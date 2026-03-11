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
  if (url.includes('tpex.org.tw') || url.includes('twse.com.tw') || url.includes('yahoo.com') || url.includes('cnyes.com')) {
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
  if (s >= 80) return { text: '強力推薦', cls: 'tag-strong', color: 'var(--green)' };
  if (s >= 65) return { text: '推薦買進', cls: 'tag-buy', color: 'var(--green)' };
  if (s >= 45) return { text: '中性觀望', cls: 'tag-hold', color: 'var(--yellow)' };
  if (s >= 30) return { text: '建議減碼', cls: 'tag-sell', color: 'var(--orange)' };
  return { text: '建議避開', cls: 'tag-sell', color: 'var(--red)' };
}

// ============================================================
// AI DEEP ANALYSIS — comprehensive professional report
// ============================================================
function generateDeepAnalysis(code, name, C, H, L, V, O, dates, instInfo) {
  const n = C.length;
  if (n < 20) return '<div class="text-muted">資料不足，無法產生完整分析</div>';

  const i = n - 1;
  const lastC = C[i], lastO = O[i], lastH = H[i], lastL = L[i], lastV = V[i];
  const prevC = C[i-1];
  const chg = lastC - prevC;
  const pct = prevC > 0 ? (chg / prevC * 100) : 0;

  // Calculate indicators
  const ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20), ma60 = TA.sma(C, Math.min(60, n));
  const rsi = TA.rsi(C);
  const macd = TA.macd(C);
  const kd = TA.kd(H, L, C);
  const bb = TA.boll(C);

  // Volume analysis
  const avgV5 = V.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgV20 = V.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgV20 > 0 ? (lastV / avgV20) : 1;

  // Trend analysis (last 20 days)
  const c20ago = n > 20 ? C[i - 20] : C[0];
  const trend20 = ((lastC - c20ago) / c20ago * 100);
  const c5ago = n > 5 ? C[i - 5] : C[0];
  const trend5 = ((lastC - c5ago) / c5ago * 100);

  // Price range (recent 20 days)
  const recent20H = Math.max(...H.slice(-20));
  const recent20L = Math.min(...L.slice(-20));
  const priceRange = recent20H - recent20L;
  const posInRange = priceRange > 0 ? ((lastC - recent20L) / priceRange * 100) : 50;

  // Support/Resistance levels
  const support1 = ma20[i] || recent20L;
  const support2 = recent20L;
  const resistance1 = bb.up[i] || recent20H;
  const resistance2 = recent20H;

  // === SCORING SYSTEM (1-10) ===
  let scores = {};

  // 1. Trend Score
  let trendScore = 5;
  const aboveMa5 = lastC > (ma5[i] || 0);
  const aboveMa10 = lastC > (ma10[i] || 0);
  const aboveMa20 = lastC > (ma20[i] || 0);
  if (aboveMa5 && aboveMa10 && aboveMa20) trendScore = 8;
  else if (aboveMa5 && aboveMa10) trendScore = 7;
  else if (aboveMa5) trendScore = 6;
  else if (!aboveMa5 && !aboveMa10 && !aboveMa20) trendScore = 2;
  else if (!aboveMa5 && !aboveMa10) trendScore = 3;
  if (trend20 > 10) trendScore = Math.min(10, trendScore + 1);
  if (trend20 < -10) trendScore = Math.max(1, trendScore - 1);
  scores['趨勢動能'] = Math.min(10, Math.max(1, trendScore));

  // 2. RSI Score
  let rsiScore = 5;
  const rsiVal = rsi[i];
  if (rsiVal != null) {
    if (rsiVal < 20) rsiScore = 9; // extremely oversold, reversal likely
    else if (rsiVal < 30) rsiScore = 8;
    else if (rsiVal < 40) rsiScore = 7;
    else if (rsiVal < 55) rsiScore = 6;
    else if (rsiVal < 65) rsiScore = 5;
    else if (rsiVal < 75) rsiScore = 4;
    else if (rsiVal < 85) rsiScore = 3;
    else rsiScore = 2;
  }
  scores['RSI 指標'] = rsiScore;

  // 3. MACD Score
  let macdScore = 5;
  const difVal = macd.dif[i], sigVal = macd.sig[i], histVal = macd.hist[i];
  const prevHist = i > 0 ? macd.hist[i-1] : 0;
  if (difVal > sigVal && histVal > prevHist) macdScore = 8; // bullish and strengthening
  else if (difVal > sigVal) macdScore = 7;
  else if (difVal > sigVal && histVal < prevHist) macdScore = 6; // bullish but weakening
  else if (difVal < sigVal && histVal > prevHist) macdScore = 4; // bearish but improving
  else if (difVal < sigVal) macdScore = 3;
  else if (difVal < sigVal && histVal < prevHist) macdScore = 2;
  if (macd.dif[i] > 0 && macd.dif[i-1] <= 0) macdScore = 9;
  scores['MACD'] = Math.min(10, Math.max(1, macdScore));

  // 4. KD Score
  let kdScore = 5;
  const kVal = kd.K[i], dVal = kd.D[i];
  if (kVal > dVal && kVal < 30) kdScore = 9; // golden cross in oversold
  else if (kVal > dVal && kVal < 50) kdScore = 7;
  else if (kVal > dVal) kdScore = 6;
  else if (kVal < dVal && kVal > 80) kdScore = 2; // death cross in overbought
  else if (kVal < dVal && kVal > 50) kdScore = 4;
  else kdScore = 3;
  scores['KD 指標'] = Math.min(10, Math.max(1, kdScore));

  // 5. Volume Score
  let volScore = 5;
  if (volRatio > 2 && chg > 0) volScore = 9; // high vol + up
  else if (volRatio > 1.5 && chg > 0) volScore = 8;
  else if (volRatio > 1 && chg > 0) volScore = 7;
  else if (volRatio > 2 && chg < 0) volScore = 2; // high vol + down
  else if (volRatio > 1.5 && chg < 0) volScore = 3;
  else if (volRatio < 0.5) volScore = 4; // low vol = uncertain
  scores['量能分析'] = Math.min(10, Math.max(1, volScore));

  // 6. Institutional Score
  let instScore = 5;
  if (instInfo) {
    const buys = (instInfo.f > 0 ? 1 : 0) + (instInfo.t > 0 ? 1 : 0) + (instInfo.d > 0 ? 1 : 0);
    const total = (instInfo.f || 0) + (instInfo.t || 0) + (instInfo.d || 0);
    if (buys === 3) instScore = 9;
    else if (buys === 2 && total > 0) instScore = 7;
    else if (buys === 2) instScore = 6;
    else if (buys === 1) instScore = 5;
    else if (buys === 0 && total < 0) instScore = 2;
    else instScore = 3;
  }
  scores['法人動向'] = instScore;

  // 7. Bollinger Band Score
  let bbScore = 5;
  if (bb.up[i] && bb.dn[i]) {
    if (lastC > bb.up[i]) bbScore = 3; // overbought
    else if (lastC < bb.dn[i]) bbScore = 8; // oversold, may bounce
    else if (posInRange > 80) bbScore = 4;
    else if (posInRange < 20) bbScore = 7;
    else bbScore = 5;
  }
  scores['布林通道'] = bbScore;

  // Overall score (weighted average)
  const weights = { '趨勢動能': 2, 'RSI 指標': 1.5, 'MACD': 1.5, 'KD 指標': 1, '量能分析': 1.5, '法人動向': 2, '布林通道': 0.5 };
  let totalW = 0, weightedSum = 0;
  for (const [k, v] of Object.entries(scores)) {
    const w = weights[k] || 1;
    weightedSum += v * w;
    totalW += w;
  }
  const overallScore = (weightedSum / totalW).toFixed(1);

  // Determine verdict
  let verdict, verdictColor, verdictIcon;
  if (overallScore >= 8) { verdict = '強力看多'; verdictColor = 'var(--green)'; verdictIcon = '&#x1F680;'; }
  else if (overallScore >= 6.5) { verdict = '偏多操作'; verdictColor = 'var(--green)'; verdictIcon = '&#x2B06;'; }
  else if (overallScore >= 5) { verdict = '中性觀望'; verdictColor = 'var(--yellow)'; verdictIcon = '&#x2796;'; }
  else if (overallScore >= 3.5) { verdict = '偏空保守'; verdictColor = 'var(--orange)'; verdictIcon = '&#x2B07;'; }
  else { verdict = '強力看空'; verdictColor = 'var(--red)'; verdictIcon = '&#x26A0;'; }

  // Generate bullish/bearish factors
  const bullish = [], bearish = [];

  if (aboveMa5 && aboveMa10 && aboveMa20) bullish.push('多頭排列，價格站穩所有均線之上');
  if (!aboveMa5 && !aboveMa10 && !aboveMa20) bearish.push('空頭排列，價格跌破所有均線');
  if (rsiVal != null && rsiVal < 30) bullish.push(`RSI ${rsiVal.toFixed(1)} 進入超賣區，短線有反彈機會`);
  if (rsiVal != null && rsiVal > 70) bearish.push(`RSI ${rsiVal.toFixed(1)} 進入超買區，短線有回檔風險`);
  if (difVal > sigVal && macd.dif[i-1] <= macd.sig[i-1]) bullish.push('MACD 出現多方交叉，動能轉強');
  if (difVal < sigVal && macd.dif[i-1] >= macd.sig[i-1]) bearish.push('MACD 出現空方交叉，動能轉弱');
  if (kVal > dVal && kVal < 30) bullish.push('KD 低檔黃金交叉，強力反彈訊號');
  if (kVal < dVal && kVal > 80) bearish.push('KD 高檔死亡交叉，短線拉回風險高');
  if (volRatio > 2 && chg > 0) bullish.push(`爆量上漲（量為均量 ${volRatio.toFixed(1)} 倍），買盤強勁`);
  if (volRatio > 2 && chg < 0) bearish.push(`爆量下跌（量為均量 ${volRatio.toFixed(1)} 倍），賣壓沉重`);
  if (instInfo && instInfo.f > 0 && instInfo.t > 0) bullish.push('外資、投信同步買超，法人共識看好');
  if (instInfo && instInfo.f < 0 && instInfo.t < 0) bearish.push('外資、投信同步賣超，法人共識偏空');
  if (bb.dn[i] && lastC < bb.dn[i]) bullish.push('股價跌破布林下軌，乖離過大可能反彈');
  if (bb.up[i] && lastC > bb.up[i]) bearish.push('股價突破布林上軌，短線過熱注意');
  if (trend5 > 5) bullish.push(`近5日漲幅 ${trend5.toFixed(1)}%，短線動能強勁`);
  if (trend5 < -5) bearish.push(`近5日跌幅 ${trend5.toFixed(1)}%，短線承壓明顯`);
  if (volRatio < 0.5 && Math.abs(pct) < 1) bearish.push('量能萎縮嚴重，市場觀望氣氛濃厚');

  // Strategy suggestion
  let strategy = '';
  if (overallScore >= 7) {
    strategy = `建議策略：可考慮於 ${fmtNum(support1, 2)} 附近逢低佈局，停損設在 ${fmtNum(support2, 2)} 以下。短線目標價 ${fmtNum(resistance1, 2)}，突破後看 ${fmtNum(resistance2, 2)}。`;
  } else if (overallScore >= 5) {
    strategy = `建議策略：維持觀望，等待明確方向。若站穩 ${fmtNum(ma20[i] || support1, 2)} 可小量試單。跌破 ${fmtNum(support2, 2)} 則轉為偏空看待。`;
  } else {
    strategy = `建議策略：短線偏空，建議降低持股比重。反彈至 ${fmtNum(ma10[i] || resistance1, 2)} 附近可減碼。若跌破 ${fmtNum(support2, 2)} 恐進一步下探。`;
  }

  // Build HTML
  let html = '';

  // Overall verdict
  html += `<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px;border-radius:12px;background:rgba(0,240,255,0.04);border:1px solid ${verdictColor}30;">
    <div style="font-size:48px;">${verdictIcon}</div>
    <div style="flex:1;">
      <div style="font-size:13px;color:var(--text2);margin-bottom:4px;">AI 綜合評分</div>
      <div style="display:flex;align-items:baseline;gap:12px;">
        <span style="font-size:36px;font-weight:800;color:${verdictColor};text-shadow:0 0 15px ${verdictColor};">${overallScore}</span>
        <span style="font-size:10px;color:var(--text2);">/ 10</span>
        <span style="font-size:18px;font-weight:700;color:${verdictColor};">${verdict}</span>
      </div>
    </div>
  </div>`;

  // Score details grid
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px;">';
  for (const [label, score] of Object.entries(scores)) {
    const sc = score;
    const color = sc >= 7 ? 'var(--green)' : sc >= 5 ? 'var(--yellow)' : 'var(--red)';
    html += `<div style="background:rgba(6,11,24,0.5);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px;letter-spacing:0.5px;">${label}</div>
      <div style="font-size:24px;font-weight:700;color:${color};text-shadow:0 0 8px ${color};">${sc}</div>
      <div class="progress-bar" style="margin-top:6px;"><div class="fill" style="width:${sc*10}%;background:${color};"></div></div>
    </div>`;
  }
  html += '</div>';

  // Key levels
  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
    <div style="padding:14px;border-radius:10px;background:rgba(0,232,123,0.04);border:1px solid rgba(0,232,123,0.15);">
      <div style="font-size:12px;color:var(--green);font-weight:600;margin-bottom:8px;">&#x25B2; 壓力區間</div>
      <div style="font-size:11px;color:var(--text2);">第一壓力: <span style="color:var(--text);font-weight:600;">${fmtNum(resistance1, 2)}</span></div>
      <div style="font-size:11px;color:var(--text2);margin-top:3px;">第二壓力: <span style="color:var(--text);font-weight:600;">${fmtNum(resistance2, 2)}</span></div>
    </div>
    <div style="padding:14px;border-radius:10px;background:rgba(255,56,96,0.04);border:1px solid rgba(255,56,96,0.15);">
      <div style="font-size:12px;color:var(--red);font-weight:600;margin-bottom:8px;">&#x25BC; 支撐區間</div>
      <div style="font-size:11px;color:var(--text2);">第一支撐: <span style="color:var(--text);font-weight:600;">${fmtNum(support1, 2)}</span></div>
      <div style="font-size:11px;color:var(--text2);margin-top:3px;">第二支撐: <span style="color:var(--text);font-weight:600;">${fmtNum(support2, 2)}</span></div>
    </div>
  </div>`;

  // Bullish / Bearish factors
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">';
  html += '<div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--green);margin-bottom:8px;">&#x2B06; 利多因素</div>';
  if (bullish.length > 0) {
    bullish.forEach(b => { html += `<div style="font-size:12px;color:#c8d0e0;padding:4px 0;border-bottom:1px solid rgba(0,240,255,0.05);">+ ${b}</div>`; });
  } else {
    html += '<div style="font-size:12px;color:var(--text2);">目前無明顯利多訊號</div>';
  }
  html += '</div><div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:8px;">&#x2B07; 利空因素</div>';
  if (bearish.length > 0) {
    bearish.forEach(b => { html += `<div style="font-size:12px;color:#c8d0e0;padding:4px 0;border-bottom:1px solid rgba(0,240,255,0.05);">- ${b}</div>`; });
  } else {
    html += '<div style="font-size:12px;color:var(--text2);">目前無明顯利空訊號</div>';
  }
  html += '</div></div>';

  // Technical summary text
  let trendText = trend20 > 5 ? '上升趨勢' : trend20 < -5 ? '下降趨勢' : '盤整格局';
  let volText = volRatio > 1.5 ? '量能充沛' : volRatio > 0.8 ? '量能正常' : '量能萎縮';
  let posText = posInRange > 70 ? '相對高檔' : posInRange < 30 ? '相對低檔' : '中間位置';

  html += `<div style="padding:16px;border-radius:10px;background:rgba(0,240,255,0.03);border:1px solid var(--border);margin-bottom:16px;">
    <div style="font-size:13px;font-weight:600;color:var(--cyan);margin-bottom:10px;">&#x1F4DD; 技術面總結</div>
    <div style="font-size:12px;color:#c8d0e0;line-height:1.8;">
      ${code} ${name} 目前處於 <b>${trendText}</b>，近20日漲跌幅 ${trend20 > 0 ? '+' : ''}${trend20.toFixed(1)}%，
      股價位於近期區間 <b>${posText}</b>（${posInRange.toFixed(0)}%）。
      ${volText}，近日成交量為20日均量的 ${volRatio.toFixed(1)} 倍。
      ${rsiVal != null ? `RSI(14) = ${rsiVal.toFixed(1)}，` : ''}
      KD 值 K=${kVal.toFixed(1)} / D=${dVal.toFixed(1)}，
      MACD 柱狀圖${histVal > 0 ? '正值' : '負值'}${histVal > prevHist ? '且持續擴大' : '但有收斂'}。
    </div>
    <div style="font-size:12px;color:var(--cyan);margin-top:10px;font-weight:500;">${strategy}</div>
  </div>`;

  // Disclaimer
  html += `<div style="font-size:10px;color:var(--text2);text-align:center;padding-top:8px;border-top:1px solid var(--border);">
    &#x26A0; 以上分析由系統根據技術指標自動生成，僅供參考，不構成投資建議。投資有風險，請審慎評估。
  </div>`;

  return html;
}

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
      renderWatchlist();
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

  if (tabName === 'analysis' && !gChartsReady) initCharts();
  if (tabName === 'watchlist') {
    var wlCodes = wlGet();
    if (wlCodes.length > 0) {
      fetchMisBatch(wlCodes).then(function() { renderWatchlist(); });
    }
    renderWatchlist();
    loadAlerts();
    loadPortfolio();
    loadDividendCalendar('watchlist');
  }
  if (tabName === 'compare') initCompareTab();
  if (tabName === 'institutional') loadInstStreakRanking();
  if (tabName === 'sectors') maybeLoadSectors();
  if (tabName === 'global') maybeLoadGlobal();
  if (tabName === 'daytrade') maybeLoadDayTrade();
  if (tabName === 'opinion') maybeLoadOpinion();
  if (tabName === 'briefing') maybeLoadBriefing();
  if (tabName === 'admin') loadAdminPanel();
  trackAction('view_tab', tabName);
  updateBackBtn();
}

window.addEventListener('popstate', function(e) {
  navHistoryDepth = Math.max(0, navHistoryDepth - 1);
  if (e.state && e.state.tab) {
    switchTab(e.state.tab, false, true);
  } else {
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
    analyzeStock();
  }
});

document.getElementById('wl-add-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addWatchlistFromInput();
});

document.querySelectorAll('#inst-tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#inst-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderInstRank(btn.dataset.inst);
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
      analyzeStock();
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

// ============================================================
// INIT CHARTS
// ============================================================
function initCharts() {
  if (gChartsReady) return;
  gChartsReady = true;

  const isMobile = window.innerWidth <= 768;
  function opts(el, h) {
    return {
      width: el.clientWidth,
      height: h,
      layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: isMobile ? 10 : 11, fontFamily: "'SF Pro Display', -apple-system, sans-serif" },
      grid: { vertLines: { color: isMobile ? 'rgba(0, 240, 255, 0.06)' : 'rgba(0, 240, 255, 0.04)' }, horzLines: { color: isMobile ? 'rgba(0, 240, 255, 0.06)' : 'rgba(0, 240, 255, 0.04)' } },
      crosshair: { mode: isMobile ? 1 : 0, vertLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2, labelBackgroundColor: '#1a2540' }, horzLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2, labelBackgroundColor: '#1a2540' } },
      timeScale: { borderColor: 'rgba(0, 240, 255, 0.1)', timeVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: isMobile ? 3 : 5 },
      rightPriceScale: { borderColor: 'rgba(0, 240, 255, 0.1)', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 }, minimumWidth: isMobile ? 55 : 65 },
      handleScroll: true,
      handleScale: true,
    };
  }

  const mc = document.getElementById('main-chart');
  chtMain = LightweightCharts.createChart(mc, opts(mc, mc.clientHeight || 420));

  sCan = chtMain.addCandlestickSeries({
    upColor: '#ff3860', downColor: '#00e87b',
    borderUpColor: '#ff3860', borderDownColor: '#00e87b',
    wickUpColor: '#ff5c7c', wickDownColor: '#33ee99',
    priceScaleId: 'right',
  });
  // Give candlestick area enough room (top 5% margin, bottom 20% for volume)
  chtMain.priceScale('right').applyOptions({
    autoScale: true,
    scaleMargins: { top: 0.05, bottom: 0.2 },
  });

  sVol = chtMain.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  chtMain.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  const maOpts = { lastValueVisible: false, priceLineVisible: false, title: '' };
  sMa5  = chtMain.addLineSeries({ color: '#ffd036', lineWidth: isMobile ? 1 : 1.5, ...maOpts });
  sMa10 = chtMain.addLineSeries({ color: '#00d4ff', lineWidth: isMobile ? 1 : 1.5, ...maOpts });
  sMa20 = chtMain.addLineSeries({ color: '#b44dff', lineWidth: isMobile ? 1 : 1.5, ...maOpts });
  sBbU  = chtMain.addLineSeries({ color: 'rgba(255,208,54,0.35)', lineWidth: 1, lineStyle: 2, ...maOpts });
  sBbL  = chtMain.addLineSeries({ color: 'rgba(255,208,54,0.35)', lineWidth: 1, lineStyle: 2, ...maOpts });

  // --- Indicator sub-charts (stacked below main, hide time axis except MACD) ---
  function indOpts(el, h) {
    const o = opts(el, h);
    o.timeScale.visible = false;  // hide time axis on RSI/KD (only MACD shows it)
    o.rightPriceScale.minimumWidth = isMobile ? 55 : 65;
    return o;
  }

  const rc = document.getElementById('rsi-chart');
  chtRsi = LightweightCharts.createChart(rc, indOpts(rc, rc.clientHeight || 130));
  chtRsi.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
  sRsi = chtRsi.addLineSeries({ color: '#ffd036', lineWidth: isMobile ? 1.5 : 2 });

  const kc = document.getElementById('kd-chart');
  chtKd = LightweightCharts.createChart(kc, indOpts(kc, kc.clientHeight || 130));
  chtKd.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
  sKK = chtKd.addLineSeries({ color: '#00d4ff', lineWidth: isMobile ? 1.5 : 2, title: 'K' });
  sDD = chtKd.addLineSeries({ color: '#ff3860', lineWidth: isMobile ? 1.5 : 2, title: 'D' });

  const mcc = document.getElementById('macd-chart');
  chtMacd = LightweightCharts.createChart(mcc, opts(mcc, mcc.clientHeight || 130));
  chtMacd.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
  sDif = chtMacd.addLineSeries({ color: '#00d4ff', lineWidth: isMobile ? 1.5 : 2, title: 'DIF' });
  sSig = chtMacd.addLineSeries({ color: '#ffd036', lineWidth: isMobile ? 1.5 : 2, title: 'Signal' });
  sHist = chtMacd.addHistogramSeries({ title: 'MACD' });

  // --- Sync time axes across all charts (XQ/三竹 style) ---
  _syncChartTimeScales();
}

// Synchronize time scales across K-line, RSI, KD, MACD charts
let _isSyncing = false;
function _syncChartTimeScales() {
  const charts = [chtMain, chtRsi, chtKd, chtMacd];
  charts.forEach((chart, idx) => {
    if (!chart) return;
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (_isSyncing) return;
      _isSyncing = true;
      try {
        // Use time-based range to keep dates aligned across charts
        // (logical ranges differ because sub-charts have fewer data points)
        const timeRange = chart.timeScale().getVisibleRange();
        if (timeRange) {
          charts.forEach((other, j) => {
            if (j !== idx && other) {
              try { other.timeScale().setVisibleRange(timeRange); } catch(e) {}
            }
          });
        }
      } finally { _isSyncing = false; }
    });
  });
}

// Toggle MA / Bollinger series visibility
function toggleChartSeries(key) {
  const seriesMap = { ma5: [sMa5], ma10: [sMa10], ma20: [sMa20], bb: [sBbU, sBbL] };
  const targets = seriesMap[key];
  if (!targets) return;
  const cb = document.getElementById('tog-' + key);
  const visible = cb ? cb.checked : true;
  targets.forEach(s => { if (s) s.applyOptions({ visible }); });
}

// ============================================================
// RENDER: MARKET OVERVIEW
// ============================================================
function renderOverview() {
  const dStr = gDate.slice(0,4) + '/' + gDate.slice(4,6) + '/' + gDate.slice(6,8);
  document.getElementById('market-date').textContent = '資料日期：' + dStr;

  // Combine TWSE + TPEx stocks for overview
  const twseStocks = gAllStocks.filter(s => /^\d{4}$/.test(s[0].trim()));
  const tpexStocks = gTpexAllStocks.filter(s => /^\d{4}$/.test((s[0]||'').trim()));

  let totalVol = 0, totalVal = 0, upN = 0, dnN = 0, flatN = 0, limitUp = 0, limitDown = 0;
  const allWithPct = [];

  twseStocks.forEach(s => {
    totalVol += parseNum(s[2]);
    totalVal += parseNum(s[3]);
    const close = parseNum(s[7]), chg = parseNum(s[8]);
    if (chg > 0) upN++; else if (chg < 0) dnN++; else flatN++;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    if (pct >= 9.5) limitUp++;
    if (pct <= -9.5) limitDown++;
    if (close > 0) allWithPct.push({ code: s[0].trim(), name: s[1].trim(), close, chg, pct, vol: parseNum(s[2]), market: 'twse' });
  });

  // TPEx fields: 0=代號, 1=名稱, 2=收盤, 3=漲跌, 4=開盤, 5=最高, 6=最低, 7=成交股數, 8=成交金額, 9=成交筆數
  tpexStocks.forEach(s => {
    const close = parseNum(s[2]), chg = parseNum(s[3]);
    const vol = parseNum(s[7]); // 成交股數 is index 7
    totalVol += vol;
    if (close === 0) return; // skip no-trade stocks
    if (chg > 0) upN++; else if (chg < 0) dnN++; else flatN++;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    if (pct >= 9.5) limitUp++;
    if (pct <= -9.5) limitDown++;
    if (close > 0) allWithPct.push({ code: (s[0]||'').trim(), name: (s[1]||'').trim(), close, chg, pct, vol, market: 'tpex' });
  });

  const totalCount = twseStocks.length + tpexStocks.length;

  const totalADR = upN + dnN + flatN;
  const upPct = totalADR > 0 ? (upN / totalADR * 100) : 0;
  const dnPct = totalADR > 0 ? (dnN / totalADR * 100) : 0;
  const flatPct = totalADR > 0 ? (flatN / totalADR * 100) : 0;
  const sentiment = upPct - dnPct;
  const sentimentLabel = sentiment > 20 ? '極度樂觀' : sentiment > 5 ? '偏多' : sentiment > -5 ? '中性' : sentiment > -20 ? '偏空' : '極度悲觀';
  const sentimentColor = sentiment > 5 ? 'var(--red)' : sentiment > -5 ? 'var(--yellow)' : 'var(--green)';

  document.getElementById('market-stats').innerHTML = `
    <div class="stat-box"><div class="label">上市+上櫃股票數</div><div class="value">${totalCount}</div></div>
    <div class="stat-box"><div class="label">上市總成交金額</div><div class="value">${fmtBig(totalVal)}</div></div>
    <div class="stat-box"><div class="label">總成交量</div><div class="value">${fmtBig(totalVol)} 股</div></div>
    <div class="stat-box"><div class="label">上漲 / 下跌</div><div class="value"><span class="up">${upN}</span> <span style="color:var(--text2);">/</span> <span class="down">${dnN}</span></div></div>
    <div class="stat-box"><div class="label">漲停 / 跌停</div><div class="value"><span class="up">${limitUp}</span> <span style="color:var(--text2);">/</span> <span class="down">${limitDown}</span></div></div>
    <div class="stat-box">
      <div class="label">市場情緒</div>
      <div class="value" style="font-size:16px;color:${sentimentColor};">${sentimentLabel}</div>
      <div class="sentiment-bar">
        <div class="seg-up" style="width:${upPct}%;"></div>
        <div class="seg-flat" style="width:${flatPct}%;"></div>
        <div class="seg-down" style="width:${dnPct}%;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px;color:var(--text2);">
        <span class="up">${upPct.toFixed(0)}%漲</span>
        <span class="down">${dnPct.toFixed(0)}%跌</span>
      </div>
    </div>
  `;

  const gainers = [...allWithPct].sort((a, b) => b.pct - a.pct).filter(s => s.chg > 0).slice(0, 15);
  const losers  = [...allWithPct].sort((a, b) => a.pct - b.pct).filter(s => s.chg < 0).slice(0, 15);

  function rankHTML(list) {
    if (window.innerWidth <= 768) {
      let h = '<div class="rank-card-list">';
      list.forEach((s, i) => {
        const cls = s.chg >= 0 ? 'up' : 'down';
        h += `<div class="rank-card" onclick="goAnalyze('${s.code}')">
          <div class="rank-card-head">
            <span class="rank-card-num">${i+1}</span>
            <span class="rank-card-code">${s.code}</span>
            <span class="rank-card-name">${s.name}</span>${limitTag(s.pct)}${warningTag(s.code)}
            <span class="rank-card-pct ${cls}">${s.pct>0?'+':''}${s.pct.toFixed(2)}%</span>
          </div>
          <div class="rank-card-body">
            <div><span class="dt-label">收盤</span><span>${limitPrice(s.close, s.pct)}</span></div>
            <div><span class="dt-label">漲跌</span><span class="${cls}">${s.chg>0?'+':''}${fmtNum(s.chg,2)}</span></div>
            <div><span class="dt-label">成交量</span><span>${fmtBig(s.vol)}</span></div>
          </div>
        </div>`;
      });
      h += '</div>';
      return h;
    }
    return mkTable(['代號', '名稱', '市場', '收盤', '漲跌', '漲跌%', '成交量'], list.map(s => {
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      return [
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>${limitTag(s.pct)}${warningTag(s.code)}`, mTag,
        limitPrice(s.close, s.pct),
        `<span class="${s.chg > 0 ? 'up' : 'down'}">${s.chg > 0 ? '+' : ''}${fmtNum(s.chg, 2)}</span>`,
        `<span class="${s.pct > 0 ? 'up' : 'down'}">${s.pct > 0 ? '+' : ''}${s.pct.toFixed(2)}%</span>`,
        fmtBig(s.vol)
      ];
    }));
  }

  document.getElementById('top-gainers').innerHTML = rankHTML(gainers);
  document.getElementById('top-losers').innerHTML = rankHTML(losers);

  // Volume ranking
  const volRanked = [...allWithPct].sort((a, b) => b.vol - a.vol).slice(0, 15);
  document.getElementById('top-volume').innerHTML = rankHTML(volRanked);

  // Advance/Decline visual
  const adEl = document.getElementById('advance-decline');
  if (adEl) {
    const total = upN + dnN + flatN;
    adEl.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-end;justify-content:center;margin-bottom:12px;">
        <div style="text-align:center;">
          <div class="up" style="font-size:28px;font-weight:800;">${upN}</div>
          <div class="text-sm text-muted">上漲</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:20px;font-weight:600;color:var(--text2);">${flatN}</div>
          <div class="text-sm text-muted">持平</div>
        </div>
        <div style="text-align:center;">
          <div class="down" style="font-size:28px;font-weight:800;">${dnN}</div>
          <div class="text-sm text-muted">下跌</div>
        </div>
      </div>
      <div class="ad-bar">
        <div class="ad-up" style="width:${total>0?(upN/total*100):0}%;"></div>
        <div class="ad-flat" style="width:${total>0?(flatN/total*100):0}%;"></div>
        <div class="ad-down" style="width:${total>0?(dnN/total*100):0}%;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;">
        <span class="up text-sm">${total>0?(upN/total*100).toFixed(1):0}%</span>
        <span class="text-sm text-muted">共 ${total} 檔</span>
        <span class="down text-sm">${total>0?(dnN/total*100).toFixed(1):0}%</span>
      </div>`;
  }

  // Market turnover
  const mtEl = document.getElementById('market-turnover');
  if (mtEl) {
    mtEl.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="label">成交金額</div><div class="value">${fmtBig(totalVal)}</div></div>
        <div class="stat-box"><div class="label">成交量(股)</div><div class="value">${fmtBig(totalVol)}</div></div>
      </div>`;
  }
}

