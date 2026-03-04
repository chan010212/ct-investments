#!/usr/bin/env python3
"""
CT Investments — 台灣股票儀表板後端
Serves static files + proxies API requests + member system
All using Python stdlib only (no pip dependencies)
"""

import http.server
import socketserver
import json
import os
import sys
import sqlite3
import hashlib
import hmac
import base64
import time
import urllib.request
import urllib.parse
import urllib.error
import ssl
import http.cookiejar
import subprocess
import binascii
import secrets
from pathlib import Path
from datetime import datetime, timedelta

PORT = int(os.environ.get('PORT', 8888))
JWT_SECRET = os.environ.get('JWT_SECRET', 'ct-investments-secret-key-change-in-production')
DB_PATH = Path(__file__).parent / 'data' / 'ct_invest.db'

# ============================================================
# NEWEBPAY (藍新金流) CONFIGURATION
# ============================================================
NEWEBPAY_MERCHANT_ID = os.environ.get('NEWEBPAY_MERCHANT_ID', '')
NEWEBPAY_HASH_KEY = os.environ.get('NEWEBPAY_HASH_KEY', '')
NEWEBPAY_HASH_IV = os.environ.get('NEWEBPAY_HASH_IV', '')
NEWEBPAY_TEST_MODE = os.environ.get('NEWEBPAY_TEST_MODE', '1') == '1'
SITE_URL = os.environ.get('SITE_URL', 'https://ct-investments.onrender.com')

# ============================================================
# FUGLE & FINMIND API KEYS
# ============================================================
FUGLE_API_KEY = os.environ.get('FUGLE_API_KEY', '')
FINMIND_TOKEN = os.environ.get('FINMIND_TOKEN', '')
NEWEBPAY_MPG_URL = (
    'https://ccore.newebpay.com/MPG/mpg_gateway' if NEWEBPAY_TEST_MODE
    else 'https://core.newebpay.com/MPG/mpg_gateway'
)

ALLOWED_HOSTS = [
    'www.twse.com.tw',
    'openapi.twse.com.tw',
    'www.tpex.org.tw',
    'mis.twse.com.tw',
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
    'mops.twse.com.tw',
    'api.cnyes.com',
]

# ============================================================
# SUBSCRIPTION PLAN HIERARCHY
# ============================================================
PLAN_HIERARCHY = {'free': 0, 'pro': 1, 'proplus': 2, 'admin': 99}

PLAN_PRICING = {
    'pro': {'monthly': 149, 'yearly': 1490},
    'proplus': {'monthly': 299, 'yearly': 2990},
}

PLAN_FEATURES = {
    'free': {
        'name': 'Free',
        'price': 0,
        'currency': 'TWD',
        'features': [
            '市場總覽 / 法人 / 個股分析',
            '當沖 / 題材 / 國際 / 晨訊 / AI',
            '篩選器 / 關注清單',
            '產業熱力圖',
            '股票比較（最多 2 檔）',
            '關注股除權息行事曆',
        ]
    },
    'pro': {
        'name': 'Pro',
        'price': 149,
        'currency': 'TWD',
        'features': [
            '所有 Free 功能',
            '到價提醒（10 組）',
            '籌碼連續買賣超統計',
            '投資組合績效追蹤',
            '股票比較（最多 5 檔）',
            '關注股除權息行事曆',
        ]
    },
    'proplus': {
        'name': 'Pro+',
        'price': 299,
        'currency': 'TWD',
        'features': [
            '所有 Pro 功能',
            '到價提醒（20 組）',
            '大盤歷史回測',
            '全市場除權息行事曆',
            '未來新功能優先體驗',
        ]
    }
}

# ============================================================
# SERVER-SIDE PROXY CACHE (avoid hammering upstream APIs)
# ============================================================
import threading
_proxy_cache = {}       # url → { data, content_type, ts }
_proxy_cache_lock = threading.Lock()
PROXY_CACHE_TTL = 120   # 2 minutes for most APIs
MIS_CACHE_TTL = 8       # 8 seconds for real-time MIS quotes

def proxy_cache_get(url):
    with _proxy_cache_lock:
        entry = _proxy_cache.get(url)
        if not entry:
            return None
        ttl = MIS_CACHE_TTL if 'mis.twse.com.tw' in url else PROXY_CACHE_TTL
        if time.time() - entry['ts'] > ttl:
            del _proxy_cache[url]
            return None
        return entry

def proxy_cache_set(url, data, content_type):
    with _proxy_cache_lock:
        _proxy_cache[url] = {'data': data, 'content_type': content_type, 'ts': time.time()}
        # Evict old entries if cache grows too large
        if len(_proxy_cache) > 200:
            cutoff = time.time() - PROXY_CACHE_TTL
            stale = [k for k, v in _proxy_cache.items() if v['ts'] < cutoff]
            for k in stale:
                del _proxy_cache[k]


# ============================================================
# MORNING REPORT (晨訊) — cached daily market briefing
# ============================================================
_mr_cache = {}          # { date_str: dict }
_mr_lock = threading.Lock()
_mr_generating = set()  # dates currently being generated

def _mr_today():
    return datetime.now().strftime('%Y%m%d')

def _mr_pn(s):
    if not s: return 0
    try: return int(str(s).replace(',', '').strip())
    except: pass
    try: return float(str(s).replace(',', '').strip())
    except: return 0

def _mr_cache_get():
    today = _mr_today()
    with _mr_lock:
        if today in _mr_cache:
            return _mr_cache[today]
    try:
        db = sqlite3.connect(str(DB_PATH))
        db.row_factory = sqlite3.Row
        row = db.execute('SELECT data FROM morning_report WHERE report_date = ?', (today,)).fetchone()
        db.close()
        if row:
            data = json.loads(row['data'])
            with _mr_lock:
                _mr_cache[today] = data
            return data
    except:
        pass
    return None

def _mr_cache_set(data):
    today = _mr_today()
    with _mr_lock:
        _mr_cache[today] = data
    try:
        db = sqlite3.connect(str(DB_PATH))
        db.execute('INSERT OR REPLACE INTO morning_report (report_date, data) VALUES (?, ?)',
                   (today, json.dumps(data, ensure_ascii=False)))
        db.commit()
        db.close()
    except Exception as e:
        print(f'[MR] SQLite save error: {e}')

def _mr_is_generating():
    today = _mr_today()
    with _mr_lock:
        return today in _mr_generating

