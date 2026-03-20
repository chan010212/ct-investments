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


async function fetchTwseHistory(code) {
  const now = new Date();
  const months = [];
  for (let m = 0; m < 13; m++) {
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
  for (let m = 0; m < 13; m++) {
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
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}${suffix}?interval=1d&range=1y`;
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

    // B4: OHLCV stats below header
    try {
      const statsEl = document.getElementById('stock-detail-stats');
      if (statsEl && n > 0) {
        const lastO = O[n-1], lastH = H[n-1], lastL = L[n-1], lastV = V[n-1];
        const volStr = lastV >= 1000 ? fmtNum(Math.round(lastV / 1000), 0) + ' 張' : fmtNum(lastV, 0) + ' 股';
        statsEl.innerHTML = `<span>開 <b>${fmtNum(lastO, 2)}</b></span><span>高 <b class="up">${fmtNum(lastH, 2)}</b></span><span>低 <b class="down">${fmtNum(lastL, 2)}</b></span><span>收 <b>${fmtNum(lastC, 2)}</b></span><span>量 <b>${volStr}</b></span>`;
        statsEl.style.display = 'flex';
      }
    } catch(e) {}

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

    // 設定 MA60/MA120 擴展均線（chart-extended.js）
    if (typeof setExtendedMAData === 'function') setExtendedMAData(C, dates, ld);

    // 儲存原始資料供 日K/週K/月K 切換使用
    window._klineRawData = { dates: dates, O: O, H: H, L: L, C: C, V: V };

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

    // Update crosshair sync series mapping after data is loaded
    _chartPrimarySeries = {};
    if (chtMain && sCan) _chartPrimarySeries[0] = sCan;
    if (chtRsi && sRsi) _chartPrimarySeries[1] = sRsi;
    if (chtKd && sKK) _chartPrimarySeries[2] = sKK;
    if (chtMacd && sDif) _chartPrimarySeries[3] = sDif;

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
      const maxMap = { 'RSI': 15, 'MACD': 15, 'KD': 15, '均線': 20, '量價': 15, '量能': 10, '法人': 10, '趨勢': 10 };
      const max = maxMap[k] || 15;
      const pctVal = (v / max * 100).toFixed(0);
      const color = pctVal > 60 ? 'var(--green)' : pctVal > 35 ? 'var(--yellow)' : 'var(--red)';
      detHTML += `<div style="margin-bottom:6px;font-size:13px;">${k} <span class="text-muted">${v}/${max}</span>
        <div class="progress-bar"><div class="fill" style="width:${pctVal}%;background:${color};"></div></div></div>`;
    }
    detHTML += '</div>';
    document.getElementById('ai-score-detail').innerHTML = detHTML;

    // Institutional
    if (instInfo) {
      const _instTotal = (instInfo.f || 0) + (instInfo.t || 0) + (instInfo.d || 0);
      document.getElementById('stock-inst-info').innerHTML = `
        <div class="stat-grid">
          <div class="stat-box"><div class="label">外資買賣超</div><div class="value ${instInfo.f > 0 ? 'up' : 'down'}">${instInfo.f > 0 ? '+' : ''}${fmtShares(instInfo.f)}</div></div>
          <div class="stat-box"><div class="label">投信買賣超</div><div class="value ${instInfo.t > 0 ? 'up' : 'down'}">${instInfo.t > 0 ? '+' : ''}${fmtShares(instInfo.t)}</div></div>
          <div class="stat-box"><div class="label">自營商買賣超</div><div class="value ${instInfo.d > 0 ? 'up' : 'down'}">${instInfo.d > 0 ? '+' : ''}${fmtShares(instInfo.d)}</div></div>
          <div class="stat-box" style="border-top:1px solid var(--border);padding-top:8px;"><div class="label" style="font-weight:700;">三大法人合計</div><div class="value ${_instTotal > 0 ? 'up' : 'down'}" style="font-weight:700;">${_instTotal > 0 ? '+' : ''}${fmtShares(_instTotal)}</div></div>
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
    fetchStockEvents(code, dates);

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
      </div>
      <div id="revenue-history-chart" style="margin-top:16px;"></div>`;
    // Load revenue history chart
    _loadRevenueHistory(code, el);
  } catch (e) {
    el.innerHTML = '<div class="text-muted">營收資料載入失敗</div>';
  }
}

async function _loadRevenueHistory(code, parentEl) {
  try {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 26, 1);
    const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-01`;
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMonthRevenue&data_id=${code}&start_date=${startStr}`;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) return;
    const json = await resp.json();
    const rows = json.data || [];
    if (rows.length === 0) return;

    // Build history data (month, revenue, yoy%)
    const histData = [];
    const byMonth = {};
    rows.forEach(r => {
      const dt = r.date || r.revenue_date || '';
      const rev = r.revenue || 0;
      if (!dt || !rev) return;
      const ym = dt.slice(0, 7); // "2024-01"
      byMonth[ym] = rev;
    });

    const months = Object.keys(byMonth).sort();
    months.forEach(ym => {
      const rev = byMonth[ym];
      const parts = ym.split('-');
      const prevYearYm = `${parseInt(parts[0])-1}-${parts[1]}`;
      const prevYearRev = byMonth[prevYearYm] || 0;
      const yoy = prevYearRev > 0 ? ((rev - prevYearRev) / prevYearRev * 100) : null;
      histData.push({ month: ym, rev, yoy });
    });

    if (histData.length < 3) return;

    const chartEl = document.getElementById('revenue-history-chart');
    if (!chartEl) return;
    chartEl.innerHTML = '<div class="text-sm" style="color:var(--cyan);font-weight:600;margin-bottom:6px;">月營收趨勢 (近26月)</div><div id="rev-hist-box" style="height:200px;"></div>';
    const box = document.getElementById('rev-hist-box');
    if (!box || box.clientWidth === 0) return;

    const chart = LightweightCharts.createChart(box, {
      width: box.clientWidth, height: 200,
      layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
      timeScale: { borderColor: 'rgba(0,240,255,0.1)' },
      rightPriceScale: { borderColor: 'rgba(0,240,255,0.1)', scaleMargins: { top: 0.1, bottom: 0.2 } },
    });

    const barSeries = chart.addHistogramSeries({
      color: 'rgba(0, 212, 255, 0.6)',
      priceFormat: { type: 'volume' },
    });
    barSeries.setData(histData.map(d => {
      const color = d.yoy !== null ? (d.yoy >= 0 ? 'rgba(255,56,96,0.6)' : 'rgba(0,232,123,0.6)') : 'rgba(0,212,255,0.4)';
      return { time: d.month + '-01', value: d.rev, color };
    }));

    // YoY line on second axis
    const yoyData = histData.filter(d => d.yoy !== null).map(d => ({ time: d.month + '-01', value: d.yoy }));
    if (yoyData.length > 0) {
      const yoySeries = chart.addLineSeries({
        color: '#ffd036', lineWidth: 2,
        priceScaleId: 'yoy',
        priceFormat: { type: 'custom', formatter: v => v.toFixed(1) + '%' },
      });
      chart.priceScale('yoy').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } });
      yoySeries.setData(yoyData);
    }

    chart.timeScale().fitContent();
  } catch(e) {
    console.warn('[CT] Revenue history chart error:', e);
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
      </div>
      <div id="quarterly-history-chart" style="margin-top:16px;"></div>`;
    // Load quarterly EPS history chart
    _loadQuarterlyHistory(code, el);
  } catch (e) {
    el.innerHTML = '<div class="text-muted">財報載入失敗</div>';
  }
}

