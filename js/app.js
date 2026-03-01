// ============================================================
// CONFIGURATION
// ============================================================
const TWSE = 'https://www.twse.com.tw/rwd/zh';
const TPEX_OLD = 'https://www.tpex.org.tw/web/stock';
const TPEX_NEW = 'https://www.tpex.org.tw/www/zh-tw';
const CACHE_MS = 10 * 60 * 1000;
const REQUEST_DELAY = 250;
const MAX_CONCURRENT = 3;

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

async function _doFetch(url) {
  const c = cacheGet(url);
  if (c) return c;
  await sleep(REQUEST_DELAY * Math.random());

  // Route all external API requests through proxy to bypass CORS
  let fetchUrl = url;
  if (url.includes('tpex.org.tw') || url.includes('twse.com.tw') || url.includes('yahoo.com')) {
    fetchUrl = '/api/proxy?url=' + encodeURIComponent(url);
  }

  const r = await fetch(fetchUrl);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  cacheSet(url, d);
  return d;
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
  for (let i = 0; i < 7; i++) {
    const d = dateStr(i);
    try {
      const res = await apiFetch(`${TWSE}/fund/BFI82U?response=json&date=${d}`);
      if (res && res.stat === 'OK') return d;
    } catch (e) { /* try next day */ }
  }
  return dateStr(0);
}

// ============================================================
// STOCK DATABASE — build from loaded data for search
// ============================================================
let gStockDB = {}; // { code: { name, market:'twse'|'tpex' } }

