// ============================================================
// CT Investments — AI 多因子評分模型
// 取代原本 app.js 中簡單加權公式，改為多維度技術分析評分
// ============================================================

// 多因子 AI 評分（個股分析用，擁有完整歷史資料）
function aiScoreMultiFactor(C, H, L, V, inst) {
  var n = C.length;
  if (n < 30) return { total: 50, d: {} };
  var i = n - 1, p = n - 2;

  var rsi = TA.rsi(C);
  var macdData = TA.macd(C);
  var dif = macdData.dif, sig = macdData.sig, hist = macdData.hist;
  var kdData = TA.kd(H, L, C);
  var K = kdData.K, D = kdData.D;
  var ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20);
  var ma60 = TA.sma(C, 60);

  var d = {};

  // === 1. RSI 訊號 (0~15) ===
  var rs = 8;
  if (rsi[i] != null) {
    if (rsi[i] < 25) rs = 14;       // 嚴重超賣，反彈機率高
    else if (rsi[i] < 35) rs = 12;  // 超賣區
    else if (rsi[i] < 45) rs = 10;
    else if (rsi[i] < 55) rs = 8;   // 中性
    else if (rsi[i] < 65) rs = 7;
    else if (rsi[i] < 75) rs = 5;
    else rs = 2;                     // 嚴重超買
    // RSI 背離加分：價格創新高但 RSI 沒有 → 頂背離扣分
    if (n > 20) {
      var priceHigh20 = Math.max.apply(null, C.slice(-20));
      var rsiHigh20 = -Infinity;
      for (var ri = n - 20; ri < n; ri++) { if (rsi[ri] != null && rsi[ri] > rsiHigh20) rsiHigh20 = rsi[ri]; }
      if (C[i] >= priceHigh20 * 0.99 && rsi[i] != null && rsi[i] < rsiHigh20 - 5) rs = Math.max(0, rs - 2); // 頂背離
      var priceLow20 = Math.min.apply(null, C.slice(-20));
      if (C[i] <= priceLow20 * 1.01 && rsi[i] != null && rsi[i] > (function() { var m = Infinity; for (var j = n-20; j < n; j++) { if (rsi[j] != null && rsi[j] < m) m = rsi[j]; } return m; })() + 5) rs = Math.min(15, rs + 2); // 底背離
    }
  }
  d['RSI'] = rs;

  // === 2. MACD 動能 (0~15) ===
  var ms = 8;
  if (dif[i] != null && sig[i] != null) {
    var golden = dif[i] > sig[i] && dif[p] <= sig[p]; // 金叉
    var death  = dif[i] < sig[i] && dif[p] >= sig[p]; // 死叉
    var histRising = hist[i] > hist[p];                // 柱體擴大

    if (golden && dif[i] < 0) ms = 15;       // 零軸下金叉（最強）
    else if (golden) ms = 13;                 // 一般金叉
    else if (dif[i] > sig[i] && histRising) ms = 12;  // 多頭且加速
    else if (dif[i] > sig[i]) ms = 10;       // 多頭
    else if (death && dif[i] > 0) ms = 2;    // 零軸上死叉（最弱）
    else if (death) ms = 3;                   // 一般死叉
    else if (dif[i] < sig[i] && !histRising) ms = 4;  // 空頭且加速
    else ms = 6;                              // 空頭減速
  }
  d['MACD'] = ms;

  // === 3. KD 訊號 (0~15) ===
  var ks = 8;
  if (K[i] != null && D[i] != null) {
    var kGolden = K[i] > D[i] && K[p] <= D[p];
    var kDeath  = K[i] < D[i] && K[p] >= D[p];

    if (kGolden && K[i] < 25) ks = 15;       // 低檔金叉（最強買訊）
    else if (kGolden && K[i] < 50) ks = 13;
    else if (kGolden) ks = 11;
    else if (K[i] > D[i] && K[i] < 50) ks = 10; // 多頭低檔
    else if (K[i] > D[i]) ks = 8;              // 多頭高檔
    else if (kDeath && K[i] > 80) ks = 2;      // 高檔死叉（最強賣訊）
    else if (kDeath) ks = 4;
    else if (K[i] < D[i] && K[i] > 50) ks = 5;
    else ks = 6;
  }
  d['KD'] = ks;

  // === 4. 均線排列 (0~20) ===
  var mas = 10;
  var c = C[i];
  var m5  = ma5[i],  m10 = ma10[i], m20 = ma20[i], m60 = ma60[i];
  var hasAll = m5 != null && m10 != null && m20 != null;
  var has60  = m60 != null;

  if (hasAll) {
    var above5 = c > m5, above10 = c > m10, above20 = c > m20;
    var above60 = has60 ? c > m60 : null;
    var aligned3 = m5 > m10 && m10 > m20;   // 三線多頭排列
    var aligned4 = aligned3 && has60 && m20 > m60; // 四線多頭排列

    if (aligned4 && above5) mas = 20;        // 完美多頭
    else if (aligned3 && above5 && above60 !== false) mas = 18;
    else if (aligned3 && above5) mas = 16;
    else if (above5 && above10 && above20) mas = 14; // 站穩均線但未完美排列
    else if (above5 && above10) mas = 11;
    else if (above5) mas = 8;
    else if (!above5 && !above10 && !above20) {
      // 空頭排列
      var bearAligned = m5 < m10 && m10 < m20;
      mas = bearAligned ? 2 : 4;
    } else mas = 6;

    // 均線糾結加分（準備變盤）
    if (hasAll && Math.abs(m5 - m20) / m20 < 0.02) {
      mas = Math.min(20, mas + 2); // 均線糾結，可能突破
    }
  }
  d['均線'] = mas;

  // === 5. 量價關係 (0~15) ===
  var vs = 8;
  var avgV5  = _avgSlice(V, 5);
  var avgV20 = _avgSlice(V, 20);
  var volRatio = avgV20 > 0 ? V[i] / avgV20 : 1;
  var priceUp = C[i] > C[p];
  var priceUp5 = C[i] > C[Math.max(0, i - 5)];

  // 量增價漲 = 健康多頭
  if (priceUp && volRatio > 1.5) vs = 14;
  else if (priceUp && volRatio > 1.0) vs = 12;
  // 量縮價漲 = 追價力道不足（偏弱多）
  else if (priceUp && volRatio < 0.6) vs = 7;
  // 量增價跌 = 恐慌出貨
  else if (!priceUp && volRatio > 2.0) vs = 3;
  else if (!priceUp && volRatio > 1.5) vs = 4;
  // 量縮價跌 = 可能打底
  else if (!priceUp && volRatio < 0.5) vs = 9;
  else if (!priceUp) vs = 5;
  else vs = 8;

  // 連續放量趨勢
  if (avgV5 > avgV20 * 1.3 && priceUp5) vs = Math.min(15, vs + 2);
  d['量價'] = vs;

  // === 6. 法人動向 (0~10) ===
  var is_ = 5;
  if (inst) {
    var fBuy = inst.f > 0 ? 1 : 0;
    var tBuy = inst.t > 0 ? 1 : 0;
    var dBuy = inst.d > 0 ? 1 : 0;
    var buys = fBuy + tBuy + dBuy;

    if (buys === 3) is_ = 10;
    else if (buys === 2) {
      // 外資+投信同買最佳
      is_ = (fBuy && tBuy) ? 9 : 7;
    }
    else if (buys === 1) {
      is_ = tBuy ? 6 : 5; // 投信獨買稍優
    }
    else is_ = 2; // 三大法人全賣
  }
  d['法人'] = is_;

  // === 7. 趨勢動能 (0~10) — 近期漲跌幅 + 動能 ===
  var ts = 5;
  if (n > 20) {
    var pct5  = C[Math.max(0, i-5)]  > 0 ? (C[i] / C[Math.max(0, i-5)]  - 1) * 100 : 0;
    var pct20 = C[Math.max(0, i-20)] > 0 ? (C[i] / C[Math.max(0, i-20)] - 1) * 100 : 0;

    // 適度上漲最佳，暴漲或暴跌都扣分
    if (pct20 > 20) ts = 4;        // 短線漲太多，小心回檔
    else if (pct20 > 10) ts = 8;   // 強勢上漲
    else if (pct20 > 3) ts = 10;   // 穩健上漲（最佳）
    else if (pct20 > -3) ts = 6;   // 盤整
    else if (pct20 > -10) ts = 4;  // 弱勢
    else ts = 3;                    // 大幅下跌

    // 5日動能加速判斷
    if (pct5 > 5 && pct20 > 0) ts = Math.min(10, ts + 1);
    if (pct5 < -5 && pct20 < 0) ts = Math.max(0, ts - 1);
  }
  d['趨勢'] = ts;

  // === 加總 ===
  var total = rs + ms + ks + mas + vs + is_ + ts;
  // 最高 15+15+15+20+15+10+10 = 100

  return { total: total, d: d };
}