// ============================================================
// RENDER: SECTOR INDEX RANKING (from MI_5MINS_INDEX)
// ============================================================
const SECTOR_INDEX_NAMES = [
  '加權指數', '未含金融', '未含電子', '未含金融電子',
  '水泥', '食品', '塑膠', '紡織', '電機', '電纜',
  '化學生技醫療', '化學', '生技醫療', '玻璃', '造紙', '鋼鐵',
  '橡膠', '汽車', '電子', '半導體', '電腦週邊', '光電',
  '通信網路', '電子零組件', '電子通路', '資訊服務', '其他電子',
  '建材營造', '航運', '觀光餐旅', '金融保險', '貿易百貨',
  '油電燃氣', '綠能環保', '數位雲端', '運動休閒', '居家生活', '其他'
];

async function renderSectorRanking() {
  const el = document.getElementById('sector-ranking');
  if (!el) return;
  try {
    const data = await API_TWSE.sectorIndex(gDate);
    if (!data || data.stat !== 'OK' || !data.data || data.data.length < 2) {
      el.innerHTML = '<div class="text-muted">盤中產業指數尚未公布</div>';
      return;
    }
    const rows = data.data;
    const first = rows[0];
    const last = rows[rows.length - 1];

    const sectors = [];
    // Skip index 0 (time), start from index 1 (加權指數)
    for (let i = 1; i < first.length && i < last.length; i++) {
      const openVal = parseNum(first[i]);
      const closeVal = parseNum(last[i]);
      if (openVal <= 0) continue;
      const chg = closeVal - openVal;
      const pct = (chg / openVal * 100);
      const name = SECTOR_INDEX_NAMES[i - 1] || `類${i}`;
      // Skip composite indices (first 4)
      if (i <= 4) continue;
      sectors.push({ name, open: openVal, close: closeVal, chg, pct });
    }

    sectors.sort((a, b) => b.pct - a.pct);
    _lastSectorData = sectors;
    renderSectorHeatmap(sectors);
    const maxAbs = Math.max(...sectors.map(s => Math.abs(s.pct)), 1);

    let html = '<div class="sector-bars">';
    sectors.forEach(s => {
      const barWidth = Math.abs(s.pct) / maxAbs * 100;
      const isUp = s.pct >= 0;
      const color = isUp ? 'var(--red)' : 'var(--green)';
      html += `<div class="sector-bar-row">
        <span class="sector-name">${s.name}</span>
        <div class="sector-bar-track">
          <div class="sector-bar-fill ${isUp?'bar-up':'bar-down'}" style="width:${barWidth}%;"></div>
        </div>
        <span class="sector-pct" style="color:${color};">${s.pct>0?'+':''}${s.pct.toFixed(2)}%</span>
      </div>`;
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">產業指數載入失敗</div>';
  }
}

// ============================================================
// SECTOR HEATMAP (squarify treemap)
// ============================================================
function squarify(items, rect) {
  // Squarified treemap algorithm
  // items: [{value, ...}] sorted descending by value
  // rect: {x, y, w, h}
  if (!items.length) return [];
  var totalValue = items.reduce(function(s, it) { return s + it.value; }, 0);
  if (totalValue <= 0) return [];
  var results = [];

  function layoutRow(row, rowValue, rect) {
    var isWide = rect.w >= rect.h;
    var side = isWide ? rect.h : rect.w;
    var rowLen = rowValue / totalValue * (rect.w * rect.h) / side;
    var x = rect.x, y = rect.y;
    row.forEach(function(it) {
      var frac = it.value / rowValue;
      var cellW, cellH;
      if (isWide) {
        cellW = rowLen;
        cellH = frac * side;
        results.push({ x: x, y: y, w: cellW, h: cellH, item: it });
        y += cellH;
      } else {
        cellH = rowLen;
        cellW = frac * side;
        results.push({ x: x, y: y, w: cellW, h: cellH, item: it });
        x += cellW;
      }
    });
    // Return remaining rect
    if (isWide) return { x: rect.x + rowLen, y: rect.y, w: rect.w - rowLen, h: rect.h };
    return { x: rect.x, y: rect.y + rowLen, w: rect.w, h: rect.h - rowLen };
  }

  function worstRatio(row, rowValue, side) {
    if (!row.length) return Infinity;
    var area = rowValue / totalValue * (rect.w * rect.h);
    var rowLen = area / side;
    var worst = 0;
    row.forEach(function(it) {
      var frac = it.value / rowValue;
      var s = frac * side;
      var r = Math.max(rowLen / s, s / rowLen);
      if (r > worst) worst = r;
    });
    return worst;
  }

  var remaining = items.slice();
  var r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };

  while (remaining.length > 0) {
    var side = Math.min(r.w, r.h);
    if (side <= 0) break;
    var row = [remaining[0]];
    var rowValue = remaining[0].value;
    var bestRatio = worstRatio(row, rowValue, side);
    var i = 1;
    while (i < remaining.length) {
      var next = remaining[i];
      var newRow = row.concat([next]);
      var newValue = rowValue + next.value;
      var newRatio = worstRatio(newRow, newValue, side);
      if (newRatio <= bestRatio) {
        row = newRow;
        rowValue = newValue;
        bestRatio = newRatio;
        i++;
      } else {
        break;
      }
    }
    r = layoutRow(row, rowValue, r);
    remaining = remaining.slice(row.length);
  }
  return results;
}

function heatColor(pct) {
  // Red (up) to Green (down) gradient, center = dark gray
  var clamped = Math.max(-5, Math.min(5, pct));
  var t = (clamped + 5) / 10; // 0=green, 0.5=neutral, 1=red
  var r, g, b;
  if (t >= 0.5) {
    // neutral → red
    var s = (t - 0.5) * 2;
    r = Math.round(40 + 185 * s);
    g = Math.round(40 - 20 * s);
    b = Math.round(50 - 20 * s);
  } else {
    // green → neutral
    var s = t * 2;
    r = Math.round(10 + 30 * s);
    g = Math.round(140 - 100 * s);
    b = Math.round(60 - 10 * s);
  }
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function renderSectorHeatmap(sectorsData) {
  var el = document.getElementById('sector-heatmap');
  if (!el) return;
  if (!sectorsData || sectorsData.length === 0) {
    el.innerHTML = '<div class="text-muted" style="padding:40px;text-align:center;">盤中資料尚未公布</div>';
    return;
  }

  var items = sectorsData.map(function(s) {
    return { name: s.name, pct: s.pct, value: Math.max(s.close, 1) };
  }).sort(function(a, b) { return b.value - a.value; });

  var W = el.clientWidth;
  var H = el.clientHeight || 320;
  el.innerHTML = '';

  var cells = squarify(items, { x: 0, y: 0, w: W, h: H });
  cells.forEach(function(c) {
    var div = document.createElement('div');
    div.className = 'hm-cell';
    div.style.left = c.x + 'px';
    div.style.top = c.y + 'px';
    div.style.width = c.w + 'px';
    div.style.height = c.h + 'px';
    div.style.background = heatColor(c.item.pct);

    var showLabel = c.w > 40 && c.h > 28;
    var showPct = c.w > 30 && c.h > 40;

    if (showLabel) {
      var nameSpan = document.createElement('span');
      nameSpan.className = 'hm-cell-name';
      nameSpan.textContent = c.item.name;
      if (c.w < 60) nameSpan.style.fontSize = '9px';
      div.appendChild(nameSpan);
    }
    if (showPct) {
      var pctSpan = document.createElement('span');
      pctSpan.className = 'hm-cell-pct';
      pctSpan.textContent = (c.item.pct > 0 ? '+' : '') + c.item.pct.toFixed(2) + '%';
      div.appendChild(pctSpan);
    }

    div.title = c.item.name + '  ' + (c.item.pct > 0 ? '+' : '') + c.item.pct.toFixed(2) + '%';
    el.appendChild(div);
  });
}

// Redraw heatmap on resize
var _hmResizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(_hmResizeTimer);
  _hmResizeTimer = setTimeout(function() {
    if (_lastSectorData) renderSectorHeatmap(_lastSectorData);
  }, 300);
});
var _lastSectorData = null;

// ============================================================
// RENDER: TAIEX INTRADAY CHART (overview page)
// ============================================================
let chtTaiex = null;
let sTaiexLine = null;
let gTaiexMode = 'taiex'; // 'taiex' or 'futures'

function initTaiexToggle() {
  const box = document.getElementById('taiex-toggle');
  if (!box || box.children.length > 0) return;
  const btnStyle = 'padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text2);transition:all .2s;';
  const activeStyle = 'background:var(--cyan);color:#0a1628;border-color:var(--cyan);font-weight:600;';
  box.innerHTML = `<button id="taiex-btn-taiex" style="${btnStyle}${activeStyle}" onclick="switchTaiexMode('taiex')">加權</button><button id="taiex-btn-futures" style="${btnStyle}" onclick="switchTaiexMode('futures')">台指期</button>`;
}

function switchTaiexMode(mode) {
  gTaiexMode = mode;
  // Update button styles
  const btnT = document.getElementById('taiex-btn-taiex');
  const btnF = document.getElementById('taiex-btn-futures');
  const active = 'background:var(--cyan);color:#0a1628;border-color:var(--cyan);font-weight:600;';
  const inactive = 'background:transparent;color:var(--text2);border-color:var(--border);font-weight:400;';
  if (btnT) btnT.style.cssText = 'padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;transition:all .2s;' + (mode === 'taiex' ? active : inactive);
  if (btnF) btnF.style.cssText = 'padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;transition:all .2s;' + (mode === 'futures' ? active : inactive);
  // Update title
  const titleEl = document.getElementById('taiex-title');
  if (titleEl) titleEl.textContent = mode === 'taiex' ? '加權指數走勢' : '台指期近月即時';
  // Reset chart for redraw
  if (chtTaiex) { chtTaiex.remove(); chtTaiex = null; sTaiexLine = null; }
  document.getElementById('taiex-chart').innerHTML = '';
  renderTaiexChart();
}

function _createTaiexChart(el) {
  const mob = window.innerWidth <= 768;
  chtTaiex = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: mob ? 10 : 11 },
    grid: { vertLines: { color: 'rgba(0, 240, 255, 0.04)' }, horzLines: { color: 'rgba(0, 240, 255, 0.04)' } },
    timeScale: { borderColor: 'rgba(0, 240, 255, 0.1)', timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
    rightPriceScale: { borderColor: 'rgba(0, 240, 255, 0.1)', autoScale: true, minimumWidth: mob ? 55 : 70 },
    crosshair: { mode: mob ? 1 : 0 },
    handleScroll: false,
    handleScale: false,
  });
}

function _renderTaiexData(data, prevClose) {
  if (data.length === 0) return;
  const el = document.getElementById('taiex-chart');
  const lastVal = data[data.length - 1].value;
  const isUp = lastVal >= prevClose;
  const lineColor = isUp ? '#ff3860' : '#00e87b';
  const topColor = isUp ? 'rgba(255,56,96,0.2)' : 'rgba(0,232,123,0.2)';
  const bottomColor = isUp ? 'rgba(255,56,96,0.02)' : 'rgba(0,232,123,0.02)';
  if (!chtTaiex) {
    el.innerHTML = '';
    _createTaiexChart(el);
    sTaiexLine = chtTaiex.addAreaSeries({ lineColor, topColor, bottomColor, lineWidth: 2 });
  } else {
    sTaiexLine.applyOptions({ lineColor, topColor, bottomColor });
  }
  sTaiexLine.setData(data);
  if (prevClose > 0) {
    sTaiexLine.createPriceLine({ price: prevClose, color: 'rgba(255,208,54,0.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '昨收' });
  }
  chtTaiex.timeScale().fitContent();
  const chg = lastVal - prevClose;
  const pct = prevClose > 0 ? (chg / prevClose * 100) : 0;
  const statusEl = document.getElementById('taiex-status');
  if (statusEl) {
    statusEl.innerHTML = `<span class="${isUp ? 'up' : 'down'}" style="font-weight:600;">${fmtNum(lastVal, 0)} (${chg > 0 ? '+' : ''}${fmtNum(chg, 0)}, ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>`;
  }
}

async function renderTaiexChart() {
  const el = document.getElementById('taiex-chart');
  if (!el || el.clientWidth === 0) return;
  initTaiexToggle();

  if (gTaiexMode === 'futures') {
    // 台指期近一即時走勢 — Cnyes 1-min intraday + TAIFEX quote
    try {
      const [intradayRes, futRes] = await Promise.allSettled([
        fetch('/api/futures/intraday').then(r => r.ok ? r.json() : null),
        fetch('/api/futures').then(r => r.ok ? r.json() : null),
      ]);
      const intraday = intradayRes.status === 'fulfilled' ? intradayRes.value : null;
      const fut = futRes.status === 'fulfilled' ? futRes.value : null;
      const session = fut && (fut.night || fut.day || fut.spot);
      const refPrice = session ? (parseFloat(session.CRefPrice) || 0) : 0;
      const points = intraday && intraday.points ? intraday.points : [];
      if (points.length >= 2) {
        const tzOffset = 8 * 3600;
        const chartData = points.map(p => ({ time: p.t + tzOffset, value: p.c }));
        _renderTaiexData(chartData, refPrice);
      } else {
        throw new Error('No chart data');
      }
      // Status bar
      if (session && session.CLastPrice) {
        const lastPrice = parseFloat(session.CLastPrice);
        const sessionLabel = fut.night ? '夜盤' : fut.day ? '日盤' : '收盤';
        const isUp = lastPrice >= refPrice;
        const chg = lastPrice - refPrice;
        const pct = refPrice > 0 ? (chg / refPrice * 100) : 0;
        const statusEl = document.getElementById('taiex-status');
        if (statusEl) {
          statusEl.innerHTML = `<span class="${isUp ? 'up' : 'down'}" style="font-weight:600;">${sessionLabel} ${fmtNum(lastPrice, 0)} (${chg > 0 ? '+' : ''}${fmtNum(chg, 0)}, ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span> <span style="color:var(--text2);font-size:10px;">開${fmtNum(parseFloat(session.COpenPrice)||0,0)} 高${fmtNum(parseFloat(session.CHighPrice)||0,0)} 低${fmtNum(parseFloat(session.CLowPrice)||0,0)} 量${fmtNum(parseInt(session.CTotalVolume)||0,0)}</span>`;
        }
      }
    } catch (e) {
      if (chtTaiex) { chtTaiex.remove(); chtTaiex = null; sTaiexLine = null; }
      el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:180px;color:var(--text2);">台指期資料暫時無法取得</div>';
    }
    return;
  }

  // 加權指數走勢 (Yahoo Finance)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/^TWII?interval=5m&range=1d`;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const r = await fetch(proxyUrl);
    if (!r.ok) return;
    const d = await r.json();
    const result = d.chart?.result?.[0];
    if (!result || !result.timestamp) return;
    const ts = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const prevClose = result.meta?.chartPreviousClose || 0;
    const data = [];
    const tzOffset = 8 * 3600;
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) data.push({ time: ts[i] + tzOffset, value: closes[i] });
    }
    _renderTaiexData(data, prevClose);
  } catch (e) {
    const statusEl = document.getElementById('taiex-status');
    if (statusEl) statusEl.textContent = '加權走勢暫時無法取得';
  }
}

// ============================================================
// RENDER: INSTITUTIONAL SUMMARY
// ============================================================
function renderInstSummary(data) {
  if (!data || data.stat !== 'OK' || !data.data) return;
  let html;
  if (window.innerWidth <= 768) {
    html = '<div class="rank-card-list">';
    data.data.forEach(r => {
      const diff = parseNum(r[3]);
      const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
      html += `<div class="rank-card">
        <div class="rank-card-head">
          <span class="rank-card-code" style="color:var(--text);">${r[0]}</span>
          <span class="rank-card-pct ${cls}" style="font-size:13px;">${diff > 0 ? '+' : ''}${fmtBig(diff)}</span>
        </div>
        <div class="rank-card-body">
          <div><span class="dt-label">買進</span><span>${fmtBig(parseNum(r[1]))}</span></div>
          <div><span class="dt-label">賣出</span><span>${fmtBig(parseNum(r[2]))}</span></div>
        </div>
      </div>`;
    });
    html += '</div>';
  } else {
    html = mkTable(['類別', '買進金額', '賣出金額', '買賣差額'], data.data.map(r => {
      const diff = parseNum(r[3]);
      return [
        r[0],
        fmtBig(parseNum(r[1])),
        fmtBig(parseNum(r[2])),
        `<span class="${diff > 0 ? 'up' : 'down'}" style="font-weight:700">${diff > 0 ? '+' : ''}${fmtBig(diff)}</span>`
      ];
    }));
  }
  document.getElementById('inst-summary-overview').innerHTML = html;
  document.getElementById('inst-amount-table').innerHTML = html;
}

// ============================================================
// RENDER: INSTITUTIONAL PER-STOCK RANK (TWSE + TPEx)
// ============================================================
function renderInstRank(type) {
  var hasTraditional = gInstStocks.length > 0 || gTpexInstStocks.length > 0;
  var hasFinMind = gFinMindInst && typeof gFinMindInst === 'object' && !gFinMindInst.error && Object.keys(gFinMindInst).length > 0;

  if (!hasTraditional && !hasFinMind) {
    var msg = '<div class="empty-state" style="padding:24px;text-align:center;">'
      + '<div class="icon" style="font-size:28px;">&#x1F3E6;</div>'
      + '<p>法人買賣超資料尚未載入</p>'
      + '<p class="text-sm text-muted" style="margin-top:6px;">可能原因：盤中尚未公布、證交所限制存取<br>收盤後將自動更新</p></div>';
    document.getElementById('inst-buy-rank').innerHTML = msg;
    document.getElementById('inst-sell-rank').innerHTML = msg;
    return;
  }
  // TWSE T86 fields: 0=code 1=name 2..4=外資(買/賣/差) 5..7=外資自營 8..10=投信 11=自營差 12..14=自營自 15..17=避險 18=三大合計
  let col;
  switch (type) {
    case 'foreign': col = 4; break;
    case 'trust': col = 10; break;
    case 'dealer': col = 11; break;
    default: col = 18;
  }

  const parsed = [];

  // TWSE
  gInstStocks.forEach(r => {
    const code = r[0].trim();
    if (/^\d{4}$/.test(code)) {
      parsed.push({ code, name: r[1].trim(), net: parseNum(r[col]), market: 'twse' });
    }
  });

  // TPEx institutional: 0=code,1=name, 10=外資合計淨, 13=投信淨, 22=自營合計淨, 23=三大法人合計
  gTpexInstStocks.forEach(r => {
    const code = (r[0] || '').trim();
    if (!/^\d{4}$/.test(code)) return;
    let net = 0;
    try {
      switch (type) {
        case 'foreign': net = parseNum(r[10]); break;
        case 'trust': net = parseNum(r[13]); break;
        case 'dealer': net = parseNum(r[22]); break;
        default: net = parseNum(r[23]); break;
      }
    } catch(e) {}
    if (!isNaN(net)) parsed.push({ code, name: (r[1]||'').trim(), net, market: 'tpex' });
  });

  // FinMind fallback: fill in stocks not already covered by T86/TPEX
  if (hasFinMind && parsed.length < 50) {
    var existingCodes = {};
    parsed.forEach(function(p) { existingCodes[p.code] = true; });
    Object.keys(gFinMindInst).forEach(function(code) {
      if (existingCodes[code]) return;
      if (!/^\d{4}$/.test(code)) return;
      var d = gFinMindInst[code];
      var net = 0;
      switch (type) {
        case 'foreign': net = d.f || 0; break;
        case 'trust': net = d.t || 0; break;
        case 'dealer': net = d.d || 0; break;
        default: net = d.total || 0; break;
      }
      var name = d.name || (gStockDB[code] ? gStockDB[code].name : '') || code;
      parsed.push({ code: code, name: name, net: net, market: gStockMap[code] ? gStockMap[code].market : 'twse' });
    });
  }

  const sorted = [...parsed].sort((a, b) => b.net - a.net);
  const buyers  = sorted.slice(0, 20);
  const sellers = [...parsed].sort((a, b) => a.net - b.net).slice(0, 20);

  function listHTML(list) {
    if (window.innerWidth <= 768) {
      let h = '<div class="rank-card-list">';
      list.forEach((s, i) => {
        const cls = s.net >= 0 ? 'up' : 'down';
        h += `<div class="rank-card" onclick="goAnalyze('${s.code}')">
          <div class="rank-card-head">
            <span class="rank-card-num">${i+1}</span>
            <span class="rank-card-code">${s.code}</span>
            <span class="rank-card-name">${s.name}</span>${warningTag(s.code)}
            <span class="rank-card-pct ${cls}">${s.net>0?'+':''}${fmtShares(s.net)}</span>
          </div>
        </div>`;
      });
      h += '</div>';
      return h;
    }
    return mkTable(['代號', '名稱', '市場', '買賣超（股）'], list.map(s => {
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      return [
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>${warningTag(s.code)}`, mTag,
        `<span class="${s.net > 0 ? 'up' : 'down'}" style="font-weight:600">${s.net > 0 ? '+' : ''}${fmtShares(s.net)}</span>`
      ];
    }));
  }

  document.getElementById('inst-buy-rank').innerHTML = listHTML(buyers);
  document.getElementById('inst-sell-rank').innerHTML = listHTML(sellers);
}

// ============================================================
// RENDER: DAY TRADING
// ============================================================
function renderDayTrade(data) {
  if (!data || data.stat !== 'OK' || !data.tables) return false;

  const t0 = data.tables[0];
  const t1 = data.tables[1];

  // Check if there's actual data (not just empty tables on holidays)
  const hasStats = t0 && t0.data && t0.data.length > 0;
  const hasRank = t1 && t1.data && t1.data.length > 0;
  if (!hasStats && !hasRank) return false;

  if (hasStats) {
    const r = t0.data[0];
    document.getElementById('dt-stats').innerHTML = `
      <div class="stat-box"><div class="label">當沖成交股數</div><div class="value">${fmtBig(parseNum(r[0]))}</div></div>
      <div class="stat-box"><div class="label">占市場比重</div><div class="value">${r[1]}</div></div>
      <div class="stat-box"><div class="label">當沖買進金額</div><div class="value">${fmtBig(parseNum(r[2]))}</div></div>
      <div class="stat-box"><div class="label">占市場比重</div><div class="value">${r[3]}</div></div>
    `;
  } else {
    document.getElementById('dt-stats').innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">當沖統計尚未公布（盤後更新）</div>';
  }

  if (hasRank) {
    const list = t1.data.map(r => ({
      code: r[0].trim(), name: r[1].trim(),
      vol: parseNum(r[3]), buy: parseNum(r[4]), sell: parseNum(r[5])
    })).filter(r => /^\d{4}$/.test(r.code)).sort((a, b) => b.vol - a.vol).slice(0, 30);

    // Mobile: use card layout; Desktop: use table
    const isMob = window.innerWidth <= 768;
    if (isMob) {
      let cardHtml = '<div class="dt-card-list">';
      list.forEach((s, i) => {
        const pnl = s.sell - s.buy;
        const pnlCls = pnl >= 0 ? 'up' : 'down';
        cardHtml += `<div class="dt-card" onclick="goAnalyze('${s.code}')">
          <div class="dt-card-head">
            <span class="dt-card-rank">${i+1}</span>
            <span class="dt-card-code">${s.code}</span>
            <span class="dt-card-name">${s.name}</span>
            <span class="dt-card-pnl ${pnlCls}">${pnl>0?'+':''}${fmtBig(pnl)}</span>
          </div>
          <div class="dt-card-body">
            <div><span class="dt-label">成交量</span><span>${fmtShares(s.vol)}</span></div>
            <div><span class="dt-label">買進</span><span>${fmtBig(s.buy)}</span></div>
            <div><span class="dt-label">賣出</span><span>${fmtBig(s.sell)}</span></div>
          </div>
        </div>`;
      });
      cardHtml += '</div>';
      document.getElementById('dt-rank').innerHTML = cardHtml;
    } else {
      document.getElementById('dt-rank').innerHTML = mkTable(
        ['代號', '名稱', '當沖成交股數', '買進金額', '賣出金額', '估計損益'],
        list.map(s => {
          const pnl = s.sell - s.buy;
          return [
            `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
            `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>`, fmtShares(s.vol), fmtBig(s.buy), fmtBig(s.sell),
            `<span class="${pnl >= 0 ? 'up' : 'down'}" style="font-weight:600">${pnl > 0 ? '+' : ''}${fmtBig(pnl)}</span>`
          ];
        })
      );
    }
  } else {
    document.getElementById('dt-rank').innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">無當沖交易明細資料</div>';
  }

  return true;
}

