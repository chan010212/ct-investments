// BOOT
// ============================================================
// Live clock
function updateClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), dow = now.getDay();
  const isTrading = dow >= 1 && dow <= 5 && ((h === 9) || (h >= 10 && h < 13) || (h === 13 && m <= 30));
  let clockText = now.toLocaleTimeString('zh-TW') + (isTrading ? ' 盤中' : '');
  if (isTrading && gLastRefreshTime) {
    const ago = Math.round((now - gLastRefreshTime) / 1000);
    clockText += ` (${ago}s前更新)`;
  }
  el.textContent = clockText;
}

let _tickerTimer = null, _clockTimer = null;
// Start ticker & clock immediately (Yahoo Finance, no dependency on TWSE init)
loadTicker();
_tickerTimer = setInterval(loadTicker, 60 * 1000);
updateClock();
_clockTimer = setInterval(updateClock, 1000);
init().then(async () => {
  startAutoRefresh();
  await checkAuth();

  // Set initial history state
  history.replaceState({ tab: 'overview' }, '', '');

  // Deep-link: ?tab=analysis&stock=2330
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (tabParam) switchTab(tabParam, false);
  const stockParam = params.get('stock');
  if (stockParam) {
    document.getElementById('stock-input').value = stockParam;
    if (tabParam !== 'analysis') switchTab('analysis', false);
    setTimeout(() => analyzeStock(), 300);
  }
});

// Pause timers when tab is hidden (saves battery on mobile)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (_tickerTimer) { clearInterval(_tickerTimer); _tickerTimer = null; }
    if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
    if (gAutoRefreshTimer) { clearInterval(gAutoRefreshTimer); gAutoRefreshTimer = null; }
  } else {
    // Resume when tab becomes visible
    if (!_tickerTimer) { loadTicker(); _tickerTimer = setInterval(loadTicker, 60 * 1000); }
    if (!_clockTimer) { updateClock(); _clockTimer = setInterval(updateClock, 1000); }
    startAutoRefresh();
    doAutoRefresh(true); // Refresh data after returning
    // Check if briefing needs daily refresh (e.g. user left app open overnight)
    if (gBriefingSuccess && gBriefingDate !== new Date().toLocaleDateString('sv')) {
      gBriefingLoaded = false;
      gBriefingSuccess = false;
      if (document.querySelector('#panel-briefing.active')) maybeLoadBriefing();
    }
  }
});

// ============================================================
// 簡易/專業模式 Toggle
// ============================================================
function initViewMode() {
  const saved = localStorage.getItem('ct-view-mode');
  // Default to 'pro' for existing users (don't break their workflow)
  const mode = saved || 'pro';
  applyViewMode(mode);
}

function applyViewMode(mode) {
  const toggle = document.getElementById('mode-toggle');
  const label = document.getElementById('mode-label-text');
  const fab = document.getElementById('mobile-mode-fab');
  const fabIcon = document.getElementById('mobile-mode-icon');

  if (mode === 'simple') {
    document.body.classList.add('simple-mode');
    if (toggle) toggle.classList.remove('pro');
    if (label) label.textContent = '簡易模式';
    if (fab) { fab.classList.remove('pro'); }
    if (fabIcon) fabIcon.textContent = '🌱';
  } else {
    document.body.classList.remove('simple-mode');
    if (toggle) toggle.classList.add('pro');
    if (label) label.textContent = '專業模式';
    if (fab) { fab.classList.add('pro'); }
    if (fabIcon) fabIcon.textContent = '📊';
  }
  localStorage.setItem('ct-view-mode', mode);
  // Re-render heatmap when switching to pro (card was display:none in simple)
  if (mode === 'pro' && _lastSectorData) {
    setTimeout(function() { renderSectorHeatmap(_lastSectorData); }, 100);
  }
}

function toggleViewMode() {
  const isSimple = document.body.classList.contains('simple-mode');
  applyViewMode(isSimple ? 'pro' : 'simple');
}

// Init mode on page load
initViewMode();

// ============================================================
// #9 — Auth Tabs (Login/Register Separation)
// ============================================================
function setAuthMode(mode) {
  gAuthMode = mode;
  updateAuthUI();
}

