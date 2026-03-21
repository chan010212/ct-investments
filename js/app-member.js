
// ============================================================
// SUBSCRIPTION PLAN SYSTEM
// ============================================================
const FEATURE_PLAN_MAP = {
  'heatmap':         'free',
  'compare_2':       'free',
  'dividends_wl':    'free',
  'price_alerts':    'pro',
  'inst_streak':     'pro',
  'portfolio':       'pro',
  'compare_5':       'pro',
  'dividends_all':   'proplus',
  'backtest':        'proplus',
};

const PLAN_LEVEL = { 'free': 0, 'pro': 1, 'proplus': 2, 'admin': 99 };

function userCanAccess(feature) {
  var requiredPlan = FEATURE_PLAN_MAP[feature] || 'free';
  var userLevel = PLAN_LEVEL[gCurrentPlan] || 0;
  if (gCurrentUser && gCurrentUser.role === 'admin') return true;
  return userLevel >= (PLAN_LEVEL[requiredPlan] || 0);
}

function showUpgradeModal(requiredPlan) {
  var overlay = document.getElementById('pricing-overlay');
  if (!overlay) return;
  overlay.classList.add('show');

  // Highlight the required plan card
  document.querySelectorAll('.plan-card').forEach(function(c) { c.style.opacity = ''; });
  updatePricingButtons();
}

function closePricingModal() {
  var overlay = document.getElementById('pricing-overlay');
  if (overlay) overlay.classList.remove('show');

}

function updatePricingButtons() {
  document.querySelectorAll('.plan-card-btn').forEach(function(btn) {
    var plan = btn.dataset.plan;
    if (!plan) return;
    var userLevel = PLAN_LEVEL[gCurrentPlan] || 0;
    var cardLevel = PLAN_LEVEL[plan] || 0;
    btn.classList.remove('current');
    if (plan === gCurrentPlan || (gCurrentUser && gCurrentUser.role === 'admin' && plan === 'proplus')) {
      btn.classList.add('current');
      btn.textContent = '目前方案';
    } else if (cardLevel < userLevel) {
      btn.textContent = plan === 'free' ? 'Free' : '已包含';
    } else {
      var labels = { 'pro': '升級 Pro', 'proplus': '升級 Pro+' };
      btn.textContent = labels[plan] || '選擇';
    }
  });
}

var gPricingPeriod = 'monthly';
var PLAN_PRICING_TWD = {
  pro: { monthly: 699, yearly: 6990 },
  proplus: { monthly: 999, yearly: 9990 }
};

function setPricingPeriod(period) {
  gPricingPeriod = period;
  document.querySelectorAll('.period-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.period === period);
  });
  var suffix = period === 'yearly' ? '/年' : '/月';
  var proEl = document.getElementById('price-pro');
  var ppEl = document.getElementById('price-proplus');
  if (proEl) proEl.innerHTML = 'NT$' + PLAN_PRICING_TWD.pro[period] + ' <span>' + suffix + '</span>';
  if (ppEl) ppEl.innerHTML = 'NT$' + PLAN_PRICING_TWD.proplus[period] + ' <span>' + suffix + '</span>';
}

async function requestUpgrade(plan) {
  if (!gCurrentUser) { openAuthModal(); return; }
  if (gCurrentUser.role === 'admin') return;
  if (plan === gCurrentPlan) return;

  var period = gPricingPeriod || 'monthly';
  trackAction('checkout_start', plan + '_' + period);

  var btn = document.querySelector('.plan-card-btn[data-plan="' + plan + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '處理中...'; }

  try {
    var resp = await authFetch('/api/checkout?plan=' + plan + '&period=' + period);
    var data = await resp.json();
    if (data.error) {
      toast(data.error);
      return;
    }
    // Create hidden form and POST to NewebPay MPG
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = data.mpg_url;
    form.style.display = 'none';
    var fields = {
      MerchantID: data.MerchantID,
      TradeInfo: data.TradeInfo,
      TradeSha: data.TradeSha,
      Version: data.Version
    };
    for (var key in fields) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = fields[key];
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  } catch (e) {
    toast('付款請求失敗，請稍後再試');
    console.error('Checkout error:', e);
  } finally {
    if (btn) { btn.disabled = false; updatePricingButtons(); }
  }
}

// Pricing overlay close on background click
document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'pricing-overlay') closePricingModal();
});

