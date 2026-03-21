// RENDER: MARKET OVERVIEW
// ============================================================
function renderRankWithToggle(containerId, fullList, renderFn, defaultCount) {
  defaultCount = defaultCount || 20;
  const el = document.getElementById(containerId);
  if (!el) return;
  if (fullList.length <= defaultCount) {
    el.innerHTML = renderFn(fullList);
    return;
  }
  const toggleId = containerId + '-toggle';
  const shortHTML = renderFn(fullList.slice(0, defaultCount));
  const fullHTML = renderFn(fullList);
  el.innerHTML = `<div class="rank-toggle-short">${shortHTML}</div><div class="rank-toggle-full" style="display:none;">${fullHTML}</div>`
    + `<div style="text-align:center;margin-top:10px;"><button id="${toggleId}" class="btn btn-secondary" data-expanded="0" style="font-size:12px;padding:6px 18px;">顯示更多 (${fullList.length}筆)</button></div>`;
  document.getElementById(toggleId).addEventListener('click', function() {
    var btn = this;
    var short = el.querySelector('.rank-toggle-short');
    var full = el.querySelector('.rank-toggle-full');
    if (btn.dataset.expanded === '1') {
      btn.dataset.expanded = '0';
      btn.textContent = '顯示更多 (' + fullList.length + '筆)';
      full.style.display = 'none';
      short.style.display = '';
    } else {
      btn.dataset.expanded = '1';
      btn.textContent = '收起';
      full.style.display = '';
      short.style.display = 'none';
    }
  });
}

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
    if (close > 0) allWithPct.push({ code: s[0].trim(), name: s[1].trim(), close, chg, pct, vol: Math.round(parseNum(s[2]) / 1000), market: 'twse' });
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
    if (close > 0) allWithPct.push({ code: (s[0]||'').trim(), name: (s[1]||'').trim(), close, chg, pct, vol: Math.round(vol / 1000), market: 'tpex' });
  });

  const totalCount = twseStocks.length + tpexStocks.length;

  const totalADR = upN + dnN + flatN;
  const upPct = totalADR > 0 ? (upN / totalADR * 100) : 0;
  const dnPct = totalADR > 0 ? (dnN / totalADR * 100) : 0;
  const flatPct = totalADR > 0 ? (flatN / totalADR * 100) : 0;
  const sentiment = upPct - dnPct;
  const sentimentLabel = sentiment > 20 ? '極度樂觀' : sentiment > 5 ? '偏多' : sentiment > -5 ? '中性' : sentiment > -20 ? '偏空' : '極度悲觀';
  const sentimentColor = sentiment > 5 ? 'var(--red)' : sentiment > -5 ? 'var(--yellow)' : 'var(--green)';

  // Margin/Short balance card
  let marginHTML = '';
  if (gMarginData) {
    const mBal = gMarginData.marginAmount;
    const mPrev = gMarginData.marginPrevAmount;
    const mChg = mBal - mPrev;
    const mChgColor = mChg > 0 ? 'var(--red)' : mChg < 0 ? 'var(--green)' : 'var(--text2)';
    const mChgSign = mChg > 0 ? '+' : '';
    const sChg = gMarginData.shortBalShares - gMarginData.shortPrevShares;
    const sChgColor = sChg > 0 ? 'var(--green)' : sChg < 0 ? 'var(--red)' : 'var(--text2)';
    const sChgSign = sChg > 0 ? '+' : '';

    marginHTML = `
    <div class="stat-box margin-ratio-box">
      <div class="label">融資餘額</div>
      <div class="value" style="font-size:20px;">${fmtBig(mBal)}</div>
      <div style="font-size:12px;color:${mChgColor};margin-top:4px;">${mChgSign}${fmtBig(mChg)}</div>
      <div class="margin-gauge"><div class="margin-gauge-fill" style="width:${mChg > 0 ? '60' : '40'}%;background:${mChgColor};"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--text2);">
        <span>融券 ${fmtNum(gMarginData.shortBalShares, 0)} 張</span>
        <span style="color:${sChgColor};">${sChgSign}${fmtNum(sChg, 0)}</span>
      </div>
    </div>`;
  }

  document.getElementById('market-stats').innerHTML = `
    <div class="stat-box"><div class="label">上市+上櫃股票數</div><div class="value">${totalCount}</div></div>
    <div class="stat-box"><div class="label">上市總成交金額</div><div class="value">${fmtBig(totalVal)}</div></div>
    <div class="stat-box"><div class="label">總成交量</div><div class="value">${fmtBig(totalVol)} 股</div></div>
    <div class="stat-box"><div class="label">漲停 / 跌停</div><div class="value"><span class="up">${limitUp}</span> <span style="color:var(--text2);">/</span> <span class="down">${limitDown}</span></div></div>
    <div class="stat-box">
      <div class="label">市場情緒</div>
      <div class="value" style="font-size:16px;color:${sentimentColor};">${sentimentLabel}</div>
    </div>
    ${marginHTML}
  `;

  const gainers = [...allWithPct].sort((a, b) => b.pct - a.pct).filter(s => s.chg > 0).slice(0, 50);
  const losers  = [...allWithPct].sort((a, b) => a.pct - b.pct).filter(s => s.chg < 0).slice(0, 50);

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
            <div><span class="dt-label">成交量</span><span>${fmtNum(s.vol, 0)} 張</span></div>
          </div>
        </div>`;
      });
      h += '</div>';
      return h;
    }
    return mkTable(['代號', '名稱', '市場', '收盤', '漲跌', '漲跌%', '成交量(張)'], list.map(s => {
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      return [
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>${limitTag(s.pct)}${warningTag(s.code)}`, mTag,
        limitPrice(s.close, s.pct),
        `<span class="${s.chg > 0 ? 'up' : 'down'}">${s.chg > 0 ? '+' : ''}${fmtNum(s.chg, 2)}</span>`,
        `<span class="${s.pct > 0 ? 'up' : 'down'}">${s.pct > 0 ? '+' : ''}${s.pct.toFixed(2)}%</span>`,
        fmtNum(s.vol, 0)
      ];
    }));
  }

  renderRankWithToggle('top-gainers', gainers, rankHTML);
  renderRankWithToggle('top-losers', losers, rankHTML);

  // Volume ranking
  const volRanked = [...allWithPct].sort((a, b) => b.vol - a.vol).slice(0, 50);
  renderRankWithToggle('top-volume', volRanked, rankHTML);

  // Advance/Decline visual
  const adEl = document.getElementById('advance-decline');
  if (adEl) {
    const total = upN + dnN + flatN;
    const upPct = total > 0 ? (upN / total * 100) : 0;
    const flatPct = total > 0 ? (flatN / total * 100) : 0;
    const dnPct = total > 0 ? (dnN / total * 100) : 0;
    adEl.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-end;justify-content:center;margin-bottom:14px;">
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
        <div class="ad-up" style="width:${upPct}%;${upPct>=15?'display:flex;align-items:center;justify-content:center;':''}">
          ${upPct>=15?`<span style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.5);">${upPct.toFixed(1)}%</span>`:''}
        </div>
        <div class="ad-flat" style="width:${flatPct}%;"></div>
        <div class="ad-down" style="width:${dnPct}%;${dnPct>=15?'display:flex;align-items:center;justify-content:center;':''}">
          ${dnPct>=15?`<span style="font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.5);">${dnPct.toFixed(1)}%</span>`:''}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;">
        <span class="up text-sm" style="font-weight:600;">${upPct.toFixed(1)}%</span>
        <span class="text-sm text-muted">共 ${total} 檔</span>
        <span class="down text-sm" style="font-weight:600;">${dnPct.toFixed(1)}%</span>
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
  // Red (up) to Green (down) gradient, ±7% range for better distinction
  var clamped = Math.max(-7, Math.min(7, pct));
  var t = (clamped + 7) / 14; // 0=deep green, 0.5=neutral, 1=deep red
  var r, g, b;
  if (t >= 0.5) {
    var s = (t - 0.5) * 2;
    r = Math.round(35 + 195 * s);
    g = Math.round(30 - 15 * s);
    b = Math.round(40 - 20 * s);
  } else {
    var s = t * 2;
    r = Math.round(8 + 27 * s);
    g = Math.round(160 - 130 * s);
    b = Math.round(65 - 25 * s);
  }
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// Approximate TWSE sector market-cap weights (2024-2025)
var SECTOR_WEIGHTS = {
  '半導體': 45, '金融保險': 10, '電腦週邊': 5, '通信網路': 4,
  '其他電子': 4, '電子零組件': 3.5, '光電': 3, '塑膠': 3,
  '鋼鐵': 2, '航運': 2, '食品': 2, '水泥': 1.8,
  '建材營造': 1.8, '汽車': 1.5, '電子通路': 1.5, '資訊服務': 1.5,
  '化學': 1.2, '化學生技醫療': 1.2, '生技醫療': 1.2, '貿易百貨': 1.2,
  '電機': 1, '紡織': 0.8, '電纜': 0.6, '玻璃': 0.5,
  '造紙': 0.4, '橡膠': 0.5, '觀光餐旅': 0.5, '油電燃氣': 0.8,
  '綠能環保': 0.5, '數位雲端': 0.8, '運動休閒': 0.3, '居家生活': 0.3, '其他': 1
};

function renderSectorHeatmap(sectorsData) {
  var el = document.getElementById('sector-heatmap');
  if (!el) return;
  if (!sectorsData || sectorsData.length === 0) {
    el.innerHTML = '<div class="text-muted" style="padding:40px;text-align:center;">盤中資料尚未公布</div>';
    return;
  }

  var items = sectorsData.map(function(s) {
    var weight = SECTOR_WEIGHTS[s.name] || 0.5;
    return { name: s.name, pct: s.pct, close: s.close, value: weight };
  }).sort(function(a, b) { return b.value - a.value; });

  var W = el.clientWidth;
  var H = el.clientHeight || 320;
  if (W < 10) {
    setTimeout(function() { renderSectorHeatmap(sectorsData); }, 500);
    return;
  }
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

    var showLabel = c.w > 36 && c.h > 24;
    var showPct = c.w > 28 && c.h > 36;
    var showClose = c.w > 60 && c.h > 52;

    if (showLabel) {
      var nameSpan = document.createElement('span');
      nameSpan.className = 'hm-cell-name';
      nameSpan.textContent = c.item.name;
      if (c.w < 55) nameSpan.style.fontSize = '9px';
      div.appendChild(nameSpan);
    }
    if (showPct) {
      var pctSpan = document.createElement('span');
      pctSpan.className = 'hm-cell-pct';
      pctSpan.textContent = (c.item.pct > 0 ? '+' : '') + c.item.pct.toFixed(2) + '%';
      div.appendChild(pctSpan);
    }
    if (showClose) {
      var closeSpan = document.createElement('span');
      closeSpan.className = 'hm-cell-close';
      closeSpan.textContent = c.item.close.toFixed(2);
      div.appendChild(closeSpan);
    }

    var pctStr = (c.item.pct > 0 ? '+' : '') + c.item.pct.toFixed(2) + '%';
    var weightStr = (SECTOR_WEIGHTS[c.item.name] || 0.5).toFixed(1) + '%';
    div.title = c.item.name + '\n漲跌: ' + pctStr + '\n指數: ' + c.item.close.toFixed(2) + '\n市值占比: ~' + weightStr;
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
    devicePixelRatio: window.devicePixelRatio || 1,
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
  const basePrice = prevClose > 0 ? prevClose : data[0].value;
  if (!chtTaiex) {
    el.innerHTML = '';
    _createTaiexChart(el);
    sTaiexLine = chtTaiex.addBaselineSeries({
      baseValue: { type: 'price', price: basePrice },
      topLineColor: '#ff3860',
      topFillColor1: 'rgba(255,56,96,0.25)',
      topFillColor2: 'rgba(255,56,96,0.02)',
      bottomLineColor: '#00e87b',
      bottomFillColor1: 'rgba(0,232,123,0.02)',
      bottomFillColor2: 'rgba(0,232,123,0.25)',
      lineWidth: 2,
    });
  } else {
    sTaiexLine.applyOptions({
      baseValue: { type: 'price', price: basePrice },
    });
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
// OVERVIEW: 重大事件
// ============================================================
async function loadOverviewEvents() {
  var el = document.getElementById('overview-events');
  if (!el) return;
  try {
    var resp = await fetch('/api/events');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    var events = (data.events || []).slice(0, 20);
    if (events.length === 0) {
      el.innerHTML = '<div class="text-muted" style="text-align:center;padding:16px;">目前無重大事件</div>';
      return;
    }
    var html = '<div class="events-timeline">';
    events.forEach(function(ev) {
      var isConf = ev.type === '法說會';
      var isDiv = ev.type === '除息' || ev.type === '除息日';
      var cls = isConf ? 'event-conf' : isDiv ? 'event-div' : 'event-news';
      var icon = isConf ? '\uD83C\uDFA4' : isDiv ? '\uD83D\uDCB0' : '\uD83D\uDCCC';
      var title = ev.title || '';
      var url = ev.url || '#';
      html += '<a href="' + url + '" target="_blank" rel="noopener" class="event-item ' + cls + '">' +
        '<span class="event-icon">' + icon + '</span>' +
        '<span class="event-body"><span class="event-title">' + title + '</span></span>' +
        '<span class="event-meta"><span class="event-date">' + (ev.time || ev.date || '') + '</span>' +
        '<span class="event-type-tag">' + ev.type + '</span></span></a>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<div class="text-muted" style="text-align:center;padding:16px;">事件載入失敗</div>';
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

  // Helper: get close price from gStockMap
  function _getClose(code) {
    const entry = gStockMap[code];
    if (!entry) return 0;
    if (entry.market === 'twse') return parseNum(entry.data[7]);
    return parseNum(entry.data[2]); // tpex close is index 2
  }

  // TWSE
  gInstStocks.forEach(r => {
    const code = r[0].trim();
    if (/^\d{4}$/.test(code)) {
      parsed.push({ code, name: r[1].trim(), net: parseNum(r[col]), market: 'twse', close: _getClose(code) });
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
    if (!isNaN(net)) parsed.push({ code, name: (r[1]||'').trim(), net, market: 'tpex', close: _getClose(code) });
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
        const estAmt = s.close > 0 ? Math.abs(s.net) * s.close : 0;
        const estStr = estAmt > 0 ? fmtBig(estAmt) : '';
        h += `<div class="rank-card" onclick="goAnalyze('${s.code}')">
          <div class="rank-card-head">
            <span class="rank-card-num">${i+1}</span>
            <span class="rank-card-code">${s.code}</span>
            <span class="rank-card-name">${s.name}</span>${warningTag(s.code)}
            <span class="rank-card-pct ${cls}">${s.net>0?'+':''}${fmtShares(s.net)}</span>
          </div>
          ${estStr ? `<div class="rank-card-body"><div><span class="dt-label">估計金額</span><span style="color:var(--yellow);">${estStr}</span></div></div>` : ''}
        </div>`;
      });
      h += '</div>';
      return h;
    }
    return mkTable(['代號', '名稱', '市場', '買賣超（股）', '估計金額'], list.map(s => {
      const mTag = s.market === 'twse'
        ? '<span class="tag-market tag-twse">上市</span>'
        : '<span class="tag-market tag-tpex">上櫃</span>';
      const estAmt = s.close > 0 ? Math.abs(s.net) * s.close : 0;
      return [
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
        `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.name}</span>${warningTag(s.code)}`, mTag,
        `<span class="${s.net > 0 ? 'up' : 'down'}" style="font-weight:600">${s.net > 0 ? '+' : ''}${fmtShares(s.net)}</span>`,
        `<span style="color:var(--yellow);">${estAmt > 0 ? fmtBig(estAmt) : '--'}</span>`
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
    // 使用增強版排行評分（ai-scoring.js）或 fallback
    let score;
    if (typeof aiRankScoreEnhanced === 'function') {
      score = aiRankScoreEnhanced(s, inst);
    } else {
      score = 50;
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
    }

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
        fmtNum(s.vol, 0),
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
      var instTotal = (inst.f || 0) + (inst.t || 0) + (inst.d || 0);
      var totalCls = instTotal > 0 ? 'up' : instTotal < 0 ? 'down' : '';
      instHtml = '<div class="sc-inst">'
        + '<div class="sc-inst-item"><span class="sc-inst-label">外資</span><span class="' + fCls + '">' + (inst.f > 0 ? '+' : '') + fmtShares(inst.f) + '</span></div>'
        + '<div class="sc-inst-item"><span class="sc-inst-label">投信</span><span class="' + tCls + '">' + (inst.t > 0 ? '+' : '') + fmtShares(inst.t) + '</span></div>'
        + '<div class="sc-inst-item"><span class="sc-inst-label">自營</span><span class="' + dCls + '">' + (inst.d > 0 ? '+' : '') + fmtShares(inst.d) + '</span></div>'
        + '<div class="sc-inst-item" style="border-top:1px solid var(--border);padding-top:4px;margin-top:4px;"><span class="sc-inst-label" style="font-weight:700;">合計</span><span class="' + totalCls + '" style="font-weight:700;">' + (instTotal > 0 ? '+' : '') + fmtShares(instTotal) + '</span></div>'
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
      try {
        const p = c.chartElement().parentElement;
        const o = { width: p.clientWidth };
        if (p.clientHeight > 0) o.height = p.clientHeight;
        c.applyOptions(o);
      } catch(e) {}
    }
  });
  // After resize, ensure K-line shows most recent data
  try { if (chtMain) chtMain.timeScale().scrollToRealTime(); } catch(e) {}
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 150));