async function _loadQuarterlyHistory(code, parentEl) {
  try {
    const now = new Date();
    const startDate = new Date(now.getFullYear() - 3, 0, 1);
    const startStr = `${startDate.getFullYear()}-01-01`;
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockFinancialStatements&data_id=${code}&start_date=${startStr}`;
    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    const resp = await fetch(proxyUrl);
    if (!resp.ok) return;
    const json = await resp.json();
    const rows = json.data || [];
    if (rows.length === 0) return;

    // Group by date (quarter), extract EPS
    const byQuarter = {};
    rows.forEach(r => {
      const dt = r.date || '';
      const type = r.type || '';
      const val = parseFloat(r.value) || 0;
      if (!dt) return;
      if (!byQuarter[dt]) byQuarter[dt] = {};
      if (type === 'EPS') byQuarter[dt].eps = val;
      else if (type === 'Revenue') byQuarter[dt].revenue = val;
      else if (type === 'NetIncome') byQuarter[dt].netIncome = val;
      else if (type === 'OperatingIncome') byQuarter[dt].opIncome = val;
    });

    const quarters = Object.keys(byQuarter).sort();
    const epsData = quarters.filter(q => byQuarter[q].eps !== undefined).map(q => ({
      quarter: q, eps: byQuarter[q].eps,
      revenue: byQuarter[q].revenue || 0,
      netIncome: byQuarter[q].netIncome || 0,
    }));

    if (epsData.length < 2) return;

    const chartEl = document.getElementById('quarterly-history-chart');
    if (!chartEl) return;
    chartEl.innerHTML = '<div class="text-sm" style="color:var(--cyan);font-weight:600;margin-bottom:6px;">季度 EPS 趨勢 (近3年)</div><div id="qtr-hist-box" style="height:200px;"></div>';
    const box = document.getElementById('qtr-hist-box');
    if (!box || box.clientWidth === 0) return;

    const chart = LightweightCharts.createChart(box, {
      width: box.clientWidth, height: 200,
      layout: { background: { color: 'transparent' }, textColor: '#8896b3', fontSize: 10 },
      grid: { vertLines: { color: 'rgba(0,240,255,0.04)' }, horzLines: { color: 'rgba(0,240,255,0.04)' } },
      timeScale: { borderColor: 'rgba(0,240,255,0.1)' },
      rightPriceScale: { borderColor: 'rgba(0,240,255,0.1)', scaleMargins: { top: 0.1, bottom: 0.1 } },
    });

    const barSeries = chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    barSeries.setData(epsData.map(d => ({
      time: d.quarter,
      value: d.eps,
      color: d.eps >= 0 ? 'rgba(255,56,96,0.65)' : 'rgba(0,232,123,0.65)',
    })));

    chart.timeScale().fitContent();
  } catch(e) {
    console.warn('[CT] Quarterly history chart error:', e);
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
    const dividendYear = found[4] || '';
    const pe = found[5] || '--';
    const pb = found[6] || '--';
    const period = found[7] || '';
    const dividendYearStr = dividendYear ? `以${parseInt(dividendYear)+1911}年股利計算` : '';
    const peNote = period ? '以近四季EPS計算' : '';

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box">
          <div class="label">本益比 (PE)</div>
          <div class="value" style="color:var(--cyan);font-size:20px;">${pe === '-' ? 'N/A' : pe}</div>
          ${peNote ? `<div class="text-sm text-muted" style="margin-top:2px;">${peNote}</div>` : ''}
        </div>
        <div class="stat-box">
          <div class="label">股價淨值比 (PB)</div>
          <div class="value" style="color:var(--purple);font-size:20px;">${pb}</div>
        </div>
        <div class="stat-box">
          <div class="label">殖利率</div>
          <div class="value" style="color:var(--yellow);font-size:20px;">${yield_}%</div>
          ${dividendYearStr ? `<div class="text-sm text-muted" style="margin-top:2px;">${dividendYearStr}</div>` : ''}
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
    let data = null, marginDate = '';
    for (let i = 0; i < 7; i++) {
      const d = dateStr(i);
      try {
        const res = await API_TWSE.marginTrade(d);
        if (res && res.stat === 'OK' && res.tables && res.tables.length > 1) {
          const t = res.tables[1];
          if (t.data && t.data.length > 0) {
            data = res;
            marginDate = d;
            break;
          }
        }
      } catch(e) {}
    }
    if (!data) {
      el.innerHTML = '<div class="text-muted">暫無融資融券資料</div>';
      return;
    }
    const table = data.tables[1];
    const rows = table.data;
    const found = rows.find(r => (r[0] || '').trim() === code);
    if (!found) {
      el.innerHTML = '<div class="text-muted">此股票無融資融券資料</div>';
      return;
    }

    // Build field name -> index mapping from table headers
    const fields = table.fields || [];
    const fi = {};
    fields.forEach((f, idx) => { fi[f.trim()] = idx; });

    // Helper: get value by field name, fallback to index
    function gv(name, fallbackIdx) {
      const idx = fi[name] !== undefined ? fi[name] : fallbackIdx;
      return idx !== undefined && idx < found.length ? found[idx] : '0';
    }

    const mBuy = fmtNum(parseNum(gv('買進', 2)));
    const mSell = fmtNum(parseNum(gv('賣出', 3)));
    const mPrevBal = fmtNum(parseNum(gv('前日餘額', 5)));
    const mBalVal = parseNum(gv('今日餘額', 6));
    const mBal = fmtNum(mBalVal);
    const mChg = mBalVal - parseNum(gv('前日餘額', 5));
    const mLimitNum = parseNum(gv('限額', 7));

    // Short selling fields - match by name to handle variable column positions
    // Look for fields that contain specific keywords in the short section
    let sBuyIdx = fi['買進'] !== undefined ? fi['買進'] : 8;
    let sSellIdx = fi['賣出'] !== undefined ? fi['賣出'] : 9;
    let sPrevBalIdx = fi['前日餘額'] !== undefined ? fi['前日餘額'] : 11;
    let sBalIdx = fi['今日餘額'] !== undefined ? fi['今日餘額'] : 12;
    let sLimitIdx = fi['限額'] !== undefined ? fi['限額'] : 13;
    let offsetIdx = fi['資券互抵'] !== undefined ? fi['資券互抵'] : 14;

    // Smarter detection: scan field names for duplicate names (融資 section vs 融券 section)
    // The TWSE MI_MARGN table has repeated field names: 買進, 賣出, etc. appear twice
    // First occurrence = 融資, second = 融券
    const fieldDups = {};
    fields.forEach((f, idx) => {
      const name = f.trim();
      if (!fieldDups[name]) fieldDups[name] = [];
      fieldDups[name].push(idx);
    });
    if (fieldDups['買進'] && fieldDups['買進'].length >= 2) sBuyIdx = fieldDups['買進'][1];
    if (fieldDups['賣出'] && fieldDups['賣出'].length >= 2) sSellIdx = fieldDups['賣出'][1];
    if (fieldDups['前日餘額'] && fieldDups['前日餘額'].length >= 2) sPrevBalIdx = fieldDups['前日餘額'][1];
    if (fieldDups['今日餘額'] && fieldDups['今日餘額'].length >= 2) sBalIdx = fieldDups['今日餘額'][1];
    if (fieldDups['限額'] && fieldDups['限額'].length >= 2) sLimitIdx = fieldDups['限額'][1];
    // 資券互抵 only appears once, also check for 資券相抵
    if (fieldDups['資券互抵']) offsetIdx = fieldDups['資券互抵'][0];
    else if (fieldDups['資券相抵']) offsetIdx = fieldDups['資券相抵'][0];

    const sBuyVal = parseNum(found[sBuyIdx] || '0');
    const sSellVal = parseNum(found[sSellIdx] || '0');
    const sPrevBalVal = parseNum(found[sPrevBalIdx] || '0');
    const sBalVal = parseNum(found[sBalIdx] || '0');
    const sLimitNum = parseNum(found[sLimitIdx] || '0');
    const offsetVal = parseNum(found[offsetIdx] || '0');

    const sBuy = fmtNum(sBuyVal);
    const sSell = fmtNum(sSellVal);
    const sBal = fmtNum(sBalVal);
    const sChg = sBalVal - sPrevBalVal;

    // Calculate key ratios
    const marginUtil = mLimitNum > 0 ? (mBalVal / mLimitNum * 100).toFixed(1) : '--';
    const shortRatio = mBalVal > 0 ? (sBalVal / mBalVal * 100).toFixed(1) : '--';
    const mLimitStr = fmtNum(mLimitNum);
    const sLimitStr = fmtNum(sLimitNum);
    const shortUtil = sLimitNum > 0 ? (sBalVal / sLimitNum * 100).toFixed(1) : '--';

    const dateDisplay = marginDate ? `${marginDate.slice(0,4)}/${marginDate.slice(4,6)}/${marginDate.slice(6,8)}` : '';

    el.innerHTML = `
      ${dateDisplay ? `<div class="text-sm" style="margin-bottom:10px;color:var(--cyan);font-weight:600;">資料日期：${dateDisplay}</div>` : ''}
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-box">
          <div class="label">融資餘額（張）</div>
          <div class="value" style="color:var(--red);font-size:18px;">${mBal}</div>
          <div class="text-sm text-muted">使用率 <span style="color:var(--cyan);font-weight:600;">${marginUtil}%</span></div>
        </div>
        <div class="stat-box">
          <div class="label">融券餘額（張）</div>
          <div class="value" style="color:var(--green);font-size:18px;">${sBal}</div>
          <div class="text-sm text-muted">使用率 <span style="color:var(--cyan);font-weight:600;">${shortUtil}%</span></div>
        </div>
        <div class="stat-box">
          <div class="label">券資比</div>
          <div class="value" style="color:${parseFloat(shortRatio)>20?'var(--red)':'var(--yellow)'};font-size:20px;">${shortRatio}%</div>
        </div>
        <div class="stat-box">
          <div class="label">資券互抵</div>
          <div class="value">${fmtNum(offsetVal)}</div>
        </div>
      </div>
      <div class="grid-2" style="gap:16px;">
        <div>
          <div class="text-sm" style="color:var(--red);font-weight:600;margin-bottom:8px;">融資（張）</div>
          <div class="stat-grid">
            <div class="stat-box"><div class="label">買進</div><div class="value">${mBuy}</div></div>
            <div class="stat-box"><div class="label">賣出</div><div class="value">${mSell}</div></div>
            <div class="stat-box"><div class="label">限額</div><div class="value">${mLimitStr}</div></div>
          </div>
          <div class="text-sm ${mChg>=0?'up':'down'}" style="margin-top:4px;">增減：${mChg>0?'+':''}${fmtNum(mChg)}</div>
        </div>
        <div>
          <div class="text-sm" style="color:var(--green);font-weight:600;margin-bottom:8px;">融券（張）</div>
          <div class="stat-grid">
            <div class="stat-box"><div class="label">買進</div><div class="value">${sBuy}</div></div>
            <div class="stat-box"><div class="label">賣出</div><div class="value">${sSell}</div></div>
            <div class="stat-box"><div class="label">限額</div><div class="value">${sLimitStr}</div></div>
          </div>
          <div class="text-sm ${sChg>=0?'up':'down'}" style="margin-top:4px;">增減：${sChg>0?'+':''}${fmtNum(sChg)}</div>
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="text-muted">融資融券載入失敗</div>';
  }
}

