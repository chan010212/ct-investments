// ============================================================
// CT Investments — 快速下單（券商導向）
// 查詢報價 + 五檔 → 導向用戶選擇的券商下單
// ============================================================

// === 狀態 ===
var _tradeState = {
  code: '',
  name: '',
  prevClose: 0,
  limitUp: 0,
  limitDown: 0,
  currentPrice: 0,
};

// === 券商連結設定 ===
var BROKER_LINKS = {
  sinopac: {
    name: '永豐金證券',
    web: 'https://www.sinotrade.com.tw/',
    note: '永豐金證券線上交易平台'
  },
  yuanta: {
    name: '元大證券',
    web: 'https://www.yuanta.com.tw/',
    note: '元大證券線上交易平台'
  },
  cathay: {
    name: '國泰證券',
    web: 'https://www.cathaysec.com.tw/',
    note: '國泰證券線上交易平台'
  },
  fubon: {
    name: '富邦證券',
    web: 'https://www.fbs.com.tw/',
    note: '富邦證券線上交易平台'
  },
  kgi: {
    name: '凱基證券',
    web: 'https://www.kgieworld.com.tw/',
    note: '凱基證券線上交易平台'
  },
  mega: {
    name: '兆豐證券',
    web: 'https://www.emega.com.tw/',
    note: '兆豐證券線上交易平台'
  }
};

// === 初始化 ===
function initTradingTab() {
  var codeInput = document.getElementById('trade-code');
  if (codeInput) {
    codeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') tradeLoadQuote();
    });
  }

  // 如果從個股分析帶入代號
  if (window._tradePrefill) {
    if (codeInput) codeInput.value = window._tradePrefill;
    window._tradePrefill = null;
    tradeLoadQuote();
  }
}

// === 查詢報價 ===
async function tradeLoadQuote() {
  var code = document.getElementById('trade-code').value.trim();
  if (!code) { toast('請輸入股票代號'); return; }
  _tradeState.code = code;

  var quoteBox = document.getElementById('trade-quote-info');
  quoteBox.style.display = 'block';
  document.getElementById('trade-quote-name').textContent = '查詢中...';
  document.getElementById('trade-quote-price').textContent = '--';

  try {
    // 從 gStockDB 取得名稱
    var db = typeof gStockDB !== 'undefined' ? gStockDB : {};
    var entry = db[code];
    var name = entry ? entry.name : code;
    _tradeState.name = name;

    // 嘗試即時報價
    var price = 0, prevClose = 0;
    if (typeof fetchRealtimeQuote === 'function') {
      try {
        var rt = await fetchRealtimeQuote(code);
        if (rt && rt.price > 0) {
          price = rt.price;
          prevClose = rt.prevClose || 0;
        }
      } catch(e) {}
    }

    // Fallback: 從 gStockDB
    if (price === 0 && entry) {
      price = entry.close || 0;
      prevClose = entry.prevClose || (price > 0 ? price : 0);
    }

    _tradeState.currentPrice = price;
    _tradeState.prevClose = prevClose;

    // 計算漲跌停（台股 10%）
    if (prevClose > 0) {
      _tradeState.limitUp = Math.round(prevClose * 1.1 * 100) / 100;
      _tradeState.limitDown = Math.round(prevClose * 0.9 * 100) / 100;
    }

    // 顯示資訊
    document.getElementById('trade-quote-name').textContent = code + ' ' + name;
    var chg = prevClose > 0 ? price - prevClose : 0;
    var pct = prevClose > 0 ? (chg / prevClose * 100) : 0;
    var color = chg > 0 ? 'var(--red)' : chg < 0 ? 'var(--green)' : 'var(--text)';
    document.getElementById('trade-quote-price').innerHTML =
      '<span style="font-size:28px;font-weight:700;color:' + color + ';">' + (price > 0 ? price.toFixed(2) : '--') + '</span>' +
      (chg !== 0 ? ' <span style="color:' + color + ';font-size:14px;">' + (chg > 0 ? '+' : '') + chg.toFixed(2) + ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%)</span>' : '');

    document.getElementById('trade-limit-up').textContent = _tradeState.limitUp > 0 ? _tradeState.limitUp.toFixed(2) : '--';
    document.getElementById('trade-limit-up').style.color = 'var(--red)';
    document.getElementById('trade-limit-down').textContent = _tradeState.limitDown > 0 ? _tradeState.limitDown.toFixed(2) : '--';
    document.getElementById('trade-limit-down').style.color = 'var(--green)';
    document.getElementById('trade-prev-close').textContent = prevClose > 0 ? prevClose.toFixed(2) : '--';

    // 載入五檔報價
    tradeLoadOrderbook(code);

  } catch(e) {
    document.getElementById('trade-quote-name').textContent = code;
    document.getElementById('trade-quote-price').textContent = '報價取得失敗';
  }
}

