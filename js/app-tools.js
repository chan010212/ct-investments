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
        devicePixelRatio: window.devicePixelRatio || 1,
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
        devicePixelRatio: window.devicePixelRatio || 1,
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
