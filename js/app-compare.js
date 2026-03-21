// ============================================================
// STOCK COMPARISON MODULE (app-compare.js)
// ============================================================
var chtCompare = null;
var chtCompVol = null;
var gComparePeriod = 'Y1';

// ------------------------------------------------------------
// Data fetching — use server cache, fallback to Yahoo
// ------------------------------------------------------------
async function fetchCompareData(code) {
  // 1. Try server-side cache
  try {
    var resp = await fetch('/api/stock-history?code=' + encodeURIComponent(code));
    if (resp.ok) {
      var json = await resp.json();
      if (json.data && json.data.length >= 30) {
        return {
          code: code,
          name: (typeof gStockDB !== 'undefined' && gStockDB[code]) ? gStockDB[code].name : code,
          dates: json.data.map(function(r) { return r.date; }),
          opens: json.data.map(function(r) { return r.open; }),
          highs: json.data.map(function(r) { return r.high; }),
          lows: json.data.map(function(r) { return r.low; }),
          closes: json.data.map(function(r) { return r.close; }),
          volumes: json.data.map(function(r) { return r.volume; })
        };
      }
    }
  } catch(e) { /* fallback */ }

  // 2. Fallback: fetchYahooHistory → rawRows transform
  if (typeof fetchYahooHistory === 'function') {
    try {
      var result = await fetchYahooHistory(code);
      if (result && result.rawRows && result.rawRows.length >= 30) {
        var dates = [], opens = [], highs = [], lows = [], closes = [], volumes = [];
        result.rawRows.forEach(function(row) {
          var parts = row[0].split('/');
          var y = parseInt(parts[0]) + 1911;
          dates.push(y + '-' + parts[1] + '-' + parts[2]);
          opens.push(parseFloat(row[3]) || 0);
          highs.push(parseFloat(row[4]) || 0);
          lows.push(parseFloat(row[5]) || 0);
          closes.push(parseFloat(row[6]) || 0);
          volumes.push(parseInt(row[1]) || 0);
        });
        return {
          code: code,
          name: result.stockName || code,
          dates: dates, opens: opens, highs: highs,
          lows: lows, closes: closes, volumes: volumes
        };
      }
    } catch(e) { /* give up */ }
  }
  return null;
}

// ------------------------------------------------------------
// Period filter helper — trim arrays to last N trading days
// ------------------------------------------------------------
function filterByPeriod(data, period) {
  var map = { M1: 22, M3: 66, M6: 132, Y1: 252 };
  var days = map[period] || 252;
  if (data.dates.length <= days) return data;
  var start = data.dates.length - days;
  return {
    code: data.code, name: data.name,
    dates: data.dates.slice(start),
    opens: data.opens.slice(start),
    highs: data.highs.slice(start),
    lows: data.lows.slice(start),
    closes: data.closes.slice(start),
    volumes: data.volumes.slice(start)
  };
}

// ------------------------------------------------------------
// Date alignment — only keep shared trading dates
// ------------------------------------------------------------
function alignDates(datasets) {
  // Find date intersection
  var sets = datasets.map(function(d) {
    var s = {};
    d.dates.forEach(function(dt) { s[dt] = true; });
    return s;
  });
  var common = {};
  datasets[0].dates.forEach(function(dt) {
    var all = true;
    for (var i = 1; i < sets.length; i++) {
      if (!sets[i][dt]) { all = false; break; }
    }
    if (all) common[dt] = true;
  });

  return datasets.map(function(d) {
    var idx = [];
    d.dates.forEach(function(dt, i) { if (common[dt]) idx.push(i); });
    return {
      code: d.code, name: d.name,
      dates: idx.map(function(i) { return d.dates[i]; }),
      opens: idx.map(function(i) { return d.opens[i]; }),
      highs: idx.map(function(i) { return d.highs[i]; }),
      lows: idx.map(function(i) { return d.lows[i]; }),
      closes: idx.map(function(i) { return d.closes[i]; }),
      volumes: idx.map(function(i) { return d.volumes[i]; })
    };
  });
}

// ------------------------------------------------------------
// Autocomplete for compare inputs
// ------------------------------------------------------------
function attachCompareAC(inputEl) {
  var wrap = inputEl.parentElement;
  var dropdown = document.createElement('div');
  dropdown.className = 'cmp-ac-dropdown';
  wrap.appendChild(dropdown);
  var debounce = null;

  inputEl.addEventListener('input', function() {
    clearTimeout(debounce);
    var q = inputEl.value.trim();
    if (q.length === 0 || typeof searchStocks !== 'function') {
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
      return;
    }
    debounce = setTimeout(function() {
      var results = searchStocks(q);
      if (results.length === 0) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
      var html = '';
      results.slice(0, 8).forEach(function(r) {
        html += '<div class="cmp-ac-item" data-code="' + r.code + '">' + r.code + ' ' + r.name + '</div>';
      });
      dropdown.innerHTML = html;
      dropdown.style.display = '';
      dropdown.querySelectorAll('.cmp-ac-item').forEach(function(el) {
        el.addEventListener('mousedown', function(e) {
          e.preventDefault();
          inputEl.value = el.dataset.code;
          dropdown.innerHTML = '';
          dropdown.style.display = 'none';
        });
      });
    }, 120);
  });

  inputEl.addEventListener('blur', function() {
    setTimeout(function() { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }, 200);
  });
}