// ============================================================
// RENDER: AI RANK (TWSE + TPEx combined)
// ============================================================
function renderAIRank() {
  const instMap = gInstMap;

  const allStockList = [];

  // TWSE
  gAllStocks.forEach(s => {
    const code = s[0].trim();
    if (!/^\d{4}$/.test(code) || parseNum(s[7]) <= 0) return;
    const close = parseNum(s[7]), chg = parseNum(s[8]), vol = parseNum(s[2]);
    if (vol < 50000) return;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    allStockList.push({ code, name: s[1].trim(), close, chg, pct, vol, market: 'twse' });
  });

  // TPEx
  gTpexAllStocks.forEach(s => {
    const code = (s[0]||'').trim();
    if (!/^\d{4}$/.test(code)) return;
    const close = parseNum(s[2]), chg = parseNum(s[3]), vol = parseNum(s[7]); // index 7 = 成交股數
    if (close <= 0 || vol < 50000) return;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    allStockList.push({ code, name: (s[1]||'').trim(), close, chg, pct, vol, market: 'tpex' });
  });

  const scored = allStockList.map(s => {
    const inst = instMap[s.code];
    let score = 50;
    if (inst) {
      const buys = (inst.f > 0 ? 1 : 0) + (inst.t > 0 ? 1 : 0) + (inst.d > 0 ? 1 : 0);
      score += buys * 8 - 12;
    }
    if (s.pct > 3) score += 15;
    else if (s.pct > 1) score += 10;
    else if (s.pct > 0) score += 5;
    else if (s.pct > -1) score += 0;
    else if (s.pct > -3) score -= 5;
    else score -= 10;
    if (s.vol > 5e6) score += 5;
    score = Math.max(0, Math.min(100, score));

    return { ...s, inst, score };
  }).sort((a, b) => b.score - a.score).slice(0, 50);

  document.getElementById('ai-rank').innerHTML = mkTable(
    ['#', '代號', '名稱', '市場', '收盤', '漲跌%', '成交量', '外資', '投信', '自營', 'AI 分數'],
    scored.map((s, i) => {
      const lb = scoreLabel(s.score);
      const inst = s.inst || { f: 0, t: 0, d: 0 };
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      return [
        i + 1,
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>`, mTag,
        limitPrice(s.close, s.pct),
        `<span class="${s.pct > 0 ? 'up' : 'down'}">${s.pct > 0 ? '+' : ''}${s.pct.toFixed(2)}%</span>`,
        fmtBig(s.vol),
        `<span class="${inst.f > 0 ? 'up' : 'down'}">${fmtShares(inst.f)}</span>`,
        `<span class="${inst.t > 0 ? 'up' : 'down'}">${fmtShares(inst.t)}</span>`,
        `<span class="${inst.d > 0 ? 'up' : 'down'}">${fmtShares(inst.d)}</span>`,
        `<span class="tag ${lb.cls}">${s.score} ${lb.text}</span>`
      ];
    })
  );
}

// ============================================================
// RENDER: WATCHLIST
// ============================================================
let gWlSort = 'default';

let gWlPendingRefresh = false;

function renderWatchlist() {
  const list = wlGet();
  const box = document.getElementById('watchlist-container');
  const countEl = document.getElementById('wl-count');
  const sortBar = document.getElementById('wl-sort-bar');

  if (countEl) countEl.textContent = list.length > 0 ? '(' + list.length + ')' : '';
  if (sortBar) sortBar.style.display = list.length > 1 ? '' : 'none';

  if (list.length === 0) {
    box.innerHTML = '<div class="empty-state"><div class="icon">&#x2B50;</div><p>尚無關注的股票<br><span class="text-sm text-muted">在「個股分析」或上方輸入代號加入</span></p></div>';
    return;
  }

  // Check if market data is ready
  var dataReady = Object.keys(gStockMap).length > 0;

  // If data not ready, show loading + schedule retry
  if (!dataReady) {
    var loadingHtml = '<div class="stock-grid">';
    list.forEach(function(code) {
      var dbInfo = gStockDB[code];
      loadingHtml += '<div class="stock-card" onclick="goAnalyze(\'' + code + '\')">'
        + '<div class="sc-bar" style="background:linear-gradient(90deg,var(--cyan),var(--purple));"></div>'
        + '<div class="sc-top"><div><div class="sc-code">' + code + '</div>'
        + '<div class="sc-name">' + (dbInfo ? dbInfo.name : '') + '</div></div>'
        + '<div><div class="sc-price" style="color:var(--text2);">--</div></div></div>'
        + '<div class="text-muted text-sm" style="padding:4px 0;">市場資料載入中...</div>'
        + '<div class="sc-del" onclick="event.stopPropagation();rmWatchlist(\'' + code + '\')">&#x2715;</div>'
        + '</div>';
    });
    loadingHtml += '</div>';
    box.innerHTML = loadingHtml;
    // Auto-retry when data arrives (max 60 retries = 30s timeout)
    if (!gWlPendingRefresh) {
      gWlPendingRefresh = true;
      var retryCount = 0;
      var retryTimer = setInterval(function() {
        retryCount++;
        if (Object.keys(gStockMap).length > 0) {
          clearInterval(retryTimer);
          gWlPendingRefresh = false;
          renderWatchlist();
        } else if (retryCount >= 60) {
          clearInterval(retryTimer);
          gWlPendingRefresh = false;
        }
      }, 500);
    }
    return;
  }

  // Use cached maps (rebuilt in init/autoRefresh via rebuildMaps)
  var sMap = gStockMap;
  var iMap = gInstMap;

  // Sort helper — prioritize MIS real-time data
  function getSortVal(code) {
    var mis = gMisCache[code];
    if (mis && mis.price > 0) {
      return { pct: mis.pct || 0, vol: mis.vol || 0, name: mis.name || (gStockDB[code] ? gStockDB[code].name : code) };
    }
    var entry = sMap[code];
    if (!entry) {
      var yc = gWlYahooCache[code];
      var dbi = gStockDB[code];
      if (yc) return { pct: yc.pct || 0, vol: yc.vol || 0, name: dbi ? dbi.name : code };
      return { pct: 0, vol: 0, name: dbi ? dbi.name : code };
    }
    var s = entry.data, m = entry.market;
    var close = m === 'twse' ? parseNum(s[7]) : parseNum(s[2]);
    var chg = m === 'twse' ? parseNum(s[8]) : parseNum(s[3]);
    var vol = m === 'twse' ? parseNum(s[2]) : parseNum(s[7]);
    var prev = close - chg;
    return { pct: prev > 0 ? (chg / prev * 100) : 0, vol: vol, name: m === 'twse' ? s[1].trim() : (s[1]||'').trim() };
  }

  var sortedList = list.slice();
  if (gWlSort === 'change') sortedList.sort(function(a, b) { return getSortVal(b).pct - getSortVal(a).pct; });
  else if (gWlSort === 'volume') sortedList.sort(function(a, b) { return getSortVal(b).vol - getSortVal(a).vol; });
  else if (gWlSort === 'name') sortedList.sort(function(a, b) { return getSortVal(a).name.localeCompare(getSortVal(b).name); });

  var missingCodes = [];
  var html = '<div class="stock-grid">';
  sortedList.forEach(function(code) {
    var entry = sMap[code];
    var inst = iMap[code];
    var dbInfo = gStockDB[code];
    var mis = gMisCache[code];

    // If MIS has real-time data, use it (overrides batch API)
    if (mis && mis.price > 0) {
      var mName = mis.name || (dbInfo ? dbInfo.name : '');
      var mIsUp = mis.chg > 0;
      var mLots = mis.vol >= 1000 ? fmtNum(Math.round(mis.vol / 1000), 0) + ' 張' : fmtNum(mis.vol, 0) + ' 股';
      var mBarColor = mIsUp ? 'linear-gradient(90deg, var(--red), rgba(255,56,96,0.3))' : mis.chg < 0 ? 'linear-gradient(90deg, var(--green), rgba(0,232,123,0.3))' : 'linear-gradient(90deg, var(--cyan), rgba(0,240,255,0.2))';
      var mMkt = dbInfo && dbInfo.market === 'twse' ? '<span class="tag-market tag-twse">上市</span>' : dbInfo && dbInfo.market === 'tpex' ? '<span class="tag-market tag-tpex">上櫃</span>' : '<span class="tag-market" style="border-color:var(--yellow);color:var(--yellow);">興櫃</span>';

      var mInstHtml = '';
      if (inst) {
        var fCls = inst.f > 0 ? 'up' : inst.f < 0 ? 'down' : '';
        var tCls = inst.t > 0 ? 'up' : inst.t < 0 ? 'down' : '';
        var dCls = inst.d > 0 ? 'up' : inst.d < 0 ? 'down' : '';
        mInstHtml = '<div class="sc-inst">'
          + '<div class="sc-inst-item"><span class="sc-inst-label">外資</span><span class="' + fCls + '">' + (inst.f > 0 ? '+' : '') + fmtShares(inst.f) + '</span></div>'
          + '<div class="sc-inst-item"><span class="sc-inst-label">投信</span><span class="' + tCls + '">' + (inst.t > 0 ? '+' : '') + fmtShares(inst.t) + '</span></div>'
          + '<div class="sc-inst-item"><span class="sc-inst-label">自營</span><span class="' + dCls + '">' + (inst.d > 0 ? '+' : '') + fmtShares(inst.d) + '</span></div>'
          + '</div>';
      }

      html += '<div class="stock-card" onclick="goAnalyze(\'' + code + '\')">'
        + '<div class="sc-bar" style="background:' + mBarColor + ';"></div>'
        + '<div class="sc-del" onclick="event.stopPropagation();rmWatchlist(\'' + code + '\')">&#x2715;</div>'
        + '<div class="sc-top"><div>'
        + '<div class="sc-code">' + code + ' <span style="font-size:12px;font-weight:400;color:var(--text2);">' + mName + '</span> ' + mMkt + limitTag(mis.pct) + warningTag(code) + '</div>'
        + '</div><div>'
        + '<div class="sc-price ' + (mis.pct >= 9.5 ? 'limit-price limit-price-up' : mis.pct <= -9.5 ? 'limit-price limit-price-down' : mIsUp ? 'up' : mis.chg < 0 ? 'down' : '') + '">' + fmtNum(mis.price, 2) + '</div>'
        + '<div class="sc-change ' + (mIsUp ? 'up' : mis.chg < 0 ? 'down' : '') + '">' + (mis.chg > 0 ? '&#x25B2;+' : mis.chg < 0 ? '&#x25BC;' : '') + fmtNum(mis.chg, 2) + ' (' + (mis.pct > 0 ? '+' : '') + mis.pct.toFixed(2) + '%) <span style="font-size:10px;color:var(--text2);">' + mis.time + '</span></div>'
        + '</div></div>'
        + '<div class="sc-stats">'
        + '<div class="sc-stat"><div class="sc-stat-label">成交量</div><div class="sc-stat-val">' + mLots + '</div></div>'
        + '<div class="sc-stat"><div class="sc-stat-label">最高</div><div class="sc-stat-val up">' + fmtNum(mis.high, 2) + '</div></div>'
        + '<div class="sc-stat"><div class="sc-stat-label">最低</div><div class="sc-stat-val down">' + fmtNum(mis.low, 2) + '</div></div>'
        + '</div>'
        + mInstHtml
        + '</div>';
      return;
    }

    if (!entry) {
      // Try Yahoo Finance cache
      var yc = gWlYahooCache[code];
      if (yc && yc.price) {
        var yName = dbInfo ? dbInfo.name : '';
        var yIsUp = yc.chg > 0;
        var yLots = yc.vol >= 1000 ? fmtNum(Math.round(yc.vol / 1000), 0) + ' 張' : fmtNum(yc.vol, 0) + ' 股';
        var yBarColor = yIsUp ? 'linear-gradient(90deg, var(--red), rgba(255,56,96,0.3))' : yc.chg < 0 ? 'linear-gradient(90deg, var(--green), rgba(0,232,123,0.3))' : 'linear-gradient(90deg, var(--cyan), rgba(0,240,255,0.2))';
        var yMkt = dbInfo && dbInfo.market === 'twse' ? '<span class="tag-market tag-twse">上市</span>' : dbInfo && dbInfo.market === 'tpex' ? '<span class="tag-market tag-tpex">上櫃</span>' : '<span class="tag-market" style="border-color:var(--yellow);color:var(--yellow);">興櫃</span>';
        html += '<div class="stock-card" onclick="goAnalyze(\'' + code + '\')">'
          + '<div class="sc-bar" style="background:' + yBarColor + ';"></div>'
          + '<div class="sc-del" onclick="event.stopPropagation();rmWatchlist(\'' + code + '\')">&#x2715;</div>'
          + '<div class="sc-top"><div>'
          + '<div class="sc-code">' + code + ' <span style="font-size:12px;font-weight:400;color:var(--text2);">' + yName + '</span> ' + yMkt + limitTag(yc.pct) + warningTag(code) + '</div>'
          + '</div><div>'
          + '<div class="sc-price ' + (yc.pct >= 9.5 ? 'limit-price limit-price-up' : yc.pct <= -9.5 ? 'limit-price limit-price-down' : yIsUp ? 'up' : yc.chg < 0 ? 'down' : '') + '">' + fmtNum(yc.price, 2) + '</div>'
          + '<div class="sc-change ' + (yIsUp ? 'up' : yc.chg < 0 ? 'down' : '') + '">' + (yc.chg > 0 ? '&#x25B2;+' : yc.chg < 0 ? '&#x25BC;' : '') + fmtNum(yc.chg, 2) + ' (' + (yc.pct > 0 ? '+' : '') + yc.pct.toFixed(2) + '%)</div>'
          + '</div></div>'
          + '<div class="sc-stats">'
          + '<div class="sc-stat"><div class="sc-stat-label">成交量</div><div class="sc-stat-val">' + yLots + '</div></div>'
          + '<div class="sc-stat"><div class="sc-stat-label">漲跌幅</div><div class="sc-stat-val ' + (yIsUp ? 'up' : yc.chg < 0 ? 'down' : '') + '">' + (yc.pct > 0 ? '+' : '') + yc.pct.toFixed(2) + '%</div></div>'
          + '</div></div>';
      } else {
        // No data yet — show placeholder and mark for fetching
        html += '<div class="stock-card" onclick="goAnalyze(\'' + code + '\')">'
          + '<div class="sc-bar" style="background:linear-gradient(90deg,var(--cyan),var(--purple));"></div>'
          + '<div class="sc-top"><div><div class="sc-code">' + code + '</div>'
          + '<div class="sc-name">' + (dbInfo ? dbInfo.name : '') + '</div></div>'
          + '<div><div class="sc-price" style="color:var(--text2);">--</div></div></div>'
          + '<div class="text-muted text-sm" style="padding:4px 0;"><div class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle;margin-right:6px;"></div>載入報價中...</div>'
          + '<div class="sc-del" onclick="event.stopPropagation();rmWatchlist(\'' + code + '\')">&#x2715;</div>'
          + '</div>';
        missingCodes.push(code);
      }
      return;
    }

    var s = entry.data, market = entry.market;
    var close, chg, vol, name, turnover;
    if (market === 'twse') {
      close = parseNum(s[7]); chg = parseNum(s[8]); vol = parseNum(s[2]); name = s[1].trim(); turnover = parseNum(s[3]);
    } else {
      close = parseNum(s[2]); chg = parseNum(s[3]); vol = parseNum(s[7]); name = (s[1]||'').trim(); turnover = parseNum(s[8] || 0);
    }
    var prev = close - chg;
    var pct = prev > 0 ? (chg / prev * 100) : 0;
    var isUp = chg > 0;
    var lots = vol >= 1000 ? fmtNum(Math.round(vol / 1000), 0) + ' 張' : fmtNum(vol, 0) + ' 股';
    var barColor = isUp ? 'linear-gradient(90deg, var(--red), rgba(255,56,96,0.3))' : chg < 0 ? 'linear-gradient(90deg, var(--green), rgba(0,232,123,0.3))' : 'linear-gradient(90deg, var(--cyan), rgba(0,240,255,0.2))';
    var mTag = market === 'twse' ? '<span class="tag-market tag-twse">上市</span>' : '<span class="tag-market tag-tpex">上櫃</span>';

    var instHtml = '';
    if (inst) {
      var fCls = inst.f > 0 ? 'up' : inst.f < 0 ? 'down' : '';
      var tCls = inst.t > 0 ? 'up' : inst.t < 0 ? 'down' : '';
      var dCls = inst.d > 0 ? 'up' : inst.d < 0 ? 'down' : '';
      instHtml = '<div class="sc-inst">'
        + '<div class="sc-inst-item"><span class="sc-inst-label">外資</span><span class="' + fCls + '">' + (inst.f > 0 ? '+' : '') + fmtShares(inst.f) + '</span></div>'
        + '<div class="sc-inst-item"><span class="sc-inst-label">投信</span><span class="' + tCls + '">' + (inst.t > 0 ? '+' : '') + fmtShares(inst.t) + '</span></div>'
        + '<div class="sc-inst-item"><span class="sc-inst-label">自營</span><span class="' + dCls + '">' + (inst.d > 0 ? '+' : '') + fmtShares(inst.d) + '</span></div>'
        + '</div>';
    }

    html += '<div class="stock-card" onclick="goAnalyze(\'' + code + '\')">'
      + '<div class="sc-bar" style="background:' + barColor + ';"></div>'
      + '<div class="sc-del" onclick="event.stopPropagation();rmWatchlist(\'' + code + '\')">&#x2715;</div>'
      + '<div class="sc-top"><div>'
      + '<div class="sc-code">' + code + ' <span style="font-size:12px;font-weight:400;color:var(--text2);">' + name + '</span> ' + mTag + warningTag(code) + '</div>'
      + '</div><div>'
      + '<div class="sc-price ' + (pct >= 9.5 ? 'limit-price limit-price-up' : pct <= -9.5 ? 'limit-price limit-price-down' : isUp ? 'up' : chg < 0 ? 'down' : '') + '">' + fmtNum(close, 2) + '</div>'
      + '<div class="sc-change ' + (isUp ? 'up' : chg < 0 ? 'down' : '') + '">' + (chg > 0 ? '&#x25B2;+' : chg < 0 ? '&#x25BC;' : '') + fmtNum(chg, 2) + ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%)</div>'
      + '</div></div>'
      + '<div class="sc-stats">'
      + '<div class="sc-stat"><div class="sc-stat-label">成交量</div><div class="sc-stat-val">' + lots + '</div></div>'
      + '<div class="sc-stat"><div class="sc-stat-label">成交額</div><div class="sc-stat-val">' + fmtBig(turnover) + '</div></div>'
      + '<div class="sc-stat"><div class="sc-stat-label">漲跌幅</div><div class="sc-stat-val ' + (isUp ? 'up' : chg < 0 ? 'down' : '') + '">' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%</div></div>'
      + '</div>'
      + instHtml
      + '</div>';
  });
  html += '</div>';
  box.innerHTML = html;

  // Fetch missing stock data from Yahoo Finance
  if (missingCodes.length > 0) {
    fetchWatchlistMissing(missingCodes);
  }
}

// Watchlist sort buttons
document.querySelectorAll('[data-wlsort]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-wlsort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    gWlSort = btn.dataset.wlsort;
    renderWatchlist();
  });
});

// ============================================================
// STOCK ANALYSIS (supports TWSE + TPEx)
// ============================================================
async function fetchTwseHistory(code) {
  const now = new Date();
  const months = [];
  for (let m = 0; m < 8; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    months.push(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + '01');
  }

  // Fetch all months in parallel (respecting concurrency)
  const results = await Promise.allSettled(months.map(ds => API_TWSE.stockMonth(code, ds)));

  const rawRows = [];
  let stockName = '';
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const res = r.value;
    if (res && res.stat === 'OK' && res.data) {
      if (!stockName && res.title) {
        const m = res.title.match(/\d+\s+(.+?)\s+各日/);
        if (m) stockName = m[1];
      }
      rawRows.push(...res.data);
    }
  });

  return { rawRows, stockName };
}

async function fetchTpexHistory(code) {
  const now = new Date();
  const months = [];
  for (let m = 0; m < 8; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    // TPEx new API uses Western date: yyyy/mm/dd
    months.push(yyyy + '/' + mm + '/01');
  }

  const results = await Promise.allSettled(
    months.map(dt => API_TPEX.stockMonth(code, dt))
  );

  const rawRows = [];
  let stockName = '';
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const res = r.value;
    // New TPEx API: { tables: [{ data: [...], ... }], name: "...", ... }
    if (res && res.tables && res.tables[0] && res.tables[0].data && res.tables[0].data.length > 0) {
      rawRows.push(...res.tables[0].data);
    }
    if (!stockName && res && res.name) stockName = res.name;
  });

  return { rawRows, stockName, isTpex: true };
}

async function fetchYahooHistory(code) {
  // Use Yahoo Finance for emerging market stocks (and as fallback)
  const suffixes = ['.TWO', '.TW'];
  for (const suffix of suffixes) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?interval=1d&range=6mo`;
      const data = await apiFetch(url);
      const result = data?.chart?.result?.[0];
      if (!result || !result.timestamp || result.timestamp.length < 5) continue;
      const ts = result.timestamp;
      const q = result.indicators.quote[0];
      const rawRows = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        const d = new Date(ts[i] * 1000);
        const rocDate = `${d.getFullYear()-1911}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const prev = i > 0 && q.close[i-1] != null ? q.close[i-1] : q.open[i];
        const chg = q.close[i] - (prev || 0);
        // Round Yahoo floats to 2 decimal places
        const rnd = v => v != null ? Math.round(v * 100) / 100 : 0;
        rawRows.push([
          rocDate,
          String(q.volume[i] || 0),
          '0',
          String(rnd(q.open[i])),
          String(rnd(q.high[i])),
          String(rnd(q.low[i])),
          String(rnd(q.close[i])),
          String(rnd(chg)),
          '0'
        ]);
      }
      const stockName = gStockDB[code]?.name || result.meta?.symbol || code;
      return { rawRows, stockName, isTpex: true, isYahoo: true };
    } catch(e) { /* try next suffix */ }
  }
  return { rawRows: [], stockName: '', isTpex: true, isYahoo: false };
}

async function analyzeStock(code) {
  code = code || document.getElementById('stock-input').value.trim();
  if (!code) { toast('請輸入股票代號'); return; }
  document.getElementById('stock-input').value = code;

  document.getElementById('stock-header').style.display = 'none';
  document.getElementById('analysis-content').style.display = 'none';
  document.getElementById('analysis-loading').style.display = 'block';
  document.getElementById('analysis-loading').innerHTML = '<div class="card"><div class="loading-box"><div class="spinner"></div><div>載入股票資料中，請稍候...</div></div></div>';

  if (!gChartsReady) initCharts();

  try {
    // Determine market
    let market = getMarket(code);
    let rawRows = [], stockName = '', isYahoo = false;
    const isEmerging = market === 'emerging';

    // Start fetching real-time quote in parallel with history (so it's ready when we render)
    const realtimePromise = fetchRealtimeQuote(code);

    if (market === 'emerging') {
      // Emerging market stock — use Yahoo Finance
      const r = await fetchYahooHistory(code);
      rawRows = r.rawRows;
      stockName = r.stockName;
      isYahoo = r.isYahoo;
      market = 'tpex'; // treat as tpex for subsequent API calls
    } else if (market === 'tpex') {
      // Known TPEx stock — try TPEx first, fallback to Yahoo
      const r = await fetchTpexHistory(code);
      rawRows = r.rawRows;
      stockName = r.stockName;
      if (rawRows.length === 0) {
        const ry = await fetchYahooHistory(code);
        rawRows = ry.rawRows; stockName = ry.stockName; isYahoo = ry.isYahoo;
      }
    } else if (market === 'twse') {
      // Known TWSE stock — try TWSE first, fallback to Yahoo
      const r = await fetchTwseHistory(code);
      rawRows = r.rawRows;
      stockName = r.stockName;
      if (rawRows.length === 0) {
        const ry = await fetchYahooHistory(code);
        rawRows = ry.rawRows; stockName = ry.stockName; isYahoo = ry.isYahoo;
      }
    } else {
      // Unknown — try TWSE first, then TPEx, then Yahoo
      const r1 = await fetchTwseHistory(code);
      if (r1.rawRows.length > 0) {
        rawRows = r1.rawRows;
        stockName = r1.stockName;
        market = 'twse';
      } else {
        const r2 = await fetchTpexHistory(code);
        if (r2.rawRows.length > 0) {
          rawRows = r2.rawRows;
          stockName = r2.stockName;
          market = 'tpex';
        } else {
          const r3 = await fetchYahooHistory(code);
          rawRows = r3.rawRows;
          stockName = r3.stockName;
          isYahoo = r3.isYahoo;
          market = 'tpex';
        }
      }
    }

    if (rawRows.length === 0) {
      document.getElementById('analysis-loading').innerHTML = `<div class="card"><div class="empty-state"><div class="icon">&#x26A0;</div><p>找不到股票 ${code} 的資料<br><span class="text-sm text-muted">請確認股票代號是否正確（支援上市、上櫃、興櫃）</span></p></div></div>`;
      return;
    }

    recentAdd(code);

    // Deduplicate & sort
    const seen = new Set();
    const rows = rawRows.filter(r => {
      const d = rocToISO(r[0]);
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    }).sort((a, b) => rocToISO(a[0]).localeCompare(rocToISO(b[0])));

    // Parse OHLCV — TWSE and TPEx have different column layouts
    const dates = [], O = [], H = [], L = [], C = [], V = [];
    if (market === 'twse') {
      // TWSE: 0=date, 1=vol(shares), 2=turnover, 3=open, 4=high, 5=low, 6=close, ...
      rows.forEach(r => {
        dates.push(rocToISO(r[0]));
        V.push(parseNum(r[1]));
        O.push(parseNum(r[3]));
        H.push(parseNum(r[4]));
        L.push(parseNum(r[5]));
        C.push(parseNum(r[6]));
      });
    } else {
      // TPEx new API: 0=date, 1=vol(張/lots), 2=turnover(仟元), 3=open, 4=high, 5=low, 6=close, 7=chg, 8=txn
      // Yahoo data: volume already in shares; TPEx volume is in 張(lots), convert to shares
      const volMultiplier = isYahoo ? 1 : 1000;
      rows.forEach(r => {
        const o = parseNum(r[3]), h = parseNum(r[4]), l = parseNum(r[5]), c = parseNum(r[6]);
        if (c === 0 && o === 0) return; // skip no-trade days
        dates.push(rocToISO(r[0]));
        V.push(parseNum(r[1]) * volMultiplier);
        O.push(o);
        H.push(h);
        L.push(l);
        C.push(c);
      });
    }

    const n = C.length;
    let lastC = C[n - 1], prevC = n > 1 ? C[n - 2] : lastC;
    let chg = lastC - prevC;
    let pct = prevC > 0 ? (chg / prevC * 100) : 0;

    // Header
    if (!stockName && gStockDB[code]) stockName = gStockDB[code].name;
    document.getElementById('stock-title').textContent = code + ' ' + stockName;
    const mTag = isEmerging
      ? '<span class="tag-market tag-emerging">興櫃</span>'
      : market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
    document.getElementById('stock-market-tag').innerHTML = mTag;
    document.getElementById('stock-warning-badge').innerHTML = warningTag(code);

    // Wait for real-time quote (started in parallel with history fetch)
    // fetchRealtimeQuote updates DOM directly + populates gMisCache
    let rtResult = null;
    try { rtResult = await realtimePromise; } catch(e) {}

    // Use real-time price if available, otherwise fall back to historical close
    if (rtResult && rtResult.price > 0) {
      lastC = rtResult.price;
      chg = rtResult.price - (rtResult.prevClose || prevC);
      pct = rtResult.prevClose > 0 ? ((rtResult.price - rtResult.prevClose) / rtResult.prevClose * 100) : 0;
    }

    if (pct >= 9.5) {
      document.getElementById('stock-price').className = 'limit-price limit-price-up';
    } else if (pct <= -9.5) {
      document.getElementById('stock-price').className = 'limit-price limit-price-down';
    } else {
      document.getElementById('stock-price').className = chg >= 0 ? 'up' : 'down';
    }
    document.getElementById('stock-price').textContent = fmtNum(lastC, 2);
    document.getElementById('stock-change').innerHTML = `<span class="${chg >= 0 ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>${limitTag(pct)}`;
    document.getElementById('stock-header').style.display = 'block';

    // Indicators
    const ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20);
    const bb = TA.boll(C);
    const rsi = TA.rsi(C);
    const macd = TA.macd(C);
    const kd = TA.kd(H, L, C);

    const ld = (arr) => dates.map((d, i) => arr[i] !== null && arr[i] !== undefined ? { time: d, value: arr[i] } : null).filter(Boolean);

    const candleData = dates.map((d, i) => ({ time: d, open: O[i], high: H[i], low: L[i], close: C[i] }));
    sCan.setData(candleData);
    sVol.setData(dates.map((d, i) => ({ time: d, value: V[i], color: C[i] >= O[i] ? 'rgba(255,56,96,0.3)' : 'rgba(0,232,123,0.3)' })));
    sMa5.setData(ld(ma5));
    sMa10.setData(ld(ma10));
    sMa20.setData(ld(ma20));
    sBbU.setData(ld(bb.up));
    sBbL.setData(ld(bb.dn));

    // Update MA values in toggle bar
    const lastMA = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] != null) return arr[i].toFixed(2); } return ''; };
    const ma5El = document.getElementById('ma5-val');
    const ma10El = document.getElementById('ma10-val');
    const ma20El = document.getElementById('ma20-val');
    if (ma5El) ma5El.textContent = lastMA(ma5);
    if (ma10El) ma10El.textContent = lastMA(ma10);
    if (ma20El) ma20El.textContent = lastMA(ma20);

    // Show last ~60 trading days for better default view, user can scroll/zoom
    const showDays = Math.min(60, dates.length);
    const barFrom = dates.length - showDays;
    const barTo = dates.length - 1;

    function fitAllCharts() {
      const fromDate = dates[barFrom];
      const toDate = dates[barTo];
      [chtMain, chtRsi, chtKd, chtMacd].forEach(c => {
        if (!c) return;
        try {
          c.timeScale().setVisibleRange({ from: fromDate, to: toDate });
        } catch(e) {
          try { c.timeScale().scrollToRealTime(); } catch(e2) {}
        }
      });
    }

    sRsi.setData(ld(rsi));

    sKK.setData(dates.map((d, i) => ({ time: d, value: kd.K[i] })));
    sDD.setData(dates.map((d, i) => ({ time: d, value: kd.D[i] })));

    sDif.setData(dates.map((d, i) => ({ time: d, value: macd.dif[i] })));
    sSig.setData(dates.map((d, i) => ({ time: d, value: macd.sig[i] })));
    sHist.setData(dates.map((d, i) => ({ time: d, value: macd.hist[i], color: macd.hist[i] >= 0 ? 'rgba(255,56,96,0.5)' : 'rgba(0,232,123,0.5)' })));

    fitAllCharts();

    // Signals
    const signals = detectSignals(C, H, L, V);
    const sigBox = document.getElementById('signal-box');
    if (signals.length === 0) {
      sigBox.innerHTML = '<span class="text-muted">目前無明顯技術訊號</span>';
    } else {
      sigBox.innerHTML = signals.map(s =>
        `<div class="signal ${s.t}">${s.t === 'bullish' ? '&#x25B2;' : s.t === 'bearish' ? '&#x25BC;' : '&#x25CF;'} ${s.s}</div>`
      ).join('');
    }

    // AI Score
    let instInfo = null;
    gInstStocks.forEach(r => {
      if (r[0].trim() === code) {
        instInfo = { f: parseNum(r[4]), t: parseNum(r[10]), d: parseNum(r[11]) };
      }
    });
    if (!instInfo) {
      gTpexInstStocks.forEach(r => {
        if ((r[0]||'').trim() === code) {
          try { instInfo = { f: parseNum(r[10]), t: parseNum(r[13]), d: parseNum(r[22]) }; } catch(e) {}
        }
      });
    }

    const score = aiScore(C, H, L, V, instInfo);
    const lb = scoreLabel(score.total);
    const ring = document.getElementById('ai-score-ring');
    ring.textContent = score.total;
    ring.style.borderColor = lb.color;
    ring.style.color = lb.color;

    let detHTML = `<div class="tag ${lb.cls}" style="font-size:14px;margin-bottom:10px;">${lb.text}</div><div>`;
    for (const [k, v] of Object.entries(score.d)) {
      const max = (k === '量能' || k === '法人') ? 10 : 20;
      const pctVal = (v / max * 100).toFixed(0);
      const color = pctVal > 60 ? 'var(--green)' : pctVal > 35 ? 'var(--yellow)' : 'var(--red)';
      detHTML += `<div style="margin-bottom:6px;font-size:13px;">${k} <span class="text-muted">${v}/${max}</span>
        <div class="progress-bar"><div class="fill" style="width:${pctVal}%;background:${color};"></div></div></div>`;
    }
    detHTML += '</div>';
    document.getElementById('ai-score-detail').innerHTML = detHTML;

    // Institutional
    if (instInfo) {
      document.getElementById('stock-inst-info').innerHTML = `
        <div class="stat-grid">
          <div class="stat-box"><div class="label">外資買賣超</div><div class="value ${instInfo.f > 0 ? 'up' : 'down'}">${instInfo.f > 0 ? '+' : ''}${fmtShares(instInfo.f)}</div></div>
          <div class="stat-box"><div class="label">投信買賣超</div><div class="value ${instInfo.t > 0 ? 'up' : 'down'}">${instInfo.t > 0 ? '+' : ''}${fmtShares(instInfo.t)}</div></div>
          <div class="stat-box"><div class="label">自營商買賣超</div><div class="value ${instInfo.d > 0 ? 'up' : 'down'}">${instInfo.d > 0 ? '+' : ''}${fmtShares(instInfo.d)}</div></div>
        </div>
        <div id="stock-inst-streak" style="margin-top:12px;"></div>`;
      loadStockInstStreak(code);
    } else {
      document.getElementById('stock-inst-info').innerHTML = '<div class="text-muted">無三大法人資料</div>';
    }

    // AI Deep Analysis Report
    document.getElementById('ai-deep-analysis').innerHTML = generateDeepAnalysis(code, stockName, C, H, L, V, O, dates, instInfo);

    document.getElementById('analysis-loading').style.display = 'none';
    document.getElementById('analysis-content').style.display = 'block';

    // Render chip summary (籌碼速覽)
    renderChipSummary(code, stockName, C, H, L, V, instInfo, score, signals);

    // Async: Load financial data, news (non-blocking)
    fetchStockRevenue(code, stockName);
    fetchStockQuarterly(code);
    fetchStockFundamentals(code);
    fetchStockMargin(code);
    fetchStockDividend(code);
    fetchStockNews(code, stockName);

    // Start real-time updates + intraday chart
    startRealtimeUpdates(code);

    // Resize all charts
    setTimeout(handleResize, 200);

  } catch (e) {
    document.getElementById('analysis-loading').innerHTML =
      `<div class="card"><div class="empty-state"><div class="icon">&#x26A0;</div><p>載入失敗：${e.message}<br><span class="text-sm text-muted">可能是網路問題或證交所限制，請稍後再試</span></p></div></div>`;
  }
}

