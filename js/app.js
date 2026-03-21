// ============================================================
// CONFIGURATION
// ============================================================
const TWSE = 'https://www.twse.com.tw/rwd/zh';
const TPEX_OLD = 'https://www.tpex.org.tw/web/stock';
const TPEX_NEW = 'https://www.tpex.org.tw/www/zh-tw';
const CACHE_MS = 10 * 60 * 1000;
const REQUEST_DELAY = 50;
const MAX_CONCURRENT = 6;

// ============================================================
// UTILITIES
// ============================================================
function parseNum(s) {
  if (!s || s === '--' || s === 'X' || s === ' ' || s === '' || s === '---' || s === '----' || s === '除息' || s === '除權' || s === '除權息') return 0;
  return parseFloat(String(s).replace(/,/g, '').replace(/\+/g, '')) || 0;
}

function fmtNum(n, dec) {
  if (isNaN(n) || n === null) return '--';
  return Number(n).toLocaleString('zh-TW', {
    minimumFractionDigits: dec || 0,
    maximumFractionDigits: dec || 0
  });
}

function fmtBig(n) {
  if (isNaN(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + ' 億';
  if (abs >= 1e4) return (n / 1e4).toFixed(0) + ' 萬';
  return fmtNum(n);
}

function fmtShares(n) {
  if (isNaN(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e3).toFixed(0) + ' 張';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + ' 張';
  return fmtNum(n) + ' 股';
}

function limitTag(pct) {
  if (pct >= 9.5) return '<span class="limit-tag limit-up">漲停</span>';
  if (pct <= -9.5) return '<span class="limit-tag limit-down">跌停</span>';
  return '';
}

function limitPrice(price, pct) {
  const txt = fmtNum(price, 2);
  if (pct >= 9.5) return '<span class="limit-price limit-price-up">' + txt + '</span>';
  if (pct <= -9.5) return '<span class="limit-price limit-price-down">' + txt + '</span>';
  return txt;
}

// Warning / Disposition stock sets
let gWarningSet = new Set();
let gDispositionSet = new Set();

async function loadWarningStocks() {
  try {
    const [wRes, dRes] = await Promise.allSettled([
      apiFetch(TWSE + '/announcement/attentionStk?response=json'),
      apiFetch(TWSE + '/announcement/dispositionStk?response=json')
    ]);
    if (wRes.status === 'fulfilled' && wRes.value && wRes.value.data) {
      wRes.value.data.forEach(r => { if (r[0]) gWarningSet.add(r[0].trim()); });
    }
    if (dRes.status === 'fulfilled' && dRes.value && dRes.value.data) {
      dRes.value.data.forEach(r => { if (r[0]) gDispositionSet.add(r[0].trim()); });
    }
    console.log('[CT] Warning stocks:', gWarningSet.size, '/ Disposition stocks:', gDispositionSet.size);
  } catch (e) { console.warn('[CT] loadWarningStocks error:', e); }
}

function warningTag(code) {
  let tag = '';
  if (gDispositionSet.has(code)) tag += '<span class="badge-disposition">處置</span>';
  if (gWarningSet.has(code)) tag += '<span class="badge-warning">警示</span>';
  return tag;
}

function rocToISO(roc) {
  const parts = roc.trim().split('/');
  const y = parseInt(parts[0]) + 1911;
  return y + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
}

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - (daysAgo || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + m + dd;
}

function toTpexDate(yyyymmdd) {
  const y = parseInt(yyyymmdd.slice(0, 4)) - 1911;
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return y + '/' + m + '/' + d;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// iOS PWA: prevent whole-page drag/bounce
// ============================================================
(function() {
  if (!navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) return;
  document.addEventListener('touchmove', function(e) {
    // Allow scrolling inside panels and scrollable containers
    var el = e.target;
    while (el && el !== document.body) {
      var style = window.getComputedStyle(el);
      var oy = style.overflowY;
      var ox = style.overflowX;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth) return;
      el = el.parentElement;
    }
    e.preventDefault();
  }, { passive: false });
})();

// ============================================================
// Prevent page scroll when interacting with charts (all platforms)
// Wheel → chart handles zoom; Drag → chart handles pan
// ============================================================
document.addEventListener('wheel', function(e) {
  var el = e.target;
  while (el) {
    if (el.classList && el.classList.contains('chart-box')) {
      e.preventDefault();
      return;
    }
    el = el.parentElement;
  }
}, { passive: false });

// ============================================================
// Prevent horizontal scroll drift on desktop
// (text selection drag can bypass overflow:hidden in all browsers)
// ============================================================
window.addEventListener('scroll', function() {
  if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
});
document.addEventListener('scroll', function() {
  if (document.documentElement.scrollLeft !== 0) document.documentElement.scrollLeft = 0;
  if (document.body.scrollLeft !== 0) document.body.scrollLeft = 0;
}, true);

// ============================================================
// CACHE & FETCH (with concurrency control)
// ============================================================
const _cache = {};

function cacheGet(key) {
  const c = _cache[key];
  return (c && Date.now() - c.t < CACHE_MS) ? c.d : null;
}

function cacheSet(key, data) {
  _cache[key] = { d: data, t: Date.now() };
}

let _activeCount = 0;
const _fetchQ = [];

function apiFetch(url) {
  return new Promise((resolve, reject) => {
    const c = cacheGet(url);
    if (c) { resolve(c); return; }
    _fetchQ.push({ url, resolve, reject });
    _drainQ();
  });
}

async function _drainQ() {
  while (_activeCount < MAX_CONCURRENT && _fetchQ.length > 0) {
    _activeCount++;
    const { url, resolve, reject } = _fetchQ.shift();
    _doFetch(url).then(resolve).catch(reject).finally(() => {
      _activeCount--;
      _drainQ();
    });
  }
}

async function _doFetch(url, _retry) {
  const c = cacheGet(url);
  if (c) return c;
  await sleep(REQUEST_DELAY * Math.random());

  // Route all external API requests through proxy to bypass CORS
  let fetchUrl = url;
  if (url.includes('tpex.org.tw') || url.includes('twse.com.tw') || url.includes('yahoo.com') || url.includes('cnyes.com') || url.includes('finmindtrade.com')) {
    fetchUrl = '/api/proxy?url=' + encodeURIComponent(url);
  }

  // Timeout: abort after 12 seconds to prevent hanging
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(fetchUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    cacheSet(url, d);
    return d;
  } catch(e) {
    clearTimeout(timer);
    // Retry once on failure (rate limit, timeout, network)
    if (!_retry) {
      await sleep(1500);
      return _doFetch(url, true);
    }
    throw e;
  }
}

// ============================================================
// API CALLS — TWSE (上市)
// ============================================================
const API_TWSE = {
  instSummary: (d) => apiFetch(`${TWSE}/fund/BFI82U?response=json&date=${d}`),
  instStocks:  (d) => apiFetch(`${TWSE}/fund/T86?response=json&date=${d}&selectType=ALLBUT0999`),
  allStocks:   (d) => apiFetch(`${TWSE}/afterTrading/STOCK_DAY_ALL?response=json&date=${d}`),
  stockMonth:  (code, d) => apiFetch(`${TWSE}/afterTrading/STOCK_DAY?response=json&date=${d}&stockNo=${code}`),
  dayTrade:    (d) => apiFetch(`${TWSE}/dayTrading/TWTB4U?response=json&date=${d}`),
  sectorIndex: (d) => apiFetch(`${TWSE}/TAIEX/MI_5MINS_INDEX?response=json&date=${d}`),
  marketDaily: (d) => apiFetch(`${TWSE}/afterTrading/FMTQIK?response=json&date=${d}`),
  pePbYield:   (d) => apiFetch(`${TWSE}/afterTrading/BWIBBU_d?response=json&date=${d}&selectType=ALL`),
  marginTrade: (d) => apiFetch(`${TWSE}/marginTrading/MI_MARGN?response=json&date=${d}&selectType=STOCK`),
  marginSummary: (d) => apiFetch(`${TWSE}/marginTrading/MI_MARGN?response=json&date=${d}`),
};

// ============================================================
// API CALLS — TPEx (上櫃) — using verified working endpoints
// ============================================================
const API_TPEX = {
  // 所有上櫃股票每日收盤行情 (d=ROC date like 115/02/26)
  allStocks: (d) => apiFetch(`${TPEX_OLD}/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&o=json&d=${toTpexDate(d)}&se=EW`),
  // 三大法人買賣明細 (d=ROC date)
  instStocks: (d) => apiFetch(`${TPEX_OLD}/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&d=${toTpexDate(d)}&se=EW&t=D`),
  // 個股月成交資訊 (date=Western yyyy/mm/dd, code=stock code)
  stockMonth: (code, westernDate) => apiFetch(`${TPEX_NEW}/afterTrading/tradingStock?response=json&date=${westernDate}&code=${code}`),
};

// ============================================================
// FIND LATEST TRADING DATE
// ============================================================
async function findTradingDate() {
  // Strategy 1: Use OpenAPI FMTQIK (always works, has latest date)
  try {
    const fmtqik = await apiFetch(OPENAPI_FMTQIK);
    if (Array.isArray(fmtqik) && fmtqik.length > 0) {
      // Date is in ROC format like "1150302", convert to Western "20260302"
      const rocDate = fmtqik[fmtqik.length - 1].Date || fmtqik[0].Date;
      if (rocDate && rocDate.length === 7) {
        const y = parseInt(rocDate.slice(0, 3)) + 1911;
        return `${y}${rocDate.slice(3)}`;
      }
    }
  } catch(e) { console.warn('[CT] FMTQIK date detection failed:', e.message); }

  // Strategy 2: Use OpenAPI STOCK_DAY_ALL (has Date field)
  try {
    const stocks = await apiFetch(OPENAPI_TWSE_ALL);
    if (Array.isArray(stocks) && stocks.length > 0) {
      const rocDate = stocks[0].Date;
      if (rocDate && rocDate.length === 7) {
        const y = parseInt(rocDate.slice(0, 3)) + 1911;
        return `${y}${rocDate.slice(3)}`;
      }
    }
  } catch(e) { console.warn('[CT] OpenAPI date detection failed:', e.message); }

  // Strategy 3: Traditional BFI82U (fallback, may be blocked on some hosts)
  for (let i = 0; i < 7; i++) {
    try {
      const d = dateStr(i);
      const r = await apiFetch(`${TWSE}/fund/BFI82U?response=json&date=${d}`);
      if (r && r.stat === 'OK') return d;
    } catch(e) {}
  }
  return dateStr(0);
}

// ============================================================
// STOCK DATABASE — build from loaded data for search
// ============================================================
let gStockDB = {}; // { code: { name, market:'twse'|'tpex' } }

function buildStockDB() {
  gAllStocks.forEach(s => {
    const code = (s[0] || '').trim();
    if (/^\d{4,6}$/.test(code)) {
      gStockDB[code] = { name: (s[1] || '').trim(), market: 'twse' };
    }
  });
  gTpexAllStocks.forEach(s => {
    const code = (s[0] || '').trim();
    if (/^\d{4,6}$/.test(code)) {
      gStockDB[code] = { name: (s[1] || '').trim(), market: 'tpex' };
    }
  });
}

function getMarket(code) {
  if (gStockDB[code]) return gStockDB[code].market;
  return null; // unknown, will try both
}

function searchStocks(query) {
  query = query.trim().toLowerCase();
  if (!query) return [];
  const results = [];
  for (const [code, info] of Object.entries(gStockDB)) {
    if (code.startsWith(query) || info.name.toLowerCase().includes(query)) {
      results.push({ code, name: info.name, market: info.market });
      if (results.length >= 15) break;
    }
  }
  // Sort: exact code match first, then by code
  results.sort((a, b) => {
    if (a.code === query) return -1;
    if (b.code === query) return 1;
    if (a.code.startsWith(query) && !b.code.startsWith(query)) return -1;
    if (!a.code.startsWith(query) && b.code.startsWith(query)) return 1;
    return a.code.localeCompare(b.code);
  });
  return results;
}

// ============================================================
// TECHNICAL ANALYSIS
// ============================================================
const TA = {
  sma(arr, p) {
    const r = [];
    for (let i = 0; i < arr.length; i++) {
      if (i < p - 1) { r.push(null); continue; }
      let s = 0;
      for (let j = 0; j < p; j++) s += arr[i - j];
      r.push(s / p);
    }
    return r;
  },

  ema(arr, p) {
    const k = 2 / (p + 1);
    const r = [arr[0]];
    for (let i = 1; i < arr.length; i++) r.push(arr[i] * k + r[i - 1] * (1 - k));
    return r;
  },

  rsi(closes, p) {
    p = p || 14;
    if (closes.length < p + 1) return closes.map(() => null);
    const chg = [];
    for (let i = 1; i < closes.length; i++) chg.push(closes[i] - closes[i - 1]);
    const gains = chg.map(c => c > 0 ? c : 0);
    const losses = chg.map(c => c < 0 ? -c : 0);
    let ag = 0, al = 0;
    for (let j = 0; j < p; j++) { ag += gains[j]; al += losses[j]; }
    ag /= p; al /= p;
    const r = new Array(p + 1).fill(null);
    r[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = p; i < chg.length; i++) {
      ag = (ag * (p - 1) + gains[i]) / p;
      al = (al * (p - 1) + losses[i]) / p;
      r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return r;
  },

  macd(closes) {
    const e12 = this.ema(closes, 12);
    const e26 = this.ema(closes, 26);
    const dif = e12.map((v, i) => v - e26[i]);
    const sig = this.ema(dif, 9);
    const hist = dif.map((v, i) => (v - sig[i]) * 2);
    return { dif, sig, hist };
  },

  kd(H, L, C, p) {
    p = p || 9;
    const rsv = [];
    for (let i = 0; i < C.length; i++) {
      if (i < p - 1) { rsv.push(50); continue; }
      const hh = Math.max(...H.slice(i - p + 1, i + 1));
      const ll = Math.min(...L.slice(i - p + 1, i + 1));
      rsv.push(hh === ll ? 50 : (C[i] - ll) / (hh - ll) * 100);
    }
    const K = [50], D = [50];
    for (let i = 1; i < rsv.length; i++) {
      K.push(K[i - 1] * 2 / 3 + rsv[i] / 3);
      D.push(D[i - 1] * 2 / 3 + K[i] / 3);
    }
    return { K, D };
  },

  boll(closes, p, m) {
    p = p || 20; m = m || 2;
    const mid = this.sma(closes, p);
    const up = [], dn = [];
    for (let i = 0; i < closes.length; i++) {
      if (mid[i] === null) { up.push(null); dn.push(null); continue; }
      const sl = closes.slice(i - p + 1, i + 1);
      const std = Math.sqrt(sl.reduce((s, v) => s + (v - mid[i]) ** 2, 0) / p);
      up.push(mid[i] + m * std);
      dn.push(mid[i] - m * std);
    }
    return { up, mid, dn };
  }
};

// ============================================================
// SIGNAL DETECTION
// ============================================================
function detectSignals(C, H, L, V) {
  const sigs = [];
  const n = C.length;
  if (n < 30) return sigs;
  const i = n - 1, p = n - 2;
  const ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20);
  const rsi = TA.rsi(C);
  const { dif, sig } = TA.macd(C);
  const { K, D } = TA.kd(H, L, C);
  const bb = TA.boll(C);

  if (ma5[i] > ma20[i] && ma5[p] <= ma20[p]) sigs.push({ t: 'bullish', s: 'MA5/MA20 黃金交叉' });
  if (ma5[i] < ma20[i] && ma5[p] >= ma20[p]) sigs.push({ t: 'bearish', s: 'MA5/MA20 死亡交叉' });
  if (ma10[i] > ma20[i] && ma10[p] <= ma20[p]) sigs.push({ t: 'bullish', s: 'MA10/MA20 黃金交叉' });
  if (ma10[i] < ma20[i] && ma10[p] >= ma20[p]) sigs.push({ t: 'bearish', s: 'MA10/MA20 死亡交叉' });

  if (dif[i] > sig[i] && dif[p] <= sig[p]) sigs.push({ t: 'bullish', s: 'MACD 多方交叉' });
  if (dif[i] < sig[i] && dif[p] >= sig[p]) sigs.push({ t: 'bearish', s: 'MACD 空方交叉' });

  if (K[i] > D[i] && K[p] <= D[p]) sigs.push({ t: K[i] < 30 ? 'bullish' : 'neutral', s: 'KD 黃金交叉' + (K[i] < 30 ? '（低檔強）' : '') });
  if (K[i] < D[i] && K[p] >= D[p]) sigs.push({ t: K[i] > 70 ? 'bearish' : 'neutral', s: 'KD 死亡交叉' + (K[i] > 70 ? '（高檔強）' : '') });

  if (rsi[i] != null && rsi[i] < 30) sigs.push({ t: 'bullish', s: 'RSI 超賣 (' + rsi[i].toFixed(1) + ')' });
  if (rsi[i] != null && rsi[i] > 70) sigs.push({ t: 'bearish', s: 'RSI 超買 (' + rsi[i].toFixed(1) + ')' });

  if (bb.up[i] && C[i] > bb.up[i]) sigs.push({ t: 'bearish', s: '突破布林上軌' });
  if (bb.dn[i] && C[i] < bb.dn[i]) sigs.push({ t: 'bullish', s: '跌破布林下軌（可能反彈）' });

  if (C[i] > (ma5[i]||0) && C[i] > (ma10[i]||0) && C[i] > (ma20[i]||0)) sigs.push({ t: 'bullish', s: '多頭排列（站穩所有均線）' });
  if (C[i] < (ma5[i]||Infinity) && C[i] < (ma10[i]||Infinity) && C[i] < (ma20[i]||Infinity) && ma20[i]) sigs.push({ t: 'bearish', s: '空頭排列（跌破所有均線）' });

  const avgV = V.slice(-20).reduce((a, b) => a + b, 0) / 20;
  if (V[i] > avgV * 2 && C[i] > C[p]) sigs.push({ t: 'bullish', s: '爆量上漲（量為均量 ' + (V[i]/avgV).toFixed(1) + ' 倍）' });
  if (V[i] > avgV * 2 && C[i] < C[p]) sigs.push({ t: 'bearish', s: '爆量下跌（量為均量 ' + (V[i]/avgV).toFixed(1) + ' 倍）' });

  return sigs;
}

// ============================================================
// AI SCORING
// ============================================================
function aiScore(C, H, L, V, inst) {
  // 委派給多因子模型（ai-scoring.js）
  if (typeof aiScoreMultiFactor === 'function') return aiScoreMultiFactor(C, H, L, V, inst);
  const n = C.length;
  if (n < 30) return { total: 50, d: {} };
  const i = n - 1, p = n - 2;
  const rsi = TA.rsi(C);
  const { dif, sig } = TA.macd(C);
  const { K, D } = TA.kd(H, L, C);
  const ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20);
  const d = {};

  let rs = 10;
  if (rsi[i] != null) {
    if (rsi[i] < 30) rs = 18;
    else if (rsi[i] < 45) rs = 15;
    else if (rsi[i] < 55) rs = 12;
    else if (rsi[i] < 70) rs = 10;
    else rs = 4;
  }
  d.RSI = rs;

  let ms = 10;
  if (dif[i] > sig[i] && dif[p] <= sig[p]) ms = 20;
  else if (dif[i] > sig[i]) ms = 15;
  else if (dif[i] < sig[i] && (dif[i] - sig[i]) > (dif[p] - sig[p])) ms = 10;
  else ms = 5;
  d.MACD = ms;

  let ks = 10;
  if (K[i] > D[i] && K[p] <= D[p] && K[i] < 30) ks = 20;
  else if (K[i] > D[i] && K[p] <= D[p]) ks = 17;
  else if (K[i] > D[i]) ks = 13;
  else if (K[i] < D[i] && K[i] > 70) ks = 3;
  else ks = 7;
  d.KD = ks;

  let mas = 10;
  const a5 = C[i] > (ma5[i]||0), a10 = C[i] > (ma10[i]||0), a20 = C[i] > (ma20[i]||0);
  if (a5 && a10 && a20) mas = 18;
  else if (a5 && a10) mas = 14;
  else if (a5) mas = 10;
  else mas = 4;
  d['均線'] = mas;

  const avgV = V.slice(-20).reduce((a, b) => a + b, 0) / 20;
  let vs = 5;
  if (V[i] > avgV * 1.5 && C[i] > C[p]) vs = 10;
  else if (V[i] > avgV * 1.5 && C[i] < C[p]) vs = 3;
  else if (V[i] < avgV * 0.5) vs = 4;
  d['量能'] = vs;

  let is_ = 5;
  if (inst) {
    const buys = (inst.f > 0 ? 1 : 0) + (inst.t > 0 ? 1 : 0) + (inst.d > 0 ? 1 : 0);
    if (buys === 3) is_ = 10;
    else if (buys === 2) is_ = 7;
    else if (buys === 1) is_ = 5;
    else is_ = 2;
  }
  d['法人'] = is_;

  return { total: rs + ms + ks + mas + vs + is_, d };
}

function scoreLabel(s) {
  if (typeof scoreLabelEnhanced === 'function') return scoreLabelEnhanced(s);
  if (s >= 80) return { text: '強力推薦', cls: 'tag-strong', color: 'var(--green)' };
  if (s >= 65) return { text: '推薦買進', cls: 'tag-buy', color: 'var(--green)' };
  if (s >= 45) return { text: '中性觀望', cls: 'tag-hold', color: 'var(--yellow)' };
  if (s >= 30) return { text: '建議減碼', cls: 'tag-sell', color: 'var(--orange)' };
  return { text: '建議避開', cls: 'tag-sell', color: 'var(--red)' };
}

// ============================================================
// AI DEEP ANALYSIS — comprehensive professional report
// ============================================================

// ============================================================
// WATCHLIST (localStorage)
// ============================================================
function wlGet() { try { return JSON.parse(localStorage.getItem('tw_wl') || '[]'); } catch { return []; } }
function wlSave(list) { localStorage.setItem('tw_wl', JSON.stringify(list)); }

// ============================================================
// RECENTLY VIEWED STOCKS
// ============================================================
function recentGet() { try { return JSON.parse(localStorage.getItem('ct_recent') || '[]'); } catch { return []; } }
function recentAdd(code) {
  let list = recentGet().filter(c => c !== code);
  list.unshift(code);
  if (list.length > 10) list = list.slice(0, 10);
  localStorage.setItem('ct_recent', JSON.stringify(list));
  renderRecentStocks();
}
function renderRecentStocks() {
  const el = document.getElementById('recent-stocks');
  if (!el) return;
  const list = recentGet();
  if (list.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  let html = '<div style="font-size:11px;color:var(--text2);margin-bottom:6px;">最近瀏覽</div><div class="recent-chips">';
  list.forEach(code => {
    const info = gStockDB[code];
    const name = info ? info.name : '';
    html += `<span class="recent-chip" onclick="goAnalyze('${code}')">${code}${name ? ' ' + name : ''}</span>`;
  });
  html += '</div>';
  el.innerHTML = html;
}

// ============================================================
// GLOBAL STATE
// ============================================================
let gDate = '';
let gAllStocks = [];      // TWSE
let gTpexAllStocks = [];  // TPEx
let gInstStocks = [];     // TWSE institutional
let gTpexInstStocks = []; // TPEx institutional
let gMarginData = null;   // 融資融券市場彙總
let gChartsReady = false;
let gStockMap = {};   // cached: code → { data, market }
let gInstMap = {};    // cached: code → { f, t, d }
let gWlYahooCache = {}; // Yahoo Finance fallback cache for watchlist: code → { price, chg, pct, vol }
let gWlFetching = false; // prevent duplicate Yahoo fetches

function rebuildMaps() {
  gStockMap = {};
  gAllStocks.forEach(s => { gStockMap[s[0].trim()] = { data: s, market: 'twse' }; });
  gTpexAllStocks.forEach(s => {
    var c = (s[0]||'').trim();
    if (c) gStockMap[c] = { data: s, market: 'tpex' };
  });
  gInstMap = {};

  // Priority 1: FinMind institutional data (most reliable on cloud)
  if (gFinMindInst && typeof gFinMindInst === 'object' && !gFinMindInst.error) {
    Object.keys(gFinMindInst).forEach(function(code) {
      var d = gFinMindInst[code];
      gInstMap[code] = { f: d.f || 0, t: d.t || 0, d: d.d || 0 };
    });
  }

  // Priority 2: TWSE T86 (overwrites FinMind if available — T86 is more detailed)
  gInstStocks.forEach(r => {
    var c = r[0].trim();
    gInstMap[c] = { f: parseNum(r[4]), t: parseNum(r[10]), d: parseNum(r[11]) };
  });
  // Priority 3: TPEX inst (overwrites for TPEX stocks)
  gTpexInstStocks.forEach(r => {
    var c = (r[0]||'').trim();
    try { gInstMap[c] = { f: parseNum(r[10]), t: parseNum(r[13]), d: parseNum(r[22]) }; } catch(e) {}
  });
}

// OpenAPI endpoints (reliable, not blocked by TWSE WAF, no date dependency)
const OPENAPI_TWSE_ALL   = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const OPENAPI_TPEX_ALL   = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes';
const OPENAPI_EMERGING   = 'https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics';
const OPENAPI_TPEX_CLOSE = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const OPENAPI_BWIBBU     = 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL';
const OPENAPI_MI_MARGN   = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN';
const OPENAPI_FMTQIK     = 'https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK';
const OPENAPI_MI_INDEX   = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX';

// ============================================================
// TWSE MIS BATCH REALTIME QUOTES (5-second fresh data)
// ============================================================
let gMisCache = {}; // code → { price, chg, pct, vol, high, low, open, time }

async function fetchMisBatch(codes) {
  if (!codes || codes.length === 0) return {};

  // Try Fugle batch first (up to 30 codes)
  var fugleGot = {};
  try {
    var batchData = await fetchFugleBatch(codes.slice(0, 30));
    if (batchData && typeof batchData === 'object' && !batchData.error) {
      Object.keys(batchData).forEach(function(code) {
        var q = batchData[code];
        if (!q || q.error) return;
        var price = q.closePrice || q.lastPrice || q.tradePrice || 0;
        var prev = q.previousClose || q.referencePrice || 0;
        if (price > 0 && prev > 0) {
          var chg = price - prev;
          gMisCache[code] = {
            price: price, chg: chg, pct: (chg / prev * 100),
            vol: q.tradeVolume || q.totalVolume || 0,
            high: q.highPrice || 0, low: q.lowPrice || 0,
            open: q.openPrice || 0, time: '', name: q.name || '',
          };
          fugleGot[code] = true;
        }
      });
    }
  } catch(e) {}

  // MIS fallback for codes not covered by Fugle
  var misCodes = codes.filter(function(c) { return !fugleGot[c]; });
  if (misCodes.length > 0) {
    var chunks = [];
    for (var i = 0; i < misCodes.length; i += 20) {
      chunks.push(misCodes.slice(i, i + 20));
    }
    for (var ci = 0; ci < chunks.length; ci++) {
      var chunk = chunks[ci];
      var exCh = chunk.map(function(code) {
        var m = getMarket(code);
        return ((m === 'tpex' || m === 'emerging') ? 'otc_' : 'tse_') + code + '.tw';
      }).join('|');
      try {
        var url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + encodeURIComponent(exCh) + '&json=1&delay=0&_=' + Date.now();
        var r = await fetch('/api/proxy?url=' + encodeURIComponent(url));
        if (!r.ok) continue;
        var d = await r.json();
        if (!d.msgArray) continue;
        d.msgArray.forEach(function(info) {
          var code = info.c;
          if (!code) return;
          var price = parseFloat(info.z);
          if (!price || isNaN(price)) price = parseFloat(info.pz);
          if (!price || isNaN(price)) {
            var bestAsk = parseFloat((info.a || '').split('_')[0]);
            var bestBid = parseFloat((info.b || '').split('_')[0]);
            if (bestAsk > 0 && bestBid > 0) price = (bestAsk + bestBid) / 2;
            else if (bestAsk > 0) price = bestAsk;
            else if (bestBid > 0) price = bestBid;
          }
          if (!price || isNaN(price)) price = parseFloat(info.o);
          if (!price || isNaN(price)) price = parseFloat(info.y);
          if (!price || isNaN(price)) price = 0;
          var prevClose = parseFloat(info.y) || 0;
          var chg = price > 0 && prevClose > 0 ? price - prevClose : 0;
          var pct = prevClose > 0 ? (chg / prevClose * 100) : 0;
          gMisCache[code] = {
            price: price, chg: chg, pct: pct,
            vol: parseInt(info.v) || 0,
            high: parseFloat(info.h) || 0, low: parseFloat(info.l) || 0,
            open: parseFloat(info.o) || 0, time: info.t || '', name: info.n || '',
          };
        });
      } catch(e) {}
      if (ci < chunks.length - 1) await sleep(2000);
    }
  }
  return gMisCache;
}

// Fetch missing watchlist stocks from Yahoo Finance
async function fetchWatchlistMissing(codes) {
  if (codes.length === 0 || gWlFetching) return;
  gWlFetching = true;
  try {
    // Try both suffixes in parallel for each stock
    var allSymbols = [];
    codes.forEach(function(code) {
      allSymbols.push(code + '.TW');
      allSymbols.push(code + '.TWO');
    });
    var quotes = await fetchYahooQuotes(allSymbols);
    quotes.forEach(function(q) {
      var c = q.symbol.replace('.TWO', '').replace('.TW', '');
      // Keep the one with highest price (avoid stale/zero entries)
      var existing = gWlYahooCache[c];
      var newEntry = {
        price: q.regularMarketPrice || 0,
        chg: q.regularMarketChange || 0,
        pct: q.regularMarketChangePercent || 0,
        vol: q.regularMarketVolume || 0,
      };
      if (!existing || newEntry.price > existing.price) {
        gWlYahooCache[c] = newEntry;
      }
    });
    // Re-render if user is still on watchlist
    var activePanel = document.querySelector('.panel.active');
    if (activePanel && activePanel.id === 'panel-watchlist') {
      if (typeof renderWatchlist === 'function') renderWatchlist();
    }
  } catch(e) { /* silent */ }
  gWlFetching = false;
}

let chtMain, chtRsi, chtKd, chtMacd;
let sCan, sVol, sMa5, sMa10, sMa20, sBbU, sBbL;
let sRsi, sKK, sDD, sDif, sSig, sHist;

// ============================================================
// TOAST
// ============================================================
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ============================================================
// STATUS
// ============================================================
function setStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  dot.className = 'status-dot ' + state;
  txt.textContent = text;
}

// ============================================================
// TABLE HELPER
// ============================================================
function mkTable(headers, rows) {
  let h = '<table><thead><tr>';
  headers.forEach((t, i) => h += `<th data-col="${i}">${t}</th>`);
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr>';
    r.forEach(c => h += `<td>${c}</td>`);
    h += '</tr>';
  });
  h += '</tbody></table>';
  return h;
}