// ------------------------------------------------------------
// Init compare tab
// ------------------------------------------------------------
function initCompareTab() {
  // Pro gating
  var proInputs = document.querySelectorAll('.cmp-pro-input');
  proInputs.forEach(function(inp) {
    if (typeof userCanAccess === 'function' && !userCanAccess('compare_5')) {
      inp.disabled = true;
      inp.placeholder = 'Pro 限定';
      inp.style.opacity = '0.4';
    } else {
      inp.disabled = false;
      inp.placeholder = '代號' + inp.id.split('-')[1];
      inp.style.opacity = '';
    }
  });

  // Attach autocomplete (only once)
  for (var i = 1; i <= 5; i++) {
    var inp = document.getElementById('cmp-' + i);
    if (inp && !inp._acAttached) {
      attachCompareAC(inp);
      inp._acAttached = true;
    }
  }

  // Period buttons
  var btns = document.querySelectorAll('.cmp-period-btn');
  btns.forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.period === gComparePeriod);
  });
}

function setComparePeriod(period) {
  gComparePeriod = period;
  document.querySelectorAll('.cmp-period-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  // Re-run if we have data
  var hasInput = document.getElementById('cmp-1') && document.getElementById('cmp-1').value.trim();
  var hasInput2 = document.getElementById('cmp-2') && document.getElementById('cmp-2').value.trim();
  if (hasInput && hasInput2) runCompare();
}

// ------------------------------------------------------------
// Main compare logic
// ------------------------------------------------------------
async function runCompare() {
  var codes = [];
  for (var i = 1; i <= 5; i++) {
    var val = (document.getElementById('cmp-' + i).value || '').trim();
    if (val) codes.push(val.split(' ')[0]);
  }
  if (codes.length < 2) { if (typeof toast === 'function') toast('請至少輸入 2 檔股票'); return; }
  var maxCodes = (typeof userCanAccess === 'function' && userCanAccess('compare_5')) ? 5 : 2;
  if (codes.length > maxCodes) {
    if (typeof showUpgradeModal === 'function') showUpgradeModal('pro');
    return;
  }

  document.getElementById('compare-loading').style.display = '';
  document.getElementById('compare-chart-card').style.display = 'none';
  document.getElementById('compare-vol-card').style.display = 'none';
  document.getElementById('compare-table-card').style.display = 'none';

  try {
    // Fetch all stocks in parallel
    var promises = codes.map(function(code) { return fetchCompareData(code); });
    var results = await Promise.all(promises);

    // Also fetch MIS for current prices
    if (typeof fetchMisBatch === 'function') await fetchMisBatch(codes);

    var valid = results.filter(function(r) { return r && r.closes && r.closes.length > 0; });
    if (valid.length < 2) {
      if (typeof toast === 'function') toast('無法取得足夠的股票資料');
      document.getElementById('compare-loading').style.display = 'none';
      return;
    }

    // Period filter
    valid = valid.map(function(d) { return filterByPeriod(d, gComparePeriod); });

    // Date alignment
    valid = alignDates(valid);
    if (valid[0].dates.length < 5) {
      if (typeof toast === 'function') toast('共同交易日不足，無法比較');
      document.getElementById('compare-loading').style.display = 'none';
      return;
    }

    renderCompareChart(valid);
    renderCompareVolChart(valid);
    renderCompareTable(valid, codes);

    document.getElementById('compare-loading').style.display = 'none';
  } catch(e) {
    document.getElementById('compare-loading').style.display = 'none';
    if (typeof toast === 'function') toast('比較失敗：' + e.message);
  }
}

// ------------------------------------------------------------
// Normalized price chart (% from first day)
// ------------------------------------------------------------
var CMP_COLORS = ['#00f0ff', '#b44dff', '#ff3860', '#00e87b', '#ffd036'];

function renderCompareChart(datasets) {
  var el = document.getElementById('compare-chart');
  if (!el) return;
  el.innerHTML = '';
  if (chtCompare) { chtCompare.remove(); chtCompare = null; }

  var isMobile = window.innerWidth <= 768;
  chtCompare = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: isMobile ? 250 : 320,
    devicePixelRatio: window.devicePixelRatio || 1,
    layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: isMobile ? 10 : 11 },
    grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: { mode: isMobile ? 1 : 0 },
  });

  // Legend
  var legendHtml = '';
  datasets.forEach(function(d, idx) {
    var color = CMP_COLORS[idx % CMP_COLORS.length];
    legendHtml += '<span class="cmp-legend-item"><span class="cmp-legend-dot" style="background:' + color + '"></span>' + d.code + ' ' + d.name + '</span>';
  });
  document.getElementById('compare-legend').innerHTML = legendHtml;

  datasets.forEach(function(d, idx) {
    var base = d.closes[0];
    if (!base || base <= 0) return;
    var series = chtCompare.addLineSeries({
      color: CMP_COLORS[idx % CMP_COLORS.length],
      lineWidth: 2,
      title: d.code,
      priceFormat: { type: 'custom', formatter: function(p) { return p.toFixed(2) + '%'; } }
    });
    var lineData = [];
    for (var j = 0; j < d.closes.length; j++) {
      if (d.dates[j]) lineData.push({ time: d.dates[j], value: ((d.closes[j] - base) / base * 100) });
    }
    series.setData(lineData);
  });
  chtCompare.timeScale().fitContent();
  document.getElementById('compare-chart-card').style.display = '';
}