// === 五檔報價 ===
async function tradeLoadOrderbook(code) {
  var el = document.getElementById('trade-orderbook');
  if (!el) return;
  el.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';

  try {
    var suffix = 'tse_';
    if (typeof getMarket === 'function') {
      var m = getMarket(code);
      suffix = (m === 'tpex' || m === 'emerging') ? 'otc_' : 'tse_';
    }
    var url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' + suffix + code + '.tw&json=1&delay=0';
    var data = await apiFetch(url);

    if (data && data.msgArray && data.msgArray.length > 0) {
      var q = data.msgArray[0];
      var askPrices = (q.a || '').split('_').filter(Boolean);
      var askVols = (q.f || '').split('_').filter(Boolean);
      var bidPrices = (q.b || '').split('_').filter(Boolean);
      var bidVols = (q.g || '').split('_').filter(Boolean);

      var prevClose = parseFloat(q.y) || _tradeState.prevClose;
      var html = '<table class="table trade-orderbook-table"><thead><tr><th>委買價</th><th>委買量</th><th>委賣價</th><th>委賣量</th></tr></thead><tbody>';
      for (var i = 0; i < 5; i++) {
        var bp = bidPrices[i] ? parseFloat(bidPrices[i]) : 0;
        var bv = bidVols[i] ? Math.round(parseFloat(bidVols[i])) : 0;
        var ap = askPrices[i] ? parseFloat(askPrices[i]) : 0;
        var av = askVols[i] ? Math.round(parseFloat(askVols[i])) : 0;
        var bColor = bp > prevClose ? 'var(--red)' : bp < prevClose ? 'var(--green)' : 'var(--text)';
        var aColor = ap > prevClose ? 'var(--red)' : ap < prevClose ? 'var(--green)' : 'var(--text)';
        html += '<tr>' +
          '<td style="color:' + bColor + ';font-weight:600;">' + (bp > 0 ? bp.toFixed(2) : '--') + '</td>' +
          '<td>' + (bv > 0 ? bv : '--') + '</td>' +
          '<td style="color:' + aColor + ';font-weight:600;">' + (ap > 0 ? ap.toFixed(2) : '--') + '</td>' +
          '<td>' + (av > 0 ? av : '--') + '</td>' +
          '</tr>';
      }
      html += '</tbody></table>';
      el.innerHTML = html;
    } else {
      el.innerHTML = '<div class="text-muted" style="text-align:center;padding:16px;">五檔資料暫無法取得</div>';
    }
  } catch(e) {
    el.innerHTML = '<div class="text-muted" style="text-align:center;padding:16px;">五檔載入失敗</div>';
  }
}

// === 開啟券商交易頁面 ===
function openBroker(brokerId) {
  var broker = BROKER_LINKS[brokerId];
  if (!broker) { toast('找不到該券商資訊'); return; }
  window.open(broker.web, '_blank', 'noopener,noreferrer');
  if (typeof trackAction === 'function') {
    trackAction('open_broker', brokerId + (_tradeState.code ? ':' + _tradeState.code : ''));
  }
}

// === 從個股分析快速下單 ===
function goTrade(code) {
  window._tradePrefill = code;
  if (typeof switchTab === 'function') switchTab('trading', true);
}