function renderLockedOverlay(containerId, requiredPlan) {
  var el = document.getElementById(containerId);
  if (!el) return;
  if (userCanAccess(Object.keys(FEATURE_PLAN_MAP).find(function(k) { return FEATURE_PLAN_MAP[k] === requiredPlan; }) || requiredPlan)) return;
  el.classList.add('feature-locked');
  // Remove any existing lock btn
  var existing = el.querySelector('.feature-locked-btn');
  if (existing) existing.remove();
  var btn = document.createElement('button');
  btn.className = 'feature-locked-btn';
  var planName = requiredPlan === 'proplus' ? 'Pro+' : requiredPlan === 'pro' ? 'Pro' : requiredPlan;
  btn.textContent = '升級至 ' + planName + ' 解鎖';
  btn.onclick = function(e) { e.stopPropagation(); showUpgradeModal(requiredPlan); };
  el.appendChild(btn);
}

function getToken() { return localStorage.getItem('ct_token'); }
function setToken(token) { localStorage.setItem('ct_token', token); }
function clearToken() { localStorage.removeItem('ct_token'); }

async function authFetch(url, opts = {}) {
  const token = getToken();
  if (token) {
    opts.headers = opts.headers || {};
    opts.headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(url, opts);
}

function openAuthModal() {
  gAuthMode = 'login';
  updateAuthUI();
  document.getElementById('auth-overlay').classList.add('show');

  document.getElementById('auth-error').textContent = '';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-name').value = '';
  setTimeout(() => document.getElementById('auth-email').focus(), 100);
}

function closeAuthModal() {
  document.getElementById('auth-overlay').classList.remove('show');

}

function toggleAuthMode() {
  gAuthMode = gAuthMode === 'login' ? 'register' : 'login';
  updateAuthUI();
}

function updateAuthUI() {
  const isLogin = gAuthMode === 'login';
  document.getElementById('auth-title').textContent = isLogin ? '登入' : '註冊';
  document.getElementById('auth-submit').textContent = isLogin ? '登入' : '註冊';
  document.getElementById('auth-name-field').style.display = isLogin ? 'none' : 'block';
  document.getElementById('auth-switch-text').textContent = isLogin ? '還沒有帳號？' : '已有帳號？';
  document.getElementById('auth-switch-link').textContent = isLogin ? '立即註冊' : '返回登入';
  document.getElementById('auth-error').textContent = '';
}

let _authSubmitting = false;
async function submitAuth() {
  if (_authSubmitting) return;
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const name = document.getElementById('auth-name').value.trim();
  const errEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit');

  if (!email || !password) { errEl.textContent = '請填寫所有欄位'; return; }
  if (password.length < 6) { errEl.textContent = '密碼至少需要 6 個字元'; return; }

  _authSubmitting = true;
  btn.disabled = true;
  btn.textContent = '處理中...';
  errEl.textContent = '';

  try {
    const endpoint = gAuthMode === 'login' ? '/api/login' : '/api/register';
    const body = { email, password };
    if (gAuthMode === 'register' && name) body.name = name;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await r.json();

    if (!r.ok) {
      errEl.textContent = data.error || '操作失敗';
      return;
    }

    setToken(data.token);
    gCurrentUser = data.user;
    gCurrentPlan = data.user.plan || 'free';
    if (data.user.role === 'admin') gCurrentPlan = 'proplus';
    closeAuthModal();
    renderUserSection();
    await syncWatchlistToServer();
    toast(gAuthMode === 'login' ? `歡迎回來，${data.user.name}` : `註冊成功，歡迎 ${data.user.name}`);
    trackAction('auth', gAuthMode);
  } catch (e) {
    if (e.name === 'AbortError') {
      errEl.textContent = '伺服器回應逾時，請重新整理頁面後再試';
    } else {
      errEl.textContent = '網路錯誤：' + (e.message || '請稍後再試');
    }
  } finally {
    _authSubmitting = false;
    btn.disabled = false;
    btn.textContent = gAuthMode === 'login' ? '登入' : '註冊';
  }
}

function logout() {
  clearToken();
  gCurrentUser = null;
  gCurrentPlan = 'free';
  renderUserSection();
  toast('已登出');
}

function renderUserSection() {
  const box = document.getElementById('user-section');
  const mobileBtn = document.getElementById('mobile-user-btn');
  if (gCurrentUser) {
    const initial = (gCurrentUser.name || gCurrentUser.email || '?')[0].toUpperCase();
    var planBadge = '';
    if (gCurrentUser.role === 'admin') {
      planBadge = '<span class="plan-badge plan-badge-admin">Admin</span>';
    } else if (gCurrentPlan === 'proplus') {
      planBadge = '<span class="plan-badge plan-badge-proplus">Pro+</span>';
    } else if (gCurrentPlan === 'pro') {
      planBadge = '<span class="plan-badge plan-badge-pro">Pro</span>';
    } else {
      planBadge = '<span class="plan-badge plan-badge-free">Free</span>';
    }
    box.innerHTML = `<div class="user-bar">
      <div class="user-avatar">${initial}</div>
      <div class="user-info">
        <div class="user-name">${gCurrentUser.name || gCurrentUser.email} ${planBadge}</div>
        <div class="user-role" style="cursor:pointer;" onclick="showUpgradeModal()">${gCurrentPlan === 'free' ? '升級方案' : gCurrentPlan === 'pro' ? 'Pro 會員' : gCurrentPlan === 'proplus' ? 'Pro+ 會員' : ''}${gCurrentUser.plan_expires_at && gCurrentPlan !== 'free' && gCurrentUser.role !== 'admin' ? ' (到期 ' + gCurrentUser.plan_expires_at.slice(0,10) + ')' : ''}</div>
      </div>
      <button class="user-logout" onclick="logout()">登出</button>
    </div>`;
    if (mobileBtn) {
      mobileBtn.querySelector('span').textContent = initial;
      mobileBtn.setAttribute('onclick', 'logout()');
      mobileBtn.style.color = 'var(--cyan)';
    }
    // Show admin nav for admins
    if (gCurrentUser.role === 'admin') showAdminNav();
    else hideAdminNav();
  } else {
    box.innerHTML = `<div class="user-bar" style="padding:12px 18px;">
      <button class="login-btn" onclick="openAuthModal()">登入 / 註冊</button>
    </div>`;
    if (mobileBtn) {
      mobileBtn.querySelector('span').textContent = '帳號';
      mobileBtn.setAttribute('onclick', 'openAuthModal()');
      mobileBtn.style.color = '';
    }
    hideAdminNav();
  }
}

async function checkAuth() {
  const token = getToken();
  if (!token) return;
  try {
    const r = await authFetch('/api/me');
    if (r.ok) {
      const data = await r.json();
      gCurrentUser = data.user;
      gCurrentUser.plan_expires_at = data.user.plan_expires_at || null;
      gCurrentPlan = data.user.plan || 'free';
      if (data.user.role === 'admin') gCurrentPlan = 'proplus';
      renderUserSection();
      await loadWatchlistFromServer();
    } else if (r.status === 401) {
      clearToken();
    } else {
      console.warn('checkAuth: server returned', r.status, '— keeping token');
    }
  } catch (e) { console.warn('checkAuth failed:', e); }
}

async function syncWatchlistToServer() {
  if (!gCurrentUser) return;
  const localList = wlGet();
  if (localList.length === 0) return;
  try {
    await authFetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: localList })
    });
  } catch (e) { console.warn('syncWatchlistToServer failed:', e); }
}

