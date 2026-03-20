// ============================================================
// CT Investments — 擴展均線 (MA60, MA120) + 日K/週K/月K 切換
// 此檔案在 app.js 之前載入，定義全域函式供 app.js 呼叫
// ============================================================

// --- MA60 / MA120 系列變數 ---
var sMa60 = null, sMa120 = null;

// 在 initCharts() 完成後由 app.js 呼叫
function initExtendedMAs() {
  if (!chtMain) return;
  var isMobile = window.innerWidth <= 768;
  var maOpts = { lastValueVisible: false, priceLineVisible: false, title: '' };
  sMa60  = chtMain.addLineSeries({ color: '#ff6b6b', lineWidth: isMobile ? 1 : 1.5, ...maOpts });
  sMa120 = chtMain.addLineSeries({ color: '#51cf66', lineWidth: isMobile ? 1 : 1.5, ...maOpts });
}

// 在 analyzeStock() 設完 MA5/10/20 後由 app.js 呼叫
function setExtendedMAData(C, dates, ld) {
  if (!sMa60 || !sMa120) return;
  var ma60  = TA.sma(C, 60);
  var ma120 = TA.sma(C, 120);
  sMa60.setData(ld(ma60));
  sMa120.setData(ld(ma120));

  // 更新 toggle bar 顯示值
  var lastMA = function(arr) {
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null) return arr[i].toFixed(2);
    }
    return '';
  };
  var el60 = document.getElementById('ma60-val');
  var el120 = document.getElementById('ma120-val');
  if (el60) el60.textContent = lastMA(ma60);
  if (el120) el120.textContent = lastMA(ma120);
}

// 擴展 toggleChartSeries 支援 ma60/ma120
var _origToggleChartSeries = null;
function _hookToggleChartSeries() {
  if (_origToggleChartSeries) return;
  if (typeof toggleChartSeries !== 'function') return;
  _origToggleChartSeries = toggleChartSeries;
  toggleChartSeries = function(key) {
    if (key === 'ma60') {
      var cb = document.getElementById('tog-ma60');
      var vis = cb ? cb.checked : true;
      if (sMa60) sMa60.applyOptions({ visible: vis });
      return;
    }
    if (key === 'ma120') {
      var cb = document.getElementById('tog-ma120');
      var vis = cb ? cb.checked : true;
      if (sMa120) sMa120.applyOptions({ visible: vis });
      return;
    }
    _origToggleChartSeries(key);
  };
}

// --- 日K / 週K / 月K 切換 ---
var _klinePeriod = 'daily';

// 將日K資料聚合成週K
function aggregateWeekly(dates, O, H, L, C, V) {
  var wDates = [], wO = [], wH = [], wL = [], wC = [], wV = [];
  var i = 0, n = dates.length;
  while (i < n) {
    var d = new Date(dates[i]);
    var weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay() + 1); // Monday
    var wo = O[i], wh = H[i], wl = L[i], wc = C[i], wv = V[i];
    var lastDate = dates[i];
    i++;
    while (i < n) {
      var d2 = new Date(dates[i]);
      var ws2 = new Date(d2);
      ws2.setDate(d2.getDate() - d2.getDay() + 1);
      if (ws2.getTime() !== weekStart.getTime()) break;
      if (H[i] > wh) wh = H[i];
      if (L[i] < wl) wl = L[i];
      wc = C[i];
      wv += V[i];
      lastDate = dates[i];
      i++;
    }
    wDates.push(lastDate);
    wO.push(wo); wH.push(wh); wL.push(wl); wC.push(wc); wV.push(wv);
  }
  return { dates: wDates, O: wO, H: wH, L: wL, C: wC, V: wV };
}

// 將日K資料聚合成月K
function aggregateMonthly(dates, O, H, L, C, V) {
  var mDates = [], mO = [], mH = [], mL = [], mC = [], mV = [];
  var i = 0, n = dates.length;
  while (i < n) {
    var ym = dates[i].substring(0, 7); // "YYYY-MM"
    var mo = O[i], mh = H[i], ml = L[i], mc = C[i], mv = V[i];
    var lastDate = dates[i];
    i++;
    while (i < n && dates[i].substring(0, 7) === ym) {
      if (H[i] > mh) mh = H[i];
      if (L[i] < ml) ml = L[i];
      mc = C[i];
      mv += V[i];
      lastDate = dates[i];
      i++;
    }
    mDates.push(lastDate);
    mO.push(mo); mH.push(mh); mL.push(ml); mC.push(mc); mV.push(mv);
  }
  return { dates: mDates, O: mO, H: mH, L: mL, C: mC, V: mV };
}