def _mr_fetch_json(url, use_relaxed_ssl=False):
    ctx = None
    if use_relaxed_ssl:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json, */*',
    })
    kwargs = {'timeout': 15}
    if ctx:
        kwargs['context'] = ctx
    with urllib.request.urlopen(req, **kwargs) as resp:
        return json.loads(resp.read().decode('utf-8'))

def _mr_yq(sym):
    d = _mr_fetch_json(f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5d&interval=1d', True)
    m = d['chart']['result'][0]['meta']
    p = m.get('regularMarketPrice', 0)
    pv = m.get('previousClose', 0) or m.get('chartPreviousClose', 0)
    c = p - pv if pv else 0
    return {'price': p, 'chg': round(c, 4), 'pct': round(c / pv * 100, 2) if pv else 0}

def _mr_get_markets():
    spec = [
        ('sp500', '^GSPC', 'S&P 500'), ('dow', '^DJI', '道瓊'), ('nasdaq', '^IXIC', 'NASDAQ'), ('sox', '^SOX', '費城半導體'),
        ('nk', '^N225', '日經225'), ('sh', '000001.SS', '上證指數'), ('hsi', '^HSI', '恒生指數'),
        ('dax', '^GDAXI', '德國DAX'), ('ftse', '^FTSE', '英國FTSE'),
        ('tsm', 'TSM', '台積電ADR'), ('umc', 'UMC', '聯電ADR'),
        ('oil', 'CL=F', '原油WTI'), ('gold', 'GC=F', '黃金'),
        ('twd', 'TWD=X', '美元/台幣'), ('dxy', 'DX-Y.NYB', '美元指數'), ('vix', '^VIX', 'VIX'), ('tnx', '^TNX', '美10Y殖利率'),
    ]
    out = {}
    for k, sym, nm in spec:
        try:
            q = _mr_yq(sym); q['name'] = nm; out[k] = q
        except Exception as e:
            print(f'[MR] {nm}: {e}')
            out[k] = {'name': nm, 'price': 0, 'chg': 0, 'pct': 0}
    return out

def _mr_get_twse():
    for i in range(5):
        ds = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')
        try:
            d = _mr_fetch_json(f'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date={ds}&response=json', True)
            if d.get('stat') == 'OK' and d.get('data'):
                r = d['data'][-1]
                return {'date': r[0], 'ds': ds, 'vol': _mr_pn(r[1]), 'val': _mr_pn(r[2]),
                        'txn': _mr_pn(r[3]), 'idx': float(r[4].replace(',', '')), 'chg': float(r[5].replace(',', ''))}
        except:
            continue
    return None

def _mr_get_inst():
    inst_market = {}
    inst_stocks = []
    inst_date = ''
    for i in range(5):
        ds = (datetime.now() - timedelta(days=i)).strftime('%Y%m%d')
        try:
            d = _mr_fetch_json(f'https://www.twse.com.tw/rwd/zh/fund/BFI82U?dayDate={ds}&type=day&response=json', True)
            if d.get('stat') == 'OK' and d.get('data'):
                for row in d['data']:
                    inst_market[row[0].strip()] = _mr_pn(row[3])
                inst_date = ds
                break
        except:
            continue
    if inst_date:
        time.sleep(1)
        try:
            d = _mr_fetch_json(f'https://www.twse.com.tw/rwd/zh/fund/T86?date={inst_date}&selectType=ALL&response=json', True)
            if d.get('stat') == 'OK' and d.get('data'):
                for row in d['data']:
                    code = row[0].strip()
                    if not code or not code[0].isdigit(): continue
                    if len(row) < 19: continue
                    inst_stocks.append({
                        'c': code, 'n': row[1].strip(),
                        'fi': _mr_pn(row[4]), 'it': _mr_pn(row[10]),
                        'dl': _mr_pn(row[11]), 'tot': _mr_pn(row[18])
                    })
        except Exception as e:
            print(f'[MR] T86 error: {e}')
    return inst_market, inst_stocks, inst_date

def _mr_get_news():
    now = int(time.time()); st = now - 86400 * 2
    cats = [('headline', '頭條'), ('tw_stock_news', '台股'), ('wd_stock', '國際'), ('forex', '匯率'), ('fund', '總經')]
    out, seen = [], set()
    for cat, lbl in cats:
        try:
            d = _mr_fetch_json(f'https://api.cnyes.com/media/api/v1/newslist/category/{cat}?startAt={st}&endAt={now}&limit=25')
            for it in d.get('items', {}).get('data', []):
                t = it.get('title', '').strip()
                if not t or t.startswith('鉅亨速報') or t in seen: continue
                seen.add(t)
                pub = it.get('publishAt', 0)
                dt = datetime.fromtimestamp(pub) if pub else None
                if dt and (datetime.now() - dt).total_seconds() > 86400: continue
                nid = it.get('newsId', '')
                nurl = f'https://news.cnyes.com/news/id/{nid}' if nid else ''
                out.append({'title': t, 'cat': lbl, 'time': dt.strftime('%H:%M') if dt else '', 'ts': pub, 'url': nurl})
        except:
            pass
    out.sort(key=lambda x: x.get('ts', 0), reverse=True)
    return out

def _mr_get_earnings():
    now = int(time.time()); st = now - 86400 * 3
    kw = ['EPS', '營收', '獲利', '財報', '年報', '季報', '毛利', '淨利', '盈餘', '配息', '股利',
          '年增', '轉盈', '轉虧', '創高', '月增', '純益', '殖利率', '法說', '展望']
    out = []
    try:
        d = _mr_fetch_json(f'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock_news?startAt={st}&endAt={now}&limit=50')
        for it in d.get('items', {}).get('data', []):
            t = it.get('title', '').strip()
            if not t or t.startswith('鉅亨速報') or t.startswith('營收速報'): continue
            if any(k in t for k in kw):
                pub = it.get('publishAt', 0)
                dt = datetime.fromtimestamp(pub) if pub else None
                nid = it.get('newsId', '')
                nurl = f'https://news.cnyes.com/news/id/{nid}' if nid else ''
                out.append({'title': t, 'time': dt.strftime('%m/%d %H:%M') if dt else '',
                            'ts': pub, 'summary': it.get('summary', '')[:120], 'url': nurl})
    except Exception as e:
        print(f'[MR] Earnings news error: {e}')
    out.sort(key=lambda x: x.get('ts', 0), reverse=True)
    return out

def _mr_calc_sentiment(m):
    sc = 0; tags = []
    sp = m.get('sp500', {}).get('pct', 0)
    sx = m.get('sox', {}).get('pct', 0)
    ts = m.get('tsm', {}).get('pct', 0)
    vx = m.get('vix', {}).get('price', 20)
    ty = m.get('tnx', {}).get('chg', 0)
    if sp > 1: sc += 2; tags.append(['S&P500 大漲', 'u'])
    elif sp > 0.3: sc += 1; tags.append(['S&P500 收紅', 'u'])
    elif sp > -0.3: tags.append(['S&P500 平盤', 'n'])
    elif sp > -1: sc -= 1; tags.append(['S&P500 收黑', 'd'])
    else: sc -= 2; tags.append(['S&P500 重挫', 'd'])
    if sx > 1.5: sc += 2; tags.append(['費半強勢', 'u'])
    elif sx > 0: sc += 1; tags.append(['費半收紅', 'u'])
    elif sx > -1.5: sc -= 1; tags.append(['費半收黑', 'd'])
    else: sc -= 2; tags.append(['費半重挫', 'd'])
    if ts > 1: sc += 1; tags.append(['台積電ADR漲', 'u'])
    elif ts < -1: sc -= 1; tags.append(['台積電ADR跌', 'd'])
    if vx > 30: sc -= 2; tags.append(['VIX恐慌', 'd'])
    elif vx > 25: sc -= 1; tags.append(['VIX偏高', 'd'])
    elif vx < 15: sc += 1; tags.append(['VIX低檔', 'u'])
    if ty > 0.05: sc -= 1; tags.append(['殖利率攀升', 'd'])
    elif ty < -0.05: sc += 1; tags.append(['殖利率回落', 'u'])
    if sc >= 4: return 5, '強勢偏多', tags
    if sc >= 2: return 4, '偏多', tags
    if sc >= -1: return 3, '中性震盪', tags
    if sc >= -3: return 2, '偏空', tags
    return 1, '強勢偏空', tags

def _mr_build_viewpoint(m, inst, tw, star):
    p = []
    sp = m.get('sp500', {}); sx = m.get('sox', {}); ts = m.get('tsm', {})
    vx = m.get('vix', {}); tnx = m.get('tnx', {}); oil = m.get('oil', {}); twd = m.get('twd', {})
    spp = sp.get('pct', 0); sxp = sx.get('pct', 0); tsp = ts.get('pct', 0)
    if abs(spp) > 1.5:
        w = '重挫' if spp < 0 else '大漲'
        p.append(f"隔夜美股{w}，S&P 500 收 {sp.get('price',0):,.0f}（{spp:+.2f}%），NASDAQ {m.get('nasdaq',{}).get('pct',0):+.2f}%。")
    elif abs(spp) > 0.5:
        w = '走弱' if spp < 0 else '走強'
        p.append(f"美股{w}，S&P 500 {spp:+.2f}%，NASDAQ {m.get('nasdaq',{}).get('pct',0):+.2f}%，道瓊 {m.get('dow',{}).get('pct',0):+.2f}%。")
    else:
        p.append(f"美股窄幅整理，S&P 500 {spp:+.2f}%，四大指數漲跌互見。")
    if abs(sxp) > 2:
        tail = '承壓明顯，電子權值股今日恐面臨修正' if sxp < 0 else '氣勢強勁，有利電子權值股表現'
        p.append(f"費半 {sxp:+.2f}%、台積電ADR {tsp:+.2f}%，半導體族群{tail}。")
    else:
        tail = '小幅回檔' if sxp < 0 else '維持穩健'
        p.append(f"費半 {sxp:+.2f}%、台積電ADR {tsp:+.2f}%，半導體族群{tail}。")
    alerts = []
    vxv = vx.get('price', 0)
    if vxv > 25: alerts.append(f"VIX {vxv:.1f}，波動風險偏高")
    if abs(tnx.get('chg', 0)) > 0.03:
        alerts.append(f"美10年殖利率{'攀升' if tnx['chg'] > 0 else '回落'}至 {tnx.get('price',0):.2f}%")
    if abs(oil.get('pct', 0)) > 3:
        alerts.append(f"原油{'飆漲' if oil['pct'] > 0 else '重挫'} {oil['pct']:+.1f}%")
    twdp = twd.get('pct', 0)
    if abs(twdp) > 0.3:
        d = '貶值' if twdp > 0 else '升值'
        alerts.append(f"台幣{d} {abs(twdp):.2f}%（{twd.get('price',0):.2f}）")
    if alerts:
        p.append('⚠ ' + '；'.join(alerts) + '。')
    if inst:
        fi = inst.get('外資及陸資(不含外資自營商)', 0) / 1e8
        it = inst.get('投信', 0) / 1e8
        if abs(fi) > 100:
            tone = '大幅買超' if fi > 0 else '大幅賣超'
            tail = '，多方結構完整。' if fi > 0 and it > 0 else '，短線賣壓沉重。' if fi < 0 and it < 0 else '，法人分歧留意攻防。'
            p.append(f"籌碼面：外資{tone} {abs(fi):.0f} 億，投信{'買超' if it > 0 else '賣超'} {abs(it):.0f} 億{tail}")
        elif abs(fi) > 30:
            p.append(f"外資{'買超' if fi > 0 else '賣超'} {abs(fi):.0f} 億，投信{'買超' if it > 0 else '賣超'} {abs(it):.0f} 億。")
    if star >= 4: p.append('【操作策略】國際環境有利，可積極佈局。關注外資回補標的及投信連續買超族群。')
    elif star == 3: p.append('【操作策略】多空交錯震盪機率高，選股不選市，倉位控制五至七成。')
    elif star == 2: p.append('【操作策略】短線偏弱，持股降至三至五成，留意止損紀律。逢低關注投信買超防禦型標的。')
    else: p.append('【操作策略】系統性風險升溫，保守防禦為主，持股三成以下。等恐慌止穩再評估進場。')
    return p

def _mr_generate():
    today = _mr_today()
    with _mr_lock:
        if today in _mr_generating:
            return
        _mr_generating.add(today)
    try:
        print(f'[MR] Generating morning report for {today}...')
        markets = _mr_get_markets()
        print('[MR] Markets done')
        twse = _mr_get_twse()
        print('[MR] TWSE done')
        inst_market, inst_stocks, inst_date = _mr_get_inst()
        print(f'[MR] Inst done ({len(inst_stocks)} stocks)')
        news = _mr_get_news()
        print(f'[MR] News done ({len(news)} items)')
        earnings = _mr_get_earnings()
        print(f'[MR] Earnings done ({len(earnings)} items)')
        star, label, tags = _mr_calc_sentiment(markets)
        viewpoint = _mr_build_viewpoint(markets, inst_market, twse, star)
        data = {
            'date': today,
            'generated_at': datetime.now().isoformat(),
            'sentiment': {'star': star, 'label': label, 'tags': tags},
            'viewpoint': viewpoint,
            'markets': markets,
            'twse': twse,
            'inst_market': inst_market,
            'inst_stocks': inst_stocks[:100],
            'inst_date': inst_date,
            'news': news[:50],
            'earnings': earnings[:15],
        }
        _mr_cache_set(data)
        print(f'[MR] Report generated and cached for {today}')
        # Collect institutional daily data after morning report
        try:
            _collect_inst_daily(inst_date, inst_stocks)
        except Exception as e2:
            print(f'[MR] inst_daily collection error: {e2}')
        # Load/update TAIEX history
        try:
            _load_taiex_history()
        except Exception as e3:
            print(f'[MR] TAIEX history error: {e3}')
    except Exception as e:
        print(f'[MR] Generation error: {e}')
        import traceback; traceback.print_exc()
    finally:
        with _mr_lock:
            _mr_generating.discard(today)


# ============================================================
# TAIEX HISTORY & BACKTEST
# ============================================================
_taiex_lock = threading.Lock()
_taiex_loaded = False

def _load_taiex_history():
    """Fetch TAIEX ^TWII 10-year history from Yahoo Finance"""
    global _taiex_loaded
    with _taiex_lock:
        if _taiex_loaded:
            return
    try:
        url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?range=10y&interval=1d'
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        })
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        result = data['chart']['result'][0]
        timestamps = result['timestamp']
        quotes = result['indicators']['quote'][0]
        db = sqlite3.connect(str(DB_PATH))
        count = 0
        for i, ts in enumerate(timestamps):
            dt = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            o = quotes['open'][i]
            h = quotes['high'][i]
            l = quotes['low'][i]
            c = quotes['close'][i]
            v = quotes['volume'][i] if quotes.get('volume') else 0
            if c is None:
                continue
            db.execute(
                'INSERT OR REPLACE INTO taiex_history (trade_date, open_price, high_price, low_price, close_price, volume) VALUES (?, ?, ?, ?, ?, ?)',
                (dt, o, h, l, c, v)
            )
            count += 1
        db.commit()
        db.close()
        print(f'[TAIEX] Loaded {count} days of history')
        with _taiex_lock:
            _taiex_loaded = True
    except Exception as e:
        print(f'[TAIEX] Load error: {e}')

def _run_backtest(db, strategy, params):
    """Run backtest on TAIEX history"""
    start_date = params.get('start_date', '2020-01-01')
    end_date = params.get('end_date', datetime.now().strftime('%Y-%m-%d'))
    amount = float(params.get('amount', 100000))

    rows = db.execute(
        'SELECT trade_date, close_price FROM taiex_history WHERE trade_date >= ? AND trade_date <= ? ORDER BY trade_date',
        (start_date, end_date)
    ).fetchall()

    if len(rows) < 2:
        return {'error': '歷史資料不足，請稍後再試'}

    dates = [r[0] for r in rows]
    closes = [r[1] for r in rows]

    if strategy == 'lump_sum':
        # Single lump sum investment
        buy_price = closes[0]
        end_price = closes[-1]
        total_return = (end_price - buy_price) / buy_price * 100
        years = max((len(dates) / 252), 0.1)
        cagr = ((end_price / buy_price) ** (1 / years) - 1) * 100
        final_value = amount * (end_price / buy_price)
        # Max drawdown
        peak = closes[0]
        max_dd = 0
        for c in closes:
            if c > peak:
                peak = c
            dd = (peak - c) / peak * 100
            if dd > max_dd:
                max_dd = dd
        equity_curve = [{'date': dates[i], 'value': round(amount * closes[i] / buy_price)} for i in range(0, len(dates), max(1, len(dates) // 200))]
        return {
            'strategy': '單筆投入',
            'start_date': dates[0], 'end_date': dates[-1],
            'invested': amount, 'final_value': round(final_value),
            'total_return': round(total_return, 2),
            'cagr': round(cagr, 2),
            'max_drawdown': round(max_dd, 2),
            'trading_days': len(dates),
            'equity_curve': equity_curve,
        }

    elif strategy == 'dca':
        # Dollar Cost Averaging — monthly
        monthly_amount = amount
        total_invested = 0
        shares = 0
        last_month = ''
        equity_curve = []
        for i, (d, c) in enumerate(zip(dates, closes)):
            month = d[:7]
            if month != last_month and c > 0:
                shares += monthly_amount / c
                total_invested += monthly_amount
                last_month = month
            if i % max(1, len(dates) // 200) == 0:
                equity_curve.append({'date': d, 'value': round(shares * c)})
        final_value = shares * closes[-1]
        total_return = (final_value - total_invested) / total_invested * 100 if total_invested > 0 else 0
        return {
            'strategy': '定期定額 (每月)',
            'start_date': dates[0], 'end_date': dates[-1],
            'invested': round(total_invested),
            'final_value': round(final_value),
            'total_return': round(total_return, 2),
            'trading_days': len(dates),
            'equity_curve': equity_curve,
        }

    elif strategy == 'ma_cross':
        # Moving average crossover
        short_p = int(params.get('short_ma', 5))
        long_p = int(params.get('long_ma', 20))
        if len(closes) < long_p + 1:
            return {'error': '資料不足以計算均線'}

        cash = amount
        position = 0  # shares held
        trades = 0
        wins = 0
        entry_price = 0
        equity_curve = []
        peak = amount
        max_dd = 0

        for i in range(long_p, len(closes)):
            short_ma = sum(closes[i - short_p + 1:i + 1]) / short_p
            long_ma = sum(closes[i - long_p + 1:i + 1]) / long_p
            prev_short = sum(closes[i - short_p:i]) / short_p
            prev_long = sum(closes[i - long_p:i]) / long_p

            # Golden cross: buy
            if short_ma > long_ma and prev_short <= prev_long and position == 0 and cash > 0:
                position = cash / closes[i]
                entry_price = closes[i]
                cash = 0
                trades += 1
            # Death cross: sell
            elif short_ma < long_ma and prev_short >= prev_long and position > 0:
                cash = position * closes[i]
                if closes[i] > entry_price:
                    wins += 1
                position = 0

            total = cash + position * closes[i]
            if total > peak:
                peak = total
            dd = (peak - total) / peak * 100
            if dd > max_dd:
                max_dd = dd

            if i % max(1, len(dates) // 200) == 0:
                equity_curve.append({'date': dates[i], 'value': round(total)})

        final_value = cash + position * closes[-1]
        total_return = (final_value - amount) / amount * 100
        win_rate = (wins / trades * 100) if trades > 0 else 0

        return {
            'strategy': f'均線交叉 (MA{short_p}/MA{long_p})',
            'start_date': dates[0], 'end_date': dates[-1],
            'invested': amount,
            'final_value': round(final_value),
            'total_return': round(total_return, 2),
            'max_drawdown': round(max_dd, 2),
            'trades': trades,
            'win_rate': round(win_rate, 1),
            'trading_days': len(dates),
            'equity_curve': equity_curve,
        }

    return {'error': '不支援的策略'}


# ============================================================
# DIVIDEND DATA (除權息行事曆)
# ============================================================
_dividend_cache = {'data': None, 'ts': 0}
_dividend_lock = threading.Lock()

def _fetch_dividend_raw():
    """Fetch dividend schedule from TWSE/TPEX"""
    results = []
    now = datetime.now()
    # Fetch TWSE dividend schedule (t187ap21_L)
    for offset in range(3):
        month = now.month + offset
        year = now.year
        if month > 12:
            month -= 12
            year += 1
        try:
            url = f'https://www.twse.com.tw/rwd/zh/exRight/TWT49U?response=json&startDate={year}{month:02d}01&endDate={year}{month:02d}28'
            d = _mr_fetch_json(url, True)
            if d.get('stat') == 'OK' and d.get('data'):
                for row in d['data']:
                    try:
                        date_parts = row[0].strip().split('/')
                        iso_date = str(int(date_parts[0]) + 1911) + '-' + date_parts[1].zfill(2) + '-' + date_parts[2].zfill(2)
                        code = row[1].strip()
                        name = row[2].strip() if len(row) > 2 else ''
                        ex_type = ''
                        cash_div = 0
                        stock_div = 0
                        if len(row) > 5:
                            try:
                                cash_div = float(str(row[5]).replace(',', '').strip() or '0')
                            except:
                                pass
                        if len(row) > 6:
                            try:
                                stock_div = float(str(row[6]).replace(',', '').strip() or '0')
                            except:
                                pass
                        if cash_div > 0 and stock_div > 0:
                            ex_type = '除權息'
                        elif cash_div > 0:
                            ex_type = '除息'
                        elif stock_div > 0:
                            ex_type = '除權'
                        results.append({
                            'date': iso_date,
                            'code': code,
                            'name': name,
                            'type': ex_type,
                            'cash': cash_div,
                            'stock': stock_div,
                        })
                    except:
                        continue
            time.sleep(0.5)
        except Exception as e:
            print(f'[DIV] TWSE fetch error: {e}')
    return results

def _get_dividend_data(wl_codes=None, month=None):
    """Get dividend data, optionally filtered by watchlist or month"""
    with _dividend_lock:
        if _dividend_cache['data'] and time.time() - _dividend_cache['ts'] < 3600:
            data = _dividend_cache['data']
        else:
            data = _fetch_dividend_raw()
            _dividend_cache['data'] = data
            _dividend_cache['ts'] = time.time()

    if wl_codes is not None:
        wl_set = set(wl_codes)
        data = [d for d in data if d['code'] in wl_set]

    if month:
        data = [d for d in data if d['date'].startswith(month)]

    return data


# ============================================================
# INSTITUTIONAL DAILY DATA COLLECTION & STREAK COMPUTATION
# ============================================================
def _collect_inst_daily(date_str, inst_stocks):
    """Save T86 institutional data to inst_daily table"""
    if not date_str or not inst_stocks:
        return
    db = sqlite3.connect(str(DB_PATH))
    try:
        existing = db.execute('SELECT COUNT(*) FROM inst_daily WHERE trade_date = ?', (date_str,)).fetchone()[0]
        if existing > 0:
            print(f'[INST] Data for {date_str} already exists ({existing} rows), skipping')
            db.close()
            return
        count = 0
        for s in inst_stocks:
            code = s.get('c', '').strip()
            if not code or not code[0].isdigit():
                continue
            db.execute(
                'INSERT OR IGNORE INTO inst_daily (trade_date, stock_code, stock_name, foreign_net, trust_net, dealer_net, total_net) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (date_str, code, s.get('n', ''), s.get('fi', 0), s.get('it', 0), s.get('dl', 0), s.get('tot', 0))
            )
            count += 1
        db.commit()
        print(f'[INST] Saved {count} rows for {date_str}')
    except Exception as e:
        print(f'[INST] Error saving: {e}')
    finally:
        db.close()

def _compute_streaks(db, stock_code, inst_type='foreign'):
    """Compute consecutive buy/sell days for a stock"""
    col_map = {'foreign': 'foreign_net', 'trust': 'trust_net', 'dealer': 'dealer_net', 'total': 'total_net'}
    col = col_map.get(inst_type, 'foreign_net')
    rows = db.execute(
        f'SELECT trade_date, {col} FROM inst_daily WHERE stock_code = ? ORDER BY trade_date DESC LIMIT 60',
        (stock_code,)
    ).fetchall()
    if not rows:
        return {'streak': 0, 'direction': 'neutral', 'total_net': 0, 'days_data': 0}
    streak = 0
    direction = 'neutral'
    total_net = 0
    first_val = rows[0][1] if rows else 0
    if first_val > 0:
        direction = 'buy'
    elif first_val < 0:
        direction = 'sell'
    else:
        return {'streak': 0, 'direction': 'neutral', 'total_net': 0, 'days_data': len(rows)}
    for r in rows:
        val = r[1]
        if direction == 'buy' and val > 0:
            streak += 1
            total_net += val
        elif direction == 'sell' and val < 0:
            streak += 1
            total_net += val
        else:
            break
    return {'streak': streak, 'direction': direction, 'total_net': total_net, 'days_data': len(rows)}

def _streak_top(db, inst_type, direction, limit=20):
    """Get top stocks by consecutive buy/sell streak"""
    col_map = {'foreign': 'foreign_net', 'trust': 'trust_net', 'dealer': 'dealer_net', 'total': 'total_net'}
    col = col_map.get(inst_type, 'foreign_net')
    # Get latest date
    latest = db.execute('SELECT MAX(trade_date) FROM inst_daily').fetchone()[0]
    if not latest:
        return []
    # Get all stocks that were buy/sell on latest date
    op = '>' if direction == 'buy' else '<'
    candidates = db.execute(
        f'SELECT DISTINCT stock_code, stock_name, {col} FROM inst_daily WHERE trade_date = ? AND {col} {op} 0 ORDER BY ABS({col}) DESC LIMIT 100',
        (latest,)
    ).fetchall()
    results = []
    for c in candidates:
        code = c[0]
        name = c[1] or ''
        info = _compute_streaks(db, code, inst_type)
        if info['streak'] >= 2:
            results.append({
                'code': code, 'name': name,
                'streak': info['streak'], 'direction': info['direction'],
                'total_net': info['total_net'], 'latest_net': c[2]
            })
    results.sort(key=lambda x: x['streak'], reverse=True)
    return results[:limit]


# ============================================================
# FUGLE + FINMIND API — rate-limited cache + helpers
# ============================================================
_api_cache = {}          # key → { data, ts }
_api_cache_lock = threading.Lock()
FUGLE_CACHE_TTL = 10     # 10 seconds for real-time quotes
FINMIND_CACHE_TTL = 600  # 10 minutes for institutional/daytrade

# Rate limiter for Fugle: max 50 requests per 60 seconds
_fugle_req_times = []
_fugle_rate_lock = threading.Lock()


def api_cache_get(key, ttl):
    with _api_cache_lock:
        entry = _api_cache.get(key)
        if not entry:
            return None
        if time.time() - entry['ts'] > ttl:
            del _api_cache[key]
            return None
        return entry['data']


def api_cache_set(key, data):
    with _api_cache_lock:
        _api_cache[key] = {'data': data, 'ts': time.time()}
        if len(_api_cache) > 300:
            cutoff = time.time() - FINMIND_CACHE_TTL
            stale = [k for k, v in _api_cache.items() if v['ts'] < cutoff]
            for k in stale:
                del _api_cache[k]


def _api_fetch_json(url, headers=None):
    """Fetch JSON from URL with custom headers."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
    }
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        return json.loads(resp.read().decode('utf-8'))


def _fugle_rate_check():
    """Returns True if we can make a Fugle request (< 50 req/60s)."""
    now = time.time()
    with _fugle_rate_lock:
        _fugle_req_times[:] = [t for t in _fugle_req_times if now - t < 60]
        if len(_fugle_req_times) >= 50:
            return False
        _fugle_req_times.append(now)
        return True


def _fugle_quote(code):
    """Fetch single stock intraday quote from Fugle API."""
    if not FUGLE_API_KEY:
        return None
    cache_key = f'fugle_quote_{code}'
    cached = api_cache_get(cache_key, FUGLE_CACHE_TTL)
    if cached is not None:
        return cached
    if not _fugle_rate_check():
        return None
    try:
        url = f'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/{code}'
        data = _api_fetch_json(url, {'X-API-KEY': FUGLE_API_KEY})
        api_cache_set(cache_key, data)
        return data
    except Exception as e:
        print(f'[FUGLE] Quote error for {code}: {e}')
        return None


def _fugle_batch(codes):
    """Fetch batch quotes from Fugle (max 30 per call)."""
    if not FUGLE_API_KEY or not codes:
        return {}
    # Deduplicate and limit
    codes = list(set(codes))[:30]
    cache_key = 'fugle_batch_' + ','.join(sorted(codes))
    cached = api_cache_get(cache_key, FUGLE_CACHE_TTL)
    if cached is not None:
        return cached
    # Fetch individually (Fugle v1 doesn't have a true batch endpoint)
    result = {}
    for code in codes:
        if not _fugle_rate_check():
            break
        try:
            url = f'https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/{code}'
            data = _api_fetch_json(url, {'X-API-KEY': FUGLE_API_KEY})
            result[code] = data
            api_cache_set(f'fugle_quote_{code}', data)
        except Exception as e:
            print(f'[FUGLE] Batch quote error for {code}: {e}')
    api_cache_set(cache_key, result)
    return result


def _finmind_fetch(dataset, date_str):
    """Fetch data from FinMind API."""
    if not FINMIND_TOKEN:
        return {'_error': 'FINMIND_TOKEN not configured'}
    cache_key = f'finmind_{dataset}_{date_str}'
    cached = api_cache_get(cache_key, FINMIND_CACHE_TTL)
    if cached is not None:
        return cached
    try:
        params = urllib.parse.urlencode({
            'dataset': dataset,
            'start_date': date_str,
            'token': FINMIND_TOKEN,
        })
        url = f'https://api.finmindtrade.com/api/v4/data?{params}'
        data = _api_fetch_json(url)
        if data and data.get('status') == 200:
            result = data.get('data', [])
            api_cache_set(cache_key, result)
            return result
        msg = data.get('msg', '') if data else 'empty response'
        print(f'[FINMIND] Bad status for {dataset}: {msg}')
        return {'_error': f'FinMind API: {msg}'}
    except Exception as e:
        print(f'[FINMIND] Fetch error {dataset}/{date_str}: {e}')
        return {'_error': str(e)}


def _finmind_inst_aggregate(rows):
    """Aggregate FinMind TaiwanStockInstitutionalInvestorsBuySell rows.
    Returns { "2330": { f, t, d, total }, ... }
    """
    if not rows:
        return {}
    agg = {}
    for r in rows:
        code = r.get('stock_id', '')
        if not code or not code[0].isdigit():
            continue
        if code not in agg:
            agg[code] = {'f': 0, 't': 0, 'd': 0, 'total': 0, 'name': r.get('stock_name', '')}
        inv = r.get('name', '')
        buy = int(r.get('buy', 0))
        sell = int(r.get('sell', 0))
        net = buy - sell
        # FinMind uses English names: Foreign_Investor, Foreign_Dealer_Self,
        # Investment_Trust, Dealer_self, Dealer_Hedging
        inv_lower = inv.lower()
        if inv_lower == 'foreign_investor' or ('外資' in inv and '自營' not in inv):
            agg[code]['f'] += net
        elif inv_lower == 'investment_trust' or '投信' in inv:
            agg[code]['t'] += net
        elif inv_lower in ('dealer_self', 'dealer_hedging', 'foreign_dealer_self') or '自營' in inv:
            agg[code]['d'] += net
        agg[code]['total'] += net
    return agg


# ============================================================
# DATABASE
# ============================================================
def init_db():
    """Initialize SQLite database with member tables"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute('PRAGMA journal_mode=WAL')
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT DEFAULT 'free',
        created_at TEXT DEFAULT (datetime('now')),
        last_login TEXT,
        login_count INTEGER DEFAULT 0
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_code TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, stock_code)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS user_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS morning_report (
        report_date TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS stock_picks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stock_code TEXT NOT NULL,
        stock_name TEXT,
        action TEXT NOT NULL,
        reason TEXT,
        target_price REAL,
        stop_loss REAL,
        score INTEGER,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS inst_daily (
        trade_date TEXT NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT,
        foreign_net INTEGER DEFAULT 0,
        trust_net INTEGER DEFAULT 0,
        dealer_net INTEGER DEFAULT 0,
        total_net INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (trade_date, stock_code)
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_inst_daily_code ON inst_daily(stock_code, trade_date)')

    c.execute('''CREATE TABLE IF NOT EXISTS taiex_history (
        trade_date TEXT PRIMARY KEY,
        open_price REAL,
        high_price REAL,
        low_price REAL,
        close_price REAL,
        volume INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT,
        entry_price REAL NOT NULL,
        entry_date TEXT NOT NULL,
        shares INTEGER DEFAULT 1000,
        notes TEXT,
        status TEXT DEFAULT 'open',
        exit_price REAL,
        exit_date TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS price_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT,
        condition TEXT NOT NULL,
        target_price REAL NOT NULL,
        triggered INTEGER DEFAULT 0,
        triggered_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS plan_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        old_plan TEXT, new_plan TEXT,
        granted_by INTEGER, reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        plan TEXT NOT NULL,
        amount INTEGER NOT NULL,
        period TEXT DEFAULT 'monthly',
        status TEXT DEFAULT 'pending',
        trade_no TEXT,
        payment_type TEXT,
        pay_time TEXT,
        gateway_status TEXT,
        raw_response TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        paid_at TEXT,
        expire_at TEXT
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_orders_no ON orders(order_no)')

    # Add plan columns to users table (safe migration)
    for col_sql in [
        "ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN plan_expires_at TEXT",
        "ALTER TABLE users ADD COLUMN plan_granted_by INTEGER",
    ]:
        try:
            c.execute(col_sql)
        except Exception:
            pass  # Column already exists

    conn.commit()

    # Seed admin account and default picks if database is fresh
    if c.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0:
        pw_hash = hash_password('chan0820')
        c.execute(
            'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
            ('chan010212@gmail.com', pw_hash, '謙堂', 'admin')
        )
        default_picks = [
            ('6693', '廣閎科', 'buy'),
            ('3141', '晶宏', 'buy'),
            ('4971', 'IET-KY', 'buy'),
            ('6849', '奇鼎科技', 'buy'),
            ('4927', '泰鼎-KY', 'buy'),
        ]
        for code, name, action in default_picks:
            c.execute(
                'INSERT INTO stock_picks (stock_code, stock_name, action) VALUES (?, ?, ?)',
                (code, name, action)
            )
        conn.commit()
        print('[DB] Seeded admin account and default picks')

    conn.close()
    print(f'[DB] Database initialized at {DB_PATH}')


def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


# ============================================================
# SIMPLE JWT (stdlib only, no pyjwt needed)
# ============================================================
def _b64encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _b64decode(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)


def jwt_encode(payload):
    header = _b64encode(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
    payload_b64 = _b64encode(json.dumps(payload).encode())
    msg = f'{header}.{payload_b64}'
    sig = _b64encode(hmac.new(JWT_SECRET.encode(), msg.encode(), hashlib.sha256).digest())
    return f'{msg}.{sig}'


def jwt_decode(token):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header, payload_b64, sig = parts
        expected_sig = _b64encode(hmac.new(JWT_SECRET.encode(), f'{header}.{payload_b64}'.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload = json.loads(_b64decode(payload_b64))
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except Exception:
        return None


PBKDF2_ITERATIONS = 10000

def hash_password(password):
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
    return base64.b64encode(salt + h).decode()


def verify_password(password, stored_hash):
    try:
        decoded = base64.b64decode(stored_hash)
        salt = decoded[:16]
        stored_h = decoded[16:]
        # Try current iteration count first, fallback to legacy 100000
        h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, PBKDF2_ITERATIONS)
        if hmac.compare_digest(h, stored_h):
            return True
        h = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
        return hmac.compare_digest(h, stored_h)
    except Exception:
        return False


# ============================================================
# NEWEBPAY AES HELPERS (uses openssl subprocess — no pip)
# ============================================================
def newebpay_encrypt(plaintext):
    """AES-256-CBC encrypt, returns hex string."""
    if not NEWEBPAY_HASH_KEY or not NEWEBPAY_HASH_IV:
        raise RuntimeError('NewebPay credentials not configured')
    key_hex = binascii.hexlify(NEWEBPAY_HASH_KEY.encode()).decode()
    iv_hex = binascii.hexlify(NEWEBPAY_HASH_IV.encode()).decode()
    result = subprocess.run(
        ['openssl', 'enc', '-aes-256-cbc', '-nosalt', '-K', key_hex, '-iv', iv_hex],
        input=plaintext.encode(), capture_output=True
    )
    if result.returncode != 0:
        raise RuntimeError(f'openssl encrypt failed: {result.stderr.decode()}')
    return binascii.hexlify(result.stdout).decode()


def newebpay_decrypt(hex_cipher):
    """AES-256-CBC decrypt from hex string, returns plaintext."""
    key_hex = binascii.hexlify(NEWEBPAY_HASH_KEY.encode()).decode()
    iv_hex = binascii.hexlify(NEWEBPAY_HASH_IV.encode()).decode()
    encrypted_bytes = binascii.unhexlify(hex_cipher)
    result = subprocess.run(
        ['openssl', 'enc', '-aes-256-cbc', '-nosalt', '-d', '-K', key_hex, '-iv', iv_hex],
        input=encrypted_bytes, capture_output=True
    )
    if result.returncode != 0:
        raise RuntimeError(f'openssl decrypt failed: {result.stderr.decode()}')
    return result.stdout.decode()


def newebpay_sha256(trade_info_hex):
    """SHA256 hash for TradeSha verification."""
    raw = f'HashKey={NEWEBPAY_HASH_KEY}&{trade_info_hex}&HashIV={NEWEBPAY_HASH_IV}'
    return hashlib.sha256(raw.encode()).hexdigest().upper()


def generate_order_no():
    """Generate unique MerchantOrderNo (max 20 chars per NewebPay spec)."""
    ts = datetime.now().strftime('%Y%m%d%H%M%S')
    rand = secrets.token_hex(3).upper()
    return f'CT{ts}{rand}'[:20]


# ============================================================
# HTTP HANDLER
# ============================================================
class StockProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Serves static files + proxies API requests + member API"""

    def do_GET(self):
        if self.path == '/api/health':
            self.send_json({'status': 'ok', 'time': datetime.now().isoformat()})
            return
        elif self.path == '/api/morning-report':
            self.handle_morning_report()
        elif self.path.startswith('/api/proxy?'):
            self.handle_proxy()
        elif self.path == '/api/me':
            self.handle_me()
        elif self.path == '/api/watchlist':
            self.handle_get_watchlist()
        elif self.path == '/api/picks':
            self.handle_get_picks()
        elif self.path == '/api/plan/features':
            self.send_json(PLAN_FEATURES)
        elif self.path.startswith('/api/checkout'):
            self.handle_checkout()
        elif self.path.startswith('/api/payment/return'):
            self.handle_payment_return()
        elif self.path == '/api/orders':
            self.handle_get_orders()
        elif self.path.startswith('/api/inst-streak'):
            self.handle_inst_streak()
        elif self.path == '/api/alerts':
            self.handle_get_alerts()
        elif self.path == '/api/portfolio':
            self.handle_get_portfolio()
        elif self.path.startswith('/api/dividends'):
            self.handle_dividends()
        elif self.path.startswith('/api/fugle/quote/'):
            self.handle_fugle_quote()
        elif self.path.startswith('/api/fugle/batch'):
            self.handle_fugle_batch()
        elif self.path.startswith('/api/finmind/inst'):
            self.handle_finmind_inst()
        elif self.path.startswith('/api/finmind/daytrade'):
            self.handle_finmind_daytrade()
        elif self.path.startswith('/api/admin/') and self.path.split('?')[0] in ('/api/admin/users', '/api/admin/actions', '/api/admin/stats', '/api/admin/orders'):
            self.handle_admin_get()
        elif self.path == '/' or self.path == '':
            self.path = '/index.html'
            super().do_GET()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/register':
            self.handle_register()
        elif self.path == '/api/login':
            self.handle_login()
        elif self.path == '/api/watchlist':
            self.handle_post_watchlist()
        elif self.path == '/api/track':
            self.handle_track()
        elif self.path == '/api/admin/picks':
            self.handle_admin_picks()
        elif self.path == '/api/admin/plan':
            self.handle_admin_plan()
        elif self.path == '/api/alerts':
            self.handle_post_alert()
        elif self.path == '/api/portfolio':
            self.handle_post_portfolio()
        elif self.path == '/api/backtest':
            self.handle_backtest()
        elif self.path == '/api/payment/notify':
            self.handle_payment_notify()
        elif self.path.startswith('/api/payment/return'):
            self.handle_payment_return()
        elif self.path.startswith('/api/alerts/') and self.path.endswith('/trigger'):
            self.handle_trigger_alert()
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/watchlist/'):
            self.handle_delete_watchlist()
        elif self.path.startswith('/api/alerts/'):
            self.handle_delete_alert()
        elif self.path.startswith('/api/portfolio/'):
            self.handle_delete_portfolio()
        elif self.path.startswith('/api/admin/picks/'):
            self.handle_admin_delete_pick()
        else:
            self.send_error(404)

    def do_PUT(self):
        if self.path.startswith('/api/portfolio/'):
            self.handle_put_portfolio()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    # --- Helpers ---
    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def get_user(self):
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return None
        token = auth[7:]
        payload = jwt_decode(token)
        if not payload:
            return None
        return payload

    def require_user(self):
        user = self.get_user()
        if not user:
            self.send_json({'error': '請先登入'}, 401)
            return None
        return user

    def require_admin(self):
        user = self.get_user()
        if not user:
            self.send_json({'error': '請先登入'}, 401)
            return None
        if user.get('role') != 'admin':
            self.send_json({'error': '需要管理員權限'}, 403)
            return None
        return user

    def require_plan(self, min_plan):
        user = self.get_user()
        if not user:
            self.send_json({'error': '請先登入'}, 401)
            return None
        role = user.get('role', 'free')
        plan = user.get('plan', 'free')
        # admin bypasses all plan checks
        if role == 'admin':
            return user
        # Check plan expiration from database
        if plan in ('pro', 'proplus'):
            db = get_db()
            try:
                row = db.execute(
                    'SELECT plan, plan_expires_at FROM users WHERE id = ?',
                    (user['uid'],)
                ).fetchone()
                if row:
                    plan = row['plan'] or 'free'
                    expires = row['plan_expires_at']
                    if expires:
                        try:
                            exp_dt = datetime.fromisoformat(expires)
                            if datetime.now() > exp_dt:
                                db.execute('UPDATE users SET plan = ? WHERE id = ?', ('free', user['uid']))
                                db.execute(
                                    'INSERT INTO plan_changes (user_id, old_plan, new_plan, reason) VALUES (?, ?, ?, ?)',
                                    (user['uid'], plan, 'free', 'Auto-expired')
                                )
                                db.commit()
                                plan = 'free'
                        except Exception:
                            pass
                    user['plan'] = plan
            finally:
                db.close()
        user_level = PLAN_HIERARCHY.get(plan, 0)
        required_level = PLAN_HIERARCHY.get(min_plan, 0)
        if user_level < required_level:
            self.send_json({'error': '此功能需要升級方案', 'upgrade': True, 'required_plan': min_plan}, 403)
            return None
        return user

    # --- Auth ---
    def handle_register(self):
        body = self.read_body()
        email = (body.get('email') or '').strip().lower()
        password = body.get('password') or ''
        name = (body.get('name') or '').strip()

        if not email or '@' not in email:
            self.send_json({'error': '請輸入有效的 Email'}, 400)
            return
        if len(password) < 6:
            self.send_json({'error': '密碼至少需要 6 個字元'}, 400)
            return
        if not name:
            name = email.split('@')[0]

        db = get_db()
        try:
            existing = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
            if existing:
                self.send_json({'error': '此 Email 已被註冊'}, 409)
                return

            pw_hash = hash_password(password)
            # First user is admin
            user_count = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
            role = 'admin' if user_count == 0 else 'free'

            db.execute(
                'INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
                (email, pw_hash, name, role)
            )
            db.commit()
            user_id = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()['id']

            plan = 'free'
            token = jwt_encode({
                'uid': user_id,
                'email': email,
                'name': name,
                'role': role,
                'plan': plan if role != 'admin' else 'proplus',
                'exp': time.time() + 30 * 24 * 3600  # 30 days
            })

            log_action(db, user_id, 'register', f'New user registered: {email}')

            self.send_json({
                'token': token,
                'user': {'id': user_id, 'email': email, 'name': name, 'role': role, 'plan': plan if role != 'admin' else 'proplus'}
            })
        finally:
            db.close()

    def handle_login(self):
        body = self.read_body()
        email = (body.get('email') or '').strip().lower()
        password = body.get('password') or ''

        if not email or not password:
            self.send_json({'error': '請輸入 Email 和密碼'}, 400)
            return

        db = get_db()
        try:
            user = db.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
            if not user or not verify_password(password, user['password_hash']):
                self.send_json({'error': 'Email 或密碼錯誤'}, 401)
                return

            db.execute(
                'UPDATE users SET last_login = datetime("now"), login_count = login_count + 1 WHERE id = ?',
                (user['id'],)
            )
            db.commit()

            user_plan = user['plan'] if 'plan' in user.keys() else 'free'
            if user['role'] == 'admin':
                user_plan = 'proplus'

            token = jwt_encode({
                'uid': user['id'],
                'email': user['email'],
                'name': user['display_name'],
                'role': user['role'],
                'plan': user_plan,
                'exp': time.time() + 30 * 24 * 3600
            })

            log_action(db, user['id'], 'login', f'User login: {email}')

            self.send_json({
                'token': token,
                'user': {
                    'id': user['id'],
                    'email': user['email'],
                    'name': user['display_name'],
                    'role': user['role'],
                    'plan': user_plan
                }
            })
        finally:
            db.close()

    def handle_me(self):
        user = self.require_user()
        if not user:
            return
        # Query live plan from DB (JWT plan may be stale after payment)
        current_plan = user.get('plan', 'free')
        expires_at = None
        db = get_db()
        try:
            row = db.execute(
                'SELECT plan, plan_expires_at FROM users WHERE id = ?',
                (user['uid'],)
            ).fetchone()
            if row:
                current_plan = row['plan'] or 'free'
                expires_at = row['plan_expires_at']
                if current_plan in ('pro', 'proplus') and expires_at:
                    try:
                        if datetime.now() > datetime.fromisoformat(expires_at):
                            db.execute('UPDATE users SET plan = ? WHERE id = ?', ('free', user['uid']))
                            db.commit()
                            current_plan = 'free'
                            expires_at = None
                    except Exception:
                        pass
            if user.get('role') == 'admin':
                current_plan = 'proplus'
        finally:
            db.close()
        self.send_json({'user': {
            'id': user['uid'],
            'email': user['email'],
            'name': user['name'],
            'role': user['role'],
            'plan': current_plan,
            'plan_expires_at': expires_at,
        }})

    # --- Watchlist ---
    def handle_get_watchlist(self):
        user = self.require_user()
        if not user:
            return
        db = get_db()
        try:
            rows = db.execute(
                'SELECT stock_code, added_at FROM watchlists WHERE user_id = ? ORDER BY added_at',
                (user['uid'],)
            ).fetchall()
            self.send_json({'watchlist': [{'code': r['stock_code'], 'added_at': r['added_at']} for r in rows]})
        finally:
            db.close()

    def handle_post_watchlist(self):
        user = self.require_user()
        if not user:
            return
        body = self.read_body()
        codes = body.get('codes', [])
        if isinstance(codes, str):
            codes = [codes]

        db = get_db()
        try:
            for code in codes:
                code = code.strip()
                if code:
                    db.execute(
                        'INSERT OR IGNORE INTO watchlists (user_id, stock_code) VALUES (?, ?)',
                        (user['uid'], code)
                    )
            db.commit()
            log_action(db, user['uid'], 'watchlist_sync', json.dumps(codes))

            rows = db.execute(
                'SELECT stock_code FROM watchlists WHERE user_id = ? ORDER BY added_at',
                (user['uid'],)
            ).fetchall()
            self.send_json({'watchlist': [r['stock_code'] for r in rows]})
        finally:
            db.close()

    def handle_delete_watchlist(self):
        user = self.require_user()
        if not user:
            return
        code = self.path.split('/')[-1]
        db = get_db()
        try:
            db.execute('DELETE FROM watchlists WHERE user_id = ? AND stock_code = ?', (user['uid'], code))
            db.commit()
            log_action(db, user['uid'], 'watchlist_remove', code)
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Track user actions ---
    def handle_track(self):
        user = self.get_user()
        body = self.read_body()
        action = body.get('action', '')
        detail = body.get('detail', '')
        uid = user['uid'] if user else None

        db = get_db()
        try:
            log_action(db, uid, action, detail)
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Stock Picks (public read) ---
    def handle_get_picks(self):
        db = get_db()
        try:
            rows = db.execute(
                'SELECT * FROM stock_picks WHERE status = "active" ORDER BY created_at DESC'
            ).fetchall()
            picks = []
            for r in rows:
                picks.append({
                    'id': r['id'],
                    'code': r['stock_code'],
                    'name': r['stock_name'],
                    'action': r['action'],
                    'reason': r['reason'],
                    'target_price': r['target_price'],
                    'stop_loss': r['stop_loss'],
                    'score': r['score'],
                    'created_at': r['created_at'],
                })
            self.send_json({'picks': picks})
        finally:
            db.close()

    # --- Admin ---
    def handle_admin_get(self):
        user = self.require_admin()
        if not user:
            return

        path = self.path.split('?')[0]
        db = get_db()
        try:
            if path == '/api/admin/users':
                rows = db.execute(
                    'SELECT id, email, display_name, role, plan, created_at, last_login, login_count FROM users ORDER BY created_at DESC'
                ).fetchall()
                self.send_json({'users': [dict(r) for r in rows]})

            elif path == '/api/admin/actions':
                rows = db.execute(
                    '''SELECT a.*, u.email, u.display_name
                       FROM user_actions a
                       LEFT JOIN users u ON a.user_id = u.id
                       ORDER BY a.created_at DESC LIMIT 200'''
                ).fetchall()
                self.send_json({'actions': [dict(r) for r in rows]})

            elif path == '/api/admin/stats':
                total_users = db.execute('SELECT COUNT(*) FROM users').fetchone()[0]
                today = datetime.now().strftime('%Y-%m-%d')
                active_today = db.execute(
                    "SELECT COUNT(DISTINCT user_id) FROM user_actions WHERE created_at >= ?",
                    (today,)
                ).fetchone()[0]
                total_picks = db.execute("SELECT COUNT(*) FROM stock_picks WHERE status = 'active'").fetchone()[0]
                popular = db.execute(
                    '''SELECT stock_code, COUNT(*) as cnt
                       FROM watchlists GROUP BY stock_code ORDER BY cnt DESC LIMIT 10'''
                ).fetchall()
                self.send_json({
                    'total_users': total_users,
                    'active_today': active_today,
                    'total_picks': total_picks,
                    'popular_stocks': [{'code': r['stock_code'], 'count': r['cnt']} for r in popular]
                })

            elif path == '/api/admin/orders':
                rows = db.execute('''
                    SELECT o.*, u.email, u.display_name
                    FROM orders o JOIN users u ON o.user_id = u.id
                    ORDER BY o.created_at DESC LIMIT 200
                ''').fetchall()
                self.send_json({'orders': [dict(r) for r in rows]})
        finally:
            db.close()

    def handle_admin_picks(self):
        user = self.require_admin()
        if not user:
            return
        body = self.read_body()
        db = get_db()
        try:
            db.execute(
                '''INSERT INTO stock_picks (stock_code, stock_name, action, reason, target_price, stop_loss, score)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (body.get('code', ''), body.get('name', ''), body.get('action', 'buy'),
                 body.get('reason', ''), body.get('target_price'), body.get('stop_loss'), body.get('score'))
            )
            db.commit()
            log_action(db, user['uid'], 'admin_add_pick', json.dumps(body, ensure_ascii=False))
            self.send_json({'ok': True})
        finally:
            db.close()

    def handle_admin_delete_pick(self):
        user = self.require_admin()
        if not user:
            return
        pick_id = self.path.split('/')[-1]
        db = get_db()
        try:
            db.execute("UPDATE stock_picks SET status = 'closed' WHERE id = ?", (pick_id,))
            db.commit()
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Backtest ---
    def handle_backtest(self):
        user = self.require_plan('proplus')
        if not user:
            return
        body = self.read_body()
        strategy = body.get('strategy', 'lump_sum')
        # Ensure TAIEX history is loaded
        if not _taiex_loaded:
            threading.Thread(target=_load_taiex_history, daemon=True).start()
        db = get_db()
        try:
            count = db.execute('SELECT COUNT(*) FROM taiex_history').fetchone()[0]
            if count < 100:
                self.send_json({'status': 'loading', 'message': '正在載入歷史資料，請稍後再試'})
                return
            result = _run_backtest(db, strategy, body)
            self.send_json(result)
        finally:
            db.close()

    # --- Dividends ---
    def handle_dividends(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == '/api/dividends/watchlist':
            # FREE: only watchlist stocks
            user = self.require_user()
            if not user:
                return
            db = get_db()
            try:
                rows = db.execute('SELECT stock_code FROM watchlists WHERE user_id = ?', (user['uid'],)).fetchall()
                wl_codes = [r['stock_code'] for r in rows]
                data = _get_dividend_data(wl_codes)
                self.send_json({'dividends': data})
            finally:
                db.close()
        elif path == '/api/dividends':
            # PRO+: all market
            user = self.require_plan('proplus')
            if not user:
                return
            month = params.get('month', [''])[0]
            data = _get_dividend_data(None, month)
            self.send_json({'dividends': data})
        else:
            self.send_error(404)

    # --- Portfolio ---
    def handle_get_portfolio(self):
        user = self.require_plan('pro')
        if not user:
            return
        db = get_db()
        try:
            rows = db.execute(
                'SELECT * FROM portfolios WHERE user_id = ? ORDER BY status ASC, created_at DESC',
                (user['uid'],)
            ).fetchall()
            self.send_json({'portfolio': [dict(r) for r in rows]})
        finally:
            db.close()

    def handle_post_portfolio(self):
        user = self.require_plan('pro')
        if not user:
            return
        body = self.read_body()
        code = (body.get('stock_code') or '').strip()
        name = body.get('stock_name', '')
        entry_price = body.get('entry_price')
        entry_date = body.get('entry_date', datetime.now().strftime('%Y-%m-%d'))
        shares = body.get('shares', 1000)
        notes = body.get('notes', '')
        if not code or not entry_price:
            self.send_json({'error': '請提供股票代號和買入價格'}, 400)
            return
        db = get_db()
        try:
            db.execute(
                'INSERT INTO portfolios (user_id, stock_code, stock_name, entry_price, entry_date, shares, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
                (user['uid'], code, name, float(entry_price), entry_date, int(shares), notes)
            )
            db.commit()
            log_action(db, user['uid'], 'portfolio_add', f'{code} @ {entry_price} x {shares}')
            self.send_json({'ok': True})
        finally:
            db.close()

    def handle_put_portfolio(self):
        user = self.require_plan('pro')
        if not user:
            return
        port_id = self.path.split('/')[-1]
        body = self.read_body()
        db = get_db()
        try:
            row = db.execute('SELECT * FROM portfolios WHERE id = ? AND user_id = ?', (port_id, user['uid'])).fetchone()
            if not row:
                self.send_json({'error': '找不到持倉'}, 404)
                return
            # Update fields
            if 'exit_price' in body:
                db.execute(
                    "UPDATE portfolios SET status = 'closed', exit_price = ?, exit_date = ? WHERE id = ?",
                    (float(body['exit_price']), body.get('exit_date', datetime.now().strftime('%Y-%m-%d')), port_id)
                )
            if 'shares' in body:
                db.execute('UPDATE portfolios SET shares = ? WHERE id = ?', (int(body['shares']), port_id))
            if 'notes' in body:
                db.execute('UPDATE portfolios SET notes = ? WHERE id = ?', (body['notes'], port_id))
            db.commit()
            self.send_json({'ok': True})
        finally:
            db.close()

    def handle_delete_portfolio(self):
        user = self.require_plan('pro')
        if not user:
            return
        port_id = self.path.split('/')[-1]
        db = get_db()
        try:
            db.execute('DELETE FROM portfolios WHERE id = ? AND user_id = ?', (port_id, user['uid']))
            db.commit()
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Price Alerts ---
    def handle_get_alerts(self):
        user = self.require_plan('pro')
        if not user:
            return
        db = get_db()
        try:
            rows = db.execute(
                'SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC',
                (user['uid'],)
            ).fetchall()
            alerts = [dict(r) for r in rows]
            self.send_json({'alerts': alerts})
        finally:
            db.close()

    def handle_post_alert(self):
        user = self.require_plan('pro')
        if not user:
            return
        body = self.read_body()
        code = (body.get('stock_code') or '').strip()
        name = body.get('stock_name', '')
        condition = body.get('condition', '')
        target_price = body.get('target_price')
        if not code or condition not in ('above', 'below') or not target_price:
            self.send_json({'error': '參數不完整'}, 400)
            return
        db = get_db()
        try:
            # Check limit: pro=10, proplus=20
            plan = user.get('plan', 'free')
            max_alerts = 20 if plan == 'proplus' else 10
            count = db.execute(
                'SELECT COUNT(*) FROM price_alerts WHERE user_id = ? AND triggered = 0',
                (user['uid'],)
            ).fetchone()[0]
            if count >= max_alerts:
                self.send_json({'error': f'已達上限（{max_alerts} 組），請刪除舊提醒'}, 400)
                return
            db.execute(
                'INSERT INTO price_alerts (user_id, stock_code, stock_name, condition, target_price) VALUES (?, ?, ?, ?, ?)',
                (user['uid'], code, name, condition, float(target_price))
            )
            db.commit()
            log_action(db, user['uid'], 'create_alert', f'{code} {condition} {target_price}')
            self.send_json({'ok': True})
        finally:
            db.close()

    def handle_delete_alert(self):
        user = self.require_plan('pro')
        if not user:
            return
        alert_id = self.path.split('/')[-1]
        db = get_db()
        try:
            db.execute('DELETE FROM price_alerts WHERE id = ? AND user_id = ?', (alert_id, user['uid']))
            db.commit()
            self.send_json({'ok': True})
        finally:
            db.close()

    def handle_trigger_alert(self):
        user = self.require_plan('pro')
        if not user:
            return
        # Path: /api/alerts/{id}/trigger
        parts = self.path.split('/')
        alert_id = parts[-2]
        db = get_db()
        try:
            db.execute(
                "UPDATE price_alerts SET triggered = 1, triggered_at = datetime('now') WHERE id = ? AND user_id = ?",
                (alert_id, user['uid'])
            )
            db.commit()
            self.send_json({'ok': True})
        finally:
            db.close()

    # --- Institutional Streak ---
    def handle_inst_streak(self):
        user = self.require_plan('pro')
        if not user:
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)
        db = get_db()
        try:
            if path == '/api/inst-streak/top':
                inst_type = params.get('type', ['foreign'])[0]
                direction = params.get('dir', ['buy'])[0]
                limit = int(params.get('limit', ['20'])[0])
                results = _streak_top(db, inst_type, direction, limit)
                # Get data range info
                dates = db.execute('SELECT MIN(trade_date), MAX(trade_date), COUNT(DISTINCT trade_date) FROM inst_daily').fetchone()
                self.send_json({
                    'top': results,
                    'data_from': dates[0] or '',
                    'data_to': dates[1] or '',
                    'trading_days': dates[2] or 0
                })
            else:
                # Single stock: /api/inst-streak?code=2330
                code = params.get('code', [''])[0]
                if not code:
                    self.send_json({'error': '請提供股票代號'}, 400)
                    return
                streaks = {}
                for t in ['foreign', 'trust', 'dealer', 'total']:
                    streaks[t] = _compute_streaks(db, code, t)
                self.send_json({'code': code, 'streaks': streaks})
        finally:
            db.close()

    # --- Admin Plan Management ---
    # --- Payment (NewebPay) ---
    def handle_checkout(self):
        user = self.require_user()
        if not user:
            return
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        plan = params.get('plan', [''])[0]
        period = params.get('period', ['monthly'])[0]

        if plan not in ('pro', 'proplus'):
            self.send_json({'error': '無效的方案'}, 400)
            return
        if period not in ('monthly', 'yearly'):
            self.send_json({'error': '無效的付款週期'}, 400)
            return
        if not NEWEBPAY_MERCHANT_ID:
            self.send_json({'error': '付款功能尚未啟用，請聯繫管理員 chan010212@gmail.com'}, 503)
            return

        pricing = PLAN_PRICING.get(plan, {})
        amount = pricing.get(period, 0)
        if amount <= 0:
            self.send_json({'error': '價格設定錯誤'}, 500)
            return

        order_no = generate_order_no()
        plan_label = 'Pro' if plan == 'pro' else 'Pro+'
        period_label = '月費' if period == 'monthly' else '年費'
        item_desc = f'CT Investments {plan_label} {period_label}'

        db = get_db()
        try:
            db.execute(
                '''INSERT INTO orders (order_no, user_id, plan, amount, period, status)
                   VALUES (?, ?, ?, ?, ?, 'pending')''',
                (order_no, user['uid'], plan, amount, period)
            )
            db.commit()
        finally:
            db.close()

        timestamp = int(time.time())
        trade_params = urllib.parse.urlencode({
            'MerchantID': NEWEBPAY_MERCHANT_ID,
            'RespondType': 'JSON',
            'TimeStamp': str(timestamp),
            'Version': '2.0',
            'MerchantOrderNo': order_no,
            'Amt': str(amount),
            'ItemDesc': item_desc,
            'Email': user['email'],
            'LoginType': '0',
            'NotifyURL': f'{SITE_URL}/api/payment/notify',
            'ReturnURL': f'{SITE_URL}/api/payment/return',
            'ClientBackURL': f'{SITE_URL}',
            'CREDIT': '1',
            'WEBATM': '1',
            'VACC': '1',
        })

        trade_info = newebpay_encrypt(trade_params)
        trade_sha = newebpay_sha256(trade_info)

        self.send_json({
            'mpg_url': NEWEBPAY_MPG_URL,
            'MerchantID': NEWEBPAY_MERCHANT_ID,
            'TradeInfo': trade_info,
            'TradeSha': trade_sha,
            'Version': '2.0',
            'order_no': order_no,
            'amount': amount,
            'plan': plan,
            'period': period,
        })

    def handle_payment_notify(self):
        """NewebPay server-to-server notification (NotifyURL)."""
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            self.send_json({'error': 'empty body'}, 400)
            return

        raw_body = self.rfile.read(length).decode()
        params = urllib.parse.parse_qs(raw_body)
        trade_info_hex = params.get('TradeInfo', [''])[0]
        trade_sha = params.get('TradeSha', [''])[0]

        if not trade_info_hex or not trade_sha:
            self.send_json({'error': 'missing fields'}, 400)
            return

        expected_sha = newebpay_sha256(trade_info_hex)
        if not hmac.compare_digest(trade_sha.upper(), expected_sha.upper()):
            print('[PAYMENT] TradeSha verification FAILED')
            self.send_json({'error': 'hash mismatch'}, 400)
            return

        try:
            decrypted = newebpay_decrypt(trade_info_hex)
            result = json.loads(decrypted)
        except Exception as e:
            print(f'[PAYMENT] Decrypt failed: {e}')
            self.send_json({'error': 'decrypt failed'}, 400)
            return

        status_code = result.get('Status')
        result_data = result.get('Result', {})
        if isinstance(result_data, str):
            try:
                result_data = json.loads(result_data)
            except Exception:
                result_data = {}

        order_no = result_data.get('MerchantOrderNo', '')
        trade_no = result_data.get('TradeNo', '')
        payment_type = result_data.get('PaymentType', '')
        pay_time = result_data.get('PayTime', '')
        amount = int(result_data.get('Amt', 0))

        print(f'[PAYMENT] Notify: order={order_no} status={status_code} '
              f'trade_no={trade_no} type={payment_type} amt={amount}')

        db = get_db()
        try:
            order = db.execute(
                'SELECT * FROM orders WHERE order_no = ?', (order_no,)
            ).fetchone()

            if not order:
                print(f'[PAYMENT] Order not found: {order_no}')
                self.send_json({'error': 'order not found'}, 404)
                return

            if order['status'] == 'paid':
                self.send_json({'status': 'already processed'})
                return

            if amount != order['amount']:
                print(f'[PAYMENT] Amount mismatch: expected={order["amount"]} got={amount}')
                self.send_json({'error': 'amount mismatch'}, 400)
                return

            if status_code == 'SUCCESS':
                now = datetime.now()
                if order['period'] == 'yearly':
                    expire_at = (now + timedelta(days=365)).isoformat()
                else:
                    expire_at = (now + timedelta(days=30)).isoformat()

                db.execute('''
                    UPDATE orders SET status='paid', trade_no=?, payment_type=?,
                    pay_time=?, paid_at=datetime('now'), expire_at=?,
                    gateway_status=?, raw_response=?
                    WHERE order_no=?
                ''', (trade_no, payment_type, pay_time, expire_at,
                      status_code, json.dumps(result, ensure_ascii=False), order_no))

                user_id = order['user_id']
                old_row = db.execute('SELECT plan FROM users WHERE id=?', (user_id,)).fetchone()
                old_plan = old_row['plan'] if old_row else 'free'

                db.execute(
                    'UPDATE users SET plan=?, plan_expires_at=? WHERE id=?',
                    (order['plan'], expire_at, user_id)
                )
                db.execute(
                    '''INSERT INTO plan_changes (user_id, old_plan, new_plan, reason)
                       VALUES (?, ?, ?, ?)''',
                    (user_id, old_plan, order['plan'],
                     f'Payment: {order_no} ({payment_type})')
                )
                log_action(db, user_id, 'payment_success',
                           json.dumps({'order_no': order_no, 'plan': order['plan'],
                                       'amount': amount, 'expire_at': expire_at},
                                      ensure_ascii=False))
                db.commit()
                print(f'[PAYMENT] Activated plan={order["plan"]} for user={user_id} until {expire_at}')
            else:
                db.execute('''
                    UPDATE orders SET status='failed', gateway_status=?, raw_response=?
                    WHERE order_no=?
                ''', (status_code, json.dumps(result, ensure_ascii=False), order_no))
                log_action(db, order['user_id'], 'payment_failed',
                           json.dumps({'order_no': order_no, 'status': status_code},
                                      ensure_ascii=False))
                db.commit()
        finally:
            db.close()

        self.send_json({'status': 'ok'})

    def handle_payment_return(self):
        """NewebPay browser redirect (ReturnURL). Shows result page."""
        trade_info_hex = ''
        trade_sha = ''

        # Handle both GET (query string) and POST (form body)
        if self.command == 'POST':
            length = int(self.headers.get('Content-Length', 0))
            if length > 0:
                raw = self.rfile.read(length).decode()
                params = urllib.parse.parse_qs(raw)
                trade_info_hex = params.get('TradeInfo', [''])[0]
                trade_sha = params.get('TradeSha', [''])[0]
        else:
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            trade_info_hex = params.get('TradeInfo', [''])[0]
            trade_sha = params.get('TradeSha', [''])[0]

        success = False
        order_no = ''
        message = '付款處理中...'

        if trade_info_hex and trade_sha:
            expected_sha = newebpay_sha256(trade_info_hex)
            if hmac.compare_digest(trade_sha.upper(), expected_sha.upper()):
                try:
                    decrypted = newebpay_decrypt(trade_info_hex)
                    result = json.loads(decrypted)
                    if result.get('Status') == 'SUCCESS':
                        success = True
                        rd = result.get('Result', {})
                        if isinstance(rd, str):
                            try:
                                rd = json.loads(rd)
                            except Exception:
                                rd = {}
                        order_no = rd.get('MerchantOrderNo', '')
                        message = '付款成功！您的方案已升級。'
                    else:
                        message = f'付款未完成：{result.get("Message", "未知錯誤")}'
                except Exception:
                    message = '付款結果解析失敗，請稍後查看帳戶狀態。'

        icon = '&#10004;' if success else '&#10060;'
        title = '付款成功' if success else '付款未完成'
        color = '#00f0ff' if success else '#ff6b6b'
        order_html = f'<p>訂單編號：{order_no}</p>' if order_no else ''

        html = f'''<!DOCTYPE html>
<html lang="zh-TW"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>付款結果 - CT Investments</title>
<style>
body{{font-family:system-ui;background:#060b18;color:#e0e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}}
.card{{background:#0d1829;border:1px solid #1a2a40;border-radius:16px;padding:40px;text-align:center;max-width:420px}}
.icon{{font-size:48px;margin-bottom:16px}}
h2{{color:{color};margin:0 0 12px}}
p{{color:#8899aa;line-height:1.6}}
a{{display:inline-block;margin-top:20px;padding:12px 32px;background:linear-gradient(135deg,#00f0ff,#0080ff);color:#060b18;text-decoration:none;border-radius:8px;font-weight:700}}
</style></head><body>
<div class="card">
<div class="icon">{icon}</div>
<h2>{title}</h2>
<p>{message}</p>{order_html}
<a href="/">返回 CT Investments</a>
</div>
<script>setTimeout(function(){{window.location.href="/";}},5000);</script>
</body></html>'''

        body = html.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_get_orders(self):
        user = self.require_user()
        if not user:
            return
        db = get_db()
        try:
            rows = db.execute(
                '''SELECT order_no, plan, amount, period, status, payment_type,
                          created_at, paid_at, expire_at
                   FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50''',
                (user['uid'],)
            ).fetchall()
            self.send_json({'orders': [dict(r) for r in rows]})
        finally:
            db.close()

    def handle_admin_plan(self):
        admin = self.require_admin()
        if not admin:
            return
        body = self.read_body()
        user_id = body.get('user_id')
        new_plan = body.get('plan', 'free')
        reason = body.get('reason', '')
        if new_plan not in PLAN_HIERARCHY:
            self.send_json({'error': '無效的方案'}, 400)
            return
        db = get_db()
        try:
            user = db.execute('SELECT id, plan, display_name FROM users WHERE id = ?', (user_id,)).fetchone()
            if not user:
                self.send_json({'error': '找不到使用者'}, 404)
                return
            old_plan = user['plan'] or 'free'
            db.execute('UPDATE users SET plan = ? WHERE id = ?', (new_plan, user_id))
            db.execute(
                'INSERT INTO plan_changes (user_id, old_plan, new_plan, granted_by, reason) VALUES (?, ?, ?, ?, ?)',
                (user_id, old_plan, new_plan, admin['uid'], reason)
            )
            db.commit()
            log_action(db, admin['uid'], 'admin_change_plan',
                       json.dumps({'user_id': user_id, 'name': user['display_name'], 'old': old_plan, 'new': new_plan, 'reason': reason}, ensure_ascii=False))
            self.send_json({'ok': True, 'old_plan': old_plan, 'new_plan': new_plan})
        finally:
            db.close()

    # --- Morning Report ---
    def handle_morning_report(self):
        data = _mr_cache_get()
        if data:
            self.send_json({'status': 'ready', 'data': data})
            return
        if _mr_is_generating():
            self.send_json({'status': 'generating'})
            return
        threading.Thread(target=_mr_generate, daemon=True).start()
        self.send_json({'status': 'generating'})

    # --- Proxy ---
    # --- Fugle + FinMind API endpoints ---
    def handle_fugle_quote(self):
        """GET /api/fugle/quote/{code}"""
        code = self.path.split('/api/fugle/quote/')[-1].split('?')[0].strip()
        if not code or not code[0].isdigit():
            self.send_json({'error': 'Invalid stock code'}, 400)
            return
        if not FUGLE_API_KEY:
            self.send_json({'error': 'Fugle API key not configured'}, 503)
            return
        data = _fugle_quote(code)
        if data is None:
            self.send_json({'error': 'Rate limited or fetch failed'}, 429)
            return
        self.send_json(data)

    def handle_fugle_batch(self):
        """GET /api/fugle/batch?codes=2330,2317"""
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        codes_str = params.get('codes', [''])[0]
        if not codes_str:
            self.send_json({'error': 'Missing codes parameter'}, 400)
            return
        if not FUGLE_API_KEY:
            self.send_json({'error': 'Fugle API key not configured'}, 503)
            return
        codes = [c.strip() for c in codes_str.split(',') if c.strip()]
        data = _fugle_batch(codes)
        self.send_json(data)

    def handle_finmind_inst(self):
        """GET /api/finmind/inst?date=2026-03-04"""
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        date = params.get('date', [''])[0]
        if not date:
            self.send_json({'error': 'Missing date parameter'}, 400)
            return
        if not FINMIND_TOKEN:
            self.send_json({'error': 'FinMind token not configured'}, 503)
            return
        rows = _finmind_fetch('TaiwanStockInstitutionalInvestorsBuySell', date)
        if rows is None or (isinstance(rows, dict) and '_error' in rows):
            err = rows.get('_error', 'Unknown') if isinstance(rows, dict) else 'Fetch failed'
            self.send_json({'error': err}, 502)
            return
        agg = _finmind_inst_aggregate(rows)
        self.send_json(agg)

    def handle_finmind_daytrade(self):
        """GET /api/finmind/daytrade?date=2026-03-04"""
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        date = params.get('date', [''])[0]
        if not date:
            self.send_json({'error': 'Missing date parameter'}, 400)
            return
        if not FINMIND_TOKEN:
            self.send_json({'error': 'FinMind token not configured'}, 503)
            return
        rows = _finmind_fetch('TaiwanStockDayTrading', date)
        if rows is None or (isinstance(rows, dict) and '_error' in rows):
            err = rows.get('_error', 'Unknown') if isinstance(rows, dict) else 'Fetch failed'
            self.send_json({'error': err}, 502)
            return
        self.send_json(rows)

    def handle_proxy(self):
        try:
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            url = params.get('url', [''])[0]

            if not url:
                self.send_error(400, 'Missing url parameter')
                return

            parsed = urllib.parse.urlparse(url)
            if parsed.hostname not in ALLOWED_HOSTS:
                self.send_error(403, f'Host not allowed: {parsed.hostname}')
                return

            # Check server-side cache first (avoids hitting TWSE rate limits)
            cached = proxy_cache_get(url)
            if cached:
                self.send_response(200)
                self.send_header('Content-Type', cached['content_type'])
                self.send_header('Content-Length', str(len(cached['data'])))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'public, max-age=60')
                self.send_header('X-Cache', 'HIT')
                self.end_headers()
                self.wfile.write(cached['data'])
                return

            hostname = parsed.hostname or ''

            # TWSE/MOPS have broken SSL cert (missing Subject Key Identifier)
            # Use relaxed SSL context for these domains
            ctx = None
            if 'twse.com.tw' in hostname or 'mops.twse.com.tw' in hostname:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE

            # Build opener with cookie support (handles WAF cookie-based challenges)
            cj = http.cookiejar.CookieJar()
            handlers = [urllib.request.HTTPCookieProcessor(cj)]
            if ctx:
                handlers.append(urllib.request.HTTPSHandler(context=ctx))
            opener = urllib.request.build_opener(*handlers)

            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': f'https://{hostname}/',
                'Connection': 'keep-alive',
            }

            req = urllib.request.Request(url, headers=headers)
            resp = opener.open(req, timeout=15)
            data = resp.read()
            content_type = resp.headers.get('Content-Type', 'application/json')
            resp.close()

            # Cache the response server-side
            proxy_cache_set(url, data, content_type)

            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'public, max-age=60')
            self.send_header('X-Cache', 'MISS')
            self.end_headers()
            self.wfile.write(data)

        except urllib.error.HTTPError as e:
            body = e.read()
            # If upstream returns a redirect error, try to return the body content
            # (some WAFs return data in error responses)
            if e.code in (301, 302, 303, 307, 308):
                self.send_error(502, f'Upstream redirect not followed: {e.code}')
            else:
                self.send_error(e.code, str(e.reason))
        except urllib.error.URLError as e:
            self.send_error(502, f'Upstream error: {e.reason}')
        except Exception as e:
            self.send_error(500, str(e))

    def end_headers(self):
        # Check _headers_buffer for existing CORS header to avoid duplicates
        has_cors = False
        if hasattr(self, '_headers_buffer'):
            for h in self._headers_buffer:
                if b'access-control-allow-origin' in h.lower():
                    has_cors = True
                    break
        if not has_cors:
            self.send_header('Access-Control-Allow-Origin', '*')
        # Service worker must not be cached by browser
        if self.path == '/sw.js':
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def log_message(self, fmt, *args):
        msg = fmt % args
        if '/api/proxy' in msg:
            sys.stderr.write(f"[PROXY] {msg}\n")
        elif '/api/' in msg:
            sys.stderr.write(f"[API] {msg}\n")
        elif '200' in msg or '304' in msg:
            pass
        else:
            sys.stderr.write(f"[HTTP] {msg}\n")


def log_action(db, user_id, action, detail=''):
    db.execute(
        'INSERT INTO user_actions (user_id, action, detail) VALUES (?, ?, ?)',
        (user_id, action, detail)
    )
    db.commit()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    os.chdir(Path(__file__).parent)
    init_db()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), StockProxyHandler)
    print(f'CT Investments server started on port {PORT} (threaded)')
    print(f'  Database: {DB_PATH}')
    print(f'  Open: http://localhost:{PORT}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped')
        server.server_close()