// 輔助：計算最近 N 根的平均值
function _avgSlice(arr, period) {
  var s = arr.slice(-period);
  if (s.length === 0) return 0;
  var sum = 0;
  for (var j = 0; j < s.length; j++) sum += s[j];
  return sum / s.length;
}

// === AI 排行榜增強評分 ===
// 用於 renderAIRank()，只有當日資料，但評分更精細
function aiRankScoreEnhanced(s, inst) {
  var score = 50;

  // 1. 法人面 (max ±20)
  if (inst) {
    var fBuy = inst.f > 0 ? 1 : 0;
    var tBuy = inst.t > 0 ? 1 : 0;
    var dBuy = inst.d > 0 ? 1 : 0;
    var buys = fBuy + tBuy + dBuy;
    var sells = 3 - buys;

    // 同買/同賣
    if (buys === 3) score += 18;
    else if (buys === 2 && fBuy && tBuy) score += 14; // 外資+投信
    else if (buys === 2) score += 10;
    else if (buys === 1 && tBuy) score += 5; // 投信獨買
    else if (buys === 1) score += 3;
    else if (sells === 3) score -= 12;
    else score -= 5;

    // 法人買超量體（大量買超更有意義）
    var totalNet = (inst.f || 0) + (inst.t || 0) + (inst.d || 0);
    if (totalNet > 5000) score += 3;      // 合計買超 5000 張以上
    else if (totalNet > 1000) score += 1;
    else if (totalNet < -5000) score -= 3;
    else if (totalNet < -1000) score -= 1;
  }

  // 2. 價格動能 (max ±15)
  var pct = s.pct || 0;
  if (pct > 5) score += 10;
  else if (pct > 3) score += 12;       // 強勢但未漲停（最佳）
  else if (pct > 1) score += 8;
  else if (pct > 0) score += 4;
  else if (pct > -1) score += 0;
  else if (pct > -3) score -= 5;
  else if (pct > -5) score -= 8;
  else score -= 10;                     // 跌停附近

  // 漲停打折（追高風險）
  if (pct >= 9.5) score -= 5;

  // 3. 量能 (max ±10)
  var vol = s.vol || 0;
  if (vol > 1e7) score += 5;           // 成交量破萬張
  else if (vol > 5e6) score += 3;
  else if (vol > 1e6) score += 1;
  else if (vol < 200000) score -= 3;   // 冷門股扣分

  // 4. 價格區間偏好 (±5)
  var close = s.close || 0;
  if (close >= 20 && close <= 500) score += 2;  // 中價股最受法人青睞
  else if (close < 10) score -= 3;               // 雞蛋水餃股
  else if (close > 1000) score += 0;              // 高價股中性

  score = Math.max(0, Math.min(100, score));
  return score;
}