// ------------------------------------------------------------
// Volume comparison chart
// ------------------------------------------------------------
function renderCompareVolChart(datasets) {
  var el = document.getElementById('compare-vol-chart');
  if (!el) return;
  el.innerHTML = '';
  if (chtCompVol) { chtCompVol.remove(); chtCompVol = null; }

  var isMobile = window.innerWidth <= 768;
  chtCompVol = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: isMobile ? 120 : 150,
    devicePixelRatio: window.devicePixelRatio || 1,
    layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: isMobile ? 10 : 11 },
    grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: { mode: isMobile ? 1 : 0 },
  });

  datasets.forEach(function(d, idx) {
    // Normalize volume to percentage of max for this stock
    var maxV = Math.max.apply(null, d.volumes.filter(function(v) { return v > 0; })) || 1;
    var series = chtCompVol.addLineSeries({
      color: CMP_COLORS[idx % CMP_COLORS.length],
      lineWidth: 1.5,
      title: d.code,
      priceFormat: { type: 'custom', formatter: function(p) { return p.toFixed(0) + '%'; } }
    });
    var lineData = [];
    for (var j = 0; j < d.volumes.length; j++) {
      if (d.dates[j]) lineData.push({ time: d.dates[j], value: (d.volumes[j] / maxV * 100) });
    }
    series.setData(lineData);
  });
  chtCompVol.timeScale().fitContent();
  document.getElementById('compare-vol-card').style.display = '';
}

