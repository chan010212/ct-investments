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
