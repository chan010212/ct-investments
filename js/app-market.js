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
    { symbol: 'MU', name: '美光 Micron' },
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
          const result = d.chart?.result?.[0];
          const meta = result?.meta;
          if (!meta) continue;
          const price = meta.regularMarketPrice || 0;
          // Filter out null closes, then find the proper previous close
          const closes = (result?.indicators?.quote?.[0]?.close || []).filter(c => c != null);
          // On non-trading days (weekends/holidays), Yahoo duplicates the last close.
          // Detect trailing duplicates and skip them to get the real previous day's close.
          let prevClose = null;
          if (closes.length >= 3 && Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) < 0.01) {
            // Last two closes identical → non-trading day duplicate
            const lastVal = closes[closes.length - 1];
            for (let i = closes.length - 3; i >= 0; i--) {
              if (Math.abs(closes[i] - lastVal) > 0.005) { prevClose = closes[i]; break; }
            }
          } else if (closes.length >= 2) {
            prevClose = closes[closes.length - 2];
          }
          prevClose = prevClose || meta.chartPreviousClose || meta.previousClose || price;
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
    html += `<div class="stat-box" style="cursor:pointer;" onclick="showIndexDetailModal('${idx.symbol}','${idx.name}',${price},${chg},${pct})">
      <div class="label">${idx.name}</div>
      <div class="value" style="font-size:18px;">${fmtNum(price, price > 1000 ? 0 : 2)}</div>
      <div class="text-sm ${isUp ? 'up' : 'down'}">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</div>
    </div>`;
  });
  html += '</div>';
  box.innerHTML = html;
}

// D1: International index detail modal
async function showIndexDetailModal(symbol, name, price, chg, pct) {
  // Remove existing modal if any
  const existing = document.getElementById('index-detail-modal');
  if (existing) existing.remove();

  const isUp = chg >= 0;
  const cls = isUp ? 'up' : 'down';

  const modal = document.createElement('div');
  modal.id = 'index-detail-modal';
  modal.className = 'index-modal-overlay';
  modal.innerHTML = `
    <div class="index-modal">
      <div class="index-modal-header">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text);">${name}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px;">${symbol}</div>
        </div>
        <button class="index-modal-close" onclick="document.getElementById('index-detail-modal').remove()">&times;</button>
      </div>
      <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px;">
        <span style="font-size:28px;font-weight:800;color:var(--text);">${fmtNum(price, price > 1000 ? 0 : 2)}</span>
        <span class="${cls}" style="font-size:16px;">${chg > 0 ? '+' : ''}${fmtNum(chg, 2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)</span>
      </div>
      <div id="index-modal-chart" style="height:250px;margin-bottom:16px;"><div class="loading-box"><div class="spinner"></div></div></div>
      <div id="index-modal-info" style="margin-bottom:8px;"></div>
    </div>`;
  document.body.appendChild(modal);

  // Close on overlay click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.remove();
  });

  // Fetch 1-month chart data
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp) throw new Error('No data');

    const ts = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];
    const highs = result.indicators?.quote?.[0]?.high || [];
    const lows = result.indicators?.quote?.[0]?.low || [];
    const meta = result.meta || {};

    // Chart
    const chartEl = document.getElementById('index-modal-chart');
    if (chartEl) {
      chartEl.innerHTML = '';
      const chart = LightweightCharts.createChart(chartEl, {
        width: chartEl.clientWidth, height: 250,
        layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: 10 },
        grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
        timeScale: { borderColor: 'rgba(0,240,255,0.1)' },
        rightPriceScale: { borderColor: 'rgba(0,240,255,0.1)', scaleMargins: { top: 0.05, bottom: 0.05 } },
        crosshair: { mode: 0 },
      });
      const areaSeries = chart.addAreaSeries({
        lineColor: isUp ? '#ff4070' : '#00ff88',
        topColor: isUp ? 'rgba(255,64,112,0.2)' : 'rgba(0,255,136,0.2)',
        bottomColor: 'rgba(0,0,0,0)',
        lineWidth: 2,
      });
      const chartData = [];
      for (let i = 0; i < ts.length; i++) {
        if (closes[i] != null) {
          chartData.push({ time: ts[i], value: closes[i] });
        }
      }
      areaSeries.setData(chartData);
      chart.timeScale().fitContent();
    }

    // 52-week high/low from meta
    const high52 = meta.fiftyTwoWeekHigh || 0;
    const low52 = meta.fiftyTwoWeekLow || 0;
    const range52 = meta.fiftyTwoWeekRange || '';
    // Compute month high/low
    const monthHigh = highs.filter(v => v != null).length > 0 ? Math.max(...highs.filter(v => v != null)) : 0;
    const monthLow = lows.filter(v => v != null).length > 0 ? Math.min(...lows.filter(v => v != null)) : 0;

    const infoEl = document.getElementById('index-modal-info');
    if (infoEl) {
      let infoHtml = '<div class="stat-grid">';
      if (monthHigh > 0) infoHtml += `<div class="stat-box"><div class="label">月最高</div><div class="value up" style="font-size:14px;">${fmtNum(monthHigh, price > 1000 ? 0 : 2)}</div></div>`;
      if (monthLow > 0) infoHtml += `<div class="stat-box"><div class="label">月最低</div><div class="value down" style="font-size:14px;">${fmtNum(monthLow, price > 1000 ? 0 : 2)}</div></div>`;
      if (high52 > 0) infoHtml += `<div class="stat-box"><div class="label">52週最高</div><div class="value" style="font-size:14px;color:var(--cyan);">${fmtNum(high52, price > 1000 ? 0 : 2)}</div></div>`;
      if (low52 > 0) infoHtml += `<div class="stat-box"><div class="label">52週最低</div><div class="value" style="font-size:14px;color:var(--orange);">${fmtNum(low52, price > 1000 ? 0 : 2)}</div></div>`;
      infoHtml += '</div>';

      // Related ETF info
      const etfMap = {
        '^DJI': 'DIA (SPDR Dow Jones)', '^GSPC': 'SPY (SPDR S&P 500)',
        '^IXIC': 'QQQ (Invesco NASDAQ)', '^SOX': 'SOXX (iShares Semiconductor)',
        '^VIX': 'UVXY / VXX', '^TWII': '0050 (元大台灣50)',
        '^N225': 'EWJ (iShares Japan)', '000001.SS': 'FXI (iShares China)',
      };
      if (etfMap[symbol]) {
        infoHtml += `<div class="text-sm text-muted" style="margin-top:10px;">相關 ETF：<span style="color:var(--yellow);">${etfMap[symbol]}</span></div>`;
      }
      infoEl.innerHTML = infoHtml;
    }
  } catch(e) {
    const chartEl = document.getElementById('index-modal-chart');
    if (chartEl) chartEl.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">圖表載入失敗</div>';
  }
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