// ------------------------------------------------------------
// Metrics table (15 rows, highlight best)
// ------------------------------------------------------------
function renderCompareTable(datasets, codes) {
  var headers = ['指標'];
  datasets.forEach(function(d) { headers.push(d.code + ' ' + d.name); });

  // Compute TA for each stock
  var taData = datasets.map(function(d) {
    var n = d.closes.length - 1;
    var C = d.closes, H = d.highs, L = d.lows, V = d.volumes;
    var mis = (typeof gMisCache !== 'undefined') ? gMisCache[d.code] : null;

    var sma5 = (typeof TA !== 'undefined') ? TA.sma(C, 5) : [];
    var sma20 = (typeof TA !== 'undefined') ? TA.sma(C, 20) : [];
    var sma60 = (typeof TA !== 'undefined') ? TA.sma(C, 60) : [];
    var rsi = (typeof TA !== 'undefined') ? TA.rsi(C) : [];
    var kd = (typeof TA !== 'undefined') ? TA.kd(H, L, C) : { K: [], D: [] };

    var price = mis ? mis.price : C[n];
    var pct = mis ? mis.pct : (C[n] && C[n-1] ? ((C[n]-C[n-1])/C[n-1]*100) : 0);

    // Period returns
    var ret1w = n >= 5 ? ((C[n] - C[n-5]) / C[n-5] * 100) : null;
    var ret1m = n >= 22 ? ((C[n] - C[n-22]) / C[n-22] * 100) : null;
    var ret3m = n >= 66 ? ((C[n] - C[n-66]) / C[n-66] * 100) : null;

    // Volume
    var vol5 = 0;
    for (var i = Math.max(0, n-4); i <= n; i++) vol5 += V[i];
    vol5 = vol5 / Math.min(5, n+1);
    var volRatio = vol5 > 0 ? (V[n] / vol5) : 0;

    // Bollinger position
    var bb = (typeof TA !== 'undefined' && TA.bb) ? TA.bb(C) : null;
    var bbPos = null;
    if (bb && bb.upper[n] && bb.lower[n] && bb.upper[n] !== bb.lower[n]) {
      bbPos = ((C[n] - bb.lower[n]) / (bb.upper[n] - bb.lower[n]) * 100);
    }

    return {
      price: price, pct: pct,
      ret1w: ret1w, ret1m: ret1m, ret3m: ret3m,
      sma5: sma5[n], sma20: sma20[n], sma60: sma60[n],
      rsi: rsi[n], K: kd.K[n], D: kd.D[n],
      vol: V[n], vol5: vol5, volRatio: volRatio,
      bbPos: bbPos
    };
  });

  var fmtN = (typeof fmtNum === 'function') ? fmtNum : function(v, d) { return v != null ? v.toFixed(d || 2) : '--'; };

  // Define metric rows
  var metrics = [
    { label: '現價', key: 'price', fmt: function(v) { return fmtN(v, 2); }, best: 'none' },
    { label: '漲跌%', key: 'pct', fmt: function(v) { return pctHtml(v); }, best: 'max' },
    { label: '1週漲跌%', key: 'ret1w', fmt: function(v) { return pctHtml(v); }, best: 'max' },
    { label: '1月漲跌%', key: 'ret1m', fmt: function(v) { return pctHtml(v); }, best: 'max' },
    { label: '3月漲跌%', key: 'ret3m', fmt: function(v) { return pctHtml(v); }, best: 'max' },
    { label: 'MA5', key: 'sma5', fmt: function(v) { return v != null ? fmtN(v, 2) : '--'; }, best: 'none' },
    { label: 'MA20', key: 'sma20', fmt: function(v) { return v != null ? fmtN(v, 2) : '--'; }, best: 'none' },
    { label: 'MA60', key: 'sma60', fmt: function(v) { return v != null ? fmtN(v, 2) : '--'; }, best: 'none' },
    { label: 'RSI(14)', key: 'rsi', fmt: function(v) { return v != null ? v.toFixed(1) : '--'; }, best: 'none' },
    { label: 'K值', key: 'K', fmt: function(v) { return v != null ? v.toFixed(1) : '--'; }, best: 'none' },
    { label: 'D值', key: 'D', fmt: function(v) { return v != null ? v.toFixed(1) : '--'; }, best: 'none' },
    { label: '成交量(張)', key: 'vol', fmt: function(v) { return v != null ? Math.round(v / 1000).toLocaleString() : '--'; }, best: 'max' },
    { label: '5日均量', key: 'vol5', fmt: function(v) { return v != null ? Math.round(v / 1000).toLocaleString() : '--'; }, best: 'none' },
    { label: '量比', key: 'volRatio', fmt: function(v) { return v != null ? v.toFixed(2) + 'x' : '--'; }, best: 'none' },
    { label: '布林位置%', key: 'bbPos', fmt: function(v) { return v != null ? v.toFixed(1) + '%' : '--'; }, best: 'none' }
  ];

  var rows = [];
  metrics.forEach(function(m) {
    var row = [m.label];
    var vals = taData.map(function(t) { return t[m.key]; });

    // Find best index
    var bestIdx = -1;
    if (m.best === 'max') {
      var maxVal = -Infinity;
      vals.forEach(function(v, i) { if (v != null && v > maxVal) { maxVal = v; bestIdx = i; } });
    }

    taData.forEach(function(t, idx) {
      var html = m.fmt(t[m.key]);
      if (bestIdx === idx) html = '<strong>' + html + '</strong>';
      row.push(html);
    });
    rows.push(row);
  });

  if (typeof mkTable === 'function') {
    document.getElementById('compare-table').innerHTML = mkTable(headers, rows);
  }
  document.getElementById('compare-table-card').style.display = '';
}

function pctHtml(v) {
  if (v == null) return '--';
  var cls = v >= 0 ? 'up' : 'down';
  return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(2) + '%</span>';
}

// ------------------------------------------------------------
// Quick compare entry point from stock analysis
// ------------------------------------------------------------
function quickCompare(code) {
  var inp = document.getElementById('cmp-1');
  if (inp) inp.value = code;
  if (typeof switchTab === 'function') switchTab('compare');
}

// ------------------------------------------------------------
// Window resize handler for charts
// ------------------------------------------------------------
window.addEventListener('resize', function() {
  if (chtCompare) {
    var el = document.getElementById('compare-chart');
    if (el) chtCompare.applyOptions({ width: el.clientWidth });
  }
  if (chtCompVol) {
    var el = document.getElementById('compare-vol-chart');
    if (el) chtCompVol.applyOptions({ width: el.clientWidth });
  }
});