// Override existing updateAuthUI
(function() {
  var _origUpdate = window.updateAuthUI;
  window.updateAuthUI = function() {
    var isLogin = gAuthMode === 'login';
    document.getElementById('auth-submit').textContent = isLogin ? '登入' : '註冊';
    document.getElementById('auth-name-field').style.display = isLogin ? 'none' : 'block';
    var confirmField = document.getElementById('auth-confirm-field');
    if (confirmField) confirmField.style.display = isLogin ? 'none' : 'block';
    var forgotEl = document.getElementById('auth-forgot');
    if (forgotEl) forgotEl.style.display = isLogin ? 'block' : 'none';
    document.getElementById('auth-error').textContent = '';
    // Update tab active states
    document.querySelectorAll('.auth-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.mode === gAuthMode);
    });
  };
})();

// Patch submitAuth to validate confirm password
(function() {
  var _origSubmit = window.submitAuth;
  var _patched = false;
  var origFn = submitAuth;
  window.submitAuth = async function() {
    if (gAuthMode === 'register') {
      var pw = document.getElementById('auth-password').value;
      var cpw = document.getElementById('auth-confirm-password');
      if (cpw && cpw.value !== pw) {
        document.getElementById('auth-error').textContent = '兩次密碼不一致';
        return;
      }
    }
    return origFn.apply(this, arguments);
  };
})();

