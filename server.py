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
from pathlib import Path
from datetime import datetime, timedelta

PORT = int(os.environ.get('PORT', 8888))
JWT_SECRET = os.environ.get('JWT_SECRET', 'ct-investments-secret-key-change-in-production')
DB_PATH = Path(__file__).parent / 'data' / 'ct_invest.db'

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
    except Exception as e:
        print(f'[MR] Generation error: {e}')
        import traceback; traceback.print_exc()
    finally:
        with _mr_lock:
            _mr_generating.discard(today)


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
        elif self.path.startswith('/api/admin/') and self.path.split('?')[0] in ('/api/admin/users', '/api/admin/actions', '/api/admin/stats'):
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
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self.path.startswith('/api/watchlist/'):
            self.handle_delete_watchlist()
        elif self.path.startswith('/api/admin/picks/'):
            self.handle_admin_delete_pick()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
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

            token = jwt_encode({
                'uid': user_id,
                'email': email,
                'name': name,
                'role': role,
                'exp': time.time() + 30 * 24 * 3600  # 30 days
            })

            log_action(db, user_id, 'register', f'New user registered: {email}')

            self.send_json({
                'token': token,
                'user': {'id': user_id, 'email': email, 'name': name, 'role': role}
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

            token = jwt_encode({
                'uid': user['id'],
                'email': user['email'],
                'name': user['display_name'],
                'role': user['role'],
                'exp': time.time() + 30 * 24 * 3600
            })

            log_action(db, user['id'], 'login', f'User login: {email}')

            self.send_json({
                'token': token,
                'user': {
                    'id': user['id'],
                    'email': user['email'],
                    'name': user['display_name'],
                    'role': user['role']
                }
            })
        finally:
            db.close()

    def handle_me(self):
        user = self.require_user()
        if not user:
            return
        self.send_json({'user': {
            'id': user['uid'],
            'email': user['email'],
            'name': user['name'],
            'role': user['role']
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
                    'SELECT id, email, display_name, role, created_at, last_login, login_count FROM users ORDER BY created_at DESC'
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