// ============================================================
// FETCH: Monthly Revenue
// ============================================================
async function fetchStockRevenue(code, stockName) {
  const el = document.getElementById('stock-revenue');
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    const results = await Promise.allSettled([
      apiFetch(OPENAPI_TWSE_ALL.replace('exchangeReport/STOCK_DAY_ALL', 'opendata/t187ap05_L')),
      apiFetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O'),
    ]);
    let found = null;
    for (const r of results) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const item of r.value) {
        const c = (item['公司代號'] || '').trim();
        if (c === code) { found = item; break; }
      }
      if (found) break;
    }
    if (!found) {
      el.innerHTML = '<div class="text-muted">暫無營收資料</div>';
      return;
    }
    const curRev = parseFloat(found['營業收入-當月營收'] || '0');
    const prevRev = parseFloat(found['營業收入-上月營收'] || '0');
    const lastYearRev = parseFloat(found['營業收入-去年當月營收'] || '0');
    const momPct = parseFloat(found['營業收入-上月比較增減(%)'] || '0');
    const yoyPct = parseFloat(found['營業收入-去年同月增減(%)'] || '0');
    const cumRev = parseFloat(found['累計營業收入-當月累計營收'] || '0');
    const cumLastYear = parseFloat(found['累計營業收入-去年累計營收'] || '0');
    const cumPct = parseFloat(found['累計營業收入-前期比較增減(%)'] || '0');
    const period = found['資料年月'] || '';
    const yr = period.slice(0, 3);
    const mo = period.slice(3);
    const periodStr = yr && mo ? `${parseInt(yr)+1911}年${parseInt(mo)}月` : '';

    el.innerHTML = `
      <div class="text-sm" style="margin-bottom:8px;color:var(--cyan);font-weight:600;">${periodStr} 營收報告</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="label">當月營收</div><div class="value">${fmtBig(curRev)}</div></div>
        <div class="stat-box"><div class="label">月增率 (MoM)</div><div class="value ${momPct>=0?'up':'down'}">${momPct>0?'+':''}${momPct.toFixed(2)}%</div></div>
        <div class="stat-box"><div class="label">年增率 (YoY)</div><div class="value ${yoyPct>=0?'up':'down'}">${yoyPct>0?'+':''}${yoyPct.toFixed(2)}%</div></div>
      </div>
      <div class="stat-grid" style="margin-top:10px;">
        <div class="stat-box"><div class="label">上月營收</div><div class="value">${fmtBig(prevRev)}</div></div>
        <div class="stat-box"><div class="label">去年同月營收</div><div class="value">${fmtBig(lastYearRev)}</div></div>
        <div class="stat-box"><div class="label">累計營收 YoY</div><div class="value ${cumPct>=0?'up':'down'}">${cumPct>0?'+':''}${cumPct.toFixed(2)}%</div></div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">營收資料載入失敗</div>';
  }
}

// ============================================================
// FETCH: Quarterly Financial Report
// ============================================================
async function fetchStockQuarterly(code) {
  const el = document.getElementById('stock-quarterly');
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    const results = await Promise.allSettled([
      apiFetch('https://openapi.twse.com.tw/v1/opendata/t187ap14_L'),
      apiFetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O'),
    ]);
    let found = null;
    for (const r of results) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const item of r.value) {
        const c = (item['公司代號'] || item['SecuritiesCompanyCode'] || '').trim();
        if (c === code) { found = item; break; }
      }
      if (found) break;
    }
    if (!found) {
      el.innerHTML = '<div class="text-muted">暫無季度財報</div>';
      return;
    }
    const year = found['年度'] || found['Year'] || '';
    const quarter = found['季別'] || '';
    const eps = found['基本每股盈餘(元)'] || found['EPS'] || '--';
    const revenue = parseFloat(found['營業收入'] || found['Revenue'] || '0');
    const opIncome = parseFloat(found['營業利益'] || found['OperatingIncome'] || '0');
    const nonOp = parseFloat(found['營業外收入及支出'] || '0');
    const netIncome = parseFloat(found['稅後淨利'] || found['NetIncome'] || '0');
    const yearStr = year ? `${parseInt(year)+1911}年` : '';
    const qStr = quarter ? `Q${quarter}` : '';

    const opMargin = revenue > 0 ? (opIncome / revenue * 100).toFixed(2) : '--';
    const netMargin = revenue > 0 ? (netIncome / revenue * 100).toFixed(2) : '--';

    el.innerHTML = `
      <div class="text-sm" style="margin-bottom:8px;color:var(--cyan);font-weight:600;">${yearStr} ${qStr} 財報摘要</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="label">基本每股盈餘</div><div class="value" style="color:var(--yellow);font-size:20px;">${eps} 元</div></div>
        <div class="stat-box"><div class="label">營業收入</div><div class="value">${fmtBig(revenue)}</div></div>
        <div class="stat-box"><div class="label">稅後淨利</div><div class="value ${netIncome>=0?'up':'down'}">${fmtBig(netIncome)}</div></div>
      </div>
      <div class="stat-grid" style="margin-top:10px;">
        <div class="stat-box"><div class="label">營業利益</div><div class="value">${fmtBig(opIncome)}</div></div>
        <div class="stat-box"><div class="label">營業利益率</div><div class="value">${opMargin}%</div></div>
        <div class="stat-box"><div class="label">淨利率</div><div class="value">${netMargin}%</div></div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">財報載入失敗</div>';
  }
}

// ============================================================
// FETCH: Stock News (CNYES)
// ============================================================
const IMPORTANT_KEYWORDS = ['重大', '法說', '併購', '營收', '財報', '漲停', '跌停', '除權', '除息', '減資', '增資', '下市', '違約', '警示', '暫停交易', '召回', '裁罰', '虧損'];

async function fetchStockNews(code, stockName) {
  const el = document.getElementById('stock-news');
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    const params = new URLSearchParams({ code, name: stockName || '' });
    const resp = await fetch(`/api/stock-news?${params}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const items = data.items || [];
    if (items.length === 0) {
      const searchUrl = `https://www.cnyes.com/search/news?keyword=${encodeURIComponent(stockName || code)}`;
      el.innerHTML = `<div class="text-muted">近兩週無相關新聞 — <a href="${searchUrl}" target="_blank" rel="noopener" style="color:var(--accent);">前往鉅亨網搜尋</a></div>`;
      return;
    }
    let html = '<div class="news-list">';
    items.forEach(n => {
      const title = n.title || '';
      const timeStr = n.time || '';
      const newsUrl = n.url || '#';
      const isImportant = IMPORTANT_KEYWORDS.some(kw => title.includes(kw));
      html += `<a href="${newsUrl}" target="_blank" rel="noopener" class="news-item${isImportant ? ' news-important' : ''}">
        ${isImportant ? '<span class="news-badge">重要</span>' : ''}
        <span class="news-title">${title}</span>
        <span class="news-time">${timeStr}</span>
      </a>`;
    });
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">新聞載入失敗</div>';
  }
}

// ============================================================
// FETCH: Stock Fundamentals (PE/PB/Yield)
// ============================================================
async function fetchStockFundamentals(code) {
  const el = document.getElementById('stock-fundamentals');
  if (!el) return;
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    // Try today first, then fall back to recent dates
    let data = null;
    for (let i = 0; i < 7; i++) {
      const d = dateStr(i);
      try {
        const res = await API_TWSE.pePbYield(d);
        if (res && res.stat === 'OK' && res.data && res.data.length > 0) {
          data = res;
          break;
        }
      } catch(e) {}
    }
    if (!data || !data.data) {
      el.innerHTML = '<div class="text-muted">暫無基本面資料</div>';
      return;
    }
    const found = data.data.find(r => (r[0] || '').trim() === code);
    if (!found) {
      el.innerHTML = '<div class="text-muted">此股票無本益比資料</div>';
      return;
    }
    // Fields: 代號, 名稱, 收盤價, 殖利率(%), 股利年度, 本益比, 股價淨值比, 財報年/季
    const price = found[2] || '--';
    const yield_ = found[3] || '--';
    const pe = found[5] || '--';
    const pb = found[6] || '--';
    const period = found[7] || '';

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box">
          <div class="label">本益比 (PE)</div>
          <div class="value" style="color:var(--cyan);font-size:20px;">${pe === '-' ? 'N/A' : pe}</div>
        </div>
        <div class="stat-box">
          <div class="label">股價淨值比 (PB)</div>
          <div class="value" style="color:var(--purple);font-size:20px;">${pb}</div>
        </div>
        <div class="stat-box">
          <div class="label">殖利率</div>
          <div class="value" style="color:var(--yellow);font-size:20px;">${yield_}%</div>
        </div>
      </div>
      <div class="text-sm text-muted" style="margin-top:8px;">財報期間：${period}</div>`;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">基本面資料載入失敗</div>';
  }
}

// ============================================================
// FETCH: Stock Margin Trading (融資融券)
// ============================================================
async function fetchStockMargin(code) {
  const el = document.getElementById('stock-margin');
  if (!el) return;
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    let data = null;
    for (let i = 0; i < 7; i++) {
      const d = dateStr(i);
      try {
        const res = await API_TWSE.marginTrade(d);
        if (res && res.stat === 'OK' && res.tables && res.tables.length > 1) {
          const t = res.tables[1];
          if (t.data && t.data.length > 0) {
            data = res;
            break;
          }
        }
      } catch(e) {}
    }
    if (!data) {
      el.innerHTML = '<div class="text-muted">暫無融資融券資料</div>';
      return;
    }
    const rows = data.tables[1].data;
    const found = rows.find(r => (r[0] || '').trim() === code);
    if (!found) {
      el.innerHTML = '<div class="text-muted">此股票無融資融券資料</div>';
      return;
    }
    // Fields: 代號,名稱, 融資:買進,賣出,現金償還,前日餘額,今日餘額,限額, 融券:買進,賣出,現金償還,前日餘額,今日餘額,限額, 資券互抵
    const mBuy = fmtNum(parseNum(found[2]));
    const mSell = fmtNum(parseNum(found[3]));
    const mPrevBal = fmtNum(parseNum(found[5]));
    const mBal = fmtNum(parseNum(found[6]));
    const mChg = parseNum(found[6]) - parseNum(found[5]);
    const sBuy = fmtNum(parseNum(found[8]));
    const sSell = fmtNum(parseNum(found[9]));
    const sPrevBal = fmtNum(parseNum(found[11]));
    const sBal = fmtNum(parseNum(found[12]));
    const sChg = parseNum(found[12]) - parseNum(found[11]);
    const offset = found[14] || '0';

    // Calculate key ratios
    const mBalNum = parseNum(found[6]);
    const mLimitNum = parseNum(found[7]);
    const sBalNum = parseNum(found[12]);
    const marginUtil = mLimitNum > 0 ? (mBalNum / mLimitNum * 100).toFixed(1) : '--';
    const shortRatio = mBalNum > 0 ? (sBalNum / mBalNum * 100).toFixed(1) : '--';

    el.innerHTML = `
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-box">
          <div class="label">融資使用率</div>
          <div class="value" style="color:var(--cyan);font-size:20px;">${marginUtil}%</div>
        </div>
        <div class="stat-box">
          <div class="label">券資比</div>
          <div class="value" style="color:${parseFloat(shortRatio)>20?'var(--red)':'var(--yellow)'};font-size:20px;">${shortRatio}%</div>
        </div>
        <div class="stat-box">
          <div class="label">資券互抵</div>
          <div class="value">${fmtNum(parseNum(offset))}</div>
        </div>
      </div>
      <div class="grid-2" style="gap:16px;">
        <div>
          <div class="text-sm" style="color:var(--red);font-weight:600;margin-bottom:8px;">融資（張）</div>
          <div class="stat-grid">
            <div class="stat-box"><div class="label">買進</div><div class="value">${mBuy}</div></div>
            <div class="stat-box"><div class="label">賣出</div><div class="value">${mSell}</div></div>
            <div class="stat-box"><div class="label">餘額</div><div class="value">${mBal}</div></div>
          </div>
          <div class="text-sm ${mChg>=0?'up':'down'}" style="margin-top:4px;">增減：${mChg>0?'+':''}${fmtNum(mChg)}</div>
        </div>
        <div>
          <div class="text-sm" style="color:var(--green);font-weight:600;margin-bottom:8px;">融券（張）</div>
          <div class="stat-grid">
            <div class="stat-box"><div class="label">買進</div><div class="value">${sBuy}</div></div>
            <div class="stat-box"><div class="label">賣出</div><div class="value">${sSell}</div></div>
            <div class="stat-box"><div class="label">餘額</div><div class="value">${sBal}</div></div>
          </div>
          <div class="text-sm ${sChg>=0?'up':'down'}" style="margin-top:4px;">增減：${sChg>0?'+':''}${fmtNum(sChg)}</div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">融資融券載入失敗</div>';
  }
}

// ============================================================
// FETCH: Dividend History (股利政策)
// ============================================================
async function fetchStockDividend(code) {
  const el = document.getElementById('stock-dividend');
  if (!el) return;
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    // TWSE OpenAPI: 個股年度配息 (t187ap21_L = 上市, mopsfin_t187ap21_O = 上櫃)
    const results = await Promise.allSettled([
      apiFetch('https://openapi.twse.com.tw/v1/opendata/t187ap21_L'),
      apiFetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap21_O'),
    ]);
    const allRecords = [];
    for (const r of results) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const item of r.value) {
        const c = (item['公司代號'] || '').trim();
        if (c === code) allRecords.push(item);
      }
    }
    if (allRecords.length === 0) {
      el.innerHTML = '<div class="text-muted">暫無股利資料</div>';
      return;
    }
    // Sort by year descending
    allRecords.sort((a, b) => {
      const ya = parseInt(a['資料年度'] || a['年度'] || '0');
      const yb = parseInt(b['資料年度'] || b['年度'] || '0');
      return yb - ya;
    });
    const recent = allRecords.slice(0, 5);

    let html = '<table><thead><tr><th>年度</th><th>現金股利</th><th>股票股利</th><th>合計</th></tr></thead><tbody>';
    recent.forEach(item => {
      const yr = item['資料年度'] || item['年度'] || '--';
      const yrStr = parseInt(yr) > 200 ? yr : (parseInt(yr) + 1911) + '';
      const cashDiv = parseFloat(item['現金股利合計'] || item['現金股利'] || '0') || 0;
      const stockDiv = parseFloat(item['股票股利合計'] || item['股票股利'] || '0') || 0;
      const total = cashDiv + stockDiv;
      html += `<tr>
        <td>${yrStr}</td>
        <td>${cashDiv > 0 ? cashDiv.toFixed(2) : '--'}</td>
        <td>${stockDiv > 0 ? stockDiv.toFixed(2) : '--'}</td>
        <td style="font-weight:600;color:var(--yellow);">${total > 0 ? total.toFixed(2) : '--'}</td>
      </tr>`;
    });
    html += '</tbody></table>';

    // Calculate average dividend
    const totalDivs = recent.filter(i => {
      const c = parseFloat(i['現金股利合計'] || i['現金股利'] || '0') || 0;
      const s = parseFloat(i['股票股利合計'] || i['股票股利'] || '0') || 0;
      return (c + s) > 0;
    });
    if (totalDivs.length > 0) {
      const avgDiv = totalDivs.reduce((sum, i) => {
        return sum + (parseFloat(i['現金股利合計'] || i['現金股利'] || '0') || 0) + (parseFloat(i['股票股利合計'] || i['股票股利'] || '0') || 0);
      }, 0) / totalDivs.length;
      html += `<div class="text-sm text-muted" style="margin-top:8px;">近 ${totalDivs.length} 年平均股利：<span style="color:var(--yellow);font-weight:600;">${avgDiv.toFixed(2)} 元</span></div>`;
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">股利資料載入失敗</div>';
  }
}

// ============================================================
// RENDER: Chip Summary (籌碼速覽 — 籌碼K style)
// ============================================================
function renderChipSummary(code, name, C, H, L, V, instInfo, aiScoreObj, signals) {
  const el = document.getElementById('chip-summary-content');
  if (!el) return;

  const n = C.length;
  if (n < 5) { el.innerHTML = '<div class="text-muted">資料不足</div>'; return; }
  const i = n - 1;
  const lastC = C[i], prevC = C[i-1];
  const chg = lastC - prevC;
  const pct = prevC > 0 ? (chg / prevC * 100) : 0;

  // Volume analysis
  const avgV20 = V.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, V.length);
  const volRatio = avgV20 > 0 ? V[i] / avgV20 : 1;
  const volLabel = volRatio > 2 ? '爆量' : volRatio > 1.3 ? '量增' : volRatio > 0.7 ? '量平' : '量縮';
  const volColor = volRatio > 1.3 ? 'var(--cyan)' : volRatio > 0.7 ? 'var(--text2)' : 'var(--orange)';

  // Price position in recent range
  const h20 = Math.max(...H.slice(-20));
  const l20 = Math.min(...L.slice(-20));
  const posInRange = (h20 - l20) > 0 ? ((lastC - l20) / (h20 - l20) * 100) : 50;
  const posLabel = posInRange > 80 ? '相對高檔' : posInRange > 60 ? '中偏高' : posInRange > 40 ? '中間' : posInRange > 20 ? '中偏低' : '相對低檔';

  // MA trend
  const ma5 = C.slice(-5).reduce((a,b)=>a+b,0)/5;
  const ma20 = C.slice(-20).reduce((a,b)=>a+b,0)/Math.min(20,n);
  const trendLabel = lastC > ma5 && lastC > ma20 ? '多方排列' : lastC < ma5 && lastC < ma20 ? '空方排列' : '盤整';
  const trendColor = lastC > ma5 && lastC > ma20 ? 'var(--red)' : lastC < ma5 && lastC < ma20 ? 'var(--green)' : 'var(--yellow)';

  // Bullish/bearish signal count
  const bullCount = signals.filter(s => s.t === 'bullish').length;
  const bearCount = signals.filter(s => s.t === 'bearish').length;

  // Inst bars
  let instHtml = '';
  if (instInfo) {
    const maxInst = Math.max(Math.abs(instInfo.f || 0), Math.abs(instInfo.t || 0), Math.abs(instInfo.d || 0), 1);
    function instBar(label, val) {
      const isUp = val >= 0;
      const w = Math.abs(val) / maxInst * 100;
      const cls = isUp ? 'up' : 'down';
      const color = isUp ? 'var(--red)' : 'var(--green)';
      return `<div class="chip-inst-row">
        <span class="chip-inst-label">${label}</span>
        <div class="chip-inst-bar-wrap">
          <div class="chip-inst-bar" style="width:${w}%;background:${color};"></div>
        </div>
        <span class="chip-inst-val ${cls}">${val>0?'+':''}${fmtShares(val)}</span>
      </div>`;
    }
    instHtml = `<div class="chip-inst">
      ${instBar('外資', instInfo.f)}
      ${instBar('投信', instInfo.t)}
      ${instBar('自營', instInfo.d)}
    </div>`;
  } else {
    instHtml = '<div class="text-muted" style="font-size:12px;">無法人資料</div>';
  }

  // AI Score
  const lb = scoreLabel(aiScoreObj.total);

  el.innerHTML = `
    <div class="chip-grid">
      <div class="chip-card">
        <div class="chip-card-title">AI 評分</div>
        <div class="chip-card-big" style="color:${lb.color};">${aiScoreObj.total}</div>
        <div class="chip-card-sub"><span class="tag ${lb.cls}" style="font-size:11px;">${lb.text}</span></div>
      </div>
      <div class="chip-card">
        <div class="chip-card-title">趨勢判定</div>
        <div class="chip-card-big" style="color:${trendColor};font-size:16px;">${trendLabel}</div>
        <div class="chip-card-sub" style="color:var(--text2);">位階：${posLabel}</div>
      </div>
      <div class="chip-card">
        <div class="chip-card-title">量能狀態</div>
        <div class="chip-card-big" style="color:${volColor};font-size:16px;">${volLabel}</div>
        <div class="chip-card-sub" style="color:var(--text2);">量比 ${volRatio.toFixed(1)}x</div>
      </div>
      <div class="chip-card">
        <div class="chip-card-title">技術訊號</div>
        <div class="chip-card-big" style="font-size:14px;">
          <span class="up">${bullCount} 多</span>
          <span style="color:var(--text2);margin:0 4px;">/</span>
          <span class="down">${bearCount} 空</span>
        </div>
        <div class="chip-card-sub" style="color:var(--text2);">${bullCount > bearCount ? '偏多' : bearCount > bullCount ? '偏空' : '中性'}</div>
      </div>
    </div>
    <div class="chip-section-title">三大法人今日買賣超</div>
    ${instHtml}
  `;
}

function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function goAnalyze(code) {
  switchTab('analysis', true);
  analyzeStock(code);
}

// ============================================================
// WATCHLIST ACTIONS
// ============================================================
function addToWatchlistFromAnalysis() {
  const code = document.getElementById('stock-input').value.trim();
  if (!code) { toast('請先輸入股票代號'); return; }
  const list = wlGet();
  if (list.includes(code)) { toast(code + ' 已在關注清單中'); return; }
  list.push(code);
  wlSave(list);
  toast('已將 ' + code + ' 加入關注清單');
}

function addWatchlistFromInput() {
  const input = document.getElementById('wl-add-input');
  const code = input.value.trim();
  if (!code) return;
  const list = wlGet();
  if (list.includes(code)) { toast(code + ' 已在關注清單中'); return; }
  list.push(code);
  wlSave(list);
  input.value = '';
  toast('已將 ' + code + ' 加入關注清單');
  renderWatchlist();
}

function rmWatchlist(code) {
  const list = wlGet().filter(c => c !== code);
  wlSave(list);
  toast('已移除 ' + code);
  renderWatchlist();
}

// ============================================================
// RESIZE
// ============================================================
function handleResize() {
  [chtMain, chtRsi, chtKd, chtMacd, chtIntraday, chtTaiex].forEach(c => {
    if (c && c.chartElement) {
      try { c.applyOptions({ width: c.chartElement().parentElement.clientWidth }); } catch(e) {}
    }
  });
  // After resize, ensure K-line shows most recent data
  try { if (chtMain) chtMain.timeScale().scrollToRealTime(); } catch(e) {}
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 150));

// K-line chart zoom controls
function zoomChart(action) {
  if (!chtMain) return;
  var ts = chtMain.timeScale();
  if (action === 'reset') {
    ts.fitContent();
    return;
  }
  var range = ts.getVisibleLogicalRange();
  if (!range) return;
  var bars = range.to - range.from;
  var center = (range.from + range.to) / 2;
  var factor = action === 'in' ? 0.6 : 1.6;
  var newBars = Math.max(10, Math.round(bars * factor));
  var half = newBars / 2;
  ts.setVisibleLogicalRange({ from: center - half, to: center + half });
}

// ============================================================
// CHART FULLSCREEN
// ============================================================
let _fsOverlay = null;
let _fsChart = null;

function toggleChartFullscreen() {
  if (_fsOverlay) { closeChartFullscreen(); return; }

  const isMobile = window.innerWidth <= 768;

  // Create overlay
  _fsOverlay = document.createElement('div');
  _fsOverlay.className = 'chart-fullscreen-overlay' + (isMobile ? ' fs-landscape' : '');

  // On mobile: set explicit pixel dimensions from window (more reliable than CSS units inside transform)
  if (isMobile) {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    _fsOverlay.style.width = vh + 'px';
    _fsOverlay.style.height = vw + 'px';
    _fsOverlay.style.left = vw + 'px';
    _fsOverlay.style.top = '0px';
  }

  // Header
  const header = document.createElement('div');
  header.className = 'chart-fs-header';

  const title = document.createElement('span');
  title.className = 'chart-fs-title';
  const codeEl = document.getElementById('stock-code');
  const nameEl = document.getElementById('stock-title');
  title.textContent = (codeEl ? codeEl.textContent : '') + ' ' + (nameEl ? nameEl.textContent : '');

  // OHLCV tooltip area (updated on crosshair move)
  const ohlcv = document.createElement('div');
  ohlcv.className = 'chart-fs-ohlcv';
  ohlcv.id = 'fs-ohlcv';

  const controls = document.createElement('div');
  controls.className = 'chart-fs-controls';

  // Zoom buttons in fullscreen
  [{ label: '+', act: 'in' }, { label: '⊙', act: 'reset' }, { label: '−', act: 'out' }].forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'chart-zoom-btn';
    btn.textContent = b.label;
    btn.onclick = () => zoomFsChart(b.act);
    controls.appendChild(btn);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'chart-fs-close';
  closeBtn.innerHTML = '✕';
  closeBtn.onclick = closeChartFullscreen;
  controls.appendChild(closeBtn);

  header.appendChild(title);
  header.appendChild(ohlcv);
  header.appendChild(controls);

  // Chart body
  const body = document.createElement('div');
  body.className = 'chart-fs-body';

  _fsOverlay.appendChild(header);
  _fsOverlay.appendChild(body);
  document.body.appendChild(_fsOverlay);

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  // Prevent touch scroll leak on the overlay
  _fsOverlay.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // Use setTimeout for reliable layout settling (rAF can fire before transform layout finishes)
  setTimeout(() => {
    if (!_fsOverlay) return;

    // Calculate chart dimensions explicitly instead of relying on clientWidth/Height in rotated container
    let w, h;
    const mob = isMobile;
    if (mob) {
      const overlayW = window.innerHeight; // overlay width = vh (rotated)
      const overlayH = window.innerWidth;  // overlay height = vw (rotated)
      const headerH = header.offsetHeight || 32;
      w = overlayW;
      h = overlayH - headerH;
      // Force body dimensions explicitly
      body.style.width = w + 'px';
      body.style.height = h + 'px';
    } else {
      w = body.clientWidth;
      h = body.clientHeight;
    }

    if (w <= 0 || h <= 0) {
      // Fallback: try reading from DOM
      w = body.clientWidth || window.innerWidth;
      h = body.clientHeight || window.innerHeight - 50;
    }

    _fsChart = LightweightCharts.createChart(body, {
      width: w, height: h,
      autoSize: false,
      layout: { background: { color: '#060b18' }, textColor: '#8896b3', fontSize: mob ? 10 : 12, fontFamily: "'SF Pro Display', -apple-system, sans-serif" },
      grid: { vertLines: { color: 'rgba(0,240,255,0.06)' }, horzLines: { color: 'rgba(0,240,255,0.06)' } },
      crosshair: {
        mode: mob ? 1 : 0,
        vertLine: { color: 'rgba(0,240,255,0.35)', style: 2, width: 1, labelBackgroundColor: '#1a2540' },
        horzLine: { color: 'rgba(0,240,255,0.35)', style: 2, width: 1, labelBackgroundColor: '#1a2540' },
      },
      timeScale: { borderColor: 'rgba(0,240,255,0.1)', timeVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: mob ? 2 : 5 },
      rightPriceScale: { borderColor: 'rgba(0,240,255,0.1)', autoScale: true, scaleMargins: { top: 0.05, bottom: 0.05 }, minimumWidth: mob ? 46 : 70 },
      handleScroll: true, handleScale: true,
    });

    // Copy data from main chart series
    const fsCan = _fsChart.addCandlestickSeries({
      upColor: '#ff4070', downColor: '#00ff88',
      borderUpColor: '#ff4070', borderDownColor: '#00ff88',
      wickUpColor: '#ff5c7c', wickDownColor: '#33ee99',
    });

    // Volume with per-bar color matching candle direction
    const fsVol = _fsChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    _fsChart.priceScale('vol').applyOptions({ scaleMargins: { top: mob ? 0.85 : 0.82, bottom: 0 } });

    const fsMA = { lastValueVisible: false, priceLineVisible: false, title: '' };
    const fsMa5 = _fsChart.addLineSeries({ color: '#ffd036', lineWidth: mob ? 1 : 1.5, ...fsMA });
    const fsMa10 = _fsChart.addLineSeries({ color: '#00d4ff', lineWidth: mob ? 1 : 1.5, ...fsMA });
    const fsMa20 = _fsChart.addLineSeries({ color: '#b44dff', lineWidth: mob ? 1 : 1.5, ...fsMA });
    const fsBbU = _fsChart.addLineSeries({ color: 'rgba(255,208,54,0.4)', lineWidth: 1, lineStyle: 2, ...fsMA });
    const fsBbL = _fsChart.addLineSeries({ color: 'rgba(255,208,54,0.4)', lineWidth: 1, lineStyle: 2, ...fsMA });

    // Copy data from existing series
    let canData = [], volData = [];
    try {
      canData = sCan && sCan.data ? sCan.data() : [];
      volData = sVol && sVol.data ? sVol.data() : [];
      if (canData.length) fsCan.setData(canData);
      // Color volume bars to match candle direction
      if (volData.length && canData.length) {
        const canMap = {};
        canData.forEach(c => { canMap[c.time] = c; });
        const coloredVol = volData.map(v => {
          const c = canMap[v.time];
          const up = c ? c.close >= c.open : true;
          return { ...v, color: up ? 'rgba(255,64,112,0.35)' : 'rgba(0,255,136,0.35)' };
        });
        fsVol.setData(coloredVol);
      } else if (volData.length) {
        fsVol.setData(volData);
      }
      if (sMa5) fsMa5.setData(sMa5.data ? sMa5.data() : []);
      if (sMa10) fsMa10.setData(sMa10.data ? sMa10.data() : []);
      if (sMa20) fsMa20.setData(sMa20.data ? sMa20.data() : []);
      if (sBbU) fsBbU.setData(sBbU.data ? sBbU.data() : []);
      if (sBbL) fsBbL.setData(sBbL.data ? sBbL.data() : []);
    } catch(e) { console.warn('[CT] FS chart data copy:', e); }

    _fsChart.timeScale().fitContent();

    // OHLCV crosshair tooltip (header, updates on hover/drag)
    const ohlcvEl = document.getElementById('fs-ohlcv');
    if (ohlcvEl && canData.length) {
      _fsChart.subscribeCrosshairMove(param => {
        if (!param || !param.time) { ohlcvEl.innerHTML = ''; return; }
        const d = param.seriesData ? param.seriesData.get(fsCan) : null;
        if (!d) { ohlcvEl.innerHTML = ''; return; }
        const cls = d.close >= d.open ? 'up' : 'down';
        const vd = param.seriesData.get(fsVol);
        const vol = vd ? (vd.value / 1000).toFixed(0) : '-';
        ohlcvEl.innerHTML =
          '<span>O:<b class="' + cls + '">' + d.open + '</b></span>' +
          '<span>H:<b class="' + cls + '">' + d.high + '</b></span>' +
          '<span>L:<b class="' + cls + '">' + d.low + '</b></span>' +
          '<span>C:<b class="' + cls + '">' + d.close + '</b></span>' +
          '<span>V:<b>' + vol + 'K</b></span>';
      });
    }

    // Pinned floating tooltip card on click
    let _fsTip = null;
    const canMap = {};
    canData.forEach(c => { canMap[c.time] = c; });

    _fsChart.subscribeClick(param => {
      // Clicked empty space → remove tooltip
      if (!param || !param.time || !param.seriesData) {
        if (_fsTip) { _fsTip.remove(); _fsTip = null; }
        return;
      }
      const d = param.seriesData.get(fsCan);
      if (!d) { if (_fsTip) { _fsTip.remove(); _fsTip = null; } return; }

      const vd = param.seriesData.get(fsVol);
      const vol = vd ? vd.value : 0;
      const chg = d.open !== 0 ? ((d.close - d.open) / d.open * 100) : 0;
      const isUp = d.close >= d.open;
      const cls = isUp ? 'up' : 'down';
      const arrow = isUp ? '\u25b2' : '\u25bc';

      // Format date
      let dateStr = '';
      if (typeof d.time === 'object') {
        dateStr = d.time.year + '/' + String(d.time.month).padStart(2,'0') + '/' + String(d.time.day).padStart(2,'0');
      } else {
        dateStr = String(d.time);
      }

      // Format volume
      let volStr = '';
      if (vol >= 1e8) volStr = (vol / 1e8).toFixed(1) + ' 億';
      else if (vol >= 1e4) volStr = (vol / 1e4).toFixed(0) + ' 萬';
      else if (vol >= 1000) volStr = (vol / 1000).toFixed(1) + 'K';
      else volStr = String(vol);

      const html =
        '<div class="tt-date">' + dateStr + '</div>' +
        '<div class="tt-row"><span class="tt-label">開</span><span class="tt-val">' + d.open + '</span></div>' +
        '<div class="tt-row"><span class="tt-label">高</span><span class="tt-val ' + cls + '">' + d.high + '</span></div>' +
        '<div class="tt-row"><span class="tt-label">低</span><span class="tt-val ' + cls + '">' + d.low + '</span></div>' +
        '<div class="tt-row"><span class="tt-label">收</span><span class="tt-val ' + cls + '">' + d.close + '</span></div>' +
        '<div class="tt-row"><span class="tt-label">量</span><span class="tt-val">' + volStr + '</span></div>' +
        '<div class="tt-chg ' + cls + '">' + arrow + ' ' + chg.toFixed(2) + '%</div>' +
        '<div class="tt-arrow"></div>';

      if (!_fsTip) {
        _fsTip = document.createElement('div');
        _fsTip.className = 'chart-fs-tooltip';
        body.appendChild(_fsTip);
      }
      _fsTip.innerHTML = html;

      // Position: above the click point, clamped within chart bounds
      const bw = body.clientWidth;
      const bh = body.clientHeight;
      const tw = _fsTip.offsetWidth || 170;
      const th = _fsTip.offsetHeight || 120;
      let tx = (param.point ? param.point.x : bw / 2) - tw / 2;
      let ty = (param.point ? param.point.y : bh / 2) - th - 14;
      // Clamp horizontal
      if (tx < 4) tx = 4;
      if (tx + tw > bw - 4) tx = bw - tw - 4;
      // If not enough space above, show below
      if (ty < 4) ty = (param.point ? param.point.y : bh / 2) + 14;
      _fsTip.style.left = tx + 'px';
      _fsTip.style.top = ty + 'px';
    });

    // Force a second resize after chart creation to ensure canvas fills correctly
    if (mob) {
      setTimeout(() => {
        if (_fsChart) _fsChart.applyOptions({ width: w, height: h });
        if (_fsChart) _fsChart.timeScale().fitContent();
      }, 100);
    }

    // Handle resize in fullscreen
    window.addEventListener('resize', _fsResize);
  }, 80);
}

