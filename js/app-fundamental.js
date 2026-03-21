// ============================================================
// CT Investments — Fundamental Analysis Charts
// app-fundamental.js
// ============================================================

// ============================================================
// 1A: P/E River Chart (本益比河流圖)
// ============================================================
async function renderPERiverChart(code) {
  const container = document.getElementById('stock-pe-river');
  if (!container) return;
  container.innerHTML = '<div class="card"><div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div><div class="loading-box"><div class="spinner"></div><div>\u8F09\u5165\u4E2D...</div></div></div>';

  try {
    // Fetch quarterly financial data (EPS) and daily price history in parallel
    const now = new Date();
    const startDate = new Date(now.getFullYear() - 5, 0, 1);
    const startStr = startDate.getFullYear() + '-01-01';
    const finUrl = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=' + code + '&start_date=' + startStr;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(finUrl);

    const [finResp, histResp] = await Promise.all([
      fetch(proxyUrl),
      fetch('/api/stock-history?code=' + encodeURIComponent(code))
    ]);

    if (!finResp.ok || !histResp.ok) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div><div class="text-muted">\u8CC7\u6599\u8F09\u5165\u5931\u6557</div></div>';
      return;
    }

    const finJson = await finResp.json();
    const histJson = await histResp.json();
    const finRows = finJson.data || [];
    const priceData = histJson.data || [];

    if (finRows.length === 0 || priceData.length < 30) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div><div class="text-muted">\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u7121\u6CD5\u7E6A\u88FD\u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div></div>';
      return;
    }

    // Group financial data by quarter, extract EPS
    var byQuarter = {};
    finRows.forEach(function(r) {
      var dt = r.date || '';
      var type = r.type || '';
      var val = parseFloat(r.value) || 0;
      if (!dt) return;
      if (!byQuarter[dt]) byQuarter[dt] = {};
      if (type === 'EPS') byQuarter[dt].eps = val;
    });

    // Sort quarters and compute trailing 4Q EPS
    var quarters = Object.keys(byQuarter).sort();
    var trailingEps = [];
    for (var qi = 0; qi < quarters.length; qi++) {
      var q = quarters[qi];
      if (byQuarter[q].eps === undefined) continue;
      // Collect last 4 quarters of EPS (including this one)
      var sum = 0;
      var count = 0;
      for (var j = qi; j >= Math.max(0, qi - 3); j--) {
        var qj = quarters[j];
        if (byQuarter[qj].eps !== undefined) {
          sum += byQuarter[qj].eps;
          count++;
        }
      }
      if (count >= 4) {
        trailingEps.push({ date: q, eps: sum });
      }
    }

    if (trailingEps.length < 2) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div><div class="text-muted">\u5B63\u5EA6\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u9700\u81F3\u5C11 4 \u5B63 EPS</div></div>';
      return;
    }

    // Build P/E band data for each price date
    // For each day, find the most recent trailing EPS
    var multiples = [10, 15, 20, 25, 30];
    var bandColors = [
      'rgba(0, 200, 83, 0.25)',   // 10x - green (cheap)
      'rgba(0, 200, 150, 0.20)',  // 15x
      'rgba(255, 208, 54, 0.20)', // 20x
      'rgba(255, 140, 0, 0.18)',  // 25x
      'rgba(255, 56, 96, 0.20)',  // 30x - red (expensive)
    ];
    var bandLineColors = [
      'rgba(0, 200, 83, 0.6)',
      'rgba(0, 200, 150, 0.5)',
      'rgba(255, 208, 54, 0.5)',
      'rgba(255, 140, 0, 0.5)',
      'rgba(255, 56, 96, 0.6)',
    ];

    // Build a lookup: sorted trailing EPS by date
    var epsLookup = trailingEps.map(function(e) { return { date: e.date, eps: e.eps }; });

    function getTrailingEpsForDate(dateStr) {
      // Find the most recent trailing EPS on or before dateStr
      var result = null;
      for (var i = 0; i < epsLookup.length; i++) {
        if (epsLookup[i].date <= dateStr) result = epsLookup[i].eps;
        else break;
      }
      return result;
    }

    // Filter price data to valid range (where we have trailing EPS)
    var firstEpsDate = epsLookup[0].date;
    var filteredPrices = priceData.filter(function(p) { return p.date >= firstEpsDate; });

    if (filteredPrices.length < 10) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div><div class="text-muted">\u50F9\u683C\u8CC7\u6599\u4E0D\u8DB3</div></div>';
      return;
    }

    // Calculate current P/E
    var latestPrice = filteredPrices[filteredPrices.length - 1];
    var latestEps = getTrailingEpsForDate(latestPrice.date);
    var currentPE = (latestEps && latestEps > 0) ? (latestPrice.close / latestEps) : null;

    // Determine P/E position label
    var peLabel = '\u7121\u6CD5\u8A08\u7B97';
    var peLabelColor = 'var(--text2)';
    if (currentPE !== null) {
      if (currentPE < 10) { peLabel = '\u4FBF\u5B9C\u5340 (<10x)'; peLabelColor = 'var(--green)'; }
      else if (currentPE < 15) { peLabel = '\u4F4E\u4F30\u5340 (10-15x)'; peLabelColor = '#00c853'; }
      else if (currentPE < 20) { peLabel = '\u5408\u7406\u5340 (15-20x)'; peLabelColor = 'var(--yellow)'; }
      else if (currentPE < 25) { peLabel = '\u504F\u9AD8\u5340 (20-25x)'; peLabelColor = '#ff8c00'; }
      else if (currentPE < 30) { peLabel = '\u6602\u8CB4\u5340 (25-30x)'; peLabelColor = 'var(--red)'; }
      else { peLabel = '\u904E\u71B1\u5340 (>30x)'; peLabelColor = '#ff1744'; }
    }

    // Build HTML
    container.innerHTML = '<div class="card">' +
      '<div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div>' +
      '<div class="text-sm text-muted mb-12">\u4EE5\u8FD1\u56DB\u5B63 EPS \u8A08\u7B97\u4E0D\u540C\u672C\u76CA\u6BD4\u5009\u4F4D\u7684\u50F9\u683C\u5E36</div>' +
      '<div class="pe-river-legend">' +
        '<div class="pe-river-legend-item">' +
          '<span class="pe-river-current-label">\u76EE\u524D P/E\uFF1A' +
            '<strong style="color:' + peLabelColor + '">' + (currentPE !== null ? currentPE.toFixed(1) + 'x' : 'N/A') + '</strong>' +
            ' \u2014 ' + peLabel +
          '</span>' +
        '</div>' +
        '<div class="pe-river-bands">' +
          '<span class="pe-band-tag" style="background:rgba(0,200,83,0.3);color:#00c853;">10x</span>' +
          '<span class="pe-band-tag" style="background:rgba(0,200,150,0.3);color:#00c896;">15x</span>' +
          '<span class="pe-band-tag" style="background:rgba(255,208,54,0.3);color:#ffd036;">20x</span>' +
          '<span class="pe-band-tag" style="background:rgba(255,140,0,0.3);color:#ff8c00;">25x</span>' +
          '<span class="pe-band-tag" style="background:rgba(255,56,96,0.3);color:#ff3860;">30x</span>' +
        '</div>' +
      '</div>' +
      '<div id="pe-river-chart-box" style="height:320px;"></div>' +
    '</div>';

    var chartBox = document.getElementById('pe-river-chart-box');
    if (!chartBox || chartBox.clientWidth === 0) return;

    var chart = LightweightCharts.createChart(chartBox, {
      width: chartBox.clientWidth,
      height: 320,
      layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
      timeScale: { borderColor: 'rgba(0,240,255,0.1)' },
      rightPriceScale: { borderColor: 'rgba(0,240,255,0.1)', scaleMargins: { top: 0.05, bottom: 0.05 } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    // Add band lines (from highest to lowest for proper layering)
    var bandSeries = [];
    for (var bi = multiples.length - 1; bi >= 0; bi--) {
      var mult = multiples[bi];
      var lineData = [];
      for (var pi = 0; pi < filteredPrices.length; pi++) {
        var p = filteredPrices[pi];
        var eps = getTrailingEpsForDate(p.date);
        if (eps !== null && eps > 0) {
          lineData.push({ time: p.date, value: eps * mult });
        }
      }
      if (lineData.length > 0) {
        var series = chart.addLineSeries({
          color: bandLineColors[bi],
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        series.setData(lineData);
        bandSeries.push(series);
      }
    }

    // Add actual price line (prominent)
    var priceLineData = filteredPrices.map(function(p) {
      return { time: p.date, value: p.close };
    });
    var priceSeries = chart.addLineSeries({
      color: '#00f0ff',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    priceSeries.setData(priceLineData);

    chart.timeScale().fitContent();

    // Responsive resize
    var resizeObserver = new ResizeObserver(function() {
      if (chartBox.clientWidth > 0) {
        chart.applyOptions({ width: chartBox.clientWidth });
      }
    });
    resizeObserver.observe(chartBox);

  } catch (e) {
    console.warn('[CT] PE River chart error:', e);
    container.innerHTML = '<div class="card"><div class="card-title">\u{1F30A} \u672C\u76CA\u6BD4\u6CB3\u6D41\u5716</div><div class="text-muted">\u672C\u76CA\u6BD4\u6CB3\u6D41\u5716\u8F09\u5165\u5931\u6557</div></div>';
  }
}


// ============================================================
// 1B: Profit Margin Trend Chart (利潤率趨勢圖)
// ============================================================
async function renderMarginTrendChart(code) {
  var container = document.getElementById('stock-margin-trend');
  if (!container) return;
  container.innerHTML = '<div class="card"><div class="card-title">\u{1F4C8} \u5229\u6F64\u7387\u8DA8\u52E2\u5716</div><div class="loading-box"><div class="spinner"></div><div>\u8F09\u5165\u4E2D...</div></div></div>';

  try {
    var now = new Date();
    var startDate = new Date(now.getFullYear() - 3, 0, 1);
    var startStr = startDate.getFullYear() + '-01-01';
    var finUrl = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=' + code + '&start_date=' + startStr;
    var proxyUrl = '/api/proxy?url=' + encodeURIComponent(finUrl);

    var resp = await fetch(proxyUrl);
    if (!resp.ok) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F4C8} \u5229\u6F64\u7387\u8DA8\u52E2\u5716</div><div class="text-muted">\u8CC7\u6599\u8F09\u5165\u5931\u6557</div></div>';
      return;
    }

    var json = await resp.json();
    var rows = json.data || [];
    if (rows.length === 0) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F4C8} \u5229\u6F64\u7387\u8DA8\u52E2\u5716</div><div class="text-muted">\u7121\u8CA1\u52D9\u8CC7\u6599</div></div>';
      return;
    }

    // Group by quarter
    var byQuarter = {};
    rows.forEach(function(r) {
      var dt = r.date || '';
      var type = r.type || '';
      var val = parseFloat(r.value) || 0;
      if (!dt) return;
      if (!byQuarter[dt]) byQuarter[dt] = {};
      if (type === 'Revenue') byQuarter[dt].revenue = val;
      else if (type === 'GrossProfit') byQuarter[dt].grossProfit = val;
      else if (type === 'OperatingIncome') byQuarter[dt].opIncome = val;
      else if (type === 'NetIncome' || type === 'IncomeAfterTaxes') byQuarter[dt].netIncome = val;
    });

    var quarters = Object.keys(byQuarter).sort();
    // Take last 12 quarters max
    if (quarters.length > 12) quarters = quarters.slice(quarters.length - 12);

    var grossMarginData = [];
    var opMarginData = [];
    var netMarginData = [];

    quarters.forEach(function(q) {
      var d = byQuarter[q];
      var rev = d.revenue || 0;
      if (rev <= 0) return;
      if (d.grossProfit !== undefined) {
        grossMarginData.push({ time: q, value: (d.grossProfit / rev * 100) });
      }
      if (d.opIncome !== undefined) {
        opMarginData.push({ time: q, value: (d.opIncome / rev * 100) });
      }
      if (d.netIncome !== undefined) {
        netMarginData.push({ time: q, value: (d.netIncome / rev * 100) });
      }
    });

    if (grossMarginData.length < 2 && opMarginData.length < 2 && netMarginData.length < 2) {
      container.innerHTML = '<div class="card"><div class="card-title">\u{1F4C8} \u5229\u6F64\u7387\u8DA8\u52E2\u5716</div><div class="text-muted">\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u7121\u6CD5\u7E6A\u88FD</div></div>';
      return;
    }

    // Latest values for legend
    var latestGross = grossMarginData.length > 0 ? grossMarginData[grossMarginData.length - 1].value : null;
    var latestOp = opMarginData.length > 0 ? opMarginData[opMarginData.length - 1].value : null;
    var latestNet = netMarginData.length > 0 ? netMarginData[netMarginData.length - 1].value : null;

    container.innerHTML = '<div class="card">' +
      '<div class="card-title">\u{1F4C8} \u5229\u6F64\u7387\u8DA8\u52E2\u5716</div>' +
      '<div class="text-sm text-muted mb-12">\u8FD1 ' + quarters.length + ' \u5B63\u5229\u6F64\u7387\u8B8A\u5316\u8DA8\u52E2</div>' +
      '<div class="margin-trend-legend">' +
        (latestGross !== null ? '<span class="margin-legend-item"><span class="legend-dot" style="background:#00e87b;"></span>\u6BDB\u5229\u7387 ' + latestGross.toFixed(1) + '%</span>' : '') +
        (latestOp !== null ? '<span class="margin-legend-item"><span class="legend-dot" style="background:#00b4d8;"></span>\u71DF\u76CA\u7387 ' + latestOp.toFixed(1) + '%</span>' : '') +
        (latestNet !== null ? '<span class="margin-legend-item"><span class="legend-dot" style="background:#ffd036;"></span>\u6DE8\u5229\u7387 ' + latestNet.toFixed(1) + '%</span>' : '') +
      '</div>' +
      '<div id="margin-trend-chart-box" style="height:250px;"></div>' +
    '</div>';

    var chartBox = document.getElementById('margin-trend-chart-box');
    if (!chartBox || chartBox.clientWidth === 0) return;

    var chart = LightweightCharts.createChart(chartBox, {
      width: chartBox.clientWidth,
      height: 250,
      layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
      timeScale: { borderColor: 'rgba(0,240,255,0.1)' },
      rightPriceScale: {
        borderColor: 'rgba(0,240,255,0.1)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });

    if (grossMarginData.length >= 2) {
      var grossSeries = chart.addLineSeries({
        color: '#00e87b', lineWidth: 2,
        priceFormat: { type: 'custom', formatter: function(v) { return v.toFixed(1) + '%'; } },
      });
      grossSeries.setData(grossMarginData);
    }

    if (opMarginData.length >= 2) {
      var opSeries = chart.addLineSeries({
        color: '#00b4d8', lineWidth: 2,
        priceFormat: { type: 'custom', formatter: function(v) { return v.toFixed(1) + '%'; } },
      });
      opSeries.setData(opMarginData);
    }

    if (netMarginData.length >= 2) {
      var netSeries = chart.addLineSeries({
        color: '#ffd036', lineWidth: 2,
        priceFormat: { type: 'custom', formatter: function(v) { return v.toFixed(1) + '%'; } },
      });
      netSeries.setData(netMarginData);
    }

    chart.timeScale().fitContent();

    // Responsive resize
    var resizeObserver = new ResizeObserver(function() {
      if (chartBox.clientWidth > 0) {
        chart.applyOptions({ width: chartBox.clientWidth });
      }
    });
    resizeObserver.observe(chartBox);

  } catch (e) {
    console.warn('[CT] Margin trend chart error:', e);
    container.innerHTML = '<div class="card"><div class="card-title">\u{1F4C8} \u5229\u6F64\u7387\u8DA8\u52E2\u5716</div><div class="text-muted">\u5229\u6F64\u7387\u5716\u8F09\u5165\u5931\u6557</div></div>';
  }
}


// ============================================================
// 1C: Revenue YoY Growth Bar Chart Enhancement
// ============================================================
async function renderRevenueYoYChart(code) {
  // This renders a standalone YoY bar chart below the existing revenue chart
  var targetEl = document.getElementById('revenue-yoy-chart');
  if (!targetEl) return;
  targetEl.innerHTML = '<div class="loading-box" style="padding:8px;"><div class="spinner"></div></div>';

  try {
    var now = new Date();
    var startDate = new Date(now.getFullYear(), now.getMonth() - 26, 1);
    var startStr = startDate.getFullYear() + '-' + String(startDate.getMonth() + 1).padStart(2, '0') + '-01';
    var url = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=' + code + '&start_date=' + startStr;
    var proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    var resp = await fetch(proxyUrl);
    if (!resp.ok) { targetEl.innerHTML = ''; return; }

    var json = await resp.json();
    var rows = json.data || [];
    if (rows.length === 0) { targetEl.innerHTML = ''; return; }

    // Build monthly revenue map
    var byMonth = {};
    rows.forEach(function(r) {
      var dt = r.date || r.revenue_date || '';
      var rev = r.revenue || 0;
      if (!dt || !rev) return;
      var ym = dt.slice(0, 7);
      byMonth[ym] = rev;
    });

    var months = Object.keys(byMonth).sort();
    var yoyData = [];

    months.forEach(function(ym) {
      var parts = ym.split('-');
      var prevYearYm = (parseInt(parts[0]) - 1) + '-' + parts[1];
      var prevRev = byMonth[prevYearYm];
      if (prevRev && prevRev > 0) {
        var yoy = ((byMonth[ym] - prevRev) / prevRev * 100);
        yoyData.push({ month: ym, yoy: yoy });
      }
    });

    if (yoyData.length < 3) { targetEl.innerHTML = ''; return; }

    targetEl.innerHTML = '<div class="text-sm" style="color:var(--cyan);font-weight:600;margin-bottom:6px;margin-top:12px;">\u6708\u71DF\u6536 YoY \u6210\u9577\u7387</div>' +
      '<div id="rev-yoy-box" style="height:180px;"></div>';

    var box = document.getElementById('rev-yoy-box');
    if (!box || box.clientWidth === 0) return;

    var chart = LightweightCharts.createChart(box, {
      width: box.clientWidth,
      height: 180,
      layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
      timeScale: { borderColor: 'rgba(0,240,255,0.1)' },
      rightPriceScale: {
        borderColor: 'rgba(0,240,255,0.1)',
        scaleMargins: { top: 0.15, bottom: 0.05 },
      },
    });

    var barSeries = chart.addHistogramSeries({
      priceFormat: { type: 'custom', formatter: function(v) { return v.toFixed(1) + '%'; } },
    });

    barSeries.setData(yoyData.map(function(d) {
      // Taiwan convention: RED = positive, GREEN = negative
      var color = d.yoy >= 0 ? 'rgba(255,56,96,0.7)' : 'rgba(0,232,123,0.7)';
      return { time: d.month + '-01', value: d.yoy, color: color };
    }));

    // Add zero line
    var zeroSeries = chart.addLineSeries({
      color: 'rgba(136,150,179,0.3)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    zeroSeries.setData(yoyData.map(function(d) {
      return { time: d.month + '-01', value: 0 };
    }));

    chart.timeScale().fitContent();

    // Responsive resize
    var resizeObserver = new ResizeObserver(function() {
      if (box.clientWidth > 0) {
        chart.applyOptions({ width: box.clientWidth });
      }
    });
    resizeObserver.observe(box);

  } catch (e) {
    console.warn('[CT] Revenue YoY chart error:', e);
    targetEl.innerHTML = '';
  }
}


// ============================================================
// SCREENER: Fetch BWIBBU data for fundamental filters
// ============================================================
var gBwibbuMap = {}; // code -> { pe, pb, yield }
var _bwibbuLoaded = false;

async function loadBwibbuData() {
  if (_bwibbuLoaded) return;
  try {
    var resp = await fetch('/api/proxy?url=' + encodeURIComponent('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'));
    if (!resp.ok) return;
    var data = await resp.json();
    if (!Array.isArray(data)) return;
    data.forEach(function(item) {
      var code = (item.Code || '').trim();
      if (!code) return;
      gBwibbuMap[code] = {
        pe: parseFloat(item.PEratio) || 0,
        pb: parseFloat(item.PBratio) || 0,
        yieldPct: parseFloat(item.DividendYield) || 0,
      };
    });
    _bwibbuLoaded = true;
  } catch (e) {
    console.warn('[CT] BWIBBU load error:', e);
  }
}

function getBwibbuForCode(code) {
  return gBwibbuMap[code] || null;
}