// === 更新 scoreLabel 支援新的分數區間 ===
function scoreLabelEnhanced(s) {
  if (s >= 80) return { text: '強力看多', cls: 'tag-strong', color: 'var(--green)' };
  if (s >= 70) return { text: '看多', cls: 'tag-buy', color: 'var(--green)' };
  if (s >= 55) return { text: '偏多', cls: 'tag-buy', color: '#4dabf7' };
  if (s >= 45) return { text: '中性', cls: 'tag-hold', color: 'var(--yellow)' };
  if (s >= 35) return { text: '偏空', cls: 'tag-sell', color: 'var(--orange)' };
  if (s >= 20) return { text: '看空', cls: 'tag-sell', color: 'var(--red)' };
  return { text: '強力看空', cls: 'tag-sell', color: 'var(--red)' };
}

// ============================================================
// AI 深度分析報告（從 app-stock.js 搬移）
// ============================================================
function generateDeepAnalysis(code, name, C, H, L, V, O, dates, instInfo) {
  const n = C.length;
  if (n < 20) return '<div class="text-muted">資料不足，無法產生完整分析</div>';

  const i = n - 1;
  const lastC = C[i], lastO = O[i], lastH = H[i], lastL = L[i], lastV = V[i];
  const prevC = C[i-1];
  const chg = lastC - prevC;
  const pct = prevC > 0 ? (chg / prevC * 100) : 0;

  const ma5 = TA.sma(C, 5), ma10 = TA.sma(C, 10), ma20 = TA.sma(C, 20), ma60 = TA.sma(C, Math.min(60, n));
  const rsi = TA.rsi(C);
  const macd = TA.macd(C);
  const kd = TA.kd(H, L, C);
  const bb = TA.boll(C);

  const avgV5 = V.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgV20 = V.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volRatio = avgV20 > 0 ? (lastV / avgV20) : 1;

  const c20ago = n > 20 ? C[i - 20] : C[0];
  const trend20 = ((lastC - c20ago) / c20ago * 100);
  const c5ago = n > 5 ? C[i - 5] : C[0];
  const trend5 = ((lastC - c5ago) / c5ago * 100);

  const recent20H = Math.max(...H.slice(-20));
  const recent20L = Math.min(...L.slice(-20));
  const priceRange = recent20H - recent20L;
  const posInRange = priceRange > 0 ? ((lastC - recent20L) / priceRange * 100) : 50;

  const support1 = ma20[i] || recent20L;
  const support2 = recent20L;
  const resistance1 = bb.up[i] || recent20H;
  const resistance2 = recent20H;

  let scores = {};

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

  let rsiScore = 5;
  const rsiVal = rsi[i];
  if (rsiVal != null) {
    if (rsiVal < 20) rsiScore = 9;
    else if (rsiVal < 30) rsiScore = 8;
    else if (rsiVal < 40) rsiScore = 7;
    else if (rsiVal < 55) rsiScore = 6;
    else if (rsiVal < 65) rsiScore = 5;
    else if (rsiVal < 75) rsiScore = 4;
    else if (rsiVal < 85) rsiScore = 3;
    else rsiScore = 2;
  }
  scores['RSI 指標'] = rsiScore;

  let macdScore = 5;
  const difVal = macd.dif[i], sigVal = macd.sig[i], histVal = macd.hist[i];
  const prevHist = i > 0 ? macd.hist[i-1] : 0;
  if (difVal > sigVal && histVal > prevHist) macdScore = 8;
  else if (difVal > sigVal) macdScore = 7;
  else if (difVal > sigVal && histVal < prevHist) macdScore = 6;
  else if (difVal < sigVal && histVal > prevHist) macdScore = 4;
  else if (difVal < sigVal) macdScore = 3;
  else if (difVal < sigVal && histVal < prevHist) macdScore = 2;
  if (macd.dif[i] > 0 && macd.dif[i-1] <= 0) macdScore = 9;
  scores['MACD'] = Math.min(10, Math.max(1, macdScore));

  let kdScore = 5;
  const kVal = kd.K[i], dVal = kd.D[i];
  if (kVal > dVal && kVal < 30) kdScore = 9;
  else if (kVal > dVal && kVal < 50) kdScore = 7;
  else if (kVal > dVal) kdScore = 6;
  else if (kVal < dVal && kVal > 80) kdScore = 2;
  else if (kVal < dVal && kVal > 50) kdScore = 4;
  else kdScore = 3;
  scores['KD 指標'] = Math.min(10, Math.max(1, kdScore));

  let volScore = 5;
  if (volRatio > 2 && chg > 0) volScore = 9;
  else if (volRatio > 1.5 && chg > 0) volScore = 8;
  else if (volRatio > 1 && chg > 0) volScore = 7;
  else if (volRatio > 2 && chg < 0) volScore = 2;
  else if (volRatio > 1.5 && chg < 0) volScore = 3;
  else if (volRatio < 0.5) volScore = 4;
  scores['量能分析'] = Math.min(10, Math.max(1, volScore));

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

  let bbScore = 5;
  if (bb.up[i] && bb.dn[i]) {
    if (lastC > bb.up[i]) bbScore = 3;
    else if (lastC < bb.dn[i]) bbScore = 8;
    else if (posInRange > 80) bbScore = 4;
    else if (posInRange < 20) bbScore = 7;
    else bbScore = 5;
  }
  scores['布林通道'] = bbScore;

  const weights = { '趨勢動能': 2, 'RSI 指標': 1.5, 'MACD': 1.5, 'KD 指標': 1, '量能分析': 1.5, '法人動向': 2, '布林通道': 0.5 };
  let totalW = 0, weightedSum = 0;
  for (const [k, v] of Object.entries(scores)) {
    const w = weights[k] || 1;
    weightedSum += v * w;
    totalW += w;
  }
  const overallScore = (weightedSum / totalW).toFixed(1);

  let verdict, verdictColor, verdictIcon;
  if (overallScore >= 8) { verdict = '強力看多'; verdictColor = 'var(--green)'; verdictIcon = '&#x1F680;'; }
  else if (overallScore >= 6.5) { verdict = '偏多操作'; verdictColor = 'var(--green)'; verdictIcon = '&#x2B06;'; }
  else if (overallScore >= 5) { verdict = '中性觀望'; verdictColor = 'var(--yellow)'; verdictIcon = '&#x2796;'; }
  else if (overallScore >= 3.5) { verdict = '偏空保守'; verdictColor = 'var(--orange)'; verdictIcon = '&#x2B07;'; }
  else { verdict = '強力看空'; verdictColor = 'var(--red)'; verdictIcon = '&#x26A0;'; }

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

  let strategy = '';
  if (overallScore >= 7) {
    strategy = `建議策略：可考慮於 ${fmtNum(support1, 2)} 附近逢低佈局，停損設在 ${fmtNum(support2, 2)} 以下。短線目標價 ${fmtNum(resistance1, 2)}，突破後看 ${fmtNum(resistance2, 2)}。`;
  } else if (overallScore >= 5) {
    strategy = `建議策略：維持觀望，等待明確方向。若站穩 ${fmtNum(ma20[i] || support1, 2)} 可小量試單。跌破 ${fmtNum(support2, 2)} 則轉為偏空看待。`;
  } else {
    strategy = `建議策略：短線偏空，建議降低持股比重。反彈至 ${fmtNum(ma10[i] || resistance1, 2)} 附近可減碼。若跌破 ${fmtNum(support2, 2)} 恐進一步下探。`;
  }

  let html = '';
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

  html += `<div style="font-size:10px;color:var(--text2);text-align:center;padding-top:8px;border-top:1px solid var(--border);">
    &#x26A0; 以上分析由系統根據技術指標自動生成，僅供參考，不構成投資建議。投資有風險，請審慎評估。
  </div>`;

  return html;
}