function buildStockDB() {
  gAllStocks.forEach(s => {
    const code = s[0].trim();
    if (/^\d{4,6}$/.test(code)) {
      gStockDB[code] = { name: s[1].trim(), market: 'twse' };
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
// GLOBAL STATE
// ============================================================
let gDate = '';
let gAllStocks = [];      // TWSE
let gTpexAllStocks = [];  // TPEx
let gInstStocks = [];     // TWSE institutional
let gTpexInstStocks = []; // TPEx institutional
let gChartsReady = false;

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
// NAVIGATION
// ============================================================
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('panel-' + el.dataset.tab).classList.add('active');
    if (el.dataset.tab === 'analysis' && !gChartsReady) initCharts();
    if (el.dataset.tab === 'watchlist') renderWatchlist();
    if (el.dataset.tab === 'sectors') maybeLoadSectors();
    if (el.dataset.tab === 'global') maybeLoadGlobal();
    if (el.dataset.tab === 'daytrade') maybeLoadDayTrade();
    if (el.dataset.tab === 'admin') loadAdminPanel();
    trackAction('view_tab', el.dataset.tab);
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

acInput.addEventListener('input', () => {
  const q = acInput.value.trim();
  if (q.length === 0) { closeAC(); return; }
  const results = searchStocks(q);
  if (results.length === 0) { closeAC(); return; }
  acIdx = -1;
  let html = '';
  results.forEach((r, i) => {
    const mCls = r.market === 'twse' ? 'tag-twse' : 'tag-tpex';
    const mLabel = r.market === 'twse' ? '上市' : '上櫃';
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

  function opts(el, h) {
    return {
      width: el.clientWidth,
      height: h,
      layout: { background: { color: 'transparent' }, textColor: '#6b7a99', fontSize: 11, fontFamily: "'SF Pro Display', -apple-system, sans-serif" },
      grid: { vertLines: { color: 'rgba(0, 240, 255, 0.04)' }, horzLines: { color: 'rgba(0, 240, 255, 0.04)' } },
      crosshair: { mode: 0, vertLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2 }, horzLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2 } },
      timeScale: { borderColor: 'rgba(0, 240, 255, 0.1)', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      rightPriceScale: { borderColor: 'rgba(0, 240, 255, 0.1)', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 } },
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

  sMa5  = chtMain.addLineSeries({ color: '#ffd036', lineWidth: 1.5, title: 'MA5' });
  sMa10 = chtMain.addLineSeries({ color: '#00d4ff', lineWidth: 1.5, title: 'MA10' });
  sMa20 = chtMain.addLineSeries({ color: '#b44dff', lineWidth: 1.5, title: 'MA20' });
  sBbU  = chtMain.addLineSeries({ color: 'rgba(255,208,54,0.35)', lineWidth: 1, lineStyle: 2 });
  sBbL  = chtMain.addLineSeries({ color: 'rgba(255,208,54,0.35)', lineWidth: 1, lineStyle: 2 });

  const rc = document.getElementById('rsi-chart');
  chtRsi = LightweightCharts.createChart(rc, opts(rc, rc.clientHeight || 160));
  chtRsi.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
  sRsi = chtRsi.addLineSeries({ color: '#ffd036', lineWidth: 2 });

  const kc = document.getElementById('kd-chart');
  chtKd = LightweightCharts.createChart(kc, opts(kc, kc.clientHeight || 160));
  chtKd.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
  sKK = chtKd.addLineSeries({ color: '#00d4ff', lineWidth: 2, title: 'K' });
  sDD = chtKd.addLineSeries({ color: '#ff3860', lineWidth: 2, title: 'D' });

  const mcc = document.getElementById('macd-chart');
  chtMacd = LightweightCharts.createChart(mcc, opts(mcc, mcc.clientHeight || 160));
  chtMacd.priceScale('right').applyOptions({ autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
  sDif = chtMacd.addLineSeries({ color: '#00d4ff', lineWidth: 2, title: 'DIF' });
  sSig = chtMacd.addLineSeries({ color: '#ffd036', lineWidth: 2, title: 'Signal' });
  sHist = chtMacd.addHistogramSeries({ title: 'MACD' });
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

  let totalVol = 0, totalVal = 0, upN = 0, dnN = 0, flatN = 0;
  const allWithPct = [];

  twseStocks.forEach(s => {
    totalVol += parseNum(s[2]);
    totalVal += parseNum(s[3]);
    const close = parseNum(s[7]), chg = parseNum(s[8]);
    if (chg > 0) upN++; else if (chg < 0) dnN++; else flatN++;
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
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
    <div class="stat-box"><div class="label">上漲</div><div class="value up">${upN}</div></div>
    <div class="stat-box"><div class="label">下跌</div><div class="value down">${dnN}</div></div>
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
    return mkTable(['代號', '名稱', '市場', '收盤', '漲跌', '漲跌%', '成交量'], list.map(s => {
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      return [
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        s.name, mTag,
        fmtNum(s.close, 2),
        `<span class="${s.chg > 0 ? 'up' : 'down'}">${s.chg > 0 ? '+' : ''}${fmtNum(s.chg, 2)}</span>`,
        `<span class="${s.pct > 0 ? 'up' : 'down'}">${s.pct > 0 ? '+' : ''}${s.pct.toFixed(2)}%</span>`,
        fmtBig(s.vol)
      ];
    }));
  }

  document.getElementById('top-gainers').innerHTML = rankHTML(gainers);
  document.getElementById('top-losers').innerHTML = rankHTML(losers);
}

// ============================================================
// RENDER: INSTITUTIONAL SUMMARY
// ============================================================
function renderInstSummary(data) {
  if (!data || data.stat !== 'OK' || !data.data) return;
  let html = mkTable(['類別', '買進金額', '賣出金額', '買賣差額'], data.data.map(r => {
    const diff = parseNum(r[3]);
    return [
      r[0],
      fmtBig(parseNum(r[1])),
      fmtBig(parseNum(r[2])),
      `<span class="${diff > 0 ? 'up' : 'down'}" style="font-weight:700">${diff > 0 ? '+' : ''}${fmtBig(diff)}</span>`
    ];
  }));
  document.getElementById('inst-summary-overview').innerHTML = html;
  document.getElementById('inst-amount-table').innerHTML = html;
}

// ============================================================
// RENDER: INSTITUTIONAL PER-STOCK RANK (TWSE + TPEx)
// ============================================================
function renderInstRank(type) {
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

  const sorted = [...parsed].sort((a, b) => b.net - a.net);
  const buyers  = sorted.slice(0, 20);
  const sellers = [...parsed].sort((a, b) => a.net - b.net).slice(0, 20);

  function listHTML(list) {
    return mkTable(['代號', '名稱', '市場', '買賣超（股）'], list.map(s => {
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      return [
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        s.name, mTag,
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
  }

  if (hasRank) {
    const list = t1.data.map(r => ({
      code: r[0].trim(), name: r[1].trim(),
      vol: parseNum(r[3]), buy: parseNum(r[4]), sell: parseNum(r[5])
    })).filter(r => /^\d{4}$/.test(r.code)).sort((a, b) => b.vol - a.vol).slice(0, 30);

    document.getElementById('dt-rank').innerHTML = mkTable(
      ['代號', '名稱', '當沖成交股數', '買進金額', '賣出金額', '估計損益'],
      list.map(s => {
        const pnl = s.sell - s.buy;
        return [
          `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
          s.name, fmtShares(s.vol), fmtBig(s.buy), fmtBig(s.sell),
          `<span class="${pnl >= 0 ? 'up' : 'down'}" style="font-weight:600">${pnl > 0 ? '+' : ''}${fmtBig(pnl)}</span>`
        ];
      })
    );
  }

  return true;
}

// ============================================================
// RENDER: AI RANK (TWSE + TPEx combined)
// ============================================================
function renderAIRank() {
  const instMap = {};
  gInstStocks.forEach(r => {
    const c = r[0].trim();
    if (/^\d{4}$/.test(c)) {
      instMap[c] = { f: parseNum(r[4]), t: parseNum(r[10]), d: parseNum(r[11]), total: parseNum(r[18]) };
    }
  });
  // TPEx: 10=外資合計淨, 13=投信淨, 22=自營合計淨, 23=三大法人合計
  gTpexInstStocks.forEach(r => {
    const c = (r[0]||'').trim();
    if (/^\d{4}$/.test(c)) {
      try {
        instMap[c] = {
          f: parseNum(r[10]),
          t: parseNum(r[13]),
          d: parseNum(r[22]),
          total: parseNum(r[23])
        };
      } catch(e) {}
    }
  });

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
        s.name, mTag,
        fmtNum(s.close, 2),
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
function renderWatchlist() {
  const list = wlGet();
  const box = document.getElementById('watchlist-container');

  if (list.length === 0) {
    box.innerHTML = '<div class="empty-state"><div class="icon">&#x2B50;</div><p>尚無關注的股票<br><span class="text-sm text-muted">在「個股分析」或上方輸入代號加入</span></p></div>';
    return;
  }

  // Build lookup maps
  const sMap = {};
  gAllStocks.forEach(s => { sMap[s[0].trim()] = { data: s, market: 'twse' }; });
  gTpexAllStocks.forEach(s => {
    const code = (s[0]||'').trim();
    if (code) sMap[code] = { data: s, market: 'tpex' };
  });

  const iMap = {};
  gInstStocks.forEach(r => {
    const c = r[0].trim();
    iMap[c] = { f: parseNum(r[4]), t: parseNum(r[10]), d: parseNum(r[11]) };
  });
  gTpexInstStocks.forEach(r => {
    const c = (r[0]||'').trim();
    try { iMap[c] = { f: parseNum(r[10]), t: parseNum(r[13]), d: parseNum(r[22]) }; } catch(e) {}
  });

  let html = '<div class="stock-grid">';
  list.forEach(code => {
    const entry = sMap[code];
    const inst = iMap[code];
    const dbInfo = gStockDB[code];

    if (!entry) {
      // Data not loaded yet — show placeholder card
      html += `<div class="stock-card" onclick="goAnalyze('${code}')">
        <div class="sc-bar" style="background:linear-gradient(90deg,var(--cyan),var(--purple));"></div>
        <div class="sc-top"><div><div class="sc-code">${code}</div><div class="sc-name">${dbInfo ? dbInfo.name : '載入中...'}</div></div></div>
        <div class="text-muted text-sm" style="padding:10px 0;">點擊查看完整分析</div>
        <div class="sc-del" onclick="event.stopPropagation();rmWatchlist('${code}')">&#x2715;</div>
      </div>`;
      return;
    }

    const s = entry.data;
    const market = entry.market;
    let close, chg, vol, name, turnover;
    if (market === 'twse') {
      close = parseNum(s[7]); chg = parseNum(s[8]); vol = parseNum(s[2]); name = s[1].trim(); turnover = parseNum(s[3]);
    } else {
      close = parseNum(s[2]); chg = parseNum(s[3]); vol = parseNum(s[7]); name = (s[1]||'').trim(); turnover = parseNum(s[8] || 0);
    }
    const prev = close - chg;
    const pct = prev > 0 ? (chg / prev * 100) : 0;
    const isUp = chg > 0;
    const lots = vol >= 1000 ? fmtNum(Math.round(vol / 1000), 0) + ' 張' : fmtNum(vol, 0) + ' 股';
    const barColor = isUp ? 'linear-gradient(90deg, var(--red), rgba(255,56,96,0.3))' : chg < 0 ? 'linear-gradient(90deg, var(--green), rgba(0,232,123,0.3))' : 'linear-gradient(90deg, var(--cyan), rgba(0,240,255,0.2))';
    const mTag = market === 'twse' ? '<span class="tag-market tag-twse">上市</span>' : '<span class="tag-market tag-tpex">上櫃</span>';

    // Institutional mini display
    let instHtml = '';
    if (inst) {
      const fCls = inst.f > 0 ? 'up' : inst.f < 0 ? 'down' : '';
      const tCls = inst.t > 0 ? 'up' : inst.t < 0 ? 'down' : '';
      const dCls = inst.d > 0 ? 'up' : inst.d < 0 ? 'down' : '';
      instHtml = `<div class="sc-inst">
        <div class="sc-inst-item"><span class="sc-inst-label">外資</span><span class="${fCls}">${inst.f > 0 ? '+' : ''}${fmtShares(inst.f)}</span></div>
        <div class="sc-inst-item"><span class="sc-inst-label">投信</span><span class="${tCls}">${inst.t > 0 ? '+' : ''}${fmtShares(inst.t)}</span></div>
        <div class="sc-inst-item"><span class="sc-inst-label">自營</span><span class="${dCls}">${inst.d > 0 ? '+' : ''}${fmtShares(inst.d)}</span></div>
      </div>`;
    }

    html += `<div class="stock-card" onclick="goAnalyze('${code}')">
      <div class="sc-bar" style="background:${barColor};"></div>
      <div class="sc-del" onclick="event.stopPropagation();rmWatchlist('${code}')">&#x2715;</div>
      <div class="sc-top">
        <div>
          <div class="sc-code">${code} <span style="font-size:12px;font-weight:400;color:var(--text2);">${name}</span> ${mTag}</div>
        </div>
        <div>
          <div class="sc-price ${isUp ? 'up' : chg < 0 ? 'down' : ''}">${fmtNum(close, 2)}</div>
          <div class="sc-change ${isUp ? 'up' : chg < 0 ? 'down' : ''}">${chg > 0 ? '&#x25B2;+' : chg < 0 ? '&#x25BC;' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</div>
        </div>
      </div>
      <div class="sc-stats">
        <div class="sc-stat"><div class="sc-stat-label">成交量</div><div class="sc-stat-val">${lots}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">成交額</div><div class="sc-stat-val">${fmtBig(turnover)}</div></div>
        <div class="sc-stat"><div class="sc-stat-label">漲跌幅</div><div class="sc-stat-val ${isUp ? 'up' : chg < 0 ? 'down' : ''}">${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</div></div>
      </div>
      ${instHtml}
    </div>`;
  });
  html += '</div>';
  box.innerHTML = html;
}

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
    let rawRows = [], stockName = '';

    if (market === 'tpex') {
      // Known TPEx stock
      const r = await fetchTpexHistory(code);
      rawRows = r.rawRows;
      stockName = r.stockName;
    } else if (market === 'twse') {
      // Known TWSE stock
      const r = await fetchTwseHistory(code);
      rawRows = r.rawRows;
      stockName = r.stockName;
    } else {
      // Unknown — try TWSE first, then TPEx
      const r1 = await fetchTwseHistory(code);
      if (r1.rawRows.length > 0) {
        rawRows = r1.rawRows;
        stockName = r1.stockName;
        market = 'twse';
      } else {
        const r2 = await fetchTpexHistory(code);
        rawRows = r2.rawRows;
        stockName = r2.stockName;
        market = 'tpex';
      }
    }

    if (rawRows.length === 0) {
      document.getElementById('analysis-loading').innerHTML = `<div class="card"><div class="empty-state"><div class="icon">&#x26A0;</div><p>找不到股票 ${code} 的資料<br><span class="text-sm text-muted">請確認股票代號是否正確（支援上市及上櫃）</span></p></div></div>`;
      return;
    }

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
      // Volume is in 張(lots), convert to shares: 1張 = 1000股
      rows.forEach(r => {
        const o = parseNum(r[3]), h = parseNum(r[4]), l = parseNum(r[5]), c = parseNum(r[6]);
        if (c === 0 && o === 0) return; // skip no-trade days
        dates.push(rocToISO(r[0]));
        V.push(parseNum(r[1]) * 1000); // 張 -> 股
        O.push(o);
        H.push(h);
        L.push(l);
        C.push(c);
      });
    }

    const n = C.length;
    const lastC = C[n - 1], prevC = n > 1 ? C[n - 2] : lastC;
    const chg = lastC - prevC;
    const pct = prevC > 0 ? (chg / prevC * 100) : 0;

    // Header
    if (!stockName && gStockDB[code]) stockName = gStockDB[code].name;
    document.getElementById('stock-title').textContent = code + ' ' + stockName;
    const mTag = market === 'twse'
      ? '<span class="tag-market tag-twse">上市</span>'
      : '<span class="tag-market tag-tpex">上櫃</span>';
    document.getElementById('stock-market-tag').innerHTML = mTag;
    document.getElementById('stock-price').textContent = fmtNum(lastC, 2);
    document.getElementById('stock-price').className = chg >= 0 ? 'up' : 'down';
    document.getElementById('stock-change').innerHTML = `<span class="${chg >= 0 ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>`;
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

    // Show last ~60 trading days for better default view, user can scroll/zoom
    const showDays = Math.min(60, dates.length);
    const visFrom = dates[dates.length - showDays];
    const visTo = dates[dates.length - 1];

    function fitAllCharts() {
      [chtMain, chtRsi, chtKd, chtMacd].forEach(c => {
        if (!c) return;
        try {
          c.timeScale().setVisibleRange({ from: visFrom, to: visTo });
        } catch(e) {
          c.timeScale().fitContent();
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
        </div>`;
    } else {
      document.getElementById('stock-inst-info').innerHTML = '<div class="text-muted">無三大法人資料</div>';
    }

    // AI Deep Analysis Report
    document.getElementById('ai-deep-analysis').innerHTML = generateDeepAnalysis(code, stockName, C, H, L, V, O, dates, instInfo);

    document.getElementById('analysis-loading').style.display = 'none';
    document.getElementById('analysis-content').style.display = 'block';

    // Start real-time updates + intraday chart
    startRealtimeUpdates(code);

    // Resize all charts
    setTimeout(() => {
      [chtMain, chtRsi, chtKd, chtMacd, chtIntraday].forEach(c => {
        if (c && c.chartElement) {
          try { c.applyOptions({ width: c.chartElement().parentElement.clientWidth }); } catch(e) {}
        }
      });
    }, 200);

  } catch (e) {
    document.getElementById('analysis-loading').innerHTML =
      `<div class="card"><div class="empty-state"><div class="icon">&#x26A0;</div><p>載入失敗：${e.message}<br><span class="text-sm text-muted">可能是網路問題或證交所限制，請稍後再試</span></p></div></div>`;
  }
}

function goAnalyze(code) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="analysis"]').classList.add('active');
  document.getElementById('panel-analysis').classList.add('active');
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
  if (gChartsReady) {
    [chtMain, chtRsi, chtKd, chtMacd, chtIntraday].forEach(c => {
      if (c && c.chartElement) {
        try { c.applyOptions({ width: c.chartElement().parentElement.clientWidth }); } catch(e) {}
      }
    });
  }
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 150));

// ============================================================
// APP INIT
// ============================================================
async function init() {
  setStatus('loading', '正在連線至證交所...');

  try {
    gDate = await findTradingDate();
    setStatus('loading', '載入市場資料（上市+上櫃）...');

    // Fetch only essential data in parallel (dayTrade deferred to tab click)
    const results = await Promise.allSettled([
      API_TWSE.instSummary(gDate),
      API_TWSE.instStocks(gDate),
      API_TWSE.allStocks(gDate),
      API_TPEX.allStocks(gDate),
      API_TPEX.instStocks(gDate),
    ]);

    const instSummary  = results[0].status === 'fulfilled' ? results[0].value : null;
    const instStocks   = results[1].status === 'fulfilled' ? results[1].value : null;
    const allStocks    = results[2].status === 'fulfilled' ? results[2].value : null;
    const tpexAll      = results[3].status === 'fulfilled' ? results[3].value : null;
    const tpexInst     = results[4].status === 'fulfilled' ? results[4].value : null;

    if (allStocks && allStocks.stat === 'OK' && allStocks.data) gAllStocks = allStocks.data;
    if (instStocks && instStocks.stat === 'OK' && instStocks.data) gInstStocks = instStocks.data;

    // TPEx data parsing
    if (tpexAll && tpexAll.tables && tpexAll.tables[0] && tpexAll.tables[0].data) {
      gTpexAllStocks = tpexAll.tables[0].data;
    } else if (tpexAll && tpexAll.aaData) {
      gTpexAllStocks = tpexAll.aaData;
    }

    if (tpexInst && tpexInst.tables && tpexInst.tables[0] && tpexInst.tables[0].data) {
      gTpexInstStocks = tpexInst.tables[0].data;
    } else if (tpexInst && tpexInst.aaData) {
      gTpexInstStocks = tpexInst.aaData;
    }

    // Build search database
    buildStockDB();

    // Render overview first (shown to user immediately)
    renderOverview();
    if (instSummary) renderInstSummary(instSummary);

    const stockCount = Object.keys(gStockDB).length;
    setStatus('', `已連線 (${gDate.slice(0,4)}/${gDate.slice(4,6)}/${gDate.slice(6,8)}) — ${stockCount} 檔股票`);

    // Render secondary panels non-blocking (after first paint)
    requestAnimationFrame(() => {
      renderInstRank('foreign');
      renderAIRank();
      renderWatchlist();
    });

  } catch (e) {
    setStatus('error', '連線失敗');
    document.getElementById('market-stats').innerHTML =
      `<div class="empty-state">
        <div class="icon" style="color:var(--red);">&#x26A0;</div>
        <p style="color:var(--red);font-weight:600;">載入失敗</p>
        <p class="text-sm text-muted" style="margin-top:8px;">
          ${e.message}<br><br>
          可能原因：<br>
          1. 證交所/櫃買中心伺服器維護中<br>
          2. 瀏覽器 CORS 限制<br>
          3. 網路連線問題<br><br>
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
      name, mTag,
      fmtNum(close, 2),
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
          const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
          const r = await fetch('/api/proxy?url=' + encodeURIComponent(url));
          if (!r.ok) continue;
          const d = await r.json();
          const meta = d.chart?.result?.[0]?.meta;
          if (!meta) continue;
          const price = meta.regularMarketPrice || 0;
          const prevClose = meta.chartPreviousClose || price;
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

  box.innerHTML = mkTable(['代碼', '名稱', '股價', '漲跌', '漲跌%', '成交量'], rows);
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
  chtIntraday = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight || 220,
    layout: { background: { color: 'transparent' }, textColor: '#6b7a99', fontSize: 11, fontFamily: "'SF Pro Display', -apple-system, sans-serif" },
    grid: { vertLines: { color: 'rgba(0, 240, 255, 0.04)' }, horzLines: { color: 'rgba(0, 240, 255, 0.04)' } },
    timeScale: { borderColor: 'rgba(0, 240, 255, 0.1)', timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderColor: 'rgba(0, 240, 255, 0.1)', autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } },
    crosshair: { mode: 0, vertLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2 }, horzLine: { color: 'rgba(0, 240, 255, 0.3)', style: 2 } },
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
  const suffix = market === 'tpex' ? '.TWO' : '.TW';
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
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) {
        data.push({ time: ts[i], value: closes[i] });
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
  const exCh = market === 'tpex' ? `otc_${code}.tw` : `tse_${code}.tw`;
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${exCh}`;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const r = await fetch(proxyUrl);
    if (!r.ok) return;
    const d = await r.json();
    const info = d.msgArray?.[0];
    if (!info) return;

    const lastPrice = parseFloat(info.z) || parseFloat(info.pz) || 0;
    const prevClose = parseFloat(info.y) || 0;
    const open = parseFloat(info.o) || 0;
    const high = parseFloat(info.h) || 0;
    const low = parseFloat(info.l) || 0;
    const vol = parseInt(info.v) || 0;

    // Update header price
    if (lastPrice > 0 && prevClose > 0) {
      const chg = lastPrice - prevClose;
      const pct = (chg / prevClose * 100);
      document.getElementById('stock-price').textContent = fmtNum(lastPrice, 2);
      document.getElementById('stock-price').className = chg >= 0 ? 'up' : 'down';
      document.getElementById('stock-change').innerHTML =
        `<span class="${chg >= 0 ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>`;
    }

    // Order book
    renderOrderBook(info, prevClose);

    // Realtime info
    document.getElementById('realtime-info').innerHTML =
      `開盤 ${fmtNum(open,2)} | 最高 <span class="up">${fmtNum(high,2)}</span> | 最低 <span class="down">${fmtNum(low,2)}</span> | 量 ${fmtNum(vol,0)} 張 | ${info.t || ''}`;

  } catch (e) {
    // silently fail
  }
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
let gDayTradeLoaded = false;
let gDayTradeSuccess = false;

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

async function maybeLoadDayTrade() {
  if (gDayTradeLoaded && gDayTradeSuccess) return;
  gDayTradeLoaded = true;
  gDayTradeSuccess = false;
  document.getElementById('dt-stats').innerHTML = '<div class="loading-box"><div class="spinner"></div><div>載入當沖資料...</div></div>';
  document.getElementById('dt-rank').innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
  try {
    // Build date list: gDate first (known trading date), then recent dates
    const dates = [];
    if (gDate) dates.push(gDate);
    for (let i = 0; i <= 7; i++) {
      const d = dateStr(i);
      if (d !== gDate) dates.push(d);
    }
    let found = false;
    for (const d of dates) {
      try {
        const data = await API_TWSE.dayTrade(d);
        if (renderDayTrade(data)) {
          found = true;
          gDayTradeSuccess = true;
          break;
        }
      } catch(e2) {
        console.warn('dayTrade fetch failed for', d, e2);
      }
    }
    if (!found) {
      document.getElementById('dt-stats').innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">近期無當沖資料（可能為非交易日）</div>';
      document.getElementById('dt-rank').innerHTML = '';
    }
  } catch(e) {
    gDayTradeLoaded = false;
    document.getElementById('dt-stats').innerHTML = '<div class="text-muted" style="padding:20px;text-align:center;">當沖資料載入失敗，點擊分頁重試</div>';
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
    const symbols = TICKER_INDICES.map(i => i.symbol);
    const quotes = await fetchYahooQuotes(symbols);
    if (quotes.length === 0) return;

    const qMap = {};
    quotes.forEach(q => { qMap[q.symbol] = q; });

    let html = '';
    function addItems() {
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

    document.getElementById('ticker-track').innerHTML = html;
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

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (q.length === 0) { searchResults.innerHTML = ''; gsIdx = -1; return; }
  const results = searchStocks(q);
  gsIdx = -1;
  if (results.length === 0) {
    searchResults.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text2);font-size:13px;">找不到符合的股票</div>';
    return;
  }
  searchResults.innerHTML = results.map((r, i) => {
    const mCls = r.market === 'twse' ? 'tag-twse' : 'tag-tpex';
    const mLabel = r.market === 'twse' ? '上市' : '上櫃';
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

function startAutoRefresh() {
  if (gAutoRefreshTimer) return;
  gAutoRefreshTimer = setInterval(async () => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), dow = now.getDay();
    const isTrading = dow >= 1 && dow <= 5 && ((h === 9 && m >= 0) || (h >= 10 && h < 13) || (h === 13 && m <= 30));
    if (!isTrading) return;

    try {
      // Refresh core data
      const results = await Promise.allSettled([
        API_TWSE.allStocks(gDate),
        API_TPEX.allStocks(gDate),
      ]);
      const allStocks = results[0].status === 'fulfilled' ? results[0].value : null;
      const tpexAll = results[1].status === 'fulfilled' ? results[1].value : null;

      if (allStocks && allStocks.stat === 'OK' && allStocks.data) gAllStocks = allStocks.data;
      if (tpexAll && tpexAll.tables && tpexAll.tables[0] && tpexAll.tables[0].data) gTpexAllStocks = tpexAll.tables[0].data;
      else if (tpexAll && tpexAll.aaData) gTpexAllStocks = tpexAll.aaData;

      buildStockDB();

      // Re-render active panel
      const activePanel = document.querySelector('.panel.active');
      if (activePanel) {
        const id = activePanel.id;
        if (id === 'panel-overview') renderOverview();
        else if (id === 'panel-watchlist') renderWatchlist();
      }

      setStatus('', `已連線 (${gDate.slice(0,4)}/${gDate.slice(4,6)}/${gDate.slice(6,8)}) — 上次更新 ${now.toLocaleTimeString('zh-TW')}`);
    } catch(e) {
      // silent fail on auto-refresh
    }
  }, 60000); // every 60 seconds
}

// ============================================================
// AUTH & MEMBER SYSTEM
// ============================================================
let gCurrentUser = null;
let gAuthMode = 'login'; // 'login' or 'register'

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
  renderUserSection();
  toast('已登出');
}

function renderUserSection() {
  const box = document.getElementById('user-section');
  if (gCurrentUser) {
    const initial = (gCurrentUser.name || gCurrentUser.email || '?')[0].toUpperCase();
    const roleLabel = gCurrentUser.role === 'admin' ? 'Admin' : gCurrentUser.role === 'premium' ? 'Premium' : 'Free';
    box.innerHTML = `<div class="user-bar">
      <div class="user-avatar">${initial}</div>
      <div class="user-info">
        <div class="user-name">${gCurrentUser.name || gCurrentUser.email}</div>
        <div class="user-role">${roleLabel}</div>
      </div>
      <button class="user-logout" onclick="logout()">登出</button>
    </div>`;
    // Show admin nav for admins
    if (gCurrentUser.role === 'admin') showAdminNav();
    else hideAdminNav();
  } else {
    box.innerHTML = `<div class="user-bar" style="padding:12px 18px;">
      <button class="login-btn" onclick="openAuthModal()">登入 / 註冊</button>
    </div>`;
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
        ? '<span class="tag" style="background:rgba(180,77,255,0.15);color:var(--purple);border:1px solid rgba(180,77,255,0.3);">Admin</span>'
        : u.role === 'premium'
        ? '<span class="tag" style="background:rgba(255,208,54,0.15);color:var(--yellow);border:1px solid rgba(255,208,54,0.3);">Premium</span>'
        : '<span class="tag" style="background:rgba(0,240,255,0.08);color:var(--text2);border:1px solid var(--border);">Free</span>';
      return [
        u.id,
        u.display_name,
        u.email,
        roleTag,
        u.created_at ? u.created_at.slice(0, 16) : '--',
        u.last_login ? u.last_login.slice(0, 16) : '從未',
        u.login_count || 0
      ];
    });

    document.getElementById('admin-users-list').innerHTML =
      mkTable(['ID', '名稱', 'Email', '角色', '註冊時間', '最後登入', '登入次數'], rows);
  } catch (e) {
    document.getElementById('admin-users-list').innerHTML = '<div class="text-muted">載入失敗</div>';
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

// Load picks for public display on overview
async function loadPublicPicks() {
  try {
    const r = await fetch('/api/picks');
    if (!r.ok) return;
    const data = await r.json();
    if (!data.picks || data.picks.length === 0) return;

    document.getElementById('picks-card').style.display = '';

    const actionMap = { buy: '買進', sell: '賣出', hold: '觀望', short: '放空' };
    const actionTag = {
      buy: '<span class="tag tag-buy">買進</span>',
      sell: '<span class="tag tag-sell">賣出</span>',
      hold: '<span class="tag tag-hold">觀望</span>',
      short: '<span class="tag tag-sell">放空</span>'
    };

    let html = '<div class="stock-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr));">';
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
        <div style="display:flex;gap:12px;font-size:11px;border-top:1px solid var(--border);padding-top:8px;">
          ${p.target_price ? `<span class="text-muted">目標 <span class="up" style="font-weight:600;">${fmtNum(p.target_price, 2)}</span></span>` : ''}
          ${p.stop_loss ? `<span class="text-muted">停損 <span class="down" style="font-weight:600;">${fmtNum(p.stop_loss, 2)}</span></span>` : ''}
          ${p.score ? `<span class="text-muted">信心 <span style="color:${scoreColor};font-weight:700;">${p.score}/10</span></span>` : ''}
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:6px;">${p.created_at ? p.created_at.slice(0, 10) : ''}</div>
      </div>`;
    });
    html += '</div>';
    document.getElementById('picks-container').innerHTML = html;
  } catch (e) { /* silent */ }
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
// BOOT
// ============================================================
init().then(async () => {
  loadTicker();
  setInterval(loadTicker, 5 * 60 * 1000);
  startAutoRefresh();
  await checkAuth();
  loadPublicPicks();
});