// ============================================================
// NAVIGATION (with History API for back gesture support)
// ============================================================
let navHistoryDepth = 0;
const _tabScrollPos = {}; // { tabName: scrollTop }

function switchTab(tabName, pushHistory, restoreScroll) {
  if (pushHistory === undefined) pushHistory = false;
  // In simple mode, redirect hidden tabs to overview
  const hiddenInSimple = ['institutional','daytrade','sectors','global','screener','compare','briefing'];
  if (document.body.classList.contains('simple-mode') && hiddenInSimple.includes(tabName)) {
    tabName = 'overview';
  }
  const currentNav = document.querySelector('.nav-item.active');
  const currentTab = currentNav ? currentNav.dataset.tab : null;
  if (currentTab === tabName && !pushHistory) return;

  // Save scroll position of current panel before leaving
  if (currentTab) {
    const curPanel = document.getElementById('panel-' + currentTab);
    if (curPanel) _tabScrollPos[currentTab] = curPanel.scrollTop;
  }

  if (pushHistory && currentTab) {
    history.pushState({ tab: tabName, fromTab: currentTab }, '', '');
    navHistoryDepth++;
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const navEl = document.querySelector('[data-tab="' + tabName + '"]');
  if (navEl) navEl.classList.add('active');
  const panel = document.getElementById('panel-' + tabName);
  if (panel) {
    panel.classList.add('active');
    if (restoreScroll && _tabScrollPos[tabName] != null) {
      panel.scrollTo({ top: _tabScrollPos[tabName], behavior: 'instant' });
    } else if (!restoreScroll) {
      panel.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  if (tabName === 'analysis' && !gChartsReady && typeof initCharts === 'function') initCharts();
  if (tabName === 'watchlist') {
    var wlCodes = wlGet();
    if (wlCodes.length > 0 && typeof fetchMisBatch === 'function') {
      fetchMisBatch(wlCodes).then(function() { if (typeof renderWatchlist === 'function') renderWatchlist(); });
    }
    if (typeof renderWatchlist === 'function') renderWatchlist();
    if (typeof loadAlerts === 'function') loadAlerts();
    if (typeof loadPortfolio === 'function') loadPortfolio();
    if (typeof loadDividendCalendar === 'function') loadDividendCalendar('watchlist');
  }
  if (tabName === 'trading' && typeof initTradingTab === 'function') initTradingTab();
  if (tabName === 'compare' && typeof initCompareTab === 'function') initCompareTab();
  if (tabName === 'institutional' && typeof loadInstStreakRanking === 'function') loadInstStreakRanking();
  if (tabName === 'sectors' && typeof maybeLoadSectors === 'function') maybeLoadSectors();
  if (tabName === 'global' && typeof maybeLoadGlobal === 'function') maybeLoadGlobal();
  if (tabName === 'daytrade' && typeof maybeLoadDayTrade === 'function') maybeLoadDayTrade();
  if (tabName === 'opinion' && typeof maybeLoadOpinion === 'function') maybeLoadOpinion();
  if (tabName === 'briefing' && typeof maybeLoadBriefing === 'function') maybeLoadBriefing();
  if (tabName === 'admin' && typeof loadAdminPanel === 'function') loadAdminPanel();
  if (tabName === 'academy' && typeof initAcademyFull === 'function') initAcademyFull();
  if (typeof trackAction === 'function') trackAction('view_tab', tabName);
  updateBackBtn();
  if (window.innerWidth <= 768 && typeof updateMobileNavActive === 'function') updateMobileNavActive(tabName);
}

// Replace initial history entry so back button doesn't leave the site
history.replaceState({ tab: 'overview' }, '', '');

window.addEventListener('popstate', function(e) {
  navHistoryDepth = Math.max(0, navHistoryDepth - 1);
  if (e.state && e.state.tab) {
    switchTab(e.state.tab, false, true);
  } else {
    // No state = user at first entry, stay on overview instead of leaving
    history.replaceState({ tab: 'overview' }, '', '');
    switchTab('overview', false, true);
  }
});

function updateBackBtn() {
  var btn = document.getElementById('back-btn');
  if (btn) btn.style.display = navHistoryDepth > 0 ? 'flex' : 'none';
}

document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
  el.addEventListener('click', () => {
    switchTab(el.dataset.tab);
  });
});

document.getElementById('stock-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    closeAC();
    if (typeof analyzeStock === 'function') analyzeStock();
  }
});