// ============================================================
// #12 — Hero Banner (CTA for non-logged-in users)
// ============================================================
function initHeroBanner() {
  var banner = document.getElementById('hero-banner');
  if (!banner) return;
  var dismissed = localStorage.getItem('ct-hero-dismissed') === '1';
  if (!gCurrentUser && !dismissed) {
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}
function dismissHero() {
  localStorage.setItem('ct-hero-dismissed', '1');
  var banner = document.getElementById('hero-banner');
  if (banner) banner.style.display = 'none';
}
function heroSearch() {
  var input = document.getElementById('hero-search-input');
  var val = (input ? input.value : '').trim();
  if (!val) return;
  // Try to analyze stock
  document.getElementById('stock-input').value = val;
  switchTab('analysis', true);
  setTimeout(function() { analyzeStock(); }, 200);
  dismissHero();
}

// ============================================================
// #5 — AI Market Summary (client-side generated)
// ============================================================
function renderAIMarketSummary() {
  var card = document.getElementById('ai-market-summary-card');
  var content = document.getElementById('ai-market-summary-content');
  if (!card || !content) return;

  // Need market data
  var statsEl = document.getElementById('market-stats');
  if (!statsEl || statsEl.querySelector('.skeleton')) return;

  var parts = [];

  // Try to get TAIEX data from ticker or stat boxes
  var statBoxes = statsEl.querySelectorAll('.stat-box');
  var taiexVal = '', taiexChg = '';
  statBoxes.forEach(function(box) {
    var label = box.querySelector('.label');
    var value = box.querySelector('.value');
    if (label && label.textContent.includes('加權')) {
      taiexVal = value ? value.textContent : '';
    }
    if (label && label.textContent.includes('漲跌')) {
      taiexChg = value ? value.textContent : '';
    }
  });

  if (taiexVal) {
    var isUp = !taiexChg.includes('-') && !taiexChg.includes('▼');
    parts.push('今日加權指數收在 ' + taiexVal + '，' + (taiexChg ? (isUp ? '上漲' : '下跌') + ' ' + taiexChg.replace(/[+▲▼-]/g,'').trim() : '') + '。');
  }

  // Get institutional data
  var instEl = document.getElementById('inst-summary-overview');
  if (instEl && !instEl.querySelector('.skeleton')) {
    var instBoxes = instEl.querySelectorAll('.stat-box');
    var instParts = [];
    instBoxes.forEach(function(box) {
      var label = box.querySelector('.label');
      var value = box.querySelector('.value');
      if (label && value) {
        var name = label.textContent.trim();
        var val = value.textContent.trim();
        var isBuy = !val.includes('-');
        instParts.push(name + (isBuy ? '買超' : '賣超') + ' ' + val.replace(/[+-]/g,''));
      }
    });
    if (instParts.length > 0) {
      parts.push('三大法人動態：' + instParts.join('、') + '。');
    }
  }

  // Get advance/decline
  var adEl = document.getElementById('advance-decline');
  if (adEl && adEl.textContent && !adEl.querySelector('.skeleton')) {
    var text = adEl.textContent;
    var upMatch = text.match(/上漲.*?(\d+)/);
    var downMatch = text.match(/下跌.*?(\d+)/);
    if (upMatch && downMatch) {
      var up = parseInt(upMatch[1]), down = parseInt(downMatch[1]);
      var mood = up > down ? '偏多' : up < down ? '偏空' : '持平';
      parts.push('上漲 ' + up + ' 家、下跌 ' + down + ' 家，市場氣氛' + mood + '。');
    }
  }

  if (parts.length === 0) return;

  content.textContent = parts.join('');
  card.style.display = 'block';
  var timeEl = document.getElementById('ai-summary-time');
  if (timeEl) {
    var now = new Date();
    timeEl.textContent = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ' 更新';
  }
}

// ============================================================
// #8 — Watchlist Overview on Homepage
// ============================================================
function renderWatchlistOverview() {
  var card = document.getElementById('wl-overview-card');
  var content = document.getElementById('wl-overview-content');
  if (!card || !content) return;
  if (!gCurrentUser) { card.style.display = 'none'; return; }

  var wl = typeof wlGet === 'function' ? wlGet() : [];
  if (!wl || wl.length === 0) {
    content.innerHTML = '<div class="wl-overview-cta">還沒關注任何股票？試試搜尋 <a onclick="openGlobalSearch()">台積電 (2330)</a></div>';
    card.style.display = 'block';
    return;
  }

  var items = wl.slice(0, 12);
  var html = '<div class="wl-ov-grid">';
  items.forEach(function(code) {
    var name = code, price = '-', chgNum = 0;

    var mis = (typeof gMisCache !== 'undefined') ? gMisCache[code] : null;
    if (mis && mis.price > 0) {
      name = mis.name || (gStockDB[code] ? gStockDB[code].name : code);
      price = mis.price;
      chgNum = mis.pct || 0;
    } else if (gStockMap[code]) {
      var m = gStockMap[code];
      var d = m.data;
      if (m.market === 'twse') {
        name = (d[1] || '').trim();
        var close = parseNum(d[7]), chg = parseNum(d[8]);
        var prev = close - chg;
        price = close > 0 ? close : '-';
        chgNum = (prev > 0 && close > 0) ? (chg / prev * 100) : 0;
      } else {
        name = (d[1] || '').trim();
        var close = parseNum(d[2]), chg = parseNum(d[3]);
        var prev = close - chg;
        price = close > 0 ? close : '-';
        chgNum = (prev > 0 && close > 0) ? (chg / prev * 100) : 0;
      }
    } else if (gStockDB[code]) {
      name = gStockDB[code].name || code;
    }
    if (price === '-' && gWlYahooCache[code]) {
      var yc = gWlYahooCache[code];
      price = yc.price || '-';
      chgNum = yc.pct || 0;
    }

    var isUp = chgNum > 0, isDown = chgNum < 0;
    var cls = isUp ? 'wl-ov-up' : isDown ? 'wl-ov-down' : 'wl-ov-flat';
    var sign = isUp ? '+' : '';
    var priceStr = (typeof price === 'number') ? price.toFixed(price >= 100 ? 0 : price >= 10 ? 1 : 2) : price;
    html += '<div class="wl-ov-card ' + cls + '" onclick="document.getElementById(\'stock-input\').value=\'' + code + '\';switchTab(\'analysis\',true);setTimeout(analyzeStock,200);">';
    html += '<div class="wl-ov-top"><span class="wl-ov-code">' + code + '</span><span class="wl-ov-name">' + name + '</span></div>';
    html += '<div class="wl-ov-price">' + priceStr + '</div>';
    html += '<div class="wl-ov-chg">' + sign + chgNum.toFixed(2) + '%</div>';
    html += '</div>';
  });
  html += '</div>';
  if (wl.length > 12) {
    html += '<div style="text-align:center;margin-top:8px;font-size:12px;color:var(--text2);">還有 ' + (wl.length - 12) + ' 檔 <a class="wl-view-all" onclick="switchTab(\'watchlist\',true)">查看全部</a></div>';
  }
  content.innerHTML = html;
  card.style.display = 'block';
}

// ============================================================
// #14 — Legal Overlay
// ============================================================
var LEGAL_CONTENT = {
  disclaimer: {
    title: '免責聲明',
    html: '<h3>投資風險警告</h3><p>本網站所提供之所有資訊、分析報告、AI 建議及任何內容，僅供參考用途，不構成任何投資建議或推薦。投資涉及風險，過去的績效不保證未來的收益。</p><h3>資料來源說明</h3><p>本站股票數據來自台灣證券交易所（TWSE）、證券櫃檯買賣中心（TPEx）及 Yahoo Finance 等公開資訊。我們盡力確保資料準確，但不對資料的即時性、完整性或正確性做出保證。</p><h3>AI 分析免責</h3><p>本站 AI 選股與分析功能係基於歷史數據與統計模型產出，其結果可能存在誤差，使用者應自行判斷並承擔投資決策之風險。</p><h3>責任限制</h3><p>CT Investments 謙堂資本及其開發團隊不對因使用本站資訊而直接或間接產生的任何損失負責。</p>'
  },
  privacy: {
    title: '隱私權政策',
    html: '<h3>個人資料蒐集</h3><p>我們僅蒐集註冊所需之 Email 及顯示名稱。不會蒐集身分證號碼、信用卡號碼等敏感資訊。</p><h3>資料用途</h3><ul><li>帳號認證與登入</li><li>提供個人化服務（關注清單、到價提醒）</li><li>網站使用行為分析（改善服務品質）</li></ul><h3>資料保護</h3><p>密碼以 SHA-256 加密儲存，傳輸全程使用 HTTPS 加密。我們不會將您的個人資料出售或提供給第三方。</p><h3>Cookie 使用</h3><p>本站使用 localStorage 儲存使用者偏好設定，不使用第三方追蹤 Cookie。</p>'
  },
  terms: {
    title: '服務條款',
    html: '<h3>服務說明</h3><p>CT Investments 謙堂資本提供台灣股票市場資訊查詢、技術分析、AI 選股等線上服務。</p><h3>帳號規範</h3><ul><li>每人限註冊一個帳號</li><li>帳號不得轉讓或與他人共用</li><li>使用者應妥善保管帳號密碼</li></ul><h3>付費方案</h3><ul><li>Free 方案永久免費</li><li>Pro / Pro+ 方案提供 7 天免費試用</li><li>試用期間可隨時取消，不收取任何費用</li><li>試用期滿後自動轉為月繳</li></ul><h3>退費政策</h3><ul><li>年繳方案：購買後 14 天內可申請全額退費</li><li>月繳方案：當月不退費，可取消下月續訂</li><li>退費請聯繫 chan010212@gmail.com</li></ul><h3>服務變更</h3><p>我們保留隨時修改服務內容、價格及條款之權利，變更將於網站上公告。</p>'
  }
};

function openLegalOverlay(section) {
  var overlay = document.getElementById('legal-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  renderLegalTabs(section);
  renderLegalContent(section);
}
function closeLegalOverlay() {
  var overlay = document.getElementById('legal-overlay');
  if (overlay) overlay.style.display = 'none';

}
function renderLegalTabs(activeSection) {
  var tabsEl = document.getElementById('legal-tabs');
  if (!tabsEl) return;
  var html = '';
  ['disclaimer','privacy','terms'].forEach(function(key) {
    var d = LEGAL_CONTENT[key];
    html += '<button class="legal-tab' + (key === activeSection ? ' active' : '') + '" onclick="switchLegalTab(\'' + key + '\')">' + d.title + '</button>';
  });
  tabsEl.innerHTML = html;
}
function renderLegalContent(section) {
  var el = document.getElementById('legal-content');
  if (!el || !LEGAL_CONTENT[section]) return;
  el.innerHTML = LEGAL_CONTENT[section].html;
}
function switchLegalTab(section) {
  renderLegalTabs(section);
  renderLegalContent(section);
}

// ============================================================
// #6 — Onboarding (3-step welcome)
// ============================================================
var ONBOARDING_STEPS = [
  { icon: '📊', title: '掌握大盤方向', desc: '總覽頁一眼看出今天市場漲還是跌，加權指數、法人動向、成交量一目瞭然。' },
  { icon: '🔍', title: '搜尋感興趣的股票', desc: '按 Ctrl+K 或點擊個股分析，輸入名稱或代號即可查看完整技術分析與 AI 建議。' },
  { icon: '⭐', title: '加入關注清單追蹤', desc: '把你關心的股票加入關注清單，每天快速追蹤漲跌動態，不再錯過任何變化。' },
  { icon: '🔄', title: '簡易 / 專業模式', desc: '初次使用建議先用「簡易模式」快速上手，熟悉後可在底部「更多」選單切換為「專業模式」，解鎖完整功能。' }
];
var gOnboardStep = 0;

function initOnboarding() {
  if (localStorage.getItem('ct-onboarding-done') === '1') return;
  gOnboardStep = 0;
  renderOnboardingStep();
  document.getElementById('onboarding-overlay').style.display = 'flex';

}
function renderOnboardingStep() {
  var step = ONBOARDING_STEPS[gOnboardStep];
  var el = document.getElementById('onboarding-step');
  if (!el) return;
  el.innerHTML = '<div class="onboarding-icon">' + step.icon + '</div><div class="onboarding-title">' + step.title + '</div><div class="onboarding-desc">' + step.desc + '</div>';
  // Dots
  var dotsEl = document.getElementById('onboarding-dots');
  if (dotsEl) {
    var html = '';
    for (var i = 0; i < ONBOARDING_STEPS.length; i++) {
      html += '<div class="onboarding-dot' + (i === gOnboardStep ? ' active' : '') + '"></div>';
    }
    dotsEl.innerHTML = html;
  }
  // Button text
  var btn = document.getElementById('onboarding-next');
  if (btn) btn.textContent = gOnboardStep === ONBOARDING_STEPS.length - 1 ? '開始使用' : '下一步';
}
function nextOnboardingStep() {
  gOnboardStep++;
  if (gOnboardStep >= ONBOARDING_STEPS.length) {
    closeOnboarding();
    return;
  }
  renderOnboardingStep();
}
function skipOnboarding() { closeOnboarding(); }
function closeOnboarding() {
  localStorage.setItem('ct-onboarding-done', '1');
  document.getElementById('onboarding-overlay').style.display = 'none';

}

// Init onboarding after short delay
setTimeout(initOnboarding, 1500);

// ============================================================
// #10 — Show/Hide upgrade nav based on plan
// ============================================================
function updateUpgradeNav() {
  var el = document.getElementById('nav-upgrade');
  if (!el) return;
  if (gCurrentUser && (gCurrentPlan === 'pro' || gCurrentPlan === 'proplus' || gCurrentUser.role === 'admin')) {
    el.style.display = 'none';
  } else {
    el.style.display = '';
  }
}

// Patch renderUserSection to call our new functions
(function() {
  var _origRender = window.renderUserSection;
  if (_origRender) {
    window.renderUserSection = function() {
      _origRender.apply(this, arguments);
      initHeroBanner();
      updateUpgradeNav();
      setTimeout(renderWatchlistOverview, 500);
    };
  }
})();

// Hook into overview rendering to add AI summary + watchlist
(function() {
  // Use MutationObserver on market-stats to detect when data loads
  var statsEl = document.getElementById('market-stats');
  if (statsEl) {
    var observer = new MutationObserver(function() {
      setTimeout(renderAIMarketSummary, 300);
      setTimeout(renderWatchlistOverview, 500);
    });
    observer.observe(statsEl, { childList: true, subtree: true });
  }
})();

// ============================================================
// Tooltip — mobile tap support
// ============================================================
(function() {
  let activeTip = null;

  function closeTip() {
    if (activeTip) {
      activeTip.classList.remove('active');
      const popup = activeTip.querySelector('.ct-tip-popup');
      if (popup) { popup.style.top = ''; popup.style.left = ''; popup.style.bottom = ''; }
      activeTip = null;
    }
    const bd = document.getElementById('ct-tip-backdrop');
    if (bd) bd.remove();
  }

  function positionPopup(tip) {
    const popup = tip.querySelector('.ct-tip-popup');
    if (!popup) return;
    const isMobile = window.innerWidth <= 768;
    const rect = tip.getBoundingClientRect();

    if (isMobile) {
      // Mobile: centered on screen with backdrop
      let bd = document.getElementById('ct-tip-backdrop');
      if (!bd) {
        bd = document.createElement('div');
        bd.id = 'ct-tip-backdrop';
        bd.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;';
        bd.onclick = closeTip;
        document.body.appendChild(bd);
      }
      popup.style.left = '16px';
      requestAnimationFrame(() => {
        const ph = popup.offsetHeight;
        const vh = window.innerHeight;
        popup.style.top = Math.max(16, (vh - ph) / 2) + 'px';
      });
    } else {
      // Desktop: show above the ? icon
      const popupW = 320;
      let left = rect.left + rect.width / 2 - popupW / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
      popup.style.left = left + 'px';
      // Try above first
      requestAnimationFrame(() => {
        const ph = popup.offsetHeight;
        let top = rect.top - ph - 8;
        if (top < 8) top = rect.bottom + 8; // fallback: below
        popup.style.top = top + 'px';
      });
    }
  }

  document.addEventListener('click', function(e) {
    const tip = e.target.closest('.ct-tip');
    if (tip) {
      e.preventDefault();
      e.stopPropagation();
      if (activeTip && activeTip !== tip) closeTip();
      tip.classList.toggle('active');
      if (tip.classList.contains('active')) {
        activeTip = tip;
        positionPopup(tip);
      } else {
        closeTip();
      }
      return;
    }
    closeTip();
  });

  // Desktop: also show on hover
  document.addEventListener('mouseover', function(e) {
    const tip = e.target.closest('.ct-tip');
    if (tip && !activeTip) positionPopup(tip);
  });
})();