let _wlSyncingFromServer = false;
async function loadWatchlistFromServer() {
  if (!gCurrentUser) return;
  try {
    const r = await authFetch('/api/watchlist');
    if (!r.ok) return;
    const data = await r.json();
    if (data.watchlist && data.watchlist.length > 0) {
      const serverCodes = data.watchlist.map(w => w.code || w);
      const localList = wlGet();
      const merged = [...new Set([...localList, ...serverCodes])];
      _wlSyncingFromServer = true;
      wlSave(merged);
      _wlSyncingFromServer = false;
    }
  } catch (e) { console.warn('loadWatchlistFromServer failed:', e); }
}

function trackAction(action, detail) {
  try {
    const body = { action, detail: String(detail || '') };
    authFetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(() => {});
  } catch (e) { /* silent */ }
}

// Override watchlist functions to also sync to server
const _origWlSave = wlSave;
wlSave = function(list) {
  _origWlSave(list);
  if (gCurrentUser && !_wlSyncingFromServer) {
    authFetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: list })
    }).catch(() => {});
  }
};

// Track stock analysis views
const _origAnalyzeStock = analyzeStock;
analyzeStock = async function(code) {
  await _origAnalyzeStock(code);
  trackAction('analyze', code || document.getElementById('stock-input').value.trim());
};

// Auth modal keyboard handling
document.getElementById('auth-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-password').focus(); }
});
document.getElementById('auth-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitAuth(); }
});
document.getElementById('auth-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('auth-email').focus(); }
});
document.getElementById('auth-overlay').addEventListener('click', e => {
  if (e.target.id === 'auth-overlay') closeAuthModal();
});