document.getElementById('wl-add-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && typeof addWatchlistFromInput === 'function') addWatchlistFromInput();
});

document.querySelectorAll('#inst-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#inst-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (typeof renderInstRank === 'function') renderInstRank(btn.dataset.inst);
  });
});

// Table sorting
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-col]');
  if (!th) return;
  const table = th.closest('table');
  const col = parseInt(th.dataset.col);
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const asc = th.dataset.sort !== 'asc';
  th.dataset.sort = asc ? 'asc' : 'desc';
  rows.sort((a, b) => {
    const av = (a.children[col]?.textContent || '').replace(/[,+%億萬張股 ]/g, '').trim();
    const bv = (b.children[col]?.textContent || '').replace(/[,+%億萬張股 ]/g, '').trim();
    const an = parseFloat(av), bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
    return asc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
});

// ============================================================
// AUTOCOMPLETE
// ============================================================
const acInput = document.getElementById('stock-input');
const acList = document.getElementById('ac-list');
let acIdx = -1;

let _acDebounce = null;
acInput.addEventListener('input', () => {
  clearTimeout(_acDebounce);
  const q = acInput.value.trim();
  if (q.length === 0) { closeAC(); return; }
  _acDebounce = setTimeout(() => {
  const results = searchStocks(q);
  if (results.length === 0) { closeAC(); return; }
  acIdx = -1;
  let html = '';
  results.forEach((r, i) => {
    const mCls = r.market === 'twse' ? 'tag-twse' : r.market === 'emerging' ? 'tag-emerging' : 'tag-tpex';
    const mLabel = r.market === 'twse' ? '上市' : r.market === 'emerging' ? '興櫃' : '上櫃';
    html += `<div class="ac-item" data-idx="${i}" data-code="${r.code}">
      <span><span class="ac-code">${r.code}</span> <span class="ac-name">${r.name}</span></span>
      <span class="ac-market tag-market ${mCls}">${mLabel}</span>
    </div>`;
  });
  acList.innerHTML = html;
  acList.classList.add('show');

  acList.querySelectorAll('.ac-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acInput.value = el.dataset.code;
      closeAC();
      if (typeof analyzeStock === 'function') analyzeStock();
    });
  });
  }, 150); // debounce 150ms
});