function _fsResize() {
  if (!_fsChart || !_fsOverlay) return;
  const isMob = _fsOverlay.classList.contains('fs-landscape');
  if (isMob) {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    _fsOverlay.style.width = vh + 'px';
    _fsOverlay.style.height = vw + 'px';
    _fsOverlay.style.left = vw + 'px';
  }
  setTimeout(() => {
    if (!_fsChart || !_fsOverlay) return;
    const body = _fsOverlay.querySelector('.chart-fs-body');
    const header = _fsOverlay.querySelector('.chart-fs-header');
    if (!body) return;
    let w, h;
    if (isMob) {
      w = window.innerHeight;
      h = window.innerWidth - (header ? header.offsetHeight : 32);
      body.style.width = w + 'px';
      body.style.height = h + 'px';
    } else {
      w = body.clientWidth;
      h = body.clientHeight;
    }
    _fsChart.applyOptions({ width: w, height: h });
  }, 80);
}

function zoomFsChart(action) {
  if (!_fsChart) return;
  var ts = _fsChart.timeScale();
  if (action === 'reset') { ts.fitContent(); return; }
  var range = ts.getVisibleLogicalRange();
  if (!range) return;
  var bars = range.to - range.from;
  var center = (range.from + range.to) / 2;
  var factor = action === 'in' ? 0.6 : 1.6;
  var newBars = Math.max(10, Math.round(bars * factor));
  var half = newBars / 2;
  ts.setVisibleLogicalRange({ from: center - half, to: center + half });
}

function closeChartFullscreen() {
  window.removeEventListener('resize', _fsResize);
  if (_fsChart) { try { _fsChart.remove(); } catch(e) {} _fsChart = null; }
  if (_fsOverlay) { _fsOverlay.remove(); _fsOverlay = null; }
  document.body.style.overflow = '';
}

// ESC to close fullscreen
document.addEventListener('keydown', e => { if (e.key === 'Escape' && _fsOverlay) closeChartFullscreen(); });

// ============================================================
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
        renderInstRank('foreign');
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
    renderOverview();
    if (instSummary) {
      renderInstSummary(instSummary);
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
      renderInstRank('foreign');
      renderAIRank();
      renderWatchlist();
      renderSectorRanking();
      renderTaiexChart();
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
// GLOBAL MARKET (via Yahoo Finance proxy)
// ============================================================
const GLOBAL_INDICES = [
  { symbol: '^DJI', name: '道瓊工業' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^SOX', name: '費城半導體' },
  { symbol: '^VIX', name: 'VIX 恐慌指數' },
  { symbol: '^TWII', name: '加權指數' },
  { symbol: '^N225', name: '日經 225' },
  { symbol: '000001.SS', name: '上證指數' },
];

const US_STOCK_GROUPS = {
  '科技巨頭': [
    { symbol: 'AAPL', name: 'Apple' },
    { symbol: 'MSFT', name: 'Microsoft' },
    { symbol: 'GOOGL', name: 'Google' },
    { symbol: 'AMZN', name: 'Amazon' },
    { symbol: 'META', name: 'Meta' },
    { symbol: 'TSLA', name: 'Tesla' },
  ],
  'AI 半導體': [
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'AMD', name: 'AMD' },
    { symbol: 'AVGO', name: 'Broadcom' },
    { symbol: 'TSM', name: '台積電ADR' },
    { symbol: 'ASML', name: 'ASML' },
    { symbol: 'ARM', name: 'ARM' },
    { symbol: 'MRVL', name: 'Marvell' },
    { symbol: 'QCOM', name: 'Qualcomm' },
  ],
  '低軌衛星 / 太空': [
    { symbol: 'ASTS', name: 'AST SpaceMobile' },
    { symbol: 'RKLB', name: 'Rocket Lab' },
    { symbol: 'GSAT', name: 'Globalstar' },
    { symbol: 'IRDM', name: 'Iridium' },
    { symbol: 'LUNR', name: 'Intuitive Machines' },
  ],
  '電動車 / 能源': [
    { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'RIVN', name: 'Rivian' },
    { symbol: 'NIO', name: 'NIO 蔚來' },
    { symbol: 'XPEV', name: 'XPeng 小鵬' },
    { symbol: 'ENPH', name: 'Enphase' },
    { symbol: 'PLUG', name: 'Plug Power' },
  ],
};

let gActiveUSGroup = Object.keys(US_STOCK_GROUPS)[0];

// Use Yahoo Finance v8 API (public, no key needed)
async function fetchYahooQuotes(symbols) {
  // Use v8 chart API (v7 quote API is deprecated/401)
  const results = await Promise.allSettled(
    symbols.map(async (sym) => {
      const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
      for (const host of hosts) {
        try {
          const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`;
          const r = await fetch('/api/proxy?url=' + encodeURIComponent(url));
          if (!r.ok) continue;
          const d = await r.json();
          const result = d.chart?.result?.[0];
          const meta = result?.meta;
          if (!meta) continue;
          const price = meta.regularMarketPrice || 0;
          const closes = result?.indicators?.quote?.[0]?.close || [];
          const prevClose = (closes.length >= 2 ? closes[closes.length - 2] : null) || meta.chartPreviousClose || price;
          const chg = price - prevClose;
          const pct = prevClose ? (chg / prevClose) * 100 : 0;
          return {
            symbol: meta.symbol || sym,
            regularMarketPrice: price,
            regularMarketChange: chg,
            regularMarketChangePercent: pct,
            regularMarketVolume: meta.regularMarketVolume || 0,
            regularMarketDayHigh: meta.regularMarketDayHigh || 0,
            regularMarketDayLow: meta.regularMarketDayLow || 0,
          };
        } catch (e) { /* try next host */ }
      }
      return null;
    })
  );
  return results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

async function renderGlobalIndices() {
  const box = document.getElementById('global-indices');
  const symbols = GLOBAL_INDICES.map(i => i.symbol);
  const quotes = await fetchYahooQuotes(symbols);

  if (quotes.length === 0) {
    box.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">國際市場資料暫時無法取得，點擊分頁重試</div>';
    return false;
  }

  const qMap = {};
  quotes.forEach(q => { qMap[q.symbol] = q; });

  let html = '<div class="stat-grid">';
  GLOBAL_INDICES.forEach(idx => {
    const q = qMap[idx.symbol];
    if (!q) return;
    const price = q.regularMarketPrice || 0;
    const chg = q.regularMarketChange || 0;
    const pct = q.regularMarketChangePercent || 0;
    const isUp = chg >= 0;
    html += `<div class="stat-box">
      <div class="label">${idx.name}</div>
      <div class="value" style="font-size:18px;">${fmtNum(price, price > 1000 ? 0 : 2)}</div>
      <div class="text-sm ${isUp ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</div>
    </div>`;
  });
  html += '</div>';
  box.innerHTML = html;
}

function renderUSStockTabs() {
  const box = document.getElementById('us-sector-tabs');
  box.innerHTML = Object.keys(US_STOCK_GROUPS).map((name, i) =>
    `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-usgroup="${name}">${name}</button>`
  ).join('');
  box.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      box.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gActiveUSGroup = btn.dataset.usgroup;
      renderUSStocks();
    });
  });
}

async function renderUSStocks() {
  const group = US_STOCK_GROUPS[gActiveUSGroup] || [];
  const box = document.getElementById('us-stocks');
  box.innerHTML = '<div class="loading-box"><div class="spinner"></div><div>載入美股資料...</div></div>';

  const symbols = group.map(s => s.symbol);
  const quotes = await fetchYahooQuotes(symbols);

  if (quotes.length === 0) {
    box.innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">美股資料暫時無法取得，點擊分頁重試</div>';
    return false;
  }

  const qMap = {};
  quotes.forEach(q => { qMap[q.symbol] = q; });

  const rows = group.map(s => {
    const q = qMap[s.symbol];
    if (!q) return null;
    const price = q.regularMarketPrice || 0;
    const chg = q.regularMarketChange || 0;
    const pct = q.regularMarketChangePercent || 0;
    const vol = q.regularMarketVolume || 0;
    const isUp = chg >= 0;
    return [
      `<b>${s.symbol}</b>`,
      s.name,
      `$${fmtNum(price, 2)}`,
      `<span class="${isUp ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)}</span>`,
      `<span class="${isUp ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>`,
      fmtBig(vol),
    ];
  }).filter(Boolean);

  if (window.innerWidth <= 768) {
    let h = '<div class="rank-card-list">';
    group.forEach(s => {
      const q = qMap[s.symbol];
      if (!q) return;
      const price = q.regularMarketPrice || 0;
      const chg = q.regularMarketChange || 0;
      const pct = q.regularMarketChangePercent || 0;
      const vol = q.regularMarketVolume || 0;
      const isUp = chg >= 0;
      h += `<div class="rank-card">
        <div class="rank-card-head">
          <span class="rank-card-code">${s.symbol}</span>
          <span class="rank-card-name">${s.name}</span>
          <span class="rank-card-pct ${isUp ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>
        </div>
        <div class="rank-card-body">
          <div><span class="dt-label">股價</span><span>$${fmtNum(price, 2)}</span></div>
          <div><span class="dt-label">漲跌</span><span class="${isUp ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)}</span></div>
          <div><span class="dt-label">成交量</span><span>${fmtBig(vol)}</span></div>
        </div>
      </div>`;
    });
    h += '</div>';
    box.innerHTML = h;
  } else {
    box.innerHTML = mkTable(['代碼', '名稱', '股價', '漲跌', '漲跌%', '成交量'], rows);
  }
}

// ============================================================
// ============================================================
// REAL-TIME QUOTE + INTRADAY CHART + ORDER BOOK
// ============================================================
let chtIntraday = null;
let sIntraLine = null;
let gRealtimeTimer = null;
let gCurrentAnalysisCode = '';

function initIntradayChart() {
  const el = document.getElementById('intraday-chart');
  if (!el || el.clientWidth === 0) return;
  if (chtIntraday) { chtIntraday.remove(); chtIntraday = null; }
  const mob = window.innerWidth <= 768;
  chtIntraday = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight || 220,
    layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: mob ? 10 : 11, fontFamily: "'SF Pro Display', -apple-system, sans-serif" },
    grid: { vertLines: { color: mob ? 'rgba(0, 240, 255, 0.06)' : 'rgba(0, 240, 255, 0.04)' }, horzLines: { color: mob ? 'rgba(0, 240, 255, 0.06)' : 'rgba(0, 240, 255, 0.04)' } },
    timeScale: { borderColor: 'rgba(0, 240, 255, 0.1)', timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderColor: 'rgba(0, 240, 255, 0.1)', autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 }, minimumWidth: mob ? 55 : 65 },
    crosshair: { mode: mob ? 1 : 0, vertLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2, labelBackgroundColor: '#1a2540' }, horzLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2, labelBackgroundColor: '#1a2540' } },
  });
  sIntraLine = chtIntraday.addAreaSeries({
    lineColor: '#00d4ff',
    topColor: 'rgba(0,212,255,0.25)',
    bottomColor: 'rgba(0,212,255,0.02)',
    lineWidth: 2,
  });
}

async function fetchIntradayChart(code) {
  const market = getMarket(code);
  const suffix = (market === 'tpex' || market === 'emerging') ? '.TWO' : '.TW';
  const symbol = code + suffix;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=1d`;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const r = await fetch(proxyUrl);
    if (!r.ok) return;
    const d = await r.json();
    const result = d.chart?.result?.[0];
    if (!result || !result.timestamp) return;
    const ts = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const data = [];
    const tzOffset = 8 * 3600; // UTC+8 (台灣時間)
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) {
        data.push({ time: ts[i] + tzOffset, value: closes[i] });
      }
    }
    if (data.length > 0 && sIntraLine) {
      sIntraLine.setData(data);
      chtIntraday.timeScale().fitContent();
    }
    document.getElementById('intraday-status').textContent =
      data.length > 0 ? `最後更新：${new Date().toLocaleTimeString('zh-TW')} (${data.length} 筆)` : '無盤中資料';
  } catch (e) {
    document.getElementById('intraday-status').textContent = '走勢圖載入失敗';
  }
}

async function fetchRealtimeQuote(code) {
  const market = getMarket(code);

  // Try Fugle first for price data, MIS for order book
  var fugleData = null, misInfo = null;
  try {
    const [fugleRes, misRes] = await Promise.allSettled([
      fetchFugleQuote(code),
      (async function() {
        const exCh = (market === 'tpex' || market === 'emerging') ? `otc_${code}.tw` : `tse_${code}.tw`;
        const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}`;
        const r = await fetch('/api/proxy?url=' + encodeURIComponent(url));
        if (!r.ok) return null;
        const d = await r.json();
        return d.msgArray?.[0] || null;
      })()
    ]);
    fugleData = fugleRes.status === 'fulfilled' ? fugleRes.value : null;
    misInfo = misRes.status === 'fulfilled' ? misRes.value : null;
  } catch(e) {}

  // Extract price from Fugle
  var lastPrice = 0, prevClose = 0, open = 0, high = 0, low = 0, vol = 0, timeStr = '';
  if (fugleData && !fugleData.error) {
    lastPrice = fugleData.closePrice || fugleData.lastPrice || fugleData.tradePrice || 0;
    prevClose = fugleData.previousClose || fugleData.referencePrice || 0;
    open = fugleData.openPrice || 0;
    high = fugleData.highPrice || 0;
    low = fugleData.lowPrice || 0;
    vol = fugleData.tradeVolume || fugleData.totalVolume || 0;
    timeStr = fugleData.lastUpdated ? fugleData.lastUpdated.slice(11, 19) : '';
  }

  // Fallback to MIS if Fugle didn't provide price
  if ((!lastPrice || lastPrice === 0) && misInfo) {
    lastPrice = parseFloat(misInfo.z);
    if (!lastPrice || isNaN(lastPrice)) lastPrice = parseFloat(misInfo.pz);
    if (!lastPrice || isNaN(lastPrice)) {
      var ba = parseFloat((misInfo.a||'').split('_')[0]), bb = parseFloat((misInfo.b||'').split('_')[0]);
      if (ba > 0 && bb > 0) lastPrice = (ba + bb) / 2;
      else if (ba > 0) lastPrice = ba;
      else if (bb > 0) lastPrice = bb;
    }
    if (!lastPrice || isNaN(lastPrice)) lastPrice = parseFloat(misInfo.o);
    if (!lastPrice || isNaN(lastPrice)) lastPrice = parseFloat(misInfo.y);
    if (!lastPrice || isNaN(lastPrice)) lastPrice = 0;
    prevClose = parseFloat(misInfo.y) || 0;
    open = parseFloat(misInfo.o) || 0;
    high = parseFloat(misInfo.h) || 0;
    low = parseFloat(misInfo.l) || 0;
    vol = parseInt(misInfo.v) || 0;
    timeStr = misInfo.t || '';
  }

  // Update header price + cache for analyzeStock to use
  if (lastPrice > 0 && prevClose > 0) {
    const chg = lastPrice - prevClose;
    const pct = (chg / prevClose * 100);
    document.getElementById('stock-price').textContent = fmtNum(lastPrice, 2);
    if (pct >= 9.5) {
      document.getElementById('stock-price').className = 'limit-price limit-price-up';
    } else if (pct <= -9.5) {
      document.getElementById('stock-price').className = 'limit-price limit-price-down';
    } else {
      document.getElementById('stock-price').className = chg >= 0 ? 'up' : 'down';
    }
    document.getElementById('stock-change').innerHTML =
      `<span class="${chg >= 0 ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>`;
    // Also update gMisCache so other code (analyzeStock, watchlist) can use it
    gMisCache[code] = {
      price: lastPrice, chg: chg, pct: pct,
      vol: vol, high: high, low: low, open: open,
      time: timeStr, name: misInfo ? (misInfo.n || '') : '',
    };
  }

  // Order book (MIS only — Fugle free tier doesn't have order book)
  if (misInfo) renderOrderBook(misInfo, prevClose || parseFloat(misInfo.y) || 0);

  // Realtime info
  if (lastPrice > 0) {
    document.getElementById('realtime-info').innerHTML =
      `開盤 ${fmtNum(open,2)} | 最高 <span class="up">${fmtNum(high,2)}</span> | 最低 <span class="down">${fmtNum(low,2)}</span> | 量 ${fmtNum(vol,0)} 張 | ${timeStr}`;
  }

  return { price: lastPrice, prevClose, chg: lastPrice - prevClose, pct: prevClose > 0 ? ((lastPrice - prevClose) / prevClose * 100) : 0 };
}

function renderOrderBook(info, prevClose) {
  const asks = (info.a || '').split('_').filter(Boolean).map(Number).slice(0, 5);
  const bids = (info.b || '').split('_').filter(Boolean).map(Number).slice(0, 5);
  const askVols = (info.f || '').split('_').filter(Boolean).map(Number).slice(0, 5);
  const bidVols = (info.g || '').split('_').filter(Boolean).map(Number).slice(0, 5);
  const maxVol = Math.max(...askVols, ...bidVols, 1);

  let html = '<table class="ob-table">';
  // Asks (reverse order, highest first)
  for (let i = asks.length - 1; i >= 0; i--) {
    const cls = asks[i] > prevClose ? 'up' : asks[i] < prevClose ? 'down' : '';
    const pct = (askVols[i] / maxVol * 100).toFixed(0);
    html += `<tr class="ob-ask">
      <td class="ob-label">賣${i + 1}</td>
      <td class="ob-price ${cls}">${fmtNum(asks[i], 2)}</td>
      <td class="ob-vol">${fmtNum(askVols[i], 0)}<div class="ob-bar" style="width:${pct}%;background:var(--green);float:right;"></div></td>
    </tr>`;
  }
  // Separator
  html += '<tr><td colspan="3" style="height:2px;background:var(--border);padding:0;"></td></tr>';
  // Bids
  for (let i = 0; i < bids.length; i++) {
    const cls = bids[i] > prevClose ? 'up' : bids[i] < prevClose ? 'down' : '';
    const pct = (bidVols[i] / maxVol * 100).toFixed(0);
    html += `<tr class="ob-bid">
      <td class="ob-label">買${i + 1}</td>
      <td class="ob-price ${cls}">${fmtNum(bids[i], 2)}</td>
      <td class="ob-vol">${fmtNum(bidVols[i], 0)}<div class="ob-bar" style="width:${pct}%;background:var(--red);float:right;"></div></td>
    </tr>`;
  }
  html += '</table>';
  document.getElementById('orderbook').innerHTML = html;
}

function startRealtimeUpdates(code) {
  stopRealtimeUpdates();
  gCurrentAnalysisCode = code;

  // Initial fetch
  initIntradayChart();
  fetchIntradayChart(code);
  fetchRealtimeQuote(code);

  // Auto refresh every 15 seconds during trading hours
  gRealtimeTimer = setInterval(() => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes();
    const isTrading = now.getDay() >= 1 && now.getDay() <= 5 && ((h === 9 && m >= 0) || (h >= 10 && h < 13) || (h === 13 && m <= 30));
    if (isTrading) {
      fetchRealtimeQuote(code);
      fetchIntradayChart(code);
    }
  }, 15000);
}

function stopRealtimeUpdates() {
  if (gRealtimeTimer) { clearInterval(gRealtimeTimer); gRealtimeTimer = null; }
}

// INIT SECTORS + GLOBAL + DAYTRADE ON TAB SWITCH (lazy load)
// ============================================================
let gSectorsLoaded = false;
let gGlobalLoaded = false;
let gGlobalSuccess = false;
let gOpinionLoaded = false;
let gOpinionSuccess = false;
let gBriefingLoaded = false;
let gBriefingSuccess = false;
let gBriefingDate = null;
let _brPollTimer = null;

function maybeLoadSectors() {
  if (gSectorsLoaded) return;
  gSectorsLoaded = true;
  renderSectorTabs();
  renderSectorStocks();
}

async function maybeLoadGlobal() {
  if (gGlobalLoaded && gGlobalSuccess) return;
  gGlobalLoaded = true;
  gGlobalSuccess = false;
  renderUSStockTabs();
  const results = await Promise.allSettled([renderGlobalIndices(), renderUSStocks()]);
  gGlobalSuccess = results.some(r => r.status === 'fulfilled' && r.value !== false);
  if (!gGlobalSuccess) gGlobalLoaded = false;
}

let gDayTradeCache = null; // cache successful day trade data
let gFinMindInst = null;   // FinMind institutional data: { "2330": { f, t, d, total, name }, ... }

// ============================================================
// FUGLE + FINMIND API (server-proxied)
// ============================================================
async function fetchFugleQuote(code) {
  try {
    const r = await fetch('/api/fugle/quote/' + encodeURIComponent(code));
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function fetchFugleBatch(codes) {
  if (!codes || codes.length === 0) return {};
  try {
    const r = await fetch('/api/fugle/batch?codes=' + encodeURIComponent(codes.join(',')));
    if (!r.ok) return {};
    return await r.json();
  } catch(e) { return {}; }
}

async function fetchFinMindInst(dateStr) {
  // dateStr = "20260304" → convert to "2026-03-04"
  var d = dateStr;
  if (d.length === 8 && d.indexOf('-') === -1) {
    d = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  }
  try {
    const r = await fetch('/api/finmind/inst?date=' + encodeURIComponent(d));
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

async function fetchFinMindDayTrade(dateStr) {
  var d = dateStr;
  if (d.length === 8 && d.indexOf('-') === -1) {
    d = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  }
  try {
    const r = await fetch('/api/finmind/daytrade?date=' + encodeURIComponent(d));
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

function renderDayTradeFinMind(rows) {
  // rows = FinMind TaiwanStockDayTrading array
  if (!rows || rows.length === 0) return false;

  // Aggregate stats
  var totalVol = 0, totalBuy = 0, totalSell = 0;
  var stockMap = {};
  rows.forEach(function(r) {
    var code = r.stock_id || '';
    if (!code || !/^\d{4}$/.test(code)) return;
    // FinMind fields: Volume (shares), BuyAmount (dollars), SellAmount (dollars)
    var vol = parseInt(r.Volume) || 0;
    var buy = parseInt(r.BuyAmount) || 0;
    var sell = parseInt(r.SellAmount) || 0;
    totalVol += vol; totalBuy += buy; totalSell += sell;
    if (!stockMap[code]) stockMap[code] = { code: code, name: (gStockDB[code] ? gStockDB[code].name : '') || code, vol: 0, buy: 0, sell: 0 };
    stockMap[code].vol += vol;
    stockMap[code].buy += buy;
    stockMap[code].sell += sell;
  });

  // Stats header
  document.getElementById('dt-stats').innerHTML =
    '<div class="stat-box"><div class="label">當沖成交股數</div><div class="value">' + fmtBig(totalVol) + '</div></div>'
    + '<div class="stat-box"><div class="label">當沖買進金額</div><div class="value">' + fmtBig(totalBuy) + '</div></div>'
    + '<div class="stat-box"><div class="label">當沖賣出金額</div><div class="value">' + fmtBig(totalSell) + '</div></div>'
    + '<div class="stat-box"><div class="label">資料來源</div><div class="value" style="font-size:13px;">FinMind</div></div>';

  // Rank list
  var list = Object.values(stockMap).sort(function(a, b) { return b.vol - a.vol; }).slice(0, 30);
  var isMob = window.innerWidth <= 768;
  if (isMob) {
    var h = '<div class="dt-card-list">';
    list.forEach(function(s, i) {
      var pnl = s.sell - s.buy;
      h += '<div class="rank-card" onclick="goAnalyze(\'' + s.code + '\')">'
        + '<div class="rank-card-head"><span class="rank-card-num">' + (i+1) + '</span>'
        + '<span class="rank-card-code">' + s.code + '</span>'
        + '<span class="rank-card-name">' + s.name + '</span>' + warningTag(s.code)
        + '<span class="rank-card-pct">' + fmtBig(s.vol) + '</span></div></div>';
    });
    h += '</div>';
    document.getElementById('dt-rank').innerHTML = h;
  } else {
    document.getElementById('dt-rank').innerHTML = mkTable(
      ['代號', '名稱', '當沖股數', '買進金額', '賣出金額'],
      list.map(function(s) {
        return [
          '<span class="clickable" onclick="goAnalyze(\'' + s.code + '\')">' + s.code + '</span>',
          '<span class="clickable" onclick="goAnalyze(\'' + s.code + '\')">' + s.name + '</span>',
          fmtBig(s.vol), fmtBig(s.buy), fmtBig(s.sell)
        ];
      })
    );
  }
  return true;
}

async function maybeLoadDayTrade(forceRefresh) {
  // Use cache if available
  if (!forceRefresh && gDayTradeCache) {
    if (Array.isArray(gDayTradeCache)) renderDayTradeFinMind(gDayTradeCache);
    else renderDayTrade(gDayTradeCache);
    return;
  }

  document.getElementById('dt-stats').innerHTML = '<div class="loading-box"><div class="spinner"></div><div>載入當沖資料...</div></div>';
  document.getElementById('dt-rank').innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';

  try {
    var found = false;

    // Strategy 1: Try FinMind first (most reliable on cloud)
    for (var i = 1; i <= 5; i++) {
      try {
        var d = dateStr(i);
        var fmData = await fetchFinMindDayTrade(d);
        if (fmData && Array.isArray(fmData) && fmData.length > 0 && renderDayTradeFinMind(fmData)) {
          gDayTradeCache = fmData;
          found = true;
          break;
        }
      } catch(e) {}
    }

    // Strategy 2: TWTB4U fallback
    if (!found) {
      for (var i = 1; i <= 10; i++) {
        try {
          var d = dateStr(i);
          var data = await API_TWSE.dayTrade(d);
          if (data && renderDayTrade(data)) {
            gDayTradeCache = data;
            found = true;
            break;
          }
        } catch(e) {
          if (i === 1 && (e.message.includes('502') || e.message.includes('Failed') || e.message.includes('307'))) break;
        }
      }
    }

    if (!found) {
      document.getElementById('dt-stats').innerHTML =
        '<div class="empty-state" style="padding:24px;text-align:center;">'
        + '<div class="icon" style="font-size:32px;">&#x26A1;</div>'
        + '<p>當沖資料暫時無法取得</p>'
        + '<p class="text-sm text-muted" style="margin-top:6px;">證交所可能限制雲端存取，盤後資料通常於次一營業日公布</p>'
        + '<button class="btn btn-primary" style="margin-top:12px;" onclick="maybeLoadDayTrade(true)">重新載入</button></div>';
      document.getElementById('dt-rank').innerHTML = '';
    }
  } catch(e) {
    document.getElementById('dt-stats').innerHTML =
      '<div class="empty-state" style="padding:24px;text-align:center;">'
      + '<div class="icon" style="font-size:32px;color:var(--red);">&#x26A0;</div>'
      + '<p>當沖資料載入失敗</p>'
      + '<p class="text-sm text-muted" style="margin-top:6px;">' + e.message + '</p>'
      + '<button class="btn btn-primary" style="margin-top:12px;" onclick="maybeLoadDayTrade(true)">重新載入</button></div>';
    document.getElementById('dt-rank').innerHTML = '';
  }
}

// ============================================================
// TICKER BAR — scrolling market indices
// ============================================================
const TICKER_INDICES = [
  { symbol: '^TWII', name: '加權指數' },
  { symbol: '^DJI', name: '道瓊' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^SOX', name: '費半' },
  { symbol: '^VIX', name: 'VIX' },
  { symbol: '^N225', name: '日經' },
  { symbol: 'NVDA', name: 'NVDA' },
  { symbol: 'TSM', name: '台積ADR' },
  { symbol: 'AAPL', name: 'AAPL' },
  { symbol: 'MSFT', name: 'MSFT' },
  { symbol: 'GOOGL', name: 'GOOG' },
  { symbol: 'TSLA', name: 'TSLA' },
];

async function loadTicker() {
  try {
    const [quotes, futuresRes] = await Promise.allSettled([
      fetchYahooQuotes(TICKER_INDICES.map(i => i.symbol)),
      fetch('/api/futures').then(r => r.ok ? r.json() : null),
    ]);
    const yahooQuotes = quotes.status === 'fulfilled' ? quotes.value : [];
    const futures = futuresRes.status === 'fulfilled' ? futuresRes.value : null;
    if (yahooQuotes.length === 0 && !futures) return;

    const qMap = {};
    yahooQuotes.forEach(q => { qMap[q.symbol] = q; });

    let html = '';
    function addItems() {
      // 台指期 (night session preferred, fallback to day)
      const txf = futures && (futures.night || futures.day || futures.spot);
      if (txf && txf.CLastPrice) {
        const price = parseFloat(txf.CLastPrice);
        const diff = parseFloat(txf.CDiff) || 0;
        const pct = parseFloat(txf.CDiffRate) || 0;
        const isUp = diff >= 0;
        const cls = isUp ? 'up' : 'down';
        const arrow = isUp ? '&#x25B2;' : '&#x25BC;';
        const label = futures.night ? '台指期夜盤' : futures.day ? '台指期' : '加權';
        html += `<span class="ticker-item">
          <span class="ti-name">${label}</span>
          <span class="ti-price ${cls}">${fmtNum(price, 0)}</span>
          <span class="${cls}" style="font-size:11px;">${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>
          <span class="ti-sep">&#x25CF;</span>
        </span>`;
      }

      TICKER_INDICES.forEach(idx => {
        const q = qMap[idx.symbol];
        if (!q) return;
        const price = q.regularMarketPrice || 0;
        const chg = q.regularMarketChange || 0;
        const pct = q.regularMarketChangePercent || 0;
        const isUp = chg >= 0;
        const cls = isUp ? 'up' : 'down';
        const arrow = isUp ? '&#x25B2;' : '&#x25BC;';
        html += `<span class="ticker-item">
          <span class="ti-name">${idx.name}</span>
          <span class="ti-price ${cls}">${fmtNum(price, price > 1000 ? 0 : 2)}</span>
          <span class="${cls}" style="font-size:11px;">${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>
          <span class="ti-sep">&#x25CF;</span>
        </span>`;
      });
    }
    addItems();
    addItems(); // duplicate for seamless scroll loop

    const track = document.getElementById('ticker-track');
    track.innerHTML = html;

    // Use Web Animations API with exact pixel values (reliable on iOS PWA)
    if (window._tickerAnim) { window._tickerAnim.cancel(); window._tickerAnim = null; }
    requestAnimationFrame(() => {
      const halfWidth = track.scrollWidth / 2;
      if (halfWidth > 0) {
        window._tickerAnim = track.animate(
          [
            { transform: 'translate3d(0, 0, 0)' },
            { transform: `translate3d(-${halfWidth}px, 0, 0)` }
          ],
          { duration: halfWidth * 25, iterations: Infinity, easing: 'linear' }
        );
      }
    });
  } catch(e) {
    // Ticker is non-critical, silently fail
  }
}

// ============================================================
// GLOBAL SEARCH MODAL (Ctrl+K)
// ============================================================
const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('global-search-input');
const searchResults = document.getElementById('global-search-results');
let gsIdx = -1;

function openSearch() {
  searchOverlay.classList.add('show');
  searchInput.value = '';
  searchResults.innerHTML = '';
  gsIdx = -1;
  setTimeout(() => searchInput.focus(), 50);
}

function closeSearch() {
  searchOverlay.classList.remove('show');
  searchInput.value = '';
  gsIdx = -1;
}

searchOverlay.addEventListener('click', e => {
  if (e.target === searchOverlay) closeSearch();
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (searchOverlay.classList.contains('show')) closeSearch();
    else openSearch();
  }
  if (e.key === 'Escape' && searchOverlay.classList.contains('show')) {
    closeSearch();
  }
});

let _gsDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(_gsDebounce);
  const q = searchInput.value.trim();
  if (q.length === 0) { searchResults.innerHTML = ''; gsIdx = -1; return; }
  _gsDebounce = setTimeout(() => {
    const results = searchStocks(q);
    gsIdx = -1;
    if (results.length === 0) {
      searchResults.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text2);font-size:13px;">找不到符合的股票</div>';
      return;
    }
    searchResults.innerHTML = results.map((r, i) => {
      const mCls = r.market === 'twse' ? 'tag-twse' : r.market === 'emerging' ? 'tag-emerging' : 'tag-tpex';
      const mLabel = r.market === 'twse' ? '上市' : r.market === 'emerging' ? '興櫃' : '上櫃';
      return `<div class="sm-item" data-idx="${i}" data-code="${r.code}">
        <span><span style="color:var(--cyan);font-weight:600;font-size:15px;">${r.code}</span>
        <span style="color:var(--text2);margin-left:8px;">${r.name}</span></span>
        <span class="tag-market ${mCls}">${mLabel}</span>
      </div>`;
    }).join('');
    searchResults.querySelectorAll('.sm-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        closeSearch();
        goAnalyze(el.dataset.code);
      });
    });
  }, 150);
});

