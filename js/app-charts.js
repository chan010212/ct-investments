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
      devicePixelRatio: window.devicePixelRatio || 1,
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

  // 初始化擴展均線 MA60/MA120（chart-extended.js）
  if (typeof initExtendedMAs === 'function') initExtendedMAs();

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
  initKlineEventTooltip();
}

// Synchronize time scales + crosshair across K-line, RSI, KD, MACD charts
let _isSyncing = false;
let _isCrosshairSyncing = false;
// Primary series for each chart (used for crosshair sync)
let _chartPrimarySeries = {};

function _syncChartTimeScales() {
  const charts = [chtMain, chtRsi, chtKd, chtMacd];
  // Map chart to its primary series for setCrosshairPosition
  _chartPrimarySeries = {};
  if (chtMain && sCan) _chartPrimarySeries[0] = sCan;
  if (chtRsi && sRsi) _chartPrimarySeries[1] = sRsi;
  if (chtKd && sKK) _chartPrimarySeries[2] = sKK;
  if (chtMacd && sDif) _chartPrimarySeries[3] = sDif;

  charts.forEach((chart, idx) => {
    if (!chart) return;
    // Scroll/zoom sync
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      // Dismiss event tooltip on scroll/zoom
      var etip = document.getElementById('kline-event-tip');
      if (etip) etip.remove();
      if (_isSyncing) return;
      _isSyncing = true;
      try {
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
    // Crosshair sync — when hovering one chart, show crosshair on all others at same time
    chart.subscribeCrosshairMove(param => {
      if (_isCrosshairSyncing) return;
      _isCrosshairSyncing = true;
      charts.forEach((other, j) => {
        if (j === idx || !other) return;
        if (!param || param.time === undefined) {
          try { other.clearCrosshairPosition(); } catch(e) {}
        } else {
          const series = _chartPrimarySeries[j];
          if (series) {
            try {
              // Get data at logical index from TARGET series for correct horizontal line
              var logIdx = param.logical !== undefined ? Math.round(param.logical) : -1;
              var targetData = logIdx >= 0 ? series.dataByIndex(logIdx) : null;
              var val = targetData ? (targetData.value !== undefined ? targetData.value : targetData.close || 0) : 0;
              other.setCrosshairPosition(val, param.time, series);
            } catch(e) {
              try { other.clearCrosshairPosition(); } catch(e2) {}
            }
          }
        }
      });
      _isCrosshairSyncing = false;
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

var _fsOrientationLocked = false;

function toggleChartFullscreen() {
  if (_fsOverlay) { closeChartFullscreen(); return; }

  const isMobile = window.innerWidth <= 768;

  // Mobile: try to lock orientation to landscape (no CSS rotate needed)
  if (isMobile && screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').then(() => {
      _fsOrientationLocked = true;
    }).catch(() => {
      _fsOrientationLocked = false;
    });
  }

  // Create overlay — no longer use fs-landscape class (no CSS rotate)
  _fsOverlay = document.createElement('div');
  _fsOverlay.className = 'chart-fullscreen-overlay';

  if (isMobile) {
    // Let the overlay fill the screen naturally
    _fsOverlay.style.overflow = 'hidden';
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
  // Use longer delay on mobile to wait for orientation change to settle
  setTimeout(() => {
    if (!_fsOverlay) return;

    // Calculate chart dimensions from actual viewport (no CSS rotate, so width/height are real)
    let w, h;
    const mob = isMobile;
    if (mob) {
      const vv = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
      w = Math.round(Math.max(vv.width, vv.height));  // landscape: wider dimension
      h = Math.round(Math.min(vv.width, vv.height));   // landscape: shorter dimension
      const headerH = header.offsetHeight || 32;
      h = h - headerH;
      body.style.width = w + 'px';
      body.style.height = h + 'px';
      body.style.maxWidth = w + 'px';
      body.style.maxHeight = h + 'px';
    } else {
      w = body.clientWidth;
      h = body.clientHeight;
    }

    if (w <= 0 || h <= 0) {
      w = body.clientWidth || window.innerWidth;
      h = body.clientHeight || window.innerHeight - 50;
    }

    _fsChart = LightweightCharts.createChart(body, {
      width: w, height: h,
      autoSize: false,
      devicePixelRatio: window.devicePixelRatio || 1,
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
        if (!_fsChart) return;
        const vv = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
        const rw = Math.round(vv.height);
        const rh = Math.round(vv.width) - (header.offsetHeight || 32);
        body.style.width = rw + 'px';
        body.style.height = rh + 'px';
        body.style.maxWidth = rw + 'px';
        body.style.maxHeight = rh + 'px';
        _fsChart.applyOptions({ width: rw, height: rh });
        _fsChart.timeScale().fitContent();
      }, 150);
    }

    // Handle resize in fullscreen
    window.addEventListener('resize', _fsResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', _fsResize);
  }, 80);
}

function _fsResize() {
  if (!_fsChart || !_fsOverlay) return;
  setTimeout(() => {
    if (!_fsChart || !_fsOverlay) return;
    const body = _fsOverlay.querySelector('.chart-fs-body');
    const header = _fsOverlay.querySelector('.chart-fs-header');
    if (!body) return;
    const vv = window.visualViewport || { width: window.innerWidth, height: window.innerHeight };
    let w = Math.round(vv.width);
    let h = Math.round(vv.height) - (header ? header.offsetHeight : 32);
    body.style.width = w + 'px';
    body.style.height = h + 'px';
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
  if (window.visualViewport) window.visualViewport.removeEventListener('resize', _fsResize);
  if (_fsChart) { try { _fsChart.remove(); } catch(e) {} _fsChart = null; }
  if (_fsOverlay) { _fsOverlay.remove(); _fsOverlay = null; }
  document.body.style.overflow = '';
  // Unlock screen orientation
  if (_fsOrientationLocked && screen.orientation && screen.orientation.unlock) {
    try { screen.orientation.unlock(); } catch(e) {}
    _fsOrientationLocked = false;
  }
}

// ESC to close fullscreen
document.addEventListener('keydown', e => { if (e.key === 'Escape' && _fsOverlay) closeChartFullscreen(); });

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
    devicePixelRatio: window.devicePixelRatio || 1,
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

    // B5: Intraday info bar
    try {
      const infoBar = document.getElementById('intraday-info-bar');
      if (infoBar && prevClose > 0) {
        const rtChg = lastPrice - prevClose;
        const rtPct = (rtChg / prevClose * 100);
        const rtCls = rtChg >= 0 ? 'up' : 'down';
        const volStr = vol >= 1000 ? fmtNum(Math.round(vol / 1000), 0) + ' 張' : fmtNum(vol, 0) + ' 股';
        infoBar.innerHTML = `<span class="ib-item">現價 <b class="${rtCls}">${fmtNum(lastPrice, 2)}</b></span>`
          + `<span class="ib-item ${rtCls}">${rtChg > 0 ? '+' : ''}${fmtNum(rtChg, 2)} (${rtPct > 0 ? '+' : ''}${rtPct.toFixed(2)}%)</span>`
          + `<span class="ib-item">高 <b class="up">${fmtNum(high, 2)}</b></span>`
          + `<span class="ib-item">低 <b class="down">${fmtNum(low, 2)}</b></span>`
          + `<span class="ib-item">量 <b>${volStr}</b></span>`;
        infoBar.style.display = 'flex';
      }
    } catch(e) {}
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