acInput.addEventListener('keydown', (e) => {
  if (!acList.classList.contains('show')) return;
  const items = acList.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    acIdx = Math.min(acIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === acIdx));
    if (items[acIdx]) acInput.value = items[acIdx].dataset.code;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    acIdx = Math.max(acIdx - 1, 0);
    items.forEach((el, i) => el.classList.toggle('active', i === acIdx));
    if (items[acIdx]) acInput.value = items[acIdx].dataset.code;
  } else if (e.key === 'Escape') {
    closeAC();
  }
});

acInput.addEventListener('blur', () => setTimeout(closeAC, 200));

function closeAC() {
  acList.classList.remove('show');
  acIdx = -1;
}


// BACKGROUND: Retry T86 institutional data (non-blocking)
// ============================================================
async function retryT86InBackground() {
  console.log('[CT] T86 empty for today, retrying in background...');
  await sleep(1500);
  for (let i = 1; i <= 7; i++) {
    try {
      const prevDate = dateStr(i);
      const [prevInst, prevTpexInst] = await Promise.allSettled([
        API_TWSE.instStocks(prevDate),
        API_TPEX.instStocks(prevDate),
      ]);
      const pi = prevInst.status === 'fulfilled' ? prevInst.value : null;
      const pti = prevTpexInst.status === 'fulfilled' ? prevTpexInst.value : null;
      if (pi && pi.stat === 'OK' && pi.data && pi.data.length > 0) {
        gInstStocks = pi.data;
        if (pti && pti.tables && pti.tables[0] && pti.tables[0].data && pti.tables[0].data.length > 0) gTpexInstStocks = pti.tables[0].data;
        else if (pti && pti.aaData && pti.aaData.length > 0) gTpexInstStocks = pti.aaData;
        console.log('[CT] T86 loaded from ' + prevDate + ' (' + gInstStocks.length + ' rows)');
        // Re-render institutional panel with the data
        if (typeof renderInstRank === 'function') renderInstRank('foreign');
        rebuildMaps();
        return;
      }
    } catch(e) {}
    await sleep(1000);
  }
  console.warn('[CT] T86 not available from any recent date');
}