searchInput.addEventListener('keydown', e => {
  const items = searchResults.querySelectorAll('.sm-item');
  if (items.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    gsIdx = Math.min(gsIdx + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('active', i === gsIdx));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    gsIdx = Math.max(gsIdx - 1, 0);
    items.forEach((el, i) => el.classList.toggle('active', i === gsIdx));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const code = gsIdx >= 0 && items[gsIdx] ? items[gsIdx].dataset.code : searchInput.value.trim();
    if (code) { closeSearch(); goAnalyze(code); }
  }
});

// ============================================================
// AUTO-REFRESH during trading hours
// ============================================================
let gAutoRefreshTimer = null;
let gLastRefreshTime = null;
let gRefreshing = false;

async function doAutoRefresh(silent) {
  if (gRefreshing) return;
  gRefreshing = true;
  const now = new Date();

  try {
    // Show refresh indicator
    const dot = document.getElementById('status-dot');
    if (dot) dot.classList.add('refreshing');

    // Clear stale fetch cache entries (keep entries < 2 min old)
    var now_ts = Date.now();
    Object.keys(_cache).forEach(function(k) {
      if (now_ts - _cache[k].ts > CACHE_MS) delete _cache[k];
    });

    // Refresh core data — OpenAPI as fallback when traditional endpoints are blocked
    // FinMind institutional data fetched in parallel
    const results = await Promise.allSettled([
      API_TWSE.allStocks(gDate),
      API_TPEX.allStocks(gDate),
      API_TWSE.instStocks(gDate),
      API_TPEX.instStocks(gDate),
      apiFetch(OPENAPI_TWSE_ALL),
      apiFetch(OPENAPI_TPEX_ALL),
      apiFetch(OPENAPI_TPEX_CLOSE),
      fetchFinMindInst(gDate),
      apiFetch(OPENAPI_EMERGING),
    ]);
    const allStocks  = results[0].status === 'fulfilled' ? results[0].value : null;
    const tpexAll    = results[1].status === 'fulfilled' ? results[1].value : null;
    const instStocks = results[2].status === 'fulfilled' ? results[2].value : null;
    const tpexInst   = results[3].status === 'fulfilled' ? results[3].value : null;
    const openTwse   = results[4].status === 'fulfilled' ? results[4].value : null;
    const openTpex   = results[5].status === 'fulfilled' ? results[5].value : null;
    const openTpexC  = results[6].status === 'fulfilled' ? results[6].value : null;
    const finMindInst = results[7].status === 'fulfilled' ? results[7].value : null;
    const openEmerging = results[8].status === 'fulfilled' ? results[8].value : null;
    if (finMindInst && typeof finMindInst === 'object' && !finMindInst.error) {
      gFinMindInst = finMindInst;
    }

    // TWSE all stocks: traditional first, OpenAPI fallback
    if (allStocks && allStocks.stat === 'OK' && allStocks.data && allStocks.data.length > 0) {
      gAllStocks = allStocks.data;
    } else if (Array.isArray(openTwse) && openTwse.length > 0) {
      gAllStocks = openTwse.map(item => [
        item.Code || '', item.Name || '',
        item.TradeVolume || '0', item.Transaction || '0', item.TradeValue || '0',
        item.OpeningPrice || '--', item.HighestPrice || '--', item.LowestPrice || '--',
        item.ClosingPrice || '--', item.Change || '0',
        '', '', '', '', '', '', ''
      ]);
    }

    // TPEX all stocks: traditional first, OpenAPI fallback
    if (tpexAll && tpexAll.tables && tpexAll.tables[0] && tpexAll.tables[0].data && tpexAll.tables[0].data.length > 0) {
      gTpexAllStocks = tpexAll.tables[0].data;
    } else if (tpexAll && tpexAll.aaData && tpexAll.aaData.length > 0) {
      gTpexAllStocks = tpexAll.aaData;
    } else if (Array.isArray(openTpexC) && openTpexC.length > 0) {
      gTpexAllStocks = openTpexC.map(item => [
        item.SecuritiesCompanyCode || '', item.CompanyName || '',
        item.ClosingPrice || '--', item.Change || '0',
        item.OpeningPrice || '--', item.HighestPrice || '--', item.LowestPrice || '--',
        item.TradingShares || '0', item.TradeValue || '0', item.Transaction || '0',
        '', '', '', '', '', '', ''
      ]);
    }

    // Update institutional data — only if we got actual rows (T86 is empty during trading hours)
    if (instStocks && instStocks.stat === 'OK' && instStocks.data && instStocks.data.length > 0) gInstStocks = instStocks.data;
    if (tpexInst && tpexInst.tables && tpexInst.tables[0] && tpexInst.tables[0].data && tpexInst.tables[0].data.length > 0) gTpexInstStocks = tpexInst.tables[0].data;
    else if (tpexInst && tpexInst.aaData && tpexInst.aaData.length > 0) gTpexInstStocks = tpexInst.aaData;

    buildStockDB();
    rebuildMaps();

    // Fill TPEX gaps from OpenAPI (critical during trading hours)
    if (Array.isArray(openTpex)) {
      openTpex.forEach(item => {
        const code = (item.SecuritiesCompanyCode || '').trim();
        const name = (item.CompanyName || '').trim();
        if (code && name && /^\d{4,6}$/.test(code) && !gStockDB[code]) {
          gStockDB[code] = { name, market: 'tpex' };
        }
      });
    }
    // Fill emerging stock gaps from OpenAPI (critical during trading hours)
    if (Array.isArray(openEmerging)) {
      openEmerging.forEach(item => {
        const code = (item.SecuritiesCompanyCode || '').trim();
        const name = (item.CompanyName || '').trim();
        if (code && name && /^\d{4,6}$/.test(code) && !gStockDB[code]) {
          gStockDB[code] = { name, market: 'emerging' };
        }
      });
    }

    // Fetch MIS real-time quotes for watchlist stocks (5-second fresh!)
    var wlCodes = wlGet();
    if (wlCodes.length > 0) {
      await fetchMisBatch(wlCodes);
    }

    // Re-render active panel (all tabs, not just overview)
    const activePanel = document.querySelector('.panel.active');
    if (activePanel) {
      const id = activePanel.id;
      if (id === 'panel-overview') renderOverview();
      else if (id === 'panel-watchlist') renderWatchlist();
      else if (id === 'panel-institutional') renderInstRank(document.querySelector('.inst-tab-btn.active')?.dataset?.inst || 'foreign');
      else if (id === 'panel-briefing') maybeLoadBriefing();
    }

    // Check price alerts
    checkPriceAlerts();

    gLastRefreshTime = now;
    setStatus('', `已連線 — 上次更新 ${now.toLocaleTimeString('zh-TW')}`);

    if (dot) setTimeout(() => dot.classList.remove('refreshing'), 500);
  } catch(e) {
    if (!silent) setStatus('error', '更新失敗，稍後重試');
    const dot = document.getElementById('status-dot');
    if (dot) dot.classList.remove('refreshing');
  } finally {
    gRefreshing = false;
  }
}

function startAutoRefresh() {
  if (gAutoRefreshTimer) return;
  gAutoRefreshTimer = setInterval(() => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), dow = now.getDay();
    // Trading hours: 9:00-13:30 (30s interval)
    const isTrading = dow >= 1 && dow <= 5 && ((h === 9 && m >= 0) || (h >= 10 && h < 13) || (h === 13 && m <= 30));
    // After-hours: 14:00-15:00 — institutional data gets published (60s interval)
    const isAfterHours = dow >= 1 && dow <= 5 && (h === 14 || (h === 15 && m === 0));
    if (isTrading) {
      doAutoRefresh(true);
    } else if (isAfterHours) {
      // Slower refresh for after-hours (only every other tick = ~60s)
      if (m % 2 === 0 && now.getSeconds() < 30) doAutoRefresh(true);
    }
  }, 30000);
}

async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  await doAutoRefresh(false);
  if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
}

// ============================================================
// AUTH & MEMBER SYSTEM
// ============================================================
let gCurrentUser = null;
let gCurrentPlan = 'free';
let gAuthMode = 'login'; // 'login' or 'register'

// ============================================================
// SUBSCRIPTION PLAN SYSTEM
// ============================================================
const FEATURE_PLAN_MAP = {
  'heatmap':         'free',
  'compare_2':       'free',
  'dividends_wl':    'free',
  'price_alerts':    'pro',
  'inst_streak':     'pro',
  'portfolio':       'pro',
  'compare_5':       'pro',
  'dividends_all':   'proplus',
  'backtest':        'proplus',
};

const PLAN_LEVEL = { 'free': 0, 'pro': 1, 'proplus': 2, 'admin': 99 };

function userCanAccess(feature) {
  var requiredPlan = FEATURE_PLAN_MAP[feature] || 'free';
  var userLevel = PLAN_LEVEL[gCurrentPlan] || 0;
  if (gCurrentUser && gCurrentUser.role === 'admin') return true;
  return userLevel >= (PLAN_LEVEL[requiredPlan] || 0);
}

function showUpgradeModal(requiredPlan) {
  var overlay = document.getElementById('pricing-overlay');
  if (!overlay) return;
  overlay.classList.add('show');
  // Highlight the required plan card
  document.querySelectorAll('.plan-card').forEach(function(c) { c.style.opacity = ''; });
  updatePricingButtons();
}

function closePricingModal() {
  var overlay = document.getElementById('pricing-overlay');
  if (overlay) overlay.classList.remove('show');
}

function updatePricingButtons() {
  document.querySelectorAll('.plan-card-btn').forEach(function(btn) {
    var plan = btn.dataset.plan;
    if (!plan) return;
    var userLevel = PLAN_LEVEL[gCurrentPlan] || 0;
    var cardLevel = PLAN_LEVEL[plan] || 0;
    btn.classList.remove('current');
    if (plan === gCurrentPlan || (gCurrentUser && gCurrentUser.role === 'admin' && plan === 'proplus')) {
      btn.classList.add('current');
      btn.textContent = '目前方案';
    } else if (cardLevel < userLevel) {
      btn.textContent = plan === 'free' ? 'Free' : '已包含';
    } else {
      var labels = { 'pro': '升級 Pro', 'proplus': '升級 Pro+' };
      btn.textContent = labels[plan] || '選擇';
    }
  });
}

var gPricingPeriod = 'monthly';
var PLAN_PRICING_TWD = {
  pro: { monthly: 149, yearly: 1490 },
  proplus: { monthly: 299, yearly: 2990 }
};

function setPricingPeriod(period) {
  gPricingPeriod = period;
  document.querySelectorAll('.period-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.period === period);
  });
  var suffix = period === 'yearly' ? '/年' : '/月';
  var proEl = document.getElementById('price-pro');
  var ppEl = document.getElementById('price-proplus');
  if (proEl) proEl.innerHTML = 'NT$' + PLAN_PRICING_TWD.pro[period] + ' <span>' + suffix + '</span>';
  if (ppEl) ppEl.innerHTML = 'NT$' + PLAN_PRICING_TWD.proplus[period] + ' <span>' + suffix + '</span>';
}

async function requestUpgrade(plan) {
  if (!gCurrentUser) { openAuthModal(); return; }
  if (gCurrentUser.role === 'admin') return;
  if (plan === gCurrentPlan) return;

  var period = gPricingPeriod || 'monthly';
  trackAction('checkout_start', plan + '_' + period);

  var btn = document.querySelector('.plan-card-btn[data-plan="' + plan + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '處理中...'; }

  try {
    var resp = await authFetch('/api/checkout?plan=' + plan + '&period=' + period);
    var data = await resp.json();
    if (data.error) {
      toast(data.error);
      return;
    }
    // Create hidden form and POST to NewebPay MPG
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = data.mpg_url;
    form.style.display = 'none';
    var fields = {
      MerchantID: data.MerchantID,
      TradeInfo: data.TradeInfo,
      TradeSha: data.TradeSha,
      Version: data.Version
    };
    for (var key in fields) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key];
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  } catch (e) {
    toast('付款請求失敗，請稍後再試');
    console.error('Checkout error:', e);
  } finally {
    if (btn) { btn.disabled = false; updatePricingButtons(); }
  }
}

// Pricing overlay close on background click
document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'pricing-overlay') closePricingModal();
});

function renderLockedOverlay(containerId, requiredPlan) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (userCanAccess(Object.keys(FEATURE_PLAN_MAP).find(function(k) { return FEATURE_PLAN_MAP[k] === requiredPlan; }) || requiredPlan)) return;
  el.classList.add('feature-locked');
  // Remove any existing lock btn
  var existing = el.querySelector('.feature-locked-btn');
  if (existing) existing.remove();
  var btn = document.createElement('button');
  btn.className = 'feature-locked-btn';
  var planName = requiredPlan === 'proplus' ? 'Pro+' : requiredPlan === 'pro' ? 'Pro' : requiredPlan;
  btn.textContent = '升級至 ' + planName + ' 解鎖';
  btn.onclick = function(e) { e.stopPropagation(); showUpgradeModal(requiredPlan); };
  el.appendChild(btn);
}

function getToken() { return localStorage.getItem('ct_token'); }
function setToken(token) { localStorage.setItem('ct_token', token); }
function clearToken() { localStorage.removeItem('ct_token'); }

async function authFetch(url, opts = {}) {
  const token = getToken();
  if (token) {
    opts.headers = opts.headers || {};
    opts.headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(url, opts);
}

function openAuthModal() {
  gAuthMode = 'login';
  updateAuthUI();
  document.getElementById('auth-overlay').classList.add('show');
  document.getElementById('auth-error').textContent = '';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-name').value = '';
  setTimeout(() => document.getElementById('auth-email').focus(), 100);
}

function closeAuthModal() {
  document.getElementById('auth-overlay').classList.remove('show');
}

function toggleAuthMode() {
  gAuthMode = gAuthMode === 'login' ? 'register' : 'login';
  updateAuthUI();
}

function updateAuthUI() {
  const isLogin = gAuthMode === 'login';
  document.getElementById('auth-title').textContent = isLogin ? '登入' : '註冊';
  document.getElementById('auth-submit').textContent = isLogin ? '登入' : '註冊';
  document.getElementById('auth-name-field').style.display = isLogin ? 'none' : 'block';
  document.getElementById('auth-switch-text').textContent = isLogin ? '還沒有帳號？' : '已有帳號？';
  document.getElementById('auth-switch-link').textContent = isLogin ? '立即註冊' : '返回登入';
  document.getElementById('auth-error').textContent = '';
}

let _authSubmitting = false;
async function submitAuth() {
  if (_authSubmitting) return;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value.trim();
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit');

  if (!email || !password) { errEl.textContent = '請填寫所有欄位'; return; }
  if (password.length < 6) { errEl.textContent = '密碼至少需要 6 個字元'; return; }

  _authSubmitting = true;
  btn.disabled = true;
  btn.textContent = '處理中...';
  errEl.textContent = '';

  try {
    const endpoint = gAuthMode === 'login' ? '/api/login' : '/api/register';
    const body = { email, password };
    if (gAuthMode === 'register' && name) body.name = name;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await r.json();

    if (!r.ok) {
      errEl.textContent = data.error || '操作失敗';
      return;
    }

    setToken(data.token);
    gCurrentUser = data.user;
    gCurrentPlan = data.user.plan || 'free';
    if (data.user.role === 'admin') gCurrentPlan = 'proplus';
    closeAuthModal();
    renderUserSection();
    await syncWatchlistToServer();
    toast(gAuthMode === 'login' ? `歡迎回來，${data.user.name}` : `註冊成功，歡迎 ${data.user.name}`);
    trackAction('auth', gAuthMode);
  } catch (e) {
    if (e.name === 'AbortError') {
      errEl.textContent = '伺服器回應逾時，請重新整理頁面後再試';
    } else {
      errEl.textContent = '網路錯誤：' + (e.message || '請稍後再試');
    }
  } finally {
    _authSubmitting = false;
    btn.disabled = false;
    btn.textContent = gAuthMode === 'login' ? '登入' : '註冊';
  }
}

function logout() {
  clearToken();
  gCurrentUser = null;
  gCurrentPlan = 'free';
  renderUserSection();
  toast('已登出');
}

function renderUserSection() {
  const box = document.getElementById('user-section');
  const mobileBtn = document.getElementById('mobile-user-btn');
  if (gCurrentUser) {
    const initial = (gCurrentUser.name || gCurrentUser.email || '?')[0].toUpperCase();
    var planBadge = '';
    if (gCurrentUser.role === 'admin') {
      planBadge = '<span class="plan-badge plan-badge-admin">Admin</span>';
    } else if (gCurrentPlan === 'proplus') {
      planBadge = '<span class="plan-badge plan-badge-proplus">Pro+</span>';
    } else if (gCurrentPlan === 'pro') {
      planBadge = '<span class="plan-badge plan-badge-pro">Pro</span>';
    } else {
      planBadge = '<span class="plan-badge plan-badge-free">Free</span>';
    }
    box.innerHTML = `<div class="user-bar">
      <div class="user-avatar">${initial}</div>
      <div class="user-info">
        <div class="user-name">${gCurrentUser.name || gCurrentUser.email} ${planBadge}</div>
        <div class="user-role" style="cursor:pointer;" onclick="showUpgradeModal()">${gCurrentPlan === 'free' ? '升級方案' : gCurrentPlan === 'pro' ? 'Pro 會員' : gCurrentPlan === 'proplus' ? 'Pro+ 會員' : ''}${gCurrentUser.plan_expires_at && gCurrentPlan !== 'free' && gCurrentUser.role !== 'admin' ? ' (到期 ' + gCurrentUser.plan_expires_at.slice(0,10) + ')' : ''}</div>
      </div>
      <button class="user-logout" onclick="logout()">登出</button>
    </div>`;
    if (mobileBtn) {
      mobileBtn.querySelector('span').textContent = initial;
      mobileBtn.setAttribute('onclick', 'logout()');
      mobileBtn.style.color = 'var(--cyan)';
    }
    // Show admin nav for admins
    if (gCurrentUser.role === 'admin') showAdminNav();
    else hideAdminNav();
  } else {
    box.innerHTML = `<div class="user-bar" style="padding:12px 18px;">
      <button class="login-btn" onclick="openAuthModal()">登入 / 註冊</button>
    </div>`;
    if (mobileBtn) {
      mobileBtn.querySelector('span').textContent = '帳號';
      mobileBtn.setAttribute('onclick', 'openAuthModal()');
      mobileBtn.style.color = '';
    }
    hideAdminNav();
  }
}

async function checkAuth() {
  const token = getToken();
  if (!token) return;
  try {
    const r = await authFetch('/api/me');
    if (r.ok) {
      const data = await r.json();
      gCurrentUser = data.user;
      gCurrentUser.plan_expires_at = data.user.plan_expires_at || null;
      gCurrentPlan = data.user.plan || 'free';
      if (data.user.role === 'admin') gCurrentPlan = 'proplus';
      renderUserSection();
      await loadWatchlistFromServer();
    } else {
      clearToken();
    }
  } catch (e) { console.warn('checkAuth failed:', e); }
}

async function syncWatchlistToServer() {
  if (!gCurrentUser) return;
  const localList = wlGet();
  if (localList.length === 0) return;
  try {
    await authFetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: localList })
    });
  } catch (e) { console.warn('syncWatchlistToServer failed:', e); }
}

let _wlSyncingFromServer = false;
async function loadWatchlistFromServer() {
  if (!gCurrentUser) return;
  try {
    const r = await authFetch('/api/watchlist');
    if (!r.ok) return;
    const data = await r.json();
    if (data.watchlist && data.watchlist.length > 0) {
      const serverCodes = data.watchlist.map(w => w.code || w);
      const localList = wlGet();
      const merged = [...new Set([...localList, ...serverCodes])];
      _wlSyncingFromServer = true;
      wlSave(merged);
      _wlSyncingFromServer = false;
    }
  } catch (e) { console.warn('loadWatchlistFromServer failed:', e); }
}

function trackAction(action, detail) {
  try {
    const body = { action, detail: String(detail || '') };
    authFetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => {});
  } catch (e) { /* silent */ }
}

// Override watchlist functions to also sync to server
const _origWlSave = wlSave;
wlSave = function(list) {
  _origWlSave(list);
  if (gCurrentUser && !_wlSyncingFromServer) {
    authFetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: list })
    }).catch(() => {});
  }
};

// Track stock analysis views
const _origAnalyzeStock = analyzeStock;
analyzeStock = async function(code) {
  await _origAnalyzeStock(code);
  trackAction('analyze', code || document.getElementById('stock-input').value.trim());
};

// Auth modal keyboard handling
document.getElementById('auth-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-password').focus(); }
});
document.getElementById('auth-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitAuth(); }
});
document.getElementById('auth-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-email').focus(); }
});
document.getElementById('auth-overlay').addEventListener('click', e => {
  if (e.target.id === 'auth-overlay') closeAuthModal();
});

// ============================================================
// ADMIN PANEL
// ============================================================
let gAdminLoaded = false;

function showAdminNav() {
  document.querySelectorAll('.nav-admin').forEach(el => { el.style.display = ''; });
}

function hideAdminNav() {
  document.querySelectorAll('.nav-admin').forEach(el => { el.style.display = 'none'; });
}

async function loadAdminPanel() {
  if (gAdminLoaded) return;
  if (!gCurrentUser || gCurrentUser.role !== 'admin') return;
  gAdminLoaded = true;

  await Promise.allSettled([
    loadAdminStats(),
    loadAdminUsers(),
    loadAdminActions(),
    loadAdminPicks()
  ]);
}