// 重新渲染K線圖（用聚合後的資料）
function _renderKlineData(dates, O, H, L, C, V) {
  if (!sCan || !sVol) return;
  var ld = function(arr) {
    return dates.map(function(d, i) {
      return arr[i] != null ? { time: d, value: arr[i] } : null;
    }).filter(Boolean);
  };

  sCan.setData(dates.map(function(d, i) {
    return { time: d, open: O[i], high: H[i], low: L[i], close: C[i] };
  }));
  sVol.setData(dates.map(function(d, i) {
    return { time: d, value: V[i], color: C[i] >= O[i] ? 'rgba(255,56,96,0.3)' : 'rgba(0,232,123,0.3)' };
  }));

  // 重算均線
  var ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20);
  if (sMa5) sMa5.setData(ld(ma5));
  if (sMa10) sMa10.setData(ld(ma10));
  if (sMa20) sMa20.setData(ld(ma20));

  // 布林通道
  var bb = TA.boll(C);
  if (sBbU) sBbU.setData(ld(bb.up));
  if (sBbL) sBbL.setData(ld(bb.dn));

  // 擴展均線
  if (sMa60) sMa60.setData(ld(TA.sma(C, 60)));
  if (sMa120) sMa120.setData(ld(TA.sma(C, 120)));

  // 指標圖表（RSI, KD, MACD）
  var rsi = TA.rsi(C);
  var macd = TA.macd(C);
  var kd = TA.kd(H != null ? H : C, L != null ? L : C, C);
  if (typeof sRsi !== 'undefined' && sRsi) sRsi.setData(ld(rsi));
  if (typeof sKK !== 'undefined' && sKK) sKK.setData(dates.map(function(d, i) { return { time: d, value: kd.K[i] }; }));
  if (typeof sDD !== 'undefined' && sDD) sDD.setData(dates.map(function(d, i) { return { time: d, value: kd.D[i] }; }));
  if (typeof sDif !== 'undefined' && sDif) sDif.setData(dates.map(function(d, i) { return { time: d, value: macd.dif[i] }; }));
  if (typeof sSig !== 'undefined' && sSig) sSig.setData(dates.map(function(d, i) { return { time: d, value: macd.sig[i] }; }));
  if (typeof sHist !== 'undefined' && sHist) sHist.setData(dates.map(function(d, i) {
    return { time: d, value: macd.hist[i], color: macd.hist[i] >= 0 ? 'rgba(255,56,96,0.5)' : 'rgba(0,232,123,0.5)' };
  }));

  // fit visible range
  if (chtMain) {
    try { chtMain.timeScale().fitContent(); } catch(e) {}
  }
}

// 切換 K 線週期
function switchKlinePeriod(period) {
  var raw = window._klineRawData;
  if (!raw || !raw.dates || raw.dates.length === 0) return;

  _klinePeriod = period;

  // 更新按鈕 active 狀態
  var btns = document.querySelectorAll('.kline-period-btn');
  btns.forEach(function(b) {
    b.classList.toggle('active', b.dataset.period === period);
  });

  if (period === 'weekly') {
    var w = aggregateWeekly(raw.dates, raw.O, raw.H, raw.L, raw.C, raw.V);
    _renderKlineData(w.dates, w.O, w.H, w.L, w.C, w.V);
  } else if (period === 'monthly') {
    var m = aggregateMonthly(raw.dates, raw.O, raw.H, raw.L, raw.C, raw.V);
    _renderKlineData(m.dates, m.O, m.H, m.L, m.C, m.V);
  } else {
    // daily — restore original
    _renderKlineData(raw.dates, raw.O, raw.H, raw.L, raw.C, raw.V);
  }
}

// 在 app.js 載入後 hook toggleChartSeries
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _hookToggleChartSeries);
} else {
  setTimeout(_hookToggleChartSeries, 0);
}