// ============================================================
// APP INIT
// ============================================================
async function init() {
  setStatus('loading', '正在連線至證交所...');

  try {
    gDate = await findTradingDate();
    loadWarningStocks(); // fire-and-forget, populates gWarningSet/gDispositionSet
    setStatus('loading', '載入市場資料（上市+上櫃）...');

    // Fetch essential data + OpenAPI stock lists in parallel
    // OpenAPI endpoints are primary (not blocked by TWSE WAF)
    // Traditional endpoints are secondary fallback
    const results = await Promise.allSettled([
      API_TWSE.instSummary(gDate),        // [0] traditional (may fail)
      API_TWSE.instStocks(gDate),         // [1] traditional (may fail)
      API_TWSE.allStocks(gDate),          // [2] traditional (may fail)
      API_TPEX.allStocks(gDate),          // [3] traditional (may fail)
      API_TPEX.instStocks(gDate),         // [4] traditional (may fail)
      apiFetch(OPENAPI_TWSE_ALL),         // [5] OpenAPI 上市 (reliable)
      apiFetch(OPENAPI_TPEX_ALL),         // [6] OpenAPI 上櫃 (reliable)
      apiFetch(OPENAPI_EMERGING),         // [7] OpenAPI 興櫃 (reliable)
      apiFetch(OPENAPI_TPEX_CLOSE),       // [8] OpenAPI 上櫃收盤 (reliable)
      API_TWSE.marginSummary(gDate),       // [9] 融資融券彙總
    ]);

    const instSummary  = results[0].status === 'fulfilled' ? results[0].value : null;
    const instStocks   = results[1].status === 'fulfilled' ? results[1].value : null;
    const allStocks    = results[2].status === 'fulfilled' ? results[2].value : null;
    const tpexAll      = results[3].status === 'fulfilled' ? results[3].value : null;
    const tpexInst     = results[4].status === 'fulfilled' ? results[4].value : null;
    const openTwse     = results[5].status === 'fulfilled' ? results[5].value : null;
    const openTpex     = results[6].status === 'fulfilled' ? results[6].value : null;
    const openEmerging = results[7].status === 'fulfilled' ? results[7].value : null;
    const openTpexClose = results[8].status === 'fulfilled' ? results[8].value : null;
    const marginRaw     = results[9].status === 'fulfilled' ? results[9].value : null;

    // --- Parse margin summary (融資融券彙總) ---
    // API format: tables[0] = 信用交易統計
    // row[0]: 融資(交易單位) — [項目, 買進, 賣出, 現償, 前日餘額, 今日餘額]
    // row[1]: 融券(交易單位) — same fields
    // row[2]: 融資金額(仟元) — same fields
    if (marginRaw && marginRaw.stat === 'OK') {
      try {
        const t = marginRaw.tables || [];
        if (t.length >= 1 && t[0].data && t[0].data.length >= 3) {
          const rows = t[0].data;
          const mShares = rows[0]; // 融資(交易單位)
          const sShares = rows[1]; // 融券(交易單位)
          const mAmount = rows[2]; // 融資金額(仟元)
          gMarginData = {
            marginBalShares: parseNum(mShares[5]),    // 融資今日餘額(張)
            marginPrevShares: parseNum(mShares[4]),   // 融資前日餘額(張)
            marginBuy: parseNum(mShares[1]),           // 融資買進(張)
            marginSell: parseNum(mShares[2]),          // 融資賣出(張)
            shortBalShares: parseNum(sShares[5]),      // 融券今日餘額(張)
            shortPrevShares: parseNum(sShares[4]),     // 融券前日餘額(張)
            marginAmount: parseNum(mAmount[5]) * 1000, // 融資餘額(元) — 原始單位仟元
            marginPrevAmount: parseNum(mAmount[4]) * 1000,
          };
        }
      } catch(e) { console.warn('[CT] Margin parse error:', e); }
    }

    // --- TWSE all stocks: prefer traditional, fallback to OpenAPI ---
    if (allStocks && allStocks.stat === 'OK' && allStocks.data) {
      gAllStocks = allStocks.data;
    } else if (Array.isArray(openTwse) && openTwse.length > 0) {
      // Convert OpenAPI format to traditional TWSE array format
      // Traditional: [code, name, volume, txn, value, open, high, low, close, change, ...]
      console.log('[CT] Traditional TWSE failed, using OpenAPI STOCK_DAY_ALL (' + openTwse.length + ' rows)');
      gAllStocks = openTwse.map(item => [
        item.Code || '', item.Name || '',
        item.TradeVolume || '0', item.Transaction || '0', item.TradeValue || '0',
        item.OpeningPrice || '--', item.HighestPrice || '--', item.LowestPrice || '--',
        item.ClosingPrice || '--', item.Change || '0',
        '', '', '', '', '', '', ''
      ]);
    }

    if (instStocks && instStocks.stat === 'OK' && instStocks.data && instStocks.data.length > 0) gInstStocks = instStocks.data;

    // TPEx data parsing (may be empty during trading hours!)
    if (tpexAll && tpexAll.tables && tpexAll.tables[0] && tpexAll.tables[0].data) {
      gTpexAllStocks = tpexAll.tables[0].data;
    } else if (tpexAll && tpexAll.aaData) {
      gTpexAllStocks = tpexAll.aaData;
    } else if (Array.isArray(openTpexClose) && openTpexClose.length > 0) {
      // Fallback: convert OpenAPI TPEX close data to traditional format
      // Traditional TPEX: [code, name, close, change, open, high, low, volume, value, txn, ...]
      console.log('[CT] Traditional TPEX failed, using OpenAPI tpex_close (' + openTpexClose.length + ' rows)');
      gTpexAllStocks = openTpexClose.map(item => [
        item.SecuritiesCompanyCode || '', item.CompanyName || '',
        item.ClosingPrice || '--', item.Change || '0',
        item.OpeningPrice || '--', item.HighestPrice || '--', item.LowestPrice || '--',
        item.TradingShares || '0', item.TradeValue || '0', item.Transaction || '0',
        '', '', '', '', '', '', ''
      ]);
    }

    if (tpexInst && tpexInst.tables && tpexInst.tables[0] && tpexInst.tables[0].data && tpexInst.tables[0].data.length > 0) {
      gTpexInstStocks = tpexInst.tables[0].data;
    } else if (tpexInst && tpexInst.aaData && tpexInst.aaData.length > 0) {
      gTpexInstStocks = tpexInst.aaData;
    }

    // Build search database from ALL sources (date-based + OpenAPI)
    buildStockDB();

    // OpenAPI supplement — always reliable, fills gaps from date-based APIs
    if (Array.isArray(openTwse)) {
      openTwse.forEach(item => {
        const code = (item.Code || '').trim();
        const name = (item.Name || '').trim();
        if (code && name && /^\d{4,6}$/.test(code) && !gStockDB[code]) {
          gStockDB[code] = { name, market: 'twse' };
        }
      });
    }
    if (Array.isArray(openTpex)) {
      openTpex.forEach(item => {
        const code = (item.SecuritiesCompanyCode || '').trim();
        const name = (item.CompanyName || '').trim();
        if (code && name && /^\d{4,6}$/.test(code) && !gStockDB[code]) {
          gStockDB[code] = { name, market: 'tpex' };
        }
      });
    }
    if (Array.isArray(openEmerging)) {
      openEmerging.forEach(item => {
        const code = (item.SecuritiesCompanyCode || '').trim();
        const name = (item.CompanyName || '').trim();
        if (code && name && /^\d{4,6}$/.test(code) && !gStockDB[code]) {
          gStockDB[code] = { name, market: 'emerging' };
        }
      });
    }

    // Build cached lookup maps for fast watchlist / screener rendering
    rebuildMaps();

    // Render overview first (shown to user immediately)
    if (typeof renderOverview === 'function') renderOverview();
    if (typeof loadOverviewEvents === 'function') loadOverviewEvents();
    if (instSummary) {
      if (typeof renderInstSummary === 'function') renderInstSummary(instSummary);
    } else {
      var noInstMsg = '<div class="text-sm text-muted" style="padding:12px;text-align:center;">法人摘要暫無法取得（證交所限制）</div>';
      var el1 = document.getElementById('inst-summary-overview');
      var el2 = document.getElementById('inst-amount-table');
      if (el1) el1.innerHTML = noInstMsg;
      if (el2) el2.innerHTML = noInstMsg;
    }

    const stockCount = Object.keys(gStockDB).length;
    const src = (allStocks && allStocks.stat === 'OK') ? '' : ' [OpenAPI]';
    setStatus('', `已連線 (${gDate.slice(0,4)}/${gDate.slice(4,6)}/${gDate.slice(6,8)}) — ${stockCount} 檔股票${src}`);

    // Render secondary panels non-blocking (after first paint)
    requestAnimationFrame(() => {
      if (typeof renderInstRank === 'function') renderInstRank('foreign');
      if (typeof renderAIRank === 'function') renderAIRank();
      if (typeof renderWatchlist === 'function') renderWatchlist();
      if (typeof renderSectorRanking === 'function') renderSectorRanking();
      if (typeof renderTaiexChart === 'function') renderTaiexChart();
      renderRecentStocks();
    });

    // If institutional per-stock data is empty (T86 not ready during trading hours),
    // retry previous dates in background (non-blocking, won't delay UI)
    if (gInstStocks.length === 0) {
      retryT86InBackground();
    }

  } catch (e) {
    setStatus('error', '連線失敗');
    let reason = '未知錯誤';
    if (e.message.includes('timeout') || e.message.includes('Timeout')) reason = '連線超時，伺服器回應過慢';
    else if (e.message.includes('502') || e.message.includes('503')) reason = '證交所/櫃買中心暫時無法連線';
    else if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) reason = '網路連線中斷，請檢查網路';
    else if (e.message.includes('CORS')) reason = '瀏覽器安全限制（CORS）';
    else reason = e.message;
    document.getElementById('market-stats').innerHTML =
      `<div class="empty-state">
        <div class="icon" style="color:var(--red);">&#x26A0;</div>
        <p style="color:var(--red);font-weight:600;">載入失敗</p>
        <p class="text-sm text-muted" style="margin-top:8px;">
          ${reason}<br><br>
          <button class="btn btn-primary" onclick="location.reload()">重新整理</button>
        </p>
      </div>`;
  }
}