async function loadAdminStats() {
  try {
    const r = await authFetch('/api/admin/stats');
    if (!r.ok) return;
    const data = await r.json();

    let popularHtml = '';
    if (data.popular_stocks && data.popular_stocks.length > 0) {
      const rows = data.popular_stocks.map((s, i) => {
        const info = gStockDB[s.code];
        const name = info ? info.name : '';
        return [
          i + 1,
          `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
          name,
          `<b>${s.count}</b> 人關注`
        ];
      });
      popularHtml = mkTable(['#', '代號', '名稱', '關注人數'], rows);
    } else {
      popularHtml = '<div class="text-muted" style="padding:16px;text-align:center;">尚無關注資料</div>';
    }
    document.getElementById('admin-popular-stocks').innerHTML = popularHtml;

    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-box">
        <div class="label">總會員數</div>
        <div class="value" style="color:var(--cyan);">${data.total_users}</div>
      </div>
      <div class="stat-box">
        <div class="label">今日活躍</div>
        <div class="value" style="color:var(--green);">${data.active_today}</div>
      </div>
      <div class="stat-box">
        <div class="label">有效投資建議</div>
        <div class="value" style="color:var(--purple);">${data.total_picks}</div>
      </div>
      <div class="stat-box">
        <div class="label">最熱門關注</div>
        <div class="value" style="font-size:16px;color:var(--yellow);">${data.popular_stocks.length > 0 ? data.popular_stocks[0].code : '--'}</div>
      </div>
    `;
  } catch (e) {
    document.getElementById('admin-stats').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function loadAdminUsers() {
  try {
    const r = await authFetch('/api/admin/users');
    if (!r.ok) return;
    const data = await r.json();

    const rows = data.users.map(u => {
      const roleTag = u.role === 'admin'
        ? '<span class="plan-badge plan-badge-admin">Admin</span>'
        : '<span class="tag" style="background:rgba(0,240,255,0.08);color:var(--text2);border:1px solid var(--border);">' + (u.role || 'free') + '</span>';
      var userPlan = u.plan || 'free';
      if (u.role === 'admin') userPlan = 'admin';
      var planSelect = u.role === 'admin' ? '<span class="plan-badge plan-badge-admin">Admin</span>' :
        '<select class="admin-plan-select" onchange="adminChangePlan(' + u.id + ', this.value)">' +
        '<option value="free"' + (userPlan === 'free' ? ' selected' : '') + '>Free</option>' +
        '<option value="pro"' + (userPlan === 'pro' ? ' selected' : '') + '>Pro</option>' +
        '<option value="proplus"' + (userPlan === 'proplus' ? ' selected' : '') + '>Pro+</option>' +
        '</select>';
      return [
        u.id,
        u.display_name,
        u.email,
        roleTag,
        planSelect,
        u.created_at ? u.created_at.slice(0, 16) : '--',
        u.last_login ? u.last_login.slice(0, 16) : '從未',
        u.login_count || 0
      ];
    });

    document.getElementById('admin-users-list').innerHTML =
      mkTable(['ID', '名稱', 'Email', '角色', '方案', '註冊時間', '最後登入', '登入次數'], rows);
  } catch (e) {
    document.getElementById('admin-users-list').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function adminChangePlan(userId, newPlan) {
  try {
    var r = await authFetch('/api/admin/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, plan: newPlan, reason: 'Admin manual change' })
    });
    var data = await r.json();
    if (r.ok) {
      toast('方案已更新：' + (data.old_plan || 'free') + ' → ' + data.new_plan);
    } else {
      toast(data.error || '更新失敗');
      loadAdminUsers();
    }
  } catch (e) {
    toast('操作失敗');
    loadAdminUsers();
  }
}

async function loadAdminActions() {
  try {
    const r = await authFetch('/api/admin/actions');
    if (!r.ok) return;
    const data = await r.json();

    const actionLabels = {
      'register': '註冊',
      'login': '登入',
      'analyze': '分析股票',
      'watchlist_sync': '同步關注',
      'watchlist_remove': '移除關注',
      'auth': '認證',
      'admin_add_pick': '發布建議',
      'view_tab': '切換分頁',
    };

    const rows = data.actions.slice(0, 100).map(a => {
      const label = actionLabels[a.action] || a.action;
      let detail = a.detail || '';
      if (detail.length > 40) detail = detail.slice(0, 40) + '...';
      return [
        a.created_at ? a.created_at.slice(0, 19) : '--',
        a.display_name || a.email || `#${a.user_id || '?'}`,
        `<span style="color:var(--cyan);">${label}</span>`,
        `<span class="text-muted">${detail}</span>`
      ];
    });

    document.getElementById('admin-actions-list').innerHTML =
      mkTable(['時間', '使用者', '動作', '詳情'], rows);
  } catch (e) {
    document.getElementById('admin-actions-list').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function loadAdminPicks() {
  try {
    const r = await authFetch('/api/picks');
    if (!r.ok) return;
    const data = await r.json();

    if (!data.picks || data.picks.length === 0) {
      document.getElementById('admin-picks-list').innerHTML =
        '<div class="text-muted" style="padding:16px;text-align:center;">尚未發布任何投資建議</div>';
      return;
    }

    const actionMap = { buy: '買進', sell: '賣出', hold: '觀望', short: '放空' };
    const actionCls = { buy: 'up', sell: 'down', hold: '', short: 'down' };

    const rows = data.picks.map(p => [
      `<span class="clickable" onclick="goAnalyze('${p.code}')">${p.code}</span>`,
      p.name || '--',
      `<span class="${actionCls[p.action] || ''}" style="font-weight:600;">${actionMap[p.action] || p.action}</span>`,
      p.target_price ? fmtNum(p.target_price, 2) : '--',
      p.stop_loss ? fmtNum(p.stop_loss, 2) : '--',
      p.score ? `<b>${p.score}</b>/10` : '--',
      `<span class="text-sm text-muted">${(p.reason || '').slice(0, 30)}${(p.reason || '').length > 30 ? '...' : ''}</span>`,
      p.created_at ? p.created_at.slice(0, 10) : '--',
      `<button class="btn btn-danger" style="padding:4px 10px;font-size:11px;" onclick="adminDeletePick(${p.id})">下架</button>`
    ]);

    document.getElementById('admin-picks-list').innerHTML =
      mkTable(['代號', '名稱', '建議', '目標價', '停損', '信心', '理由', '日期', '操作'], rows);
  } catch (e) {
    document.getElementById('admin-picks-list').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function adminAddPick() {
  const code = document.getElementById('pick-code').value.trim();
  const name = document.getElementById('pick-name').value.trim();
  const action = document.getElementById('pick-action').value;
  const target = parseFloat(document.getElementById('pick-target').value) || null;
  const stoploss = parseFloat(document.getElementById('pick-stoploss').value) || null;
  const score = parseInt(document.getElementById('pick-score').value) || null;
  const reason = document.getElementById('pick-reason').value.trim();

  if (!code) { toast('請輸入股票代號'); return; }

  // Auto-fill name from DB if empty
  const finalName = name || (gStockDB[code] ? gStockDB[code].name : '');

  try {
    const r = await authFetch('/api/admin/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code, name: finalName, action, reason,
        target_price: target, stop_loss: stoploss, score
      })
    });
    if (r.ok) {
      toast('投資建議已發布');
      document.getElementById('pick-code').value = '';
      document.getElementById('pick-name').value = '';
      document.getElementById('pick-reason').value = '';
      document.getElementById('pick-target').value = '';
      document.getElementById('pick-stoploss').value = '';
      document.getElementById('pick-score').value = '';
      loadAdminPicks();
      loadAdminStats();
    } else {
      const data = await r.json();
      toast(data.error || '發布失敗');
    }
  } catch (e) {
    toast('網路錯誤');
  }
}

// ============================================================
// SCREENER (股票篩選器)
// ============================================================
function runScreener() {
  const sMap = {};
  gAllStocks.forEach(s => {
    const code = s[0].trim();
    if (!/^\d{4}$/.test(code)) return;
    const close = parseNum(s[7]), chg = parseNum(s[8]), vol = parseNum(s[2]);
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    sMap[code] = { code, name: s[1].trim(), close, chg, pct, vol, market: 'twse' };
  });
  gTpexAllStocks.forEach(s => {
    const code = (s[0]||'').trim();
    if (!/^\d{4}$/.test(code)) return;
    const close = parseNum(s[2]), chg = parseNum(s[3]), vol = parseNum(s[7]);
    if (close === 0) return;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    sMap[code] = { code, name: (s[1]||'').trim(), close, chg, pct, vol, market: 'tpex' };
  });

  // Institutional map
  const iMap = {};
  gInstStocks.forEach(r => {
    const c = r[0].trim();
    if (/^\d{4}$/.test(c)) iMap[c] = { f: parseNum(r[4]), t: parseNum(r[10]), d: parseNum(r[11]) };
  });
  gTpexInstStocks.forEach(r => {
    const c = (r[0]||'').trim();
    try { if (/^\d{4}$/.test(c)) iMap[c] = { f: parseNum(r[10]), t: parseNum(r[13]), d: parseNum(r[22]) }; } catch(e) {}
  });

  // Read filter values
  const fForeignBuy = document.getElementById('f-foreign-buy').checked;
  const fTrustBuy = document.getElementById('f-trust-buy').checked;
  const fDealerBuy = document.getElementById('f-dealer-buy').checked;
  const fAllBuy = document.getElementById('f-all-buy').checked;
  const fAllSell = document.getElementById('f-all-sell').checked;
  const fLimitUp = document.getElementById('f-limit-up').checked;
  const fLimitDown = document.getElementById('f-limit-down').checked;
  const fUp3 = document.getElementById('f-up3').checked;
  const fDown3 = document.getElementById('f-down3').checked;
  const fPctMin = parseFloat(document.getElementById('f-pct-min').value);
  const fPctMax = parseFloat(document.getElementById('f-pct-max').value);
  const fPriceMin = parseFloat(document.getElementById('f-price-min').value);
  const fPriceMax = parseFloat(document.getElementById('f-price-max').value);
  const fVolBurst = document.getElementById('f-vol-burst').checked;
  const fVolUp = document.getElementById('f-vol-up').checked;
  const fVolShrink = document.getElementById('f-vol-shrink').checked;
  const fVolMin = parseFloat(document.getElementById('f-vol-min').value);
  const fVolMax = parseFloat(document.getElementById('f-vol-max').value);
  const fWarning = document.getElementById('f-warning').checked;
  const fDisposition = document.getElementById('f-disposition').checked;
  const fNearWarning = document.getElementById('f-near-warning').checked;
  const fMktTwse = document.getElementById('f-mkt-twse').checked;
  const fMktTpex = document.getElementById('f-mkt-tpex').checked;

  // Check if any filter is active
  const hasFilter = fForeignBuy || fTrustBuy || fDealerBuy || fAllBuy || fAllSell ||
    fLimitUp || fLimitDown || fUp3 || fDown3 ||
    !isNaN(fPctMin) || !isNaN(fPctMax) || !isNaN(fPriceMin) || !isNaN(fPriceMax) ||
    fVolBurst || fVolUp || fVolShrink || !isNaN(fVolMin) || !isNaN(fVolMax) ||
    fWarning || fDisposition || fNearWarning;

  if (!hasFilter) {
    toast('請至少選擇一個篩選條件');
    return;
  }

  // Compute average volume per stock (rough: use current vol as proxy since we only have 1-day data)
  // For volume ratio, we use gAllStocks total vol vs individual
  const results = [];

  Object.values(sMap).forEach(s => {
    // Market filter
    if (s.market === 'twse' && !fMktTwse) return;
    if (s.market === 'tpex' && !fMktTpex) return;
    if (s.close <= 0) return;

    const inst = iMap[s.code];
    const volLots = s.vol / 1000; // convert shares to lots (張)

    // Institutional filters
    if (fForeignBuy && (!inst || inst.f <= 0)) return;
    if (fTrustBuy && (!inst || inst.t <= 0)) return;
    if (fDealerBuy && (!inst || inst.d <= 0)) return;
    if (fAllBuy && (!inst || inst.f <= 0 || inst.t <= 0 || inst.d <= 0)) return;
    if (fAllSell && (!inst || inst.f >= 0 || inst.t >= 0 || inst.d >= 0)) return;

    // Price change filters
    if (fLimitUp && s.pct < 9.5) return;
    if (fLimitDown && s.pct > -9.5) return;
    if (fUp3 && s.pct < 3) return;
    if (fDown3 && s.pct > -3) return;
    if (!isNaN(fPctMin) && s.pct < fPctMin) return;
    if (!isNaN(fPctMax) && s.pct > fPctMax) return;

    // Price filters
    if (!isNaN(fPriceMin) && s.close < fPriceMin) return;
    if (!isNaN(fPriceMax) && s.close > fPriceMax) return;

    // Volume filters (lots)
    if (!isNaN(fVolMin) && volLots < fVolMin) return;
    if (!isNaN(fVolMax) && volLots > fVolMax) return;

    // Volume ratio filters — we estimate by comparing to median volume
    // For burst/up/shrink, we need a baseline. Use a heuristic: compare to all stocks' median vol
    if (fVolBurst || fVolUp || fVolShrink) {
      // Without historical data, skip vol-ratio if vol is 0
      if (s.vol <= 0) return;
      // We'll tag these but can't truly filter by ratio without historical data
      // Use a proxy: filter by absolute volume thresholds
      if (fVolBurst && volLots < 3000) return;   // 爆量 > 3000張
      if (fVolUp && volLots < 1000) return;       // 量增 > 1000張
      if (fVolShrink && volLots > 500) return;    // 量縮 < 500張
    }

    // Warning / Disposition / Near-warning filters (OR logic among the three)
    if (fWarning || fDisposition || fNearWarning) {
      let match = false;
      if (fWarning && gWarningSet.has(s.code)) match = true;
      if (fDisposition && gDispositionSet.has(s.code)) match = true;
      if (fNearWarning && Math.abs(s.pct) >= 6 && volLots > 1000) match = true;
      if (!match) return;
    }

    s.inst = inst;
    results.push(s);
  });

  // Sort by absolute change % descending
  results.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  const statusEl = document.getElementById('screener-status');
  const box = document.getElementById('screener-results');

  if (results.length === 0) {
    statusEl.textContent = '篩選完成，無符合條件的股票';
    box.innerHTML = '';
    return;
  }

  const capped = results.slice(0, 100);
  statusEl.textContent = `篩選完成：共 ${results.length} 檔符合（顯示前 ${capped.length} 檔）`;

  // Render results
  const isMob = window.innerWidth <= 768;
  if (isMob) {
    let h = '<div class="rank-card-list">';
    capped.forEach((s, i) => {
      const cls = s.chg >= 0 ? 'up' : 'down';
      let instLine = '';
      if (s.inst) {
        const fc = s.inst.f > 0 ? 'up' : s.inst.f < 0 ? 'down' : '';
        const tc = s.inst.t > 0 ? 'up' : s.inst.t < 0 ? 'down' : '';
        instLine = `<div style="font-size:11px;margin-top:4px;color:var(--text2);">
          外資 <span class="${fc}">${s.inst.f>0?'+':''}${fmtShares(s.inst.f)}</span>
          　投信 <span class="${tc}">${s.inst.t>0?'+':''}${fmtShares(s.inst.t)}</span>
        </div>`;
      }
      h += `<div class="rank-card" onclick="goAnalyze('${s.code}')">
        <div class="rank-card-head">
          <span class="rank-card-num">${i+1}</span>
          <span class="rank-card-code">${s.code}</span>
          <span class="rank-card-name">${s.name}</span>${warningTag(s.code)}
          <span class="rank-card-pct ${cls}">${s.pct>0?'+':''}${s.pct.toFixed(2)}%</span>
        </div>
        <div class="rank-card-body">
          <div><span class="dt-label">收盤</span><span>${limitPrice(s.close, s.pct)}</span></div>
          <div><span class="dt-label">漲跌</span><span class="${cls}">${s.chg>0?'+':''}${fmtNum(s.chg,2)}</span></div>
          <div><span class="dt-label">成交量</span><span>${fmtBig(s.vol)}</span></div>
        </div>
        ${instLine}
      </div>`;
    });
    h += '</div>';
    box.innerHTML = h;
  } else {
    box.innerHTML = mkTable(
      ['#', '代號', '名稱', '市場', '收盤', '漲跌', '漲跌%', '成交量', '外資', '投信'],
      capped.map((s, i) => {
        const mTag = s.market === 'twse'
          ? '<span class="tag-market tag-twse">上市</span>'
          : '<span class="tag-market tag-tpex">上櫃</span>';
        const inst = s.inst || {};
        return [
          i + 1,
          `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
          `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>${warningTag(s.code)}`,
          mTag,
          limitPrice(s.close, s.pct),
          `<span class="${s.chg>0?'up':'down'}">${s.chg>0?'+':''}${fmtNum(s.chg,2)}</span>`,
          `<span class="${s.pct>0?'up':'down'}">${s.pct>0?'+':''}${s.pct.toFixed(2)}%</span>`,
          fmtBig(s.vol),
          `<span class="${(inst.f||0)>0?'up':(inst.f||0)<0?'down':''}">${inst.f?((inst.f>0?'+':'')+fmtShares(inst.f)):'--'}</span>`,
          `<span class="${(inst.t||0)>0?'up':(inst.t||0)<0?'down':''}">${inst.t?((inst.t>0?'+':'')+fmtShares(inst.t)):'--'}</span>`
        ];
      })
    );
  }

  trackAction('screener', results.length + ' results');
}

function clearScreener() {
  document.querySelectorAll('#screener-filters input[type="checkbox"]').forEach(cb => {
    cb.checked = cb.id === 'f-mkt-twse' || cb.id === 'f-mkt-tpex';
  });
  document.querySelectorAll('#screener-filters input[type="number"]').forEach(inp => inp.value = '');
  document.getElementById('screener-results').innerHTML = '';
  document.getElementById('screener-status').textContent = '';
}

// Load opinion panel (謙堂觀點)
async function maybeLoadOpinion() {
  if (gOpinionLoaded && gOpinionSuccess) return;
  gOpinionLoaded = true;
  gOpinionSuccess = false;
  document.getElementById('opinion-container').innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    const r = await fetch('/api/picks');
    if (!r.ok) { gOpinionLoaded = false; return; }
    const data = await r.json();
    if (!data.picks || data.picks.length === 0) {
      document.getElementById('opinion-container').innerHTML = '<div class="text-muted" style="text-align:center;padding:32px 0;">目前暫無觀點，敬請期待</div>';
      gOpinionSuccess = true;
      return;
    }

    const actionTag = {
      buy: '<span class="tag tag-buy">買進</span>',
      sell: '<span class="tag tag-sell">賣出</span>',
      hold: '<span class="tag tag-hold">觀望</span>',
      short: '<span class="tag tag-sell">放空</span>'
    };

    let html = '<div class="stock-grid">';
    data.picks.forEach(p => {
      const scoreColor = (p.score || 5) >= 7 ? 'var(--green)' : (p.score || 5) >= 5 ? 'var(--yellow)' : 'var(--red)';
      html += `<div class="stock-card" onclick="goAnalyze('${p.code}')" style="cursor:pointer;">
        <div class="sc-bar" style="background:linear-gradient(90deg,var(--purple),var(--cyan));"></div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <div class="sc-code">${p.code} <span style="font-size:12px;font-weight:400;color:var(--text2);">${p.name || ''}</span></div>
          </div>
          <div>${actionTag[p.action] || ''}</div>
        </div>
        ${p.reason ? `<div style="font-size:12px;color:#c8d0e0;margin-bottom:8px;line-height:1.5;">${p.reason}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px 12px;font-size:11px;border-top:1px solid var(--border);padding-top:8px;">
          ${p.target_price ? `<span class="text-muted">目標 <span class="up" style="font-weight:600;">${fmtNum(p.target_price, 2)}</span></span>` : ''}
          ${p.stop_loss ? `<span class="text-muted">停損 <span class="down" style="font-weight:600;">${fmtNum(p.stop_loss, 2)}</span></span>` : ''}
          ${p.score ? `<span class="text-muted">信心 <span style="color:${scoreColor};font-weight:700;">${p.score}/10</span></span>` : ''}
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:6px;">${p.created_at ? p.created_at.slice(0, 10) : ''}</div>
      </div>`;
    });
    html += '</div>';
    document.getElementById('opinion-container').innerHTML = html;
    gOpinionSuccess = true;
  } catch (e) {
    gOpinionLoaded = false;
  }
}

// ============================================================
// MORNING BRIEFING (晨訊)
// ============================================================
async function maybeLoadBriefing() {
  var today = new Date().toLocaleDateString('sv');  // YYYY-MM-DD
  if (gBriefingLoaded && gBriefingSuccess && gBriefingDate === today) return;
  // New day → force reload
  if (gBriefingDate && gBriefingDate !== today) { gBriefingSuccess = false; }
  gBriefingLoaded = true;
  gBriefingSuccess = false;
  document.getElementById('briefing-container').innerHTML = '<div class="loading-box"><div class="spinner"></div><div>載入晨訊...</div></div>';

  try {
    var r = await fetch('/api/morning-report');
    if (!r.ok) { gBriefingLoaded = false; return; }
    var body = await r.json();

    if (body.status === 'ready' && body.data) {
      renderBriefing(body.data);
      gBriefingSuccess = true;
      return;
    }

    // Status is "generating" — show progress and poll
    document.getElementById('briefing-container').innerHTML =
      '<div class="loading-box"><div class="spinner"></div><div>晨訊產生中，首次約需 15 秒...</div></div>';

    if (_brPollTimer) { clearInterval(_brPollTimer); _brPollTimer = null; }
    var _brPollCount = 0;
    _brPollTimer = setInterval(async function() {
      if (gBriefingSuccess) { clearInterval(_brPollTimer); _brPollTimer = null; return; }
      _brPollCount++;
      if (_brPollCount > 20) {
        clearInterval(_brPollTimer); _brPollTimer = null;
        if (!gBriefingSuccess) {
          gBriefingLoaded = false;
          document.getElementById('briefing-container').innerHTML =
            '<div class="empty-state" style="padding:24px;text-align:center;">'
            + '<p>晨訊產生逾時，請稍後再試</p>'
            + '<button class="btn btn-primary" style="margin-top:12px;" onclick="gBriefingLoaded=false;maybeLoadBriefing()">重新載入</button></div>';
        }
        return;
      }
      try {
        var r2 = await fetch('/api/morning-report');
        if (!r2.ok) return;
        var b2 = await r2.json();
        if (b2.status === 'ready' && b2.data) {
          clearInterval(_brPollTimer); _brPollTimer = null;
          renderBriefing(b2.data);
          gBriefingSuccess = true;
        }
      } catch(e) {
        console.warn('[Briefing] Poll error:', e.message);
      }
    }, 3000);

  } catch (e) {
    gBriefingLoaded = false;
    document.getElementById('briefing-container').innerHTML =
      '<div class="empty-state" style="padding:24px;text-align:center;">'
      + '<p>晨訊載入失敗</p>'
      + '<button class="btn btn-primary" style="margin-top:12px;" onclick="gBriefingLoaded=false;maybeLoadBriefing()">重新載入</button></div>';
  }
}

function brEscHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function brMktTable(title, markets, keys) {
  var rows = '';
  keys.forEach(function(k) {
    var d = markets[k];
    if (!d) return;
    var cl = d.chg > 0 ? 'up' : d.chg < 0 ? 'down' : '';
    var fp = d.price < 10000 ? fmtNum(d.price, 2) : fmtNum(d.price, 0);
    var chgStr = (d.chg > 0 ? '+' : '') + fmtNum(d.chg, 2);
    var pctStr = (d.pct > 0 ? '+' : '') + fmtNum(d.pct, 2) + '%';
    rows += '<tr class="' + cl + '"><td>' + d.name + '</td><td class="text-right">' + fp + '</td><td class="text-right">' + chgStr + '</td><td class="text-right">' + pctStr + '</td></tr>';
  });
  return '<div class="br-section"><div class="br-section-title">' + title + '</div>'
    + '<table class="br-table"><thead><tr><th>項目</th><th class="text-right">收盤</th><th class="text-right">漲跌</th><th class="text-right">幅度</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function brInstBars(inst, instDate) {
  if (!inst || Object.keys(inst).length === 0)
    return '<div class="br-section"><div class="br-section-title">三大法人摘要</div><div class="text-muted" style="padding:8px 0;">尚無資料</div></div>';

  var fi = inst['外資及陸資(不含外資自營商)'] || 0;
  var it = inst['投信'] || 0;
  var ds = inst['自營商(自行買賣)'] || 0;
  var dh = inst['自營商(避險)'] || 0;
  var tot = inst['合計'] || fi + it + ds + dh;

  function bar(name, val) {
    var cl = val > 0 ? 'up' : 'down';
    var w = Math.min(Math.abs(val / 1e8) / 400 * 100, 100);
    return '<div class="br-inst-bar"><span class="br-inst-label">' + name + '</span>'
      + '<div class="br-inst-track"><div class="br-inst-fill ' + cl + '" style="width:' + w + '%"></div></div>'
      + '<span class="br-inst-val ' + cl + '">' + fmtBig(val) + '</span></div>';
  }

  var dateLabel = instDate ? ' (' + instDate + ')' : '';
  var h = '<div class="br-section"><div class="br-section-title">三大法人摘要' + dateLabel + '</div>';
  h += bar('外　資', fi) + bar('投　信', it) + bar('自營商', ds);
  var totCl = tot > 0 ? 'up' : 'down';
  h += '<div style="text-align:right;padding-top:8px;margin-top:4px;border-top:1px solid var(--border);font-size:13px;">'
    + '合計 <span class="' + totCl + '" style="font-weight:600;">' + fmtBig(tot) + '</span>'
    + '<span class="text-muted" style="font-size:11px;margin-left:6px;">（避險 ' + fmtBig(dh) + '）</span></div>';
  h += '</div>';
  return h;
}

function brInstStocks(stocks) {
  if (!stocks || stocks.length === 0) return '';

  function fmtS(n) {
    var abs = Math.abs(n);
    if (abs >= 1e8) return (n / 1e8).toFixed(1) + '億';
    if (abs >= 1e4) return (n / 1e4).toFixed(0) + '萬';
    return fmtNum(n);
  }

  function stkTbl(title, rows, badge, badgeStyle) {
    if (!rows.length) return '';
    var h = '<div style="margin-bottom:14px;"><div style="font-size:13px;font-weight:600;margin-bottom:6px;">' + title;
    if (badge) h += ' <span class="tag" style="font-size:10px;padding:1px 8px;border-radius:10px;' + (badgeStyle || '') + '">' + badge + '</span>';
    h += '</div><table class="br-table"><thead><tr><th>代號</th><th>名稱</th><th class="text-right">外資</th><th class="text-right">投信</th><th class="text-right">合計</th></tr></thead><tbody>';
    rows.forEach(function(s) {
      var fc = s.fi > 0 ? 'up' : 'down';
      var tc = s.it > 0 ? 'up' : 'down';
      var ac = s.tot > 0 ? 'up' : 'down';
      h += '<tr><td style="color:var(--blue);font-weight:600;cursor:pointer;" onclick="goAnalyze(\'' + s.c + '\')">' + s.c + '</td>'
        + '<td style="max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + s.n + '</td>'
        + '<td class="text-right ' + fc + '">' + fmtS(s.fi) + '</td>'
        + '<td class="text-right ' + tc + '">' + fmtS(s.it) + '</td>'
        + '<td class="text-right ' + ac + '" style="font-weight:700;">' + fmtS(s.tot) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  var allBuy = stocks.filter(function(s) { return s.fi > 0 && s.it > 0 && s.dl > 0; }).sort(function(a,b) { return b.tot - a.tot; }).slice(0, 10);
  var allSell = stocks.filter(function(s) { return s.fi < 0 && s.it < 0 && s.dl < 0; }).sort(function(a,b) { return a.tot - b.tot; }).slice(0, 10);
  var fiBuy = stocks.filter(function(s) { return s.fi > 0; }).sort(function(a,b) { return b.fi - a.fi; }).slice(0, 10);
  var itBuy = stocks.filter(function(s) { return s.it > 0; }).sort(function(a,b) { return b.it - a.it; }).slice(0, 10);

  var h = '<div class="br-section"><div class="br-section-title">法人籌碼焦點</div>';
  h += stkTbl('三法人同步買超', allBuy, '利多', 'background:rgba(255,56,96,0.1);color:var(--red);border:1px solid var(--red);');
  h += stkTbl('三法人同步賣超', allSell, '利空', 'background:rgba(0,232,123,0.1);color:var(--green);border:1px solid var(--green);');
  h += '<div class="grid-2">';
  h += stkTbl('外資買超 TOP', fiBuy);
  h += stkTbl('投信買超 TOP', itBuy);
  h += '</div></div>';
  return h;
}

function brEarnings(earnings) {
  if (!earnings || earnings.length === 0)
    return '<div class="br-section"><div class="br-section-title">最新財報 · 營收 · 獲利動態</div><div class="text-muted" style="padding:8px 0;">暫無財報新聞</div></div>';
  var rows = earnings.map(function(n) {
    var link = n.url
      ? '<a href="' + n.url + '" target="_blank" rel="noopener" style="color:var(--text);text-decoration:none;">' + brEscHtml(n.title) + '</a>'
      : brEscHtml(n.title);
    var summ = n.summary ? '<div style="font-size:12px;color:var(--text2);margin-top:4px;line-height:1.6;">' + brEscHtml(n.summary) + '</div>' : '';
    return '<div style="padding:14px 0;border-bottom:1px solid var(--border);">'
      + '<div style="font-size:14px;line-height:1.5;"><span style="color:var(--text2);font-size:11px;margin-right:8px;">' + n.time + '</span>' + link + '</div>' + summ + '</div>';
  }).join('');
  return '<div class="br-section"><div class="br-section-title">最新財報 · 營收 · 獲利動態</div>' + rows + '</div>';
}

function brNews(news) {
  if (!news || news.length === 0)
    return '<div class="br-section"><div class="br-section-title">財經要聞</div><div class="text-muted" style="padding:8px 0;">暫無新聞</div></div>';
  var byCat = {};
  news.forEach(function(n) { if (!byCat[n.cat]) byCat[n.cat] = []; byCat[n.cat].push(n); });

  var h = '<div class="br-section"><div class="br-section-title">財經要聞</div>';
  ['頭條', '台股', '國際', '匯率', '總經'].forEach(function(cat) {
    var items = byCat[cat];
    if (!items) return;
    var lim = cat === '頭條' ? 8 : cat === '台股' ? 6 : 4;
    var rows = items.slice(0, lim).map(function(n) {
      var link = n.url
        ? '<a href="' + n.url + '" target="_blank" rel="noopener" style="color:var(--text);text-decoration:none;">' + brEscHtml(n.title) + '</a>'
        : brEscHtml(n.title);
      return '<div style="display:flex;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.02);">'
        + '<span style="color:var(--text2);font-size:11px;flex-shrink:0;width:40px;">' + n.time + '</span>'
        + '<span style="font-size:13px;line-height:1.5;">' + link + '</span></div>';
    }).join('');
    h += '<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:#d4a940;letter-spacing:2px;padding-bottom:5px;margin-bottom:5px;border-bottom:1px solid var(--border);">' + cat + '</div>' + rows + '</div>';
  });
  h += '</div>';
  return h;
}

function renderBriefing(data) {
  var s = data.sentiment;

  // Date — save for daily refresh check
  gBriefingDate = new Date().toLocaleDateString('sv');
  var dStr = data.date ? data.date.slice(0,4) + '/' + data.date.slice(4,6) + '/' + data.date.slice(6,8) : '';
  document.getElementById('briefing-date').textContent = dStr;

  // Stars
  var stars = '';
  for (var i = 0; i < 5; i++) {
    stars += i < s.star ? '<span style="color:#d4a940;">&#9733;</span>' : '<span style="color:var(--text2);">&#9733;</span>';
  }

  // Tags
  var tagsHtml = s.tags.map(function(t) {
    var cls = t[1] === 'u' ? 'br-tag-up' : t[1] === 'd' ? 'br-tag-down' : 'br-tag-neutral';
    return '<span class="' + cls + '">' + t[0] + '</span>';
  }).join('');

  var sClr = s.star >= 4 ? 'var(--red)' : s.star <= 2 ? 'var(--green)' : 'var(--text2)';

  var html = '';

  // Sentiment card
  html += '<div class="br-sentiment">'
    + '<div class="br-stars">' + stars + '</div>'
    + '<div class="br-label" style="color:' + sClr + ';">' + s.label + '</div>'
    + '<div class="br-tags">' + tagsHtml + '</div></div>';

  // Sub-tabs
  html += '<div class="tab-bar" id="br-tabs">'
    + '<button class="tab-btn active" data-br="overview">總覽</button>'
    + '<button class="tab-btn" data-br="intl">國際</button>'
    + '<button class="tab-btn" data-br="inst">法人</button>'
    + '<button class="tab-btn" data-br="earn">財報</button>'
    + '<button class="tab-btn" data-br="news">新聞</button></div>';

  // === Sub-pane: Overview ===
  html += '<div class="br-pane active" id="br-overview">';

  // Viewpoint
  html += '<div class="br-viewpoint"><div class="br-vp-title">MARKET INSIGHT</div>';
  (data.viewpoint || []).forEach(function(p) {
    if (p.indexOf('⚠') === 0) html += '<p class="br-vp-warn">' + p + '</p>';
    else if (p.indexOf('【') === 0) html += '<p class="br-vp-action">' + p + '</p>';
    else html += '<p>' + p + '</p>';
  });
  html += '</div>';

  // TWSE
  if (data.twse) {
    var tw = data.twse;
    var cl = tw.chg > 0 ? 'up' : tw.chg < 0 ? 'down' : '';
    var chgSign = tw.chg > 0 ? '+' : '';
    html += '<div class="br-section"><div class="br-section-title">台股前日收盤</div>'
      + '<div style="text-align:center;padding:8px 0;">'
      + '<span class="' + cl + '" style="font-size:28px;font-weight:700;">' + fmtNum(tw.idx, 2) + '</span>'
      + '<span class="' + cl + '" style="font-size:16px;margin-left:8px;">' + chgSign + fmtNum(tw.chg, 2) + '</span></div>'
      + '<div class="text-sm text-muted" style="text-align:center;">成交額 <b>' + fmtBig(tw.val) + '</b> ／ 量 <b>' + fmtBig(tw.vol) + '</b>股 ／ 筆數 <b>' + fmtNum(tw.txn) + '</b></div></div>';
  }

  html += brMktTable('美股四大指數', data.markets, ['sp500', 'dow', 'nasdaq', 'sox']);
  html += brMktTable('台灣 ADR', data.markets, ['tsm', 'umc']);
  html += brInstBars(data.inst_market, data.inst_date);
  html += '</div>'; // end br-overview

  // === Sub-pane: International ===
  html += '<div class="br-pane" id="br-intl">';
  html += brMktTable('美股四大指數', data.markets, ['sp500', 'dow', 'nasdaq', 'sox']);
  html += brMktTable('亞洲', data.markets, ['nk', 'sh', 'hsi']);
  html += brMktTable('歐洲', data.markets, ['dax', 'ftse']);
  html += brMktTable('原物料 · 匯率 · 指標', data.markets, ['oil', 'gold', 'twd', 'dxy', 'tnx', 'vix']);
  html += brMktTable('台灣 ADR', data.markets, ['tsm', 'umc']);
  html += '</div>';

  // === Sub-pane: Institutional ===
  html += '<div class="br-pane" id="br-inst">';
  html += brInstBars(data.inst_market, data.inst_date);
  html += brInstStocks(data.inst_stocks);
  html += '</div>';

  // === Sub-pane: Earnings ===
  html += '<div class="br-pane" id="br-earn">';
  html += brEarnings(data.earnings);
  html += '</div>';

  // === Sub-pane: News ===
  html += '<div class="br-pane" id="br-news">';
  html += brNews(data.news);
  html += '</div>';

  // Disclaimer
  html += '<div class="text-sm text-muted" style="margin-top:16px;padding:10px 14px;background:var(--bg2);border-radius:8px;line-height:1.6;font-size:10px;">'
    + '本晨訊由 CT 謙堂資本系統自動產生，資料源：TWSE、TPEX、Yahoo Finance、鉅亨網。所有內容僅供研究參考，不構成投資建議。</div>';

  document.getElementById('briefing-container').innerHTML = html;

  // Attach sub-tab click handlers
  document.querySelectorAll('#br-tabs .tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('#br-tabs .tab-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.br-pane').forEach(function(p) { p.classList.remove('active'); });
      var pane = document.getElementById('br-' + btn.dataset.br);
      if (pane) pane.classList.add('active');
    });
  });
}

async function adminDeletePick(id) {
  if (!confirm('確定要下架此投資建議？')) return;
  try {
    const r = await authFetch('/api/admin/picks/' + id, { method: 'DELETE' });
    if (r.ok) {
      toast('已下架');
      loadAdminPicks();
      loadAdminStats();
    }
  } catch (e) {
    toast('操作失敗');
  }
}

// ============================================================
// TAIEX BACKTEST (PRO+ feature)
// ============================================================
let chtBacktest = null;

// Show/hide MA params based on strategy selection
document.addEventListener('change', function(e) {
  if (e.target && e.target.id === 'bt-strategy') {
    var maParams = document.getElementById('bt-ma-params');
    if (maParams) maParams.style.display = e.target.value === 'ma_cross' ? '' : 'none';
  }
});

async function runBacktest() {
  if (!userCanAccess('backtest')) {
    showUpgradeModal('proplus');
    return;
  }
  if (!gCurrentUser) { openAuthModal(); return; }

  var strategy = document.getElementById('bt-strategy').value;
  var startDate = document.getElementById('bt-start').value;
  var amount = parseFloat(document.getElementById('bt-amount').value) || 100000;
  var resultEl = document.getElementById('bt-result');
  var chartEl = document.getElementById('bt-chart');

  resultEl.style.display = '';
  resultEl.innerHTML = '<div class="loading-box"><div class="spinner"></div><div>回測計算中...</div></div>';
  chartEl.style.display = 'none';

  var body = { strategy: strategy, start_date: startDate, amount: amount };
  if (strategy === 'ma_cross') {
    body.short_ma = parseInt(document.getElementById('bt-short-ma').value) || 5;
    body.long_ma = parseInt(document.getElementById('bt-long-ma').value) || 20;
  }

  try {
    var r = await authFetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await r.json();

    if (data.status === 'loading') {
      resultEl.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">' + data.message + '</div>';
      return;
    }
    if (data.error) {
      resultEl.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">' + data.error + '</div>';
      return;
    }

    // Render result stats
    var retCls = data.total_return >= 0 ? 'up' : 'down';
    var h = '<div class="stat-grid" style="margin-bottom:14px;">';
    h += '<div class="stat-box"><div class="label">策略</div><div class="value" style="font-size:14px;">' + (data.strategy || '') + '</div></div>';
    h += '<div class="stat-box"><div class="label">總投入</div><div class="value">' + fmtBig(data.invested) + '</div></div>';
    h += '<div class="stat-box"><div class="label">最終價值</div><div class="value ' + retCls + '">' + fmtBig(data.final_value) + '</div></div>';
    h += '<div class="stat-box"><div class="label">總報酬率</div><div class="value ' + retCls + '">' + (data.total_return >= 0 ? '+' : '') + data.total_return + '%</div></div>';
    if (data.cagr != null) h += '<div class="stat-box"><div class="label">年化報酬(CAGR)</div><div class="value ' + retCls + '">' + (data.cagr >= 0 ? '+' : '') + data.cagr + '%</div></div>';
    if (data.max_drawdown != null) h += '<div class="stat-box"><div class="label">最大回撤</div><div class="value down">-' + data.max_drawdown + '%</div></div>';
    if (data.trades != null) h += '<div class="stat-box"><div class="label">交易次數</div><div class="value">' + data.trades + '</div></div>';
    if (data.win_rate != null) h += '<div class="stat-box"><div class="label">勝率</div><div class="value">' + data.win_rate + '%</div></div>';
    h += '<div class="stat-box"><div class="label">回測期間</div><div class="value" style="font-size:12px;">' + data.start_date + ' ~ ' + data.end_date + '<br>' + data.trading_days + ' 交易日</div></div>';
    h += '</div>';
    resultEl.innerHTML = h;
    resultEl.style.display = '';

    // Render equity curve
    if (data.equity_curve && data.equity_curve.length > 0) {
      chartEl.innerHTML = '';
      chartEl.style.display = '';
      if (chtBacktest) { chtBacktest.remove(); chtBacktest = null; }
      chtBacktest = LightweightCharts.createChart(chartEl, {
        width: chartEl.clientWidth,
        height: 250,
        layout: { background: { color: '#0c1632' }, textColor: '#6b7a99' },
        grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });
      var areaSeries = chtBacktest.addAreaSeries({
        topColor: 'rgba(0, 240, 255, 0.3)',
        bottomColor: 'rgba(0, 240, 255, 0.01)',
        lineColor: '#00f0ff',
        lineWidth: 2,
      });
      areaSeries.setData(data.equity_curve.map(function(p) {
        return { time: p.date, value: p.value };
      }));
      chtBacktest.timeScale().fitContent();
    }
  } catch (e) {
    resultEl.innerHTML = '<div class="text-muted">回測失敗：' + e.message + '</div>';
  }
}

// ============================================================
// DIVIDEND CALENDAR (FREE watchlist / PRO+ all)
// ============================================================
let gDividendMode = 'watchlist';

async function loadDividendCalendar(mode) {
  mode = mode || 'watchlist';
  var sec = document.getElementById('dividend-section');
  var el = document.getElementById('dividend-calendar');
  if (!sec || !el) return;

  if (mode === 'all' && !userCanAccess('dividends_all')) {
    showUpgradeModal('proplus');
    return;
  }
  if (!gCurrentUser) { openAuthModal(); return; }

  gDividendMode = mode;
  sec.style.display = '';
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';

  try {
    var url = mode === 'all'
      ? '/api/dividends?month=' + new Date().toISOString().slice(0, 7)
      : '/api/dividends/watchlist';
    var r = await authFetch(url);
    if (!r.ok) {
      var data = await r.json();
      if (data.upgrade) { showUpgradeModal('proplus'); el.innerHTML = ''; return; }
      el.innerHTML = '<div class="text-muted">載入失敗</div>';
      return;
    }
    var data = await r.json();
    renderDividendCalendar(data.dividends || []);
  } catch (e) {
    el.innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

function renderDividendCalendar(dividends) {
  var el = document.getElementById('dividend-calendar');
  if (!el) return;
  if (dividends.length === 0) {
    el.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">近期無除權息資料' +
      (gDividendMode === 'watchlist' ? '（僅顯示關注股）' : '') + '</div>';
    return;
  }

  // Group by date
  var byDate = {};
  dividends.forEach(function(d) {
    if (!byDate[d.date]) byDate[d.date] = [];
    byDate[d.date].push(d);
  });

  // Build month calendar
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var firstDay = new Date(year, month, 1);
  var lastDay = new Date(year, month + 1, 0);
  var startDow = firstDay.getDay(); // 0=Sun
  var daysInMonth = lastDay.getDate();

  var h = '<div style="font-size:14px;font-weight:600;margin-bottom:8px;">' + year + '/' + (month + 1) + ' 除權息行事曆</div>';
  h += '<div class="div-cal-grid">';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(function(d) {
    h += '<div class="div-cal-header">' + d + '</div>';
  });

  // Empty cells before first day
  for (var i = 0; i < startDow; i++) {
    h += '<div class="div-cal-cell div-cal-empty"></div>';
  }

  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var items = byDate[dateStr] || [];
    h += '<div class="div-cal-cell"><div class="div-cal-day">' + d + '</div>';
    items.forEach(function(item) {
      var cls = item.cash > 0 && item.stock > 0 ? 'div-cal-both' : item.cash > 0 ? 'div-cal-cash' : 'div-cal-stock';
      var label = item.code + ' ';
      if (item.cash > 0) label += '$' + item.cash;
      h += '<div class="div-cal-item ' + cls + '" onclick="goAnalyze(\'' + item.code + '\')" title="' + item.name + ' ' + item.type + (item.cash ? ' 現金' + item.cash : '') + (item.stock ? ' 股票' + item.stock : '') + '">' + label + '</div>';
    });
    h += '</div>';
  }
  h += '</div>';
  el.innerHTML = h;
}

// ============================================================
// STOCK COMPARISON (FREE 2 / PRO 5)
// ============================================================
let chtCompare = null;

function initCompareTab() {
  var proInputs = document.querySelectorAll('.cmp-pro-input');
  proInputs.forEach(function(inp) {
    if (!userCanAccess('compare_5')) {
      inp.disabled = true;
      inp.placeholder = 'Pro 限定';
      inp.style.opacity = '0.4';
    } else {
      inp.disabled = false;
      inp.placeholder = '代號' + inp.id.split('-')[1];
      inp.style.opacity = '';
    }
  });
}

async function runCompare() {
  var codes = [];
  for (var i = 1; i <= 5; i++) {
    var val = (document.getElementById('cmp-' + i).value || '').trim();
    if (val) codes.push(val.split(' ')[0]);
  }
  if (codes.length < 2) { toast('請至少輸入 2 檔股票'); return; }
  var maxCodes = userCanAccess('compare_5') ? 5 : 2;
  if (codes.length > maxCodes) {
    showUpgradeModal('pro');
    return;
  }

  document.getElementById('compare-loading').style.display = '';
  document.getElementById('compare-chart-card').style.display = 'none';
  document.getElementById('compare-table-card').style.display = 'none';

  try {
    // Fetch data for all stocks in parallel
    var promises = codes.map(function(code) {
      return fetchYahooHistory(code).then(function(data) { return { code: code, data: data }; }).catch(function() { return { code: code, data: null }; });
    });
    var results = await Promise.all(promises);

    // Also fetch MIS for current prices
    await fetchMisBatch(codes);

    // Build comparison table
    var tableRows = [];
    var validResults = results.filter(function(r) { return r.data && r.data.closes && r.data.closes.length > 0; });

    if (validResults.length < 2) {
      toast('無法取得足夠的股票資料');
      document.getElementById('compare-loading').style.display = 'none';
      return;
    }

    var headers = ['指標'];
    validResults.forEach(function(r) {
      var info = gStockDB[r.code];
      headers.push(r.code + ' ' + (info ? info.name : ''));
    });

    // Metrics
    var metricRows = [];
    var metricNames = ['現價', '漲跌%', 'MA5', 'MA20', 'MA60', 'RSI(14)', 'K值', 'D值'];
    metricNames.forEach(function(name) {
      var row = [name];
      validResults.forEach(function(r) {
        var C = r.data.closes;
        var H = r.data.highs;
        var L = r.data.lows;
        var n = C.length - 1;
        var mis = gMisCache[r.code];
        if (name === '現價') {
          var price = mis ? mis.price : C[n];
          row.push(fmtNum(price, 2));
        } else if (name === '漲跌%') {
          var pct = mis ? mis.pct : (C[n] && C[n-1] ? ((C[n]-C[n-1])/C[n-1]*100) : 0);
          var cls = pct >= 0 ? 'up' : 'down';
          row.push('<span class="' + cls + '">' + (pct >= 0 ? '+' : '') + (typeof pct === 'number' ? pct.toFixed(2) : pct) + '%</span>');
        } else if (name === 'MA5') {
          var ma = TA.sma(C, 5);
          row.push(ma[n] ? fmtNum(ma[n], 2) : '--');
        } else if (name === 'MA20') {
          var ma = TA.sma(C, 20);
          row.push(ma[n] ? fmtNum(ma[n], 2) : '--');
        } else if (name === 'MA60') {
          var ma = TA.sma(C, 60);
          row.push(ma[n] ? fmtNum(ma[n], 2) : '--');
        } else if (name === 'RSI(14)') {
          var rsi = TA.rsi(C);
          row.push(rsi[n] != null ? rsi[n].toFixed(1) : '--');
        } else if (name === 'K值') {
          var kd = TA.kd(H, L, C);
          row.push(kd.K[n] != null ? kd.K[n].toFixed(1) : '--');
        } else if (name === 'D值') {
          var kd = TA.kd(H, L, C);
          row.push(kd.D[n] != null ? kd.D[n].toFixed(1) : '--');
        }
      });
      metricRows.push(row);
    });

    document.getElementById('compare-table').innerHTML = mkTable(headers, metricRows);
    document.getElementById('compare-table-card').style.display = '';

    // Build normalized chart
    var chartEl = document.getElementById('compare-chart');
    if (chartEl) {
      chartEl.innerHTML = '';
      if (chtCompare) { chtCompare.remove(); chtCompare = null; }
      chtCompare = LightweightCharts.createChart(chartEl, {
        width: chartEl.clientWidth,
        height: 300,
        layout: { background: { color: '#0c1632' }, textColor: '#6b7a99' },
        grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
        crosshair: { mode: 0 },
      });

      var colors = ['#00f0ff', '#b44dff', '#ff3860', '#00e87b', '#ffd036'];
      validResults.forEach(function(r, idx) {
        var C = r.data.closes;
        var D = r.data.dates;
        if (!C || C.length === 0) return;
        var base = C[0];
        var series = chtCompare.addLineSeries({
          color: colors[idx % colors.length],
          lineWidth: 2,
          title: r.code,
        });
        var lineData = [];
        for (var j = 0; j < C.length; j++) {
          if (D[j] && base > 0) {
            lineData.push({ time: D[j], value: ((C[j] - base) / base * 100) });
          }
        }
        series.setData(lineData);
      });
      chtCompare.timeScale().fitContent();
      document.getElementById('compare-chart-card').style.display = '';
    }

    document.getElementById('compare-loading').style.display = 'none';
  } catch (e) {
    document.getElementById('compare-loading').style.display = 'none';
    toast('比較失敗：' + e.message);
  }
}

// ============================================================
// PORTFOLIO TRACKING (PRO feature)
// ============================================================
let gPortfolio = [];

function openPortfolioModal() {
  if (!userCanAccess('portfolio')) { showUpgradeModal('pro'); return; }
  if (!gCurrentUser) { openAuthModal(); return; }
  document.getElementById('port-code').value = '';
  document.getElementById('port-price').value = '';
  document.getElementById('port-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('port-shares').value = '1';
  document.getElementById('port-notes').value = '';
  document.getElementById('port-error').textContent = '';
  document.getElementById('portfolio-overlay').classList.add('show');
  setTimeout(function() { document.getElementById('port-code').focus(); }, 100);
}

function closePortfolioModal() {
  document.getElementById('portfolio-overlay').classList.remove('show');
}

document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'portfolio-overlay') closePortfolioModal();
});

async function submitPortfolio() {
  var code = document.getElementById('port-code').value.trim();
  var price = parseFloat(document.getElementById('port-price').value);
  var date = document.getElementById('port-date').value;
  var shares = parseInt(document.getElementById('port-shares').value) || 1;
  var notes = document.getElementById('port-notes').value.trim();
  var errEl = document.getElementById('port-error');
  if (!code || !price || price <= 0) { errEl.textContent = '請輸入股票代號和買入價格'; return; }
  var info = gStockDB[code];
  var name = info ? info.name : '';
  try {
    var r = await authFetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_code: code, stock_name: name, entry_price: price, entry_date: date, shares: shares, notes: notes })
    });
    var data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || '新增失敗'; return; }
    toast('已新增持倉：' + code + ' ' + name);
    closePortfolioModal();
    loadPortfolio();
  } catch (e) { errEl.textContent = '網路錯誤'; }
}

async function loadPortfolio() {
  var sec = document.getElementById('portfolio-section');
  if (!sec) return;
  if (!userCanAccess('portfolio') || !gCurrentUser) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  try {
    var r = await authFetch('/api/portfolio');
    if (!r.ok) return;
    var data = await r.json();
    gPortfolio = data.portfolio || [];
    renderPortfolio();
  } catch (e) { /* silent */ }
}

function renderPortfolio() {
  var el = document.getElementById('portfolio-container');
  var sumEl = document.getElementById('portfolio-summary');
  if (!el) return;
  var open = gPortfolio.filter(function(p) { return p.status === 'open'; });
  if (open.length === 0 && gPortfolio.length === 0) {
    el.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">尚無持倉，點擊上方「+ 新增持倉」開始追蹤</div>';
    if (sumEl) sumEl.innerHTML = '';
    return;
  }

  // Calculate P&L
  var totalInvested = 0, totalCurrent = 0;
  var rows = open.map(function(p) {
    var mis = gMisCache[p.stock_code];
    var currentPrice = mis ? mis.price : 0;
    var invested = p.entry_price * p.shares * 1000;
    var current = currentPrice * p.shares * 1000;
    totalInvested += invested;
    if (currentPrice > 0) totalCurrent += current;
    else totalCurrent += invested;
    var pnl = currentPrice > 0 ? (currentPrice - p.entry_price) * p.shares * 1000 : 0;
    var pnlPct = p.entry_price > 0 && currentPrice > 0 ? ((currentPrice - p.entry_price) / p.entry_price * 100) : 0;
    var cls = pnl >= 0 ? 'up' : 'down';
    var days = Math.floor((new Date() - new Date(p.entry_date)) / 86400000);
    return [
      '<span class="clickable" onclick="goAnalyze(\'' + p.stock_code + '\')">' + p.stock_code + '</span>',
      p.stock_name || '',
      fmtNum(p.entry_price, 2),
      currentPrice > 0 ? '<span class="' + cls + '">' + fmtNum(currentPrice, 2) + '</span>' : '--',
      p.shares + ' 張',
      '<span class="' + cls + '">' + (pnl >= 0 ? '+' : '') + fmtNum(Math.round(pnl)) + '</span>',
      '<span class="' + cls + '">' + (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%</span>',
      days + '天',
      '<button class="btn btn-secondary" style="padding:2px 8px;font-size:10px;" onclick="closePosition(' + p.id + ')">平倉</button>' +
      '<button class="btn btn-secondary" style="padding:2px 8px;font-size:10px;margin-left:4px;" onclick="deletePosition(' + p.id + ')">刪除</button>'
    ];
  });

  el.innerHTML = mkTable(['代號', '名稱', '買入價', '現價', '張數', '損益', '報酬%', '持有', '操作'], rows);

  // Summary
  if (sumEl && totalInvested > 0) {
    var unrealized = totalCurrent - totalInvested;
    var pct = (unrealized / totalInvested * 100);
    var cls = unrealized >= 0 ? 'up' : 'down';
    sumEl.innerHTML = '<div class="stat-grid">' +
      '<div class="stat-box"><div class="label">總投入</div><div class="value">' + fmtBig(totalInvested) + '</div></div>' +
      '<div class="stat-box"><div class="label">現值</div><div class="value ' + cls + '">' + fmtBig(totalCurrent) + '</div></div>' +
      '<div class="stat-box"><div class="label">未實現損益</div><div class="value ' + cls + '">' + (unrealized >= 0 ? '+' : '') + fmtBig(unrealized) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)</div></div></div>';
  }
}

async function closePosition(id) {
  var p = gPortfolio.find(function(x) { return x.id === id; });
  if (!p) return;
  var mis = gMisCache[p.stock_code];
  var price = mis ? mis.price : 0;
  var exitPrice = prompt('輸入賣出價格：', price || p.entry_price);
  if (!exitPrice) return;
  try {
    await authFetch('/api/portfolio/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exit_price: parseFloat(exitPrice) })
    });
    toast('已平倉');
    loadPortfolio();
  } catch (e) { toast('操作失敗'); }
}

async function deletePosition(id) {
  if (!confirm('確定刪除此持倉？')) return;
  try {
    await authFetch('/api/portfolio/' + id, { method: 'DELETE' });
    gPortfolio = gPortfolio.filter(function(x) { return x.id !== id; });
    renderPortfolio();
    toast('已刪除');
  } catch (e) { toast('刪除失敗'); }
}

// ============================================================
// PRICE ALERTS (PRO feature)
// ============================================================
let gAlerts = [];

function openAlertModal() {
  if (!userCanAccess('price_alerts')) {
    showUpgradeModal('pro');
    return;
  }
  if (!gCurrentUser) { openAuthModal(); return; }
  var codeInput = document.getElementById('stock-input');
  var code = codeInput ? codeInput.value.trim().split(' ')[0] : '';
  if (!code) { toast('請先搜尋一檔股票'); return; }
  var info = gStockDB[code];
  var name = info ? info.name : '';
  document.getElementById('alert-stock-label').textContent = code + ' ' + name;
  document.getElementById('alert-price').value = '';
  document.getElementById('alert-error').textContent = '';
  document.getElementById('alert-overlay').classList.add('show');
  // Pre-fill with current price if available
  var mis = gMisCache[code];
  if (mis && mis.price) document.getElementById('alert-price').value = mis.price;
  setTimeout(function() { document.getElementById('alert-price').focus(); }, 100);
}

function closeAlertModal() {
  document.getElementById('alert-overlay').classList.remove('show');
}

document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'alert-overlay') closeAlertModal();
});

async function submitAlert() {
  var code = (document.getElementById('alert-stock-label').textContent || '').split(' ')[0];
  var info = gStockDB[code];
  var name = info ? info.name : '';
  var condition = document.getElementById('alert-condition').value;
  var price = parseFloat(document.getElementById('alert-price').value);
  var errEl = document.getElementById('alert-error');
  if (!price || price <= 0) { errEl.textContent = '請輸入有效價格'; return; }
  try {
    // Request notification permission on first alert
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    var r = await authFetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_code: code, stock_name: name, condition: condition, target_price: price })
    });
    var data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || '建立失敗'; return; }
    toast('提醒已建立：' + code + ' ' + (condition === 'above' ? '漲破' : '跌破') + ' ' + price);
    closeAlertModal();
    loadAlerts();
  } catch (e) {
    errEl.textContent = '網路錯誤';
  }
}