// ============================================================
// ADMIN PANEL
// ============================================================
let gAdminLoaded = false;

function showAdminNav() {
  document.querySelectorAll('.nav-admin').forEach(el => { el.style.display = ''; });
  document.querySelectorAll('.mbn-more-admin').forEach(el => { el.style.display = ''; });
}

function hideAdminNav() {
  document.querySelectorAll('.nav-admin').forEach(el => { el.style.display = 'none'; });
  document.querySelectorAll('.mbn-more-admin').forEach(el => { el.style.display = 'none'; });
}

async function loadAdminPanel() {
  if (gAdminLoaded) return;
  if (!gCurrentUser || gCurrentUser.role !== 'admin') return;
  gAdminLoaded = true;

  await Promise.allSettled([
    loadAdminStats(),
    loadAdminUsers(),
    loadAdminActions(),
    loadAdminPicks()
  ]);
}

async function loadAdminStats() {
  try {
    const r = await authFetch('/api/admin/stats');
    if (!r.ok) return;
    const data = await r.json();

    let popularHtml = '';
    if (data.popular_stocks && data.popular_stocks.length > 0) {
      const rows = data.popular_stocks.map((s, i) => {
        const info = gStockDB[s.code];
        const name = info ? info.name : '';
        return [
          i + 1,
          `<span class="clickable" onclick="goAnalyze('${s.code}')">${s.code}</span>`,
          name,
          `<b>${s.count}</b> 人關注`
        ];
      });
      popularHtml = mkTable(['#', '代號', '名稱', '關注人數'], rows);
    } else {
      popularHtml = '<div class="text-muted" style="padding:16px;text-align:center;">尚無關注資料</div>';
    }
    document.getElementById('admin-popular-stocks').innerHTML = popularHtml;

    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-box">
        <div class="label">總會員數</div>
        <div class="value" style="color:var(--cyan);">${data.total_users}</div>
      </div>
      <div class="stat-box">
        <div class="label">今日活躍</div>
        <div class="value" style="color:var(--green);">${data.active_today}</div>
      </div>
      <div class="stat-box">
        <div class="label">觀察標的數</div>
        <div class="value" style="color:var(--purple);">${data.total_picks}</div>
      </div>
      <div class="stat-box">
        <div class="label">最熱門關注</div>
        <div class="value" style="font-size:16px;color:var(--yellow);">${data.popular_stocks.length > 0 ? data.popular_stocks[0].code : '--'}</div>
      </div>
    `;
  } catch (e) {
    document.getElementById('admin-stats').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function loadAdminUsers() {
  try {
    const r = await authFetch('/api/admin/users');
    if (!r.ok) return;
    const data = await r.json();

    const rows = data.users.map(u => {
      const roleTag = u.role === 'admin'
        ? '<span class="plan-badge plan-badge-admin">Admin</span>'
        : '<span class="tag" style="background:rgba(0,240,255,0.08);color:var(--text2);border:1px solid var(--border);">' + (u.role || 'free') + '</span>';
      var userPlan = u.plan || 'free';
      if (u.role === 'admin') userPlan = 'admin';
      var planSelect = u.role === 'admin' ? '<span class="plan-badge plan-badge-admin">Admin</span>' :
        '<select class="admin-plan-select" onchange="adminChangePlan(' + u.id + ', this.value)">' +
        '<option value="free"' + (userPlan === 'free' ? ' selected' : '') + '>Free</option>' +
        '<option value="pro"' + (userPlan === 'pro' ? ' selected' : '') + '>Pro</option>' +
        '<option value="proplus"' + (userPlan === 'proplus' ? ' selected' : '') + '>Pro+</option>' +
        '</select>';
      return [
        u.id,
        u.display_name,
        u.email,
        roleTag,
        planSelect,
        u.created_at ? u.created_at.slice(0, 16) : '--',
        u.last_login ? u.last_login.slice(0, 16) : '從未',
        u.login_count || 0
      ];
    });

    document.getElementById('admin-users-list').innerHTML =
      mkTable(['ID', '名稱', 'Email', '角色', '方案', '註冊時間', '最後登入', '登入次數'], rows);
  } catch (e) {
    document.getElementById('admin-users-list').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function adminChangePlan(userId, newPlan) {
  try {
    var r = await authFetch('/api/admin/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, plan: newPlan, reason: 'Admin manual change' })
    });
    var data = await r.json();
    if (r.ok) {
      toast('方案已更新：' + (data.old_plan || 'free') + ' → ' + data.new_plan);
    } else {
      toast(data.error || '更新失敗');
      loadAdminUsers();
    }
  } catch (e) {
    toast('操作失敗');
    loadAdminUsers();
  }
}

async function loadAdminActions() {
  try {
    const r = await authFetch('/api/admin/actions');
    if (!r.ok) return;
    const data = await r.json();

    const actionLabels = {
      'register': '註冊',
      'login': '登入',
      'analyze': '分析股票',
      'watchlist_sync': '同步關注',
      'watchlist_remove': '移除關注',
      'auth': '認證',
      'admin_add_pick': '新增觀察',
      'view_tab': '切換分頁',
    };

    const rows = data.actions.slice(0, 100).map(a => {
      const label = actionLabels[a.action] || a.action;
      let detail = a.detail || '';
      if (detail.length > 40) detail = detail.slice(0, 40) + '...';
      return [
        a.created_at ? a.created_at.slice(0, 19) : '--',
        a.display_name || a.email || `#${a.user_id || '?'}`,
        `<span style="color:var(--cyan);">${label}</span>`,
        `<span class="text-muted">${detail}</span>`
      ];
    });

    document.getElementById('admin-actions-list').innerHTML =
      mkTable(['時間', '使用者', '動作', '詳情'], rows);
  } catch (e) {
    document.getElementById('admin-actions-list').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function loadAdminPicks() {
  try {
    const r = await authFetch('/api/picks');
    if (!r.ok) return;
    const data = await r.json();

    if (!data.picks || data.picks.length === 0) {
      document.getElementById('admin-picks-list').innerHTML =
        '<div class="text-muted" style="padding:16px;text-align:center;">尚未新增任何觀察標的</div>';
      return;
    }

    const actionMap = { buy: '看多', sell: '看空', hold: '中性', short: '偏空' };
    const actionCls = { buy: 'up', sell: 'down', hold: '', short: 'down' };

    const rows = data.picks.map(p => [
      `<span class="clickable" onclick="goAnalyze('${p.code}')">${p.code}</span>`,
      p.name || '--',
      `<span class="${actionCls[p.action] || ''}" style="font-weight:600;">${actionMap[p.action] || p.action}</span>`,
      p.target_price ? fmtNum(p.target_price, 2) : '--',
      p.stop_loss ? fmtNum(p.stop_loss, 2) : '--',
      p.score ? `<b>${p.score}</b>/10` : '--',
      `<span class="text-sm text-muted">${(p.reason || '').slice(0, 30)}${(p.reason || '').length > 30 ? '...' : ''}</span>`,
      p.created_at ? p.created_at.slice(0, 10) : '--',
      `<button class="btn btn-danger" style="padding:4px 10px;font-size:11px;" onclick="adminDeletePick(${p.id})">移除</button>`
    ]);

    document.getElementById('admin-picks-list').innerHTML =
      mkTable(['代號', '名稱', '方向', '參考價', '觀察價', '關注度', '原因', '日期', '操作'], rows);
  } catch (e) {
    document.getElementById('admin-picks-list').innerHTML = '<div class="text-muted">載入失敗</div>';
  }
}

async function adminAddPick() {
  const code = document.getElementById('pick-code').value.trim();
  const name = document.getElementById('pick-name').value.trim();
  const action = document.getElementById('pick-action').value;
  const target = parseFloat(document.getElementById('pick-target').value) || null;
  const stoploss = parseFloat(document.getElementById('pick-stoploss').value) || null;
  const score = parseInt(document.getElementById('pick-score').value) || null;
  const reason = document.getElementById('pick-reason').value.trim();

  if (!code) { toast('請輸入股票代號'); return; }

  // Auto-fill name from DB if empty
  const finalName = name || (gStockDB[code] ? gStockDB[code].name : '');

  try {
    const r = await authFetch('/api/admin/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code, name: finalName, action, reason,
        target_price: target, stop_loss: stoploss, score
      })
    });
    if (r.ok) {
      toast('觀察標的已新增');
      document.getElementById('pick-code').value = '';
      document.getElementById('pick-name').value = '';
      document.getElementById('pick-reason').value = '';
      document.getElementById('pick-target').value = '';
      document.getElementById('pick-stoploss').value = '';
      document.getElementById('pick-score').value = '';
      loadAdminPicks();
      loadAdminStats();
    } else {
      const data = await r.json();
      toast(data.error || '發布失敗');
    }
  } catch (e) {
    toast('網路錯誤');
  }
}