// ============================================================
// TAIWAN SECTOR/THEME GROUPS
// ============================================================
const SECTORS = {
  'AI / 人工智慧': ['2330','2454','3443','2379','3035','6547','2382','3661','2308','6669','3529','2345','6515','3034','2303','3036','6770','2376'],
  '散熱 / 熱管理': ['3017','2059','6230','3078','8261','6117','3653','5765','2049','3167','6182','2367','3653','6790','3005'],
  '低軌衛星': ['2439','3455','6145','3376','3698','8072','3704','2497','4977','3260','6285','3380','2314','4906','6457'],
  'ABF載板 / IC基板': ['2313','3037','8046','3044','6196','2317','2368','3189','6234'],
  '電動車 / EV': ['2308','2327','3037','2049','6510','2231','3432','6625','1560','3665','1536','2201','1319','6488'],
  'CoWoS / 先進封裝': ['2330','3711','2379','6547','3035','2449','6805','3443','3529','3034','2351','3661'],
  '機器人': ['2317','4977','2049','3443','6285','2382','1536','3706','2062','4536','2014','6121'],
  '軍工 / 國防': ['2634','2208','2014','1513','2524','3704','8072','6230','2233','4551'],
  'DRAM / 記憶體': ['2408','4967','3450','6770','3006','3474','3260','8150','3596'],
  '半導體設備': ['3443','2379','6547','3035','5765','3583','3691','2360','6698','6510'],
  '生技醫療': ['4743','6547','4142','4174','1760','6472','4147','4726','1734','4968','6446'],
  '金融股': ['2882','2881','2884','2886','2887','2891','2880','2883','2890','2885','5880','2888','2892'],
  '高股息 / 存股': ['2882','2412','2886','2884','1216','6505','2887','5880','9910','2303','1101','2002','1326'],
  '綠能 / 儲能': ['6244','3576','3691','6443','6464','6671','3519','4807','6538','1513'],
};