// ============================================================
// FETCH: Stock Events — K-line markers (法說會, 除息日)
// ============================================================
var _stockEventsByDate = {};

async function fetchStockEvents(code, chartDates) {
  _stockEventsByDate = {};
  try {
    var resp = await fetch('/api/stock-events/' + encodeURIComponent(code));
    if (!resp.ok) return;
    var data = await resp.json();
    var events = data.events || [];
    if (events.length === 0 || !sCan) return;

    // Build date set for quick lookup
    var dateSet = {};
    if (chartDates) chartDates.forEach(function(d) { dateSet[d] = true; });

    var markers = [];
    var isMob = window.innerWidth <= 768;
    events.forEach(function(ev) {
      var d = ev.date;
      if (!dateSet[d]) return;

      if (ev.type === '法說會') {
        markers.push({
          time: d,
          position: 'belowBar',
          color: '#b44dff',
          shape: 'arrowUp',
          text: isMob ? '\u6CD5' : '\u6CD5\u8AAC',  // 法 or 法說
        });
      } else if (ev.type === '除息日' || ev.type === '除息') {
        markers.push({
          time: d,
          position: 'aboveBar',
          color: '#ffd036',
          shape: 'circle',
          text: ev.amount ? (isMob ? '$' + ev.amount : '\u9664\u606F $' + ev.amount) : (isMob ? '\u9664' : '\u9664\u606F'),
        });
      }

      // Store for tooltip
      if (!_stockEventsByDate[d]) _stockEventsByDate[d] = [];
      _stockEventsByDate[d].push(ev);
    });

    // LightweightCharts requires markers sorted by time ascending
    markers.sort(function(a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    sCan.setMarkers(markers);
  } catch(e) {
    console.warn('[CT] fetchStockEvents error:', e);
  }
}

// K-line chart click handler — show event tooltip
var _klineEventTipActive = false;

function initKlineEventTooltip() {
  if (!chtMain || _klineEventTipActive) return;
  _klineEventTipActive = true;

  chtMain.subscribeClick(function(param) {
    // Dismiss existing tooltip
    var existing = document.getElementById('kline-event-tip');
    if (existing) existing.remove();

    if (!param || !param.time) return;

    // Format date key
    var dateKey = '';
    if (typeof param.time === 'object') {
      dateKey = param.time.year + '-' + String(param.time.month).padStart(2, '0') + '-' + String(param.time.day).padStart(2, '0');
    } else {
      dateKey = String(param.time);
    }

    var evts = _stockEventsByDate[dateKey];
    if (!evts || evts.length === 0) return;

    // Build tooltip HTML
    var html = '<div class="kline-event-tip-close" onclick="this.parentElement.remove()">\u2715</div>';
    html += '<div class="tt-date">' + dateKey + '</div>';
    evts.forEach(function(ev) {
      html += '<div class="kline-event-row">';
      html += '<span class="kline-event-type">' + ev.type + '</span>';
      if (ev.amount) html += '<span class="kline-event-amt">' + ev.amount + ' \u5143</span>';
      if (ev.title) html += '<div class="kline-event-title">' + ev.title + '</div>';
      if (ev.url) html += '<a href="' + ev.url + '" target="_blank" rel="noopener" class="kline-event-link">\u8A73\u60C5 \u2192</a>';
      html += '</div>';
    });

    var tip = document.createElement('div');
    tip.id = 'kline-event-tip';
    tip.className = 'kline-event-tooltip';
    tip.innerHTML = html;

    // Position near click point
    var chartEl = document.getElementById('main-chart');
    chartEl.style.position = 'relative';
    chartEl.appendChild(tip);
    var tx = (param.point ? param.point.x : 100) - tip.offsetWidth / 2;
    var ty = (param.point ? param.point.y : 100) - tip.offsetHeight - 14;
    if (tx < 4) tx = 4;
    if (tx + tip.offsetWidth > chartEl.clientWidth - 4) tx = chartEl.clientWidth - tip.offsetWidth - 4;
    if (ty < 4) ty = (param.point ? param.point.y : 100) + 14;
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
  });
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
    const instTotal = (instInfo.f || 0) + (instInfo.t || 0) + (instInfo.d || 0);
    instHtml = `<div class="chip-inst">
      ${instBar('外資', instInfo.f)}
      ${instBar('投信', instInfo.t)}
      ${instBar('自營', instInfo.d)}
      <div class="chip-inst-row" style="border-top:1px solid var(--border);padding-top:6px;margin-top:6px;">
        <span class="chip-inst-label" style="font-weight:700;">合計</span>
        <div class="chip-inst-bar-wrap">
          <div class="chip-inst-bar" style="width:${Math.abs(instTotal)/maxInst*100}%;background:${instTotal>=0?'var(--red)':'var(--green)'};"></div>
        </div>
        <span class="chip-inst-val ${instTotal>=0?'up':'down'}" style="font-weight:700;">${instTotal>0?'+':''}${fmtShares(instTotal)}</span>
      </div>
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
