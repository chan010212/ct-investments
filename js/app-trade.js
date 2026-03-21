// ============================================================
// CT Investments — 交易下單模組
// 前端 UI 先行，Shioaji API 連接後直接接上
// ============================================================

// === 狀態 ===
var _tradeState = {
  action: 'buy',       // buy | sell
  priceType: 'LMT',   // LMT | MKT
  orderType: 'ROD',   // ROD | IOC | FOK
  connected: false,
  code: '',
  name: '',
  prevClose: 0,
  limitUp: 0,
  limitDown: 0,
  currentPrice: 0,
};

// === 初始化 ===
function initTradingTab() {
  var codeInput = document.getElementById('trade-code');
  if (codeInput) {
    codeInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') tradeLoadQuote();
    });
  }
  // 監聽價格/數量變動自動計算預估金額
  var priceInput = document.getElementById('trade-price');
  var qtyInput = document.getElementById('trade-qty');
  if (priceInput) priceInput.addEventListener('input', tradeCalcEstimate);
  if (qtyInput) qtyInput.addEventListener('input', tradeCalcEstimate);

  // 如果從個股分析帶入代號
  if (window._tradePrefill) {
    codeInput.value = window._tradePrefill;
    window._tradePrefill = null;
    tradeLoadQuote();
  }
}

// === 買賣切換 ===
function tradeSetAction(btn) {
  var group = document.getElementById('trade-action-group');
  group.querySelectorAll('.trade-toggle').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _tradeState.action = btn.dataset.val;

  var submitBtn = document.getElementById('trade-submit-btn');
  var submitText = document.getElementById('trade-submit-text');
  if (_tradeState.action === 'buy') {
    submitBtn.className = 'btn trade-submit-btn trade-submit-buy';
    submitText.textContent = '買進下單';
  } else {
    submitBtn.className = 'btn trade-submit-btn trade-submit-sell';
    submitText.textContent = '賣出下單';
  }
}

// === 價格類型切換 ===
function tradeSetPriceType(btn) {
  var group = document.getElementById('trade-price-type-group');
  group.querySelectorAll('.trade-toggle').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _tradeState.priceType = btn.dataset.val;

  var priceRow = document.getElementById('trade-price-row');
  if (_tradeState.priceType === 'MKT') {
    priceRow.style.opacity = '0.4';
    priceRow.style.pointerEvents = 'none';
  } else {
    priceRow.style.opacity = '1';
    priceRow.style.pointerEvents = '';
  }
  tradeCalcEstimate();
}

// === 委託條件切換 ===
function tradeSetOrderType(btn) {
  var group = document.getElementById('trade-order-type-group');
  group.querySelectorAll('.trade-toggle').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  _tradeState.orderType = btn.dataset.val;
}

// === 價格增減 ===
function tradeAdjPrice(delta) {
  var input = document.getElementById('trade-price');
  var current = parseFloat(input.value) || _tradeState.currentPrice || 0;
  // 台股最小跳動單位
  var tick = _getTickSize(current);
  var newPrice = Math.max(0, current + (delta > 0 ? tick : -tick));
  input.value = newPrice.toFixed(_getTickDecimals(newPrice));
  tradeCalcEstimate();
}

// === 數量增減 ===
function tradeAdjQty(delta) {
  var input = document.getElementById('trade-qty');
  var current = parseInt(input.value) || 1;
  input.value = Math.max(1, current + delta);
  tradeCalcEstimate();
}

// === 台股升降單位 ===
function _getTickSize(price) {
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}

function _getTickDecimals(price) {
  if (price < 10) return 2;
  if (price < 50) return 2;
  if (price < 100) return 1;
  if (price < 500) return 1;
  return 0;
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

    // 自動帶入價格
    var priceInput = document.getElementById('trade-price');
    if (!priceInput.value || parseFloat(priceInput.value) === 0) {
      priceInput.value = price > 0 ? price.toFixed(_getTickDecimals(price)) : '';
    }
    tradeCalcEstimate();

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
    // 使用 MIS API 取得五檔
    var suffix = '';
    if (typeof getMarket === 'function') {
      var m = getMarket(code);
      suffix = (m === 'tpex' || m === 'emerging') ? 'tse_' : 'tse_';
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

// === 預估金額計算 ===
function tradeCalcEstimate() {
  var price = parseFloat(document.getElementById('trade-price').value) || 0;
  var qty = parseInt(document.getElementById('trade-qty').value) || 0;

  if (_tradeState.priceType === 'MKT') {
    price = _tradeState.currentPrice || 0;
  }

  var shares = qty * 1000; // 1張 = 1000股
  var amount = price * shares;
  var fee = Math.max(20, Math.round(amount * 0.001425)); // 手續費 0.1425%，最低 20 元

  document.getElementById('trade-est-amount').textContent = amount > 0 ? 'NT$ ' + amount.toLocaleString() : '--';
  document.getElementById('trade-est-fee').textContent = fee > 0 ? 'NT$ ' + fee.toLocaleString() : '--';

  // 賣出多顯示交易稅
  if (_tradeState.action === 'sell') {
    var tax = Math.round(amount * 0.003); // 證交稅 0.3%
    document.getElementById('trade-est-fee').textContent = 'NT$ ' + fee.toLocaleString() + ' + 稅 NT$ ' + tax.toLocaleString();
  }
}

// === 下單 ===
function tradeSubmit() {
  if (!_tradeState.connected) {
    toast('尚未連接券商 API，無法下單');
    // 顯示設定提示
    var msg = document.getElementById('trade-conn-msg');
    if (msg) msg.innerHTML = '請先取得永豐 Shioaji API Key 並至設定頁面輸入<br><a href="https://www.sinotrade.com.tw/ec/20191125/Main" target="_blank" rel="noopener" style="color:var(--accent);">前往永豐申請 &rarr;</a>';
    return;
  }

  var code = _tradeState.code;
  var price = parseFloat(document.getElementById('trade-price').value) || 0;
  var qty = parseInt(document.getElementById('trade-qty').value) || 0;

  if (!code) { toast('請先查詢股票'); return; }
  if (_tradeState.priceType === 'LMT' && price <= 0) { toast('請輸入委託價格'); return; }
  if (qty <= 0) { toast('請輸入委託數量'); return; }

  // 限價範圍檢查
  if (_tradeState.priceType === 'LMT' && _tradeState.limitUp > 0) {
    if (price > _tradeState.limitUp) { toast('委託價格超過漲停價'); return; }
    if (price < _tradeState.limitDown) { toast('委託價格低於跌停價'); return; }
  }

  var actionText = _tradeState.action === 'buy' ? '買進' : '賣出';
  var shares = qty * 1000;
  var amount = price * shares;
  var confirm = window.confirm(
    actionText + ' ' + code + ' ' + _tradeState.name + '\n' +
    '價格：' + price + '\n' +
    '數量：' + qty + ' 張 (' + shares.toLocaleString() + ' 股)\n' +
    '預估金額：NT$ ' + amount.toLocaleString() + '\n' +
    '委託條件：' + _tradeState.orderType + '\n\n' +
    '確認下單？'
  );

  if (!confirm) return;

  // TODO: 連接 Shioaji API 後實際下單
  toast('下單功能開發中，等待券商 API 連接');
}

// === 刷新委託 ===
function tradeRefreshOrders() {
  if (!_tradeState.connected) {
    toast('尚未連接券商');
    return;
  }
  // TODO: 從 Shioaji API 取得委託回報
}

// === 從個股分析快速下單 ===
function goTrade(code) {
  window._tradePrefill = code;
  if (typeof switchTab === 'function') switchTab('trading', true);
}