let gActiveSector = Object.keys(SECTORS)[0];

function renderSectorTabs() {
  const box = document.getElementById('sector-tabs');
  box.innerHTML = Object.keys(SECTORS).map((name, i) =>
    `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-sector="${name}">${name}</button>`
  ).join('');
  box.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      box.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gActiveSector = btn.dataset.sector;
      renderSectorStocks();
    });
  });
}

function renderSectorStocks() {
  const codes = SECTORS[gActiveSector] || [];
  const sMap = {};
  gAllStocks.forEach(s => { sMap[s[0].trim()] = { d: s, m: 'twse' }; });
  gTpexAllStocks.forEach(s => { const c = (s[0]||'').trim(); if (c) sMap[c] = { d: s, m: 'tpex' }; });
  const iMap = {};
  gInstStocks.forEach(r => { iMap[r[0].trim()] = { f: parseNum(r[4]), t: parseNum(r[10]), d: parseNum(r[11]) }; });
  gTpexInstStocks.forEach(r => { const c = (r[0]||'').trim(); iMap[c] = { f: parseNum(r[10]), t: parseNum(r[13]), d: parseNum(r[22]) }; });

  const rows = [];
  const uniqueCodes = [...new Set(codes)]; // remove duplicates
  uniqueCodes.forEach(code => {
    const entry = sMap[code];
    if (!entry) return;
    const s = entry.d;
    const m = entry.m;
    let close, chg, vol, name;
    if (m === 'twse') {
      close = parseNum(s[7]); chg = parseNum(s[8]); vol = parseNum(s[2]); name = s[1].trim();
    } else {
      close = parseNum(s[2]); chg = parseNum(s[3]); vol = parseNum(s[7]); name = (s[1]||'').trim();
    }
    if (close <= 0) return;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    const inst = iMap[code] || { f: 0, t: 0, d: 0 };
    const mTag = m === 'twse' ? '<span class="tag-market tag-twse">上市</span>' : '<span class="tag-market tag-tpex">上櫃</span>';
    rows.push([
      `<span class="clickable" onclick="goAnalyze('${code}')">${code}</span>`,
      `<span class="clickable" onclick="goAnalyze('${code}')">${name}</span>`, mTag,
      limitPrice(close, pct),
      `<span class="${chg >= 0 ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)}</span>`,
      `<span class="${pct >= 0 ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>`,
      fmtBig(vol),
      `<span class="${inst.f >= 0 ? 'up' : 'down'}">${fmtShares(inst.f)}</span>`,
      `<span class="${inst.t >= 0 ? 'up' : 'down'}">${fmtShares(inst.t)}</span>`,
    ]);
  });

  document.getElementById('sector-stocks').innerHTML = rows.length > 0
    ? mkTable(['代號', '名稱', '市場', '收盤', '漲跌', '漲跌%', '成交量', '外資', '投信'], rows)
    : '<div class="text-muted" style="padding:20px;text-align:center;">尚無資料（可能未開盤或資料載入中）</div>';
}

// ============================================================

// ============================================================
// AUTH & MEMBER SYSTEM
// ============================================================
let gCurrentUser = null;
let gCurrentPlan = 'free';
let gAuthMode = 'login'; // 'login' or 'register'