async function loadAlerts() {
  if (!userCanAccess('price_alerts') || !gCurrentUser) {
    var sec = document.getElementById('alerts-section');
    if (sec) sec.style.display = 'none';
    return;
  }
  try {
    var r = await authFetch('/api/alerts');
    if (!r.ok) return;
    var data = await r.json();
    gAlerts = data.alerts || [];
    renderAlerts();
  } catch (e) { /* silent */ }
}

function renderAlerts() {
  var sec = document.getElementById('alerts-section');
  var el = document.getElementById('alerts-container');
  if (!sec || !el) return;
  if (gAlerts.length === 0) {
    sec.style.display = 'none';
    return;
  }
  sec.style.display = '';
  var active = gAlerts.filter(function(a) { return !a.triggered; });
  var triggered = gAlerts.filter(function(a) { return a.triggered; });
  var h = '';
  if (active.length > 0) {
    h += '<div style="margin-bottom:12px;font-size:12px;color:var(--text2);">進行中 (' + active.length + ')</div>';
    active.forEach(function(a) {
      var condLabel = a.condition === 'above' ? '漲破' : '跌破';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">' +
        '<div><span class="clickable" onclick="goAnalyze(\'' + a.stock_code + '\')" style="font-weight:600;">' + a.stock_code + '</span> ' +
        '<span class="text-muted">' + (a.stock_name || '') + '</span> ' +
        '<span style="color:var(--cyan);">' + condLabel + ' ' + a.target_price + '</span></div>' +
        '<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="deleteAlert(' + a.id + ')">刪除</button></div>';
    });
  }
  if (triggered.length > 0) {
    h += '<div style="margin-top:12px;margin-bottom:8px;font-size:12px;color:var(--text2);">已觸發 (' + triggered.length + ')</div>';
    triggered.slice(0, 10).forEach(function(a) {
      var condLabel = a.condition === 'above' ? '漲破' : '跌破';
      h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);opacity:0.6;">' +
        '<div><span>' + a.stock_code + '</span> <span class="text-muted">' + (a.stock_name || '') + '</span> ' +
        condLabel + ' ' + a.target_price + ' <span class="text-muted text-sm">(' + (a.triggered_at || '') + ')</span></div>' +
        '<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="deleteAlert(' + a.id + ')">刪除</button></div>';
    });
  }
  el.innerHTML = h;
}

async function deleteAlert(id) {
  try {
    await authFetch('/api/alerts/' + id, { method: 'DELETE' });
    gAlerts = gAlerts.filter(function(a) { return a.id !== id; });
    renderAlerts();
    toast('提醒已刪除');
  } catch (e) { toast('刪除失敗'); }
}

function checkPriceAlerts() {
  if (!gAlerts || gAlerts.length === 0) return;
  var active = gAlerts.filter(function(a) { return !a.triggered; });
  active.forEach(function(a) {
    var mis = gMisCache[a.stock_code];
    if (!mis || !mis.price) return;
    var price = mis.price;
    var triggered = false;
    if (a.condition === 'above' && price >= a.target_price) triggered = true;
    if (a.condition === 'below' && price <= a.target_price) triggered = true;
    if (triggered) {
      a.triggered = 1;
      a.triggered_at = new Date().toLocaleString('zh-TW');
      // Send notification
      var condLabel = a.condition === 'above' ? '漲破' : '跌破';
      var msg = a.stock_code + ' ' + (a.stock_name || '') + ' 已' + condLabel + ' ' + a.target_price + '（現價 ' + price + '）';
      toast(msg);
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('CT Investments 到價提醒', { body: msg, icon: '/manifest.json' });
        } catch (e) { /* silent */ }
      }
      // Mark triggered on server
      authFetch('/api/alerts/' + a.id + '/trigger', { method: 'POST' }).catch(function() {});
      renderAlerts();
    }
  });
}

// ============================================================
// INSTITUTIONAL STREAK (PRO feature)
// ============================================================
async function loadStockInstStreak(code) {
  var el = document.getElementById('stock-inst-streak');
  if (!el) return;
  if (!userCanAccess('inst_streak')) {
    el.innerHTML = '<div style="position:relative;padding:16px;background:var(--bg);border-radius:8px;min-height:60px;" class="feature-locked">' +
      '<div style="filter:blur(3px);color:var(--text2);font-size:12px;">外資連買 -- 天，投信連買 -- 天</div>' +
      '<button class="feature-locked-btn" onclick="showUpgradeModal(\'pro\')">升級 Pro 解鎖</button></div>';
    return;
  }
  try {
    var r = await authFetch('/api/inst-streak?code=' + code);
    if (!r.ok) { el.innerHTML = ''; return; }
    var data = await r.json();
    var streaks = data.streaks || {};
    var h = '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    var labels = { foreign: '外資', trust: '投信', dealer: '自營商' };
    ['foreign', 'trust', 'dealer'].forEach(function(t) {
      var s = streaks[t] || {};
      if (!s.streak) return;
      var dirLabel = s.direction === 'buy' ? '連買' : '連賣';
      var cls = s.direction === 'buy' ? 'up' : 'down';
      h += '<span class="tag ' + cls + '" style="font-size:12px;padding:4px 10px;">' +
        labels[t] + ' ' + dirLabel + ' <b>' + s.streak + '</b> 天 ' +
        '<span style="font-size:11px;">(' + fmtShares(Math.abs(s.total_net)) + ')</span></span>';
    });
    h += '</div>';
    if (h.indexOf('<span') === -1) h = '<div class="text-muted" style="font-size:12px;">尚無連續買賣超資料（資料持續累積中）</div>';
    el.innerHTML = h;
  } catch (e) {
    el.innerHTML = '';
  }
}

function onStreakTabClick(btn) {
  document.querySelectorAll('.streak-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  loadInstStreakRanking();
}

async function loadInstStreakRanking() {
  var el = document.getElementById('inst-streak-ranking');
  if (!el) return;
  if (!userCanAccess('inst_streak')) {
    el.classList.add('feature-locked');
    el.innerHTML = '<div style="filter:blur(3px);padding:20px;"><table><thead><tr><th>代號</th><th>名稱</th><th>連續天數</th><th>累計張數</th></tr></thead><tbody>' +
      '<tr><td>----</td><td>----</td><td>--</td><td>--</td></tr>'.repeat(5) + '</tbody></table></div>' +
      '<button class="feature-locked-btn" onclick="showUpgradeModal(\'pro\')">升級 Pro 解鎖</button>';
    return;
  }

  var activeBtn = el.parentElement.querySelector('.streak-tab-btn.active');
  var type = activeBtn ? activeBtn.dataset.type : 'foreign';
  var dir = activeBtn ? activeBtn.dataset.dir : 'buy';

  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    var r = await authFetch('/api/inst-streak/top?type=' + type + '&dir=' + dir + '&limit=20');
    if (!r.ok) { el.innerHTML = '<div class="text-muted">載入失敗</div>'; return; }
    var data = await r.json();
    var top = data.top || [];
    if (top.length === 0) {
      el.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;">資料累積中，請於 2-3 週後查看<br><span style="font-size:11px;">資料範圍：' + (data.data_from || '--') + ' ~ ' + (data.data_to || '--') + ' (' + (data.trading_days || 0) + ' 個交易日)</span></div>';
      return;
    }
    var suffix = '<div class="text-sm text-muted" style="margin-top:8px;">資料範圍：' + (data.data_from || '--') + ' ~ ' + (data.data_to || '--') + ' (' + (data.trading_days || 0) + ' 個交易日)</div>';
    if (window.innerWidth <= 768) {
      var h = '<div class="rank-card-list">';
      top.forEach(function(s, i) {
        var dirLabel = s.direction === 'buy' ? '連買' : '連賣';
        var cls = s.direction === 'buy' ? 'up' : 'down';
        h += '<div class="rank-card" onclick="goAnalyze(\'' + s.code + '\')">'
          + '<div class="rank-card-head"><span class="rank-card-num">' + (i+1) + '</span>'
          + '<span class="rank-card-code">' + s.code + '</span>'
          + '<span class="rank-card-name">' + s.name + '</span>'
          + '<span class="rank-card-pct ' + cls + '">' + dirLabel + ' ' + s.streak + ' 天</span></div>'
          + '<div class="rank-card-body">'
          + '<div><span class="dt-label">累計</span><span class="' + cls + '">' + fmtShares(Math.abs(s.total_net)) + '</span></div>'
          + '<div><span class="dt-label">最新</span><span class="' + cls + '">' + fmtShares(Math.abs(s.latest_net)) + '</span></div>'
          + '</div></div>';
      });
      h += '</div>';
      el.innerHTML = h + suffix;
    } else {
      var rows = top.map(function(s) {
        var dirLabel = s.direction === 'buy' ? '連買' : '連賣';
        var cls = s.direction === 'buy' ? 'up' : 'down';
        return [
          '<span class="clickable" onclick="goAnalyze(\'' + s.code + '\')">' + s.code + '</span>',
          s.name,
          '<span class="' + cls + '" style="font-weight:700;">' + dirLabel + ' ' + s.streak + ' 天</span>',
          '<span class="' + cls + '">' + fmtShares(Math.abs(s.total_net)) + '</span>',
          '<span class="' + cls + '">' + fmtShares(Math.abs(s.latest_net)) + '</span>'
        ];
      });
      el.innerHTML = mkTable(['代號', '名稱', '連續天數', '累計張數', '最新一日'], rows) + suffix;
    }
  } catch (e) {
    el.innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

// ============================================================
// BOOT
// ============================================================
// Live clock
function updateClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), dow = now.getDay();
  const isTrading = dow >= 1 && dow <= 5 && ((h === 9) || (h >= 10 && h < 13) || (h === 13 && m <= 30));
  let clockText = now.toLocaleTimeString('zh-TW') + (isTrading ? ' 盤中' : '');
  if (isTrading && gLastRefreshTime) {
    const ago = Math.round((now - gLastRefreshTime) / 1000);
    clockText += ` (${ago}s前更新)`;
  }
  el.textContent = clockText;
}

let _tickerTimer = null, _clockTimer = null;
// Start ticker & clock immediately (Yahoo Finance, no dependency on TWSE init)
loadTicker();
_tickerTimer = setInterval(loadTicker, 60 * 1000);
updateClock();
_clockTimer = setInterval(updateClock, 1000);
init().then(async () => {
  startAutoRefresh();
  await checkAuth();

  // Set initial history state
  history.replaceState({ tab: 'overview' }, '', '');

  // Deep-link: ?tab=analysis&stock=2330
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (tabParam) switchTab(tabParam, false);
  const stockParam = params.get('stock');
  if (stockParam) {
    document.getElementById('stock-input').value = stockParam;
    if (tabParam !== 'analysis') switchTab('analysis', false);
    setTimeout(() => analyzeStock(), 300);
  }
});

// Pause timers when tab is hidden (saves battery on mobile)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (_tickerTimer) { clearInterval(_tickerTimer); _tickerTimer = null; }
    if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
    if (gAutoRefreshTimer) { clearInterval(gAutoRefreshTimer); gAutoRefreshTimer = null; }
  } else {
    // Resume when tab becomes visible
    if (!_tickerTimer) { loadTicker(); _tickerTimer = setInterval(loadTicker, 60 * 1000); }
    if (!_clockTimer) { updateClock(); _clockTimer = setInterval(updateClock, 1000); }
    startAutoRefresh();
    doAutoRefresh(true); // Refresh data after returning
    // Check if briefing needs daily refresh (e.g. user left app open overnight)
    if (gBriefingSuccess && gBriefingDate !== new Date().toLocaleDateString('sv')) {
      gBriefingLoaded = false;
      gBriefingSuccess = false;
      if (document.querySelector('#panel-briefing.active')) maybeLoadBriefing();
    }
  }
});
