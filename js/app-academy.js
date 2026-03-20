// ============================================================
// 新手學院 — Academy
// ============================================================
const ACADEMY_LESSONS = [
  {
    id: 'taiex',
    icon: '📊',
    title: '什麼是加權指數？',
    desc: '台股的溫度計，一個數字看懂大盤',
    time: '1 分鐘',
    color: '#00d4ff',
    subtitle: '加權指數就像台股的「平均體溫」，漲代表市場整體偏熱，跌代表偏冷。',
    body: `
      <h3>加權指數 = 台股大盤</h3>
      <div class="acad-point">
        <span class="acad-point-icon">📈</span>
        <span class="acad-point-text">台灣證券交易所把所有上市股票的股價，按照公司大小（市值）加權平均，算出一個數字，就是「加權股價指數」，簡稱大盤。</span>
      </div>
      <div class="acad-point">
        <span class="acad-point-icon">🌡️</span>
        <span class="acad-point-text">它就像市場的溫度計：<br>指數上漲 → 大部分股票在漲 → 市場偏樂觀<br>指數下跌 → 大部分股票在跌 → 市場偏悲觀</span>
      </div>
      <div class="acad-point">
        <span class="acad-point-icon">⚖️</span>
        <span class="acad-point-text">「加權」的意思是：台積電這種大公司的影響力，比小公司大很多。所以台積電漲，大盤通常也漲。</span>
      </div>
      <h3>下方是一段模擬的大盤走勢圖</h3>
    `,
    notes: '<strong>小提醒：</strong>大盤漲不代表每檔股票都漲，但它反映了整體市場氣氛。看盤的第一步，就是先看大盤方向。',
    chart: 'taiex'
  },
  {
    id: 'candlestick',
    icon: '🕯️',
    title: 'K 線怎麼看？',
    desc: '一根K棒就能看出漲跌和力道',
    time: '2 分鐘',
    color: '#ff4070',
    subtitle: 'K 線圖是最基本的股價圖表，每根「K 棒」代表一天的股價變化。',
    body: `
      <h3>台股顏色規則</h3>
      <div class="acad-point">
        <span class="acad-point-icon">🔴</span>
        <span class="acad-point-text">
          <span class="acad-color-demo acad-color-up">▲ 紅色 K 棒 = 收盤價 > 開盤價 = 上漲</span><br>
          實體越長，漲幅越大
        </span>
      </div>
      <div class="acad-point">
        <span class="acad-point-icon">🟢</span>
        <span class="acad-point-text">
          <span class="acad-color-demo acad-color-down">▼ 綠色 K 棒 = 收盤價 < 開盤價 = 下跌</span><br>
          實體越長，跌幅越大
        </span>
      </div>
      <div class="acad-point">
        <span class="acad-point-icon">➖</span>
        <span class="acad-point-text">
          <span class="acad-color-demo acad-color-flat">— 十字線 = 開盤 ≈ 收盤 = 多空拉鋸</span><br>
          上下影線代表盤中波動範圍
        </span>
      </div>
      <h3>影線代表什麼？</h3>
      <div class="acad-point">
        <span class="acad-point-icon">📍</span>
        <span class="acad-point-text"><strong>上影線長</strong> → 盤中衝高但被賣壓壓回（賣力強）<br><strong>下影線長</strong> → 盤中下殺但被買盤撐住（買力強）</span>
      </div>
      <h3>看看下方的 K 線圖</h3>
    `,
    notes: '<strong>台股特有：</strong>台灣、日本、中國都是「紅漲綠跌」，跟美國、歐洲相反。在謙堂資本的圖表中，紅色永遠代表上漲。',
    chart: 'candlestick'
  },
  {
    id: 'volume',
    icon: '📦',
    title: '成交量代表什麼？',
    desc: '有量才有價，量是價格的先行指標',
    time: '1 分鐘',
    color: '#ffd036',
    subtitle: '成交量 = 當天有多少股票被交易。量大代表市場關注度高，量小代表沒人在意。',
    body: `
      <h3>成交量的基本概念</h3>
      <div class="acad-point">
        <span class="acad-point-icon">🔊</span>
        <span class="acad-point-text"><strong>爆量上漲</strong> → 很多人搶著買，漲勢有力<br><strong>爆量下跌</strong> → 很多人搶著賣，恐慌賣壓</span>
      </div>
      <div class="acad-point">
        <span class="acad-point-icon">🔇</span>
        <span class="acad-point-text"><strong>縮量上漲</strong> → 漲但沒人跟，要注意<br><strong>縮量盤整</strong> → 市場在等方向，暫時觀望</span>
      </div>
      <div class="acad-point">
        <span class="acad-point-icon">📊</span>
        <span class="acad-point-text">下方圖表中，<strong>下半部的長條</strong>就是成交量。紅色 = 當天上漲的成交量，綠色 = 當天下跌的成交量。</span>
      </div>
    `,
    notes: '<strong>口訣：</strong>「量先價行」— 通常成交量會比股價先反應。突然爆量往往是轉折的訊號。',
    chart: 'volume'
  },
  {
    id: 'ma',
    icon: '〰️',
    title: '均線是什麼？',
    desc: 'MA5、MA20、MA60 一次搞懂',
    time: '2 分鐘',
    color: '#b44dff',
    subtitle: '均線 = 過去 N 天收盤價的平均值連成的線，是判斷趨勢方向最常用的工具。',
    body: `
      <h3>常見的三條均線</h3>
      <div class="acad-point" style="border-left-color:#ffd036;">
        <span class="acad-point-icon">🟡</span>
        <span class="acad-point-text"><strong>MA5（5日線 / 週線）</strong><br>過去 5 天的平均價，反映「這一週」的趨勢。短線交易者常用。</span>
      </div>
      <div class="acad-point" style="border-left-color:#00d4ff;">
        <span class="acad-point-icon">🔵</span>
        <span class="acad-point-text"><strong>MA20（20日線 / 月線）</strong><br>過去 20 天的平均價，反映「這個月」的趨勢。股價站上月線通常代表偏多。</span>
      </div>
      <div class="acad-point" style="border-left-color:#b44dff;">
        <span class="acad-point-icon">🟣</span>
        <span class="acad-point-text"><strong>MA60（60日線 / 季線）</strong><br>過去 60 天的平均價，反映中期趨勢。被稱為「生命線」，跌破季線通常是警訊。</span>
      </div>
      <h3>怎麼判讀？</h3>
      <div class="acad-point">
        <span class="acad-point-icon">✅</span>
        <span class="acad-point-text"><strong>黃金交叉</strong>：短均線從下往上穿越長均線 → 看漲訊號<br><strong>死亡交叉</strong>：短均線從上往下穿越長均線 → 看跌訊號</span>
      </div>
    `,
    notes: '<strong>小提醒：</strong>下方圖表中，K 線上面的三條彩色線就是均線。觀察股價跟均線的位置關係，就能大概知道目前趨勢方向。',
    chart: 'ma'
  },
  {
    id: 'institutional',
    icon: '🏦',
    title: '三大法人是誰？',
    desc: '外資、投信、自營商的角色與影響',
    time: '2 分鐘',
    color: '#00f0ff',
    subtitle: '三大法人 = 外資 + 投信 + 自營商，是台股最有影響力的大戶。他們買什麼、賣什麼，散戶都在看。',
    body: `
      <h3>三大法人分別是？</h3>
      <div class="acad-point" style="border-left-color:#00d4ff;">
        <span class="acad-point-icon">🌍</span>
        <span class="acad-point-text"><strong>外資（外國機構投資人）</strong><br>國外的大型基金（如摩根、高盛），資金最龐大，對大盤影響最大。外資連續買超 → 大盤通常偏多。</span>
      </div>
      <div class="acad-point" style="border-left-color:#b44dff;">
        <span class="acad-point-icon">🏢</span>
        <span class="acad-point-text"><strong>投信（國內投信基金）</strong><br>台灣的基金公司（如元大、國泰），擅長研究中小型股。投信連買 → 該股可能有基本面題材。</span>
      </div>
      <div class="acad-point" style="border-left-color:#ff8c42;">
        <span class="acad-point-icon">🏛️</span>
        <span class="acad-point-text"><strong>自營商（券商自己的錢）</strong><br>券商用自有資金交易，操作偏短線。參考價值較低，但大量買賣時仍值得注意。</span>
      </div>
      <h3>買超 vs 賣超</h3>
      <div class="acad-point">
        <span class="acad-point-icon">📊</span>
        <span class="acad-point-text">
          <span class="acad-color-demo acad-color-up">買超 = 買的 > 賣的 → 看好</span>
          <span class="acad-color-demo acad-color-down" style="margin-left:8px;">賣超 = 賣的 > 買的 → 看淡</span>
        </span>
      </div>
    `,
    notes: '<strong>實戰技巧：</strong>在謙堂資本的「法人」頁面，可以看到法人每天的買賣超金額和個股排行。外資 + 投信同步買超的股票，通常比較值得關注。',
    chart: 'institutional'
  },
  {
    id: 'rsi',
    icon: '⚡',
    title: 'RSI 怎麼看？',
    desc: '判斷股票太貴或太便宜的指標',
    time: '1 分鐘',
    color: '#ff8c42',
    subtitle: 'RSI（相對強弱指標）用 0~100 的數字告訴你，這檔股票最近是漲太多還是跌太多。',
    body: `
      <h3>RSI 的三個區間</h3>
      <div class="acad-point" style="border-left-color:#ff4070;">
        <span class="acad-point-icon">🔴</span>
        <span class="acad-point-text"><strong>RSI > 70（超買區）</strong><br>最近漲幅太大，股價可能偏貴。不代表一定會跌，但要注意回檔風險。</span>
      </div>
      <div class="acad-point" style="border-left-color:var(--text2);">
        <span class="acad-point-icon">⚪</span>
        <span class="acad-point-text"><strong>RSI 30~70（正常區）</strong><br>多數時間股價在這個區間波動，屬於正常狀態。</span>
      </div>
      <div class="acad-point" style="border-left-color:#00ff88;">
        <span class="acad-point-icon">🟢</span>
        <span class="acad-point-text"><strong>RSI < 30（超賣區）</strong><br>最近跌幅太大，股價可能偏便宜。不代表一定會漲，但可以開始留意。</span>
      </div>
    `,
    notes: '<strong>注意：</strong>RSI 只是參考，不是買賣訊號。強勢股的 RSI 可能長期在 70 以上，弱勢股可能長期在 30 以下。要搭配其他指標一起看。',
    chart: 'rsi'
  },
  {
    id: 'kd',
    icon: '🔀',
    title: 'KD 指標入門',
    desc: 'K值D值交叉就是買賣訊號？',
    time: '2 分鐘',
    color: '#ff36ab',
    subtitle: 'KD（隨機指標）是台股最多人用的技術指標之一，用 K 線和 D 線的交叉來判斷買賣時機。',
    body: `
      <h3>K 值和 D 值</h3>
      <div class="acad-point" style="border-left-color:#ffd036;">
        <span class="acad-point-icon">🟡</span>
        <span class="acad-point-text"><strong>K 值（快線）</strong> — 反應較快，波動大<br><strong>D 值（慢線）</strong> — 反應較慢，比較平滑<br>兩條線的數值範圍都是 0~100</span>
      </div>
      <h3>交叉訊號</h3>
      <div class="acad-point" style="border-left-color:#ff4070;">
        <span class="acad-point-icon">📈</span>
        <span class="acad-point-text"><strong>黃金交叉（低檔 K 上穿 D）</strong><br>K 值從 D 值下方穿越到上方，而且位置在 20 以下 → 可能是買進訊號</span>
      </div>
      <div class="acad-point" style="border-left-color:#00ff88;">
        <span class="acad-point-icon">📉</span>
        <span class="acad-point-text"><strong>死亡交叉（高檔 K 下穿 D）</strong><br>K 值從 D 值上方穿越到下方，而且位置在 80 以上 → 可能是賣出訊號</span>
      </div>
    `,
    notes: '<strong>實戰提醒：</strong>KD 在盤整行情很好用，但在強勢趨勢中容易「鈍化」（一直在高檔或低檔）。不要只看 KD 就決定買賣。',
    chart: 'kd'
  },
  {
    id: 'margin',
    icon: '💳',
    title: '融資融券是什麼？',
    desc: '散戶情緒指標，看懂券資比',
    time: '2 分鐘',
    color: '#00ff88',
    subtitle: '融資融券是台股特有的「借貸交易」機制，從融資券餘額可以觀察散戶的多空情緒。',
    body: `
      <h3>融資 vs 融券</h3>
      <div class="acad-point" style="border-left-color:#ff4070;">
        <span class="acad-point-icon">💰</span>
        <span class="acad-point-text"><strong>融資 = 借錢買股票</strong><br>投資人向券商借錢買股票，代表看漲。融資增加 → 散戶看多情緒升溫。</span>
      </div>
      <div class="acad-point" style="border-left-color:#00ff88;">
        <span class="acad-point-icon">📋</span>
        <span class="acad-point-text"><strong>融券 = 借股票來賣</strong><br>投資人向券商借股票先賣出，等跌了再買回來還。代表看跌。</span>
      </div>
      <h3>券資比</h3>
      <div class="acad-point">
        <span class="acad-point-icon">📐</span>
        <span class="acad-point-text"><strong>券資比 = 融券餘額 ÷ 融資餘額</strong><br>券資比 > 30% → 看空的人多，但也代表未來有「軋空回補」的上漲動能<br>券資比 < 5% → 幾乎沒人放空</span>
      </div>
    `,
    notes: '<strong>進階觀念：</strong>融資大增但股價不漲 → 散戶追高接貨（危險訊號）。融券大增但股價不跌 → 空方可能被軋（反而可能上漲）。在個股分析的「融資券」區塊可以看到詳細數據。',
    chart: 'margin'
  }
];

let _acadCurrentLesson = null;
let _acadChart = null;

function initAcademy() {
  const grid = document.getElementById('acad-grid');
  if (!grid) return;
  const done = JSON.parse(localStorage.getItem('ct-acad-done') || '[]');
  grid.innerHTML = ACADEMY_LESSONS.map((l, i) => `
    <div class="acad-card ${done.includes(l.id) ? 'done' : ''}" style="--acad-color:${l.color};" onclick="openLesson(${i})">
      <div class="acad-card-icon">${l.icon}</div>
      <div class="acad-card-title">${l.title}</div>
      <div class="acad-card-desc">${l.desc}</div>
      <div class="acad-card-meta">
        <span class="acad-card-time">⏱ ${l.time}</span>
        ${done.includes(l.id) ? '<span style="color:var(--green);">已完成</span>' : '<span>未讀</span>'}
      </div>
    </div>
  `).join('');
  updateAcadProgress();
}

function updateAcadProgress() {
  const done = JSON.parse(localStorage.getItem('ct-acad-done') || '[]');
  const el = document.getElementById('acad-progress');
  if (el) el.textContent = done.length + ' / ' + ACADEMY_LESSONS.length + ' 完成';
}

function openLesson(idx) {
  const l = ACADEMY_LESSONS[idx];
  if (!l) return;
  _acadCurrentLesson = l;
  const overlay = document.getElementById('acad-lesson-overlay');
  document.getElementById('acad-lesson-title').textContent = l.icon + ' ' + l.title;
  document.getElementById('acad-lesson-subtitle').textContent = l.subtitle;
  document.getElementById('acad-lesson-body').innerHTML = l.body;
  document.getElementById('acad-lesson-notes').innerHTML = l.notes;
  const badge = document.getElementById('acad-lesson-badge');
  badge.textContent = '⏱ ' + l.time;
  badge.style.background = l.color + '22';
  badge.style.color = l.color;
  badge.style.border = '1px solid ' + l.color + '44';

  const done = JSON.parse(localStorage.getItem('ct-acad-done') || '[]');
  const btn = document.getElementById('acad-done-btn');
  if (done.includes(l.id)) {
    btn.textContent = '✔ 已完成';
    btn.classList.add('completed');
  } else {
    btn.textContent = '✔ 我學會了';
    btn.classList.remove('completed');
  }

  overlay.style.display = 'block';
  overlay.scrollTop = 0;


  // Render chart after overlay is visible
  setTimeout(() => renderAcadChart(l.chart), 100);
}

function closeLesson() {
  document.getElementById('acad-lesson-overlay').style.display = 'none';

  if (_acadChart) { _acadChart.remove(); _acadChart = null; }
  _acadCurrentLesson = null;
}

function markLessonDone() {
  if (!_acadCurrentLesson) return;
  const done = JSON.parse(localStorage.getItem('ct-acad-done') || '[]');
  if (!done.includes(_acadCurrentLesson.id)) {
    done.push(_acadCurrentLesson.id);
    localStorage.setItem('ct-acad-done', JSON.stringify(done));
  }
  const btn = document.getElementById('acad-done-btn');
  btn.textContent = '✔ 已完成';
  btn.classList.add('completed');
  initAcademy(); // refresh grid
}

function renderAcadChart(type) {
  const container = document.getElementById('acad-lesson-chart');
  container.innerHTML = '';
  if (_acadChart) { _acadChart.remove(); _acadChart = null; }

  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    layout: { background: { color: '#0a1128' }, textColor: '#8a9bc0', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(0,240,255,0.05)' }, horzLines: { color: 'rgba(0,240,255,0.05)' } },
    crosshair: { mode: 0 },
    timeScale: { borderColor: 'rgba(0,240,255,0.15)', timeVisible: false },
    rightPriceScale: { borderColor: 'rgba(0,240,255,0.15)' },
    handleScroll: false,
    handleScale: false,
  });
  _acadChart = chart;

  // Generate sample Taiwan stock data
  const basePrice = 580;
  const days = 60;
  const data = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const d = new Date(2025, 0, 2 + i);
    // skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) { price += (Math.random() - 0.48) * 3; continue; }
    const change = (Math.random() - 0.48) * 8;
    const o = price;
    const c = price + change;
    const h = Math.max(o, c) + Math.random() * 4;
    const l = Math.min(o, c) - Math.random() * 4;
    const time = d.toISOString().split('T')[0];
    data.push({ time, open: +o.toFixed(2), close: +c.toFixed(2), high: +h.toFixed(2), low: +l.toFixed(2), vol: Math.floor(5000 + Math.random() * 20000) });
    price = c;
  }

  if (type === 'taiex') {
    // Area-style chart for TAIEX
    const base = data[0].close;
    const series = chart.addBaselineSeries({
      baseValue: { type: 'price', price: base },
      topLineColor: '#ff4070',
      topFillColor1: 'rgba(255,64,112,0.15)',
      topFillColor2: 'rgba(255,64,112,0.02)',
      bottomLineColor: '#00ff88',
      bottomFillColor1: 'rgba(0,255,136,0.02)',
      bottomFillColor2: 'rgba(0,255,136,0.15)',
      lineWidth: 2,
    });
    series.setData(data.map(d => ({ time: d.time, value: d.close })));
  }
  else if (type === 'candlestick') {
    const cs = chart.addCandlestickSeries({
      upColor: '#ff4070', downColor: '#00e87b',
      borderUpColor: '#ff4070', borderDownColor: '#00e87b',
      wickUpColor: '#ff4070', wickDownColor: '#00e87b',
    });
    cs.setData(data);
  }
  else if (type === 'volume') {
    const cs = chart.addCandlestickSeries({
      upColor: '#ff4070', downColor: '#00e87b',
      borderUpColor: '#ff4070', borderDownColor: '#00e87b',
      wickUpColor: '#ff4070', wickDownColor: '#00e87b',
    });
    cs.setData(data);
    const vol = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(data.map(d => ({
      time: d.time,
      value: d.vol,
      color: d.close >= d.open ? 'rgba(255,64,112,0.5)' : 'rgba(0,232,123,0.5)',
    })));
  }
  else if (type === 'ma') {
    const cs = chart.addCandlestickSeries({
      upColor: '#ff4070', downColor: '#00e87b',
      borderUpColor: '#ff4070', borderDownColor: '#00e87b',
      wickUpColor: '#ff4070', wickDownColor: '#00e87b',
    });
    cs.setData(data);
    // MA lines
    const calcMA = (period) => {
      const result = [];
      for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        result.push({ time: data[i].time, value: +(sum / period).toFixed(2) });
      }
      return result;
    };
    chart.addLineSeries({ color: '#ffd036', lineWidth: 1.5, title: 'MA5' }).setData(calcMA(5));
    chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5, title: 'MA20' }).setData(calcMA(20));
  }
  else if (type === 'institutional') {
    // Bar chart for institutional buy/sell
    const buySeries = chart.addHistogramSeries({
      title: '三大法人買賣超',
      priceFormat: { type: 'volume' },
    });
    buySeries.setData(data.map(d => {
      const val = Math.floor((Math.random() - 0.45) * 15000);
      return { time: d.time, value: val, color: val >= 0 ? 'rgba(255,64,112,0.7)' : 'rgba(0,232,123,0.7)' };
    }));
  }
  else if (type === 'rsi') {
    // RSI chart with zones
    const rsiData = [];
    let gain = 0, loss = 0;
    for (let i = 1; i < data.length; i++) {
      const diff = data[i].close - data[i-1].close;
      if (i <= 14) {
        if (diff > 0) gain += diff; else loss -= diff;
        if (i === 14) {
          gain /= 14; loss /= 14;
          const rs = loss === 0 ? 100 : gain / loss;
          rsiData.push({ time: data[i].time, value: +(100 - 100 / (1 + rs)).toFixed(2) });
        }
      } else {
        gain = (gain * 13 + (diff > 0 ? diff : 0)) / 14;
        loss = (loss * 13 + (diff < 0 ? -diff : 0)) / 14;
        const rs = loss === 0 ? 100 : gain / loss;
        rsiData.push({ time: data[i].time, value: +(100 - 100 / (1 + rs)).toFixed(2) });
      }
    }
    const rsiLine = chart.addLineSeries({ color: '#ff8c42', lineWidth: 2, title: 'RSI(14)' });
    rsiLine.setData(rsiData);
    // Overbought/oversold lines
    chart.addLineSeries({ color: 'rgba(255,64,112,0.4)', lineWidth: 1, lineStyle: 2, title: '' })
      .setData(rsiData.map(d => ({ time: d.time, value: 70 })));
    chart.addLineSeries({ color: 'rgba(0,255,136,0.4)', lineWidth: 1, lineStyle: 2, title: '' })
      .setData(rsiData.map(d => ({ time: d.time, value: 30 })));
    chart.priceScale('right').applyOptions({ autoScale: false, scaleMargins: { top: 0.05, bottom: 0.05 } });
  }
  else if (type === 'kd') {
    // KD indicator
    const kdData = [];
    for (let i = 8; i < data.length; i++) {
      let high9 = -Infinity, low9 = Infinity;
      for (let j = 0; j < 9; j++) {
        high9 = Math.max(high9, data[i-j].high);
        low9 = Math.min(low9, data[i-j].low);
      }
      const rsv = high9 === low9 ? 50 : ((data[i].close - low9) / (high9 - low9)) * 100;
      const prevK = kdData.length > 0 ? kdData[kdData.length-1].k : 50;
      const prevD = kdData.length > 0 ? kdData[kdData.length-1].d : 50;
      const k = +(prevK * 2/3 + rsv * 1/3).toFixed(2);
      const d = +(prevD * 2/3 + k * 1/3).toFixed(2);
      kdData.push({ time: data[i].time, k, d });
    }
    chart.addLineSeries({ color: '#ffd036', lineWidth: 2, title: 'K' })
      .setData(kdData.map(d => ({ time: d.time, value: d.k })));
    chart.addLineSeries({ color: '#ff36ab', lineWidth: 2, title: 'D' })
      .setData(kdData.map(d => ({ time: d.time, value: d.d })));
    chart.addLineSeries({ color: 'rgba(255,64,112,0.3)', lineWidth: 1, lineStyle: 2, title: '' })
      .setData(kdData.map(d => ({ time: d.time, value: 80 })));
    chart.addLineSeries({ color: 'rgba(0,255,136,0.3)', lineWidth: 1, lineStyle: 2, title: '' })
      .setData(kdData.map(d => ({ time: d.time, value: 20 })));
  }
  else if (type === 'margin') {
    // Margin trading: two histogram series
    const marginBuy = chart.addHistogramSeries({ title: '融資增減(張)', priceScaleId: 'margin' });
    marginBuy.setData(data.map(d => {
      const val = Math.floor((Math.random() - 0.5) * 3000);
      return { time: d.time, value: val, color: val >= 0 ? 'rgba(255,64,112,0.6)' : 'rgba(0,232,123,0.6)' };
    }));
    const shortSell = chart.addLineSeries({ color: '#ffd036', lineWidth: 2, title: '融券餘額', priceScaleId: 'short' });
    let shortBal = 2000;
    shortSell.setData(data.map(d => {
      shortBal += Math.floor((Math.random() - 0.48) * 500);
      shortBal = Math.max(200, shortBal);
      return { time: d.time, value: shortBal };
    }));
  }

  chart.timeScale().fitContent();
  // Lock the view — prevent any scrolling/scaling after fitContent
  chart.timeScale().applyOptions({ rightOffset: 2, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true });
  chart.priceScale('right').applyOptions({ autoScale: true });

  // Resize on window resize
  const ro = new ResizeObserver(() => {
    const o = { width: container.clientWidth };
    if (container.clientHeight > 0) o.height = container.clientHeight;
    chart.applyOptions(o);
  });
  ro.observe(container);
}

// Init academy when switching to that tab
initAcademy();

// ============================================================
// 能力測驗 & 勳章系統
// ============================================================
const QUIZ_BADGES = [
  { id: 'beginner', icon: '🌱', name: '韭菜萌芽', sub: '通過初階測驗', color: '#00e87b', glow: 'rgba(0,232,123,0.2)' },
  { id: 'intermediate', icon: '⚔️', name: '散戶戰士', sub: '通過中階測驗', color: '#00d4ff', glow: 'rgba(0,212,255,0.2)' },
  { id: 'advanced', icon: '🦅', name: '盤面獵鷹', sub: '通過高階測驗', color: '#ffd700', glow: 'rgba(255,215,0,0.25)' },
  { id: 'master', icon: '👑', name: '謙堂宗師', sub: '三階段全滿分', color: '#ff36ab', glow: 'rgba(255,54,171,0.25)' },
];

const QUIZ_LEVELS = [
  {
    id: 'beginner',
    icon: '📗',
    title: '初階測驗',
    desc: '台股基礎觀念，學完學院課程即可挑戰',
    color: '#00e87b',
    badge: '🌱 韭菜萌芽',
    unlockReq: null,
    questions: [
      {
        q: '台股的顏色規則，下列何者正確？',
        opts: ['紅色代表下跌，綠色代表上漲', '紅綠都代表上漲', '紅色代表上漲，綠色代表下跌', '顏色沒有特定意義'],
        ans: 2,
        explain: '台股、日股、陸股都是「紅漲綠跌」，跟歐美相反。在謙堂資本的所有圖表中，紅色永遠代表上漲。'
      },
      {
        q: '加權指數上漲 100 點，代表什麼？',
        opts: ['每檔股票都漲了 100 元', '只有台積電在漲', '外資一定在買超', '台股整體市場氣氛偏樂觀'],
        ans: 3,
        explain: '加權指數是所有上市股票按市值加權的平均表現。指數上漲代表整體市場偏多，但不代表每檔股票都在漲。'
      },
      {
        q: '三大法人不包含下列哪一個？',
        opts: ['外資', '散戶', '投信', '自營商'],
        ans: 1,
        explain: '三大法人 = 外資 + 投信 + 自營商。散戶是一般個人投資者，不屬於法人。'
      },
      {
        q: 'K 線圖中，一根「長紅 K 棒」代表什麼？',
        opts: ['成交量很大', '外資大量買進', '當天下跌幅度很大', '當天上漲幅度很大'],
        ans: 3,
        explain: '紅色 K 棒代表收盤價高於開盤價（上漲），實體越長代表漲幅越大。「長紅」= 大漲。'
      },
      {
        q: '「爆量上漲」通常代表什麼？',
        opts: ['很多人搶著買，漲勢有力道', '股票即將下市', '沒人關注這檔股票', '融券大增'],
        ans: 0,
        explain: '成交量大增（爆量）且股價上漲，代表市場買氣強勁，多方力道充足。是相對正面的訊號。'
      },
    ]
  },
  {
    id: 'intermediate',
    icon: '📘',
    title: '中階測驗',
    desc: '技術指標判讀，需理解均線、RSI、KD',
    color: '#00d4ff',
    badge: '⚔️ 散戶戰士',
    unlockReq: 'beginner',
    questions: [
      {
        q: 'MA20（月線）的意義是什麼？',
        opts: ['過去 20 天的最高價', '每個月的第 20 天的股價', '過去 20 天收盤價的平均值', '前 20 檔熱門股的平均價'],
        ans: 2,
        explain: 'MA20 = 過去 20 個交易日的收盤價加總除以 20。也稱為「月線」，是判斷中短期趨勢最常用的均線。'
      },
      {
        q: '短均線從上方往下穿越長均線，這叫什麼？',
        opts: ['黃金交叉', '布林突破', '量價背離', '死亡交叉'],
        ans: 3,
        explain: '死亡交叉 = 短期均線由上往下穿越長期均線，代表短期趨勢轉弱，是偏空的訊號。'
      },
      {
        q: '當 RSI 數值超過 70，代表什麼？',
        opts: ['成交量很大', '三大法人在買超', '股價很便宜，可以買進', '股價進入超買區，可能偏貴'],
        ans: 3,
        explain: 'RSI > 70 代表近期漲幅較大，進入「超買區」，股價可能偏貴。但不代表一定會跌，強勢股 RSI 可能長期維持高檔。'
      },
      {
        q: 'KD 指標中「黃金交叉」是指什麼？',
        opts: ['K 值從下方穿越 D 值往上', 'K 值從上方穿越 D 值往下', 'K 值等於 D 值', 'K 值和 D 值都等於 50'],
        ans: 0,
        explain: '黃金交叉 = K 值從 D 值下方往上穿越。如果發生在低檔區（20 以下），通常被視為買進訊號。'
      },
      {
        q: '股價碰到布林通道上緣，通常代表什麼？',
        opts: ['一定會繼續漲', '股價可能偏高，注意回檔', '股價處於正常範圍', '成交量即將爆增'],
        ans: 1,
        explain: '布林通道上緣代表統計上的「偏高位置」。碰到上緣不代表一定會跌，但要注意短線回檔的風險。突破上緣持續上漲代表強勢。'
      },
    ]
  },
  {
    id: 'advanced',
    icon: '📕',
    title: '高階測驗',
    desc: '籌碼分析與實戰判斷，進階投資人挑戰',
    color: '#ff4070',
    badge: '🦅 盤面獵鷹',
    unlockReq: 'intermediate',
    questions: [
      {
        q: '外資連續 5 天買超某檔股票，但股價沒漲，最合理的判斷是？',
        opts: ['一定會補漲，先買再說', '外資看錯了，不用管', '應該立刻買進', '可能有其他賣壓在壓抑，需綜合觀察'],
        ans: 3,
        explain: '法人買超但股價不漲，可能有大量融資賣壓、其他法人在賣、或是出貨行為。需要綜合判斷，不能只看單一訊號。'
      },
      {
        q: '融資大增但股價持續下跌，這通常是什麼訊號？',
        opts: ['法人在大量買進', '散戶可能在接刀，下跌趨勢恐延續', '融券即將回補', '散戶看多，即將反彈'],
        ans: 1,
        explain: '融資增加代表散戶在借錢買股。如果股價仍下跌，代表散戶在「接刀」，當融資斷頭出場時可能引發更大賣壓，是危險訊號。'
      },
      {
        q: 'RSI 出現「頂背離」（股價創新高但 RSI 沒跟上），代表什麼？',
        opts: ['RSI 壞掉了，可以忽略', '應該加碼買進', '上漲動能可能減弱，注意反轉風險', '漲勢將加速'],
        ans: 2,
        explain: '頂背離 = 股價創新高但 RSI 沒有跟上，代表上漲的力道正在衰退。這是技術分析中重要的反轉警訊之一。'
      },
      {
        q: '券資比超過 30%，對股價可能有什麼影響？',
        opts: ['短線有軋空上漲的潛力', '一定會持續下跌', '代表這檔股票要下市了', '跟股價完全無關'],
        ans: 0,
        explain: '券資比高代表放空的人多。如果股價不跌反漲，空方被迫回補（買回股票），反而會推升股價，稱為「軋空」。'
      },
      {
        q: '投信和外資同步連續買超某中小型股，最正確的解讀是？',
        opts: ['代表即將被收購', '100% 會漲，應該全押', '不需要特別注意', '法人共識偏多，值得關注但仍需基本面配合'],
        ans: 3,
        explain: '外資 + 投信同步買超稱為「雙法人認養」，代表該股基本面可能有題材。但投資仍需考慮估值、產業趨勢等因素，不能只看籌碼面。'
      },
    ]
  }
];

let _quizState = null; // { levelId, qIdx, score, answers }

function initBadgeWall() {
  const wall = document.getElementById('badge-wall');
  if (!wall) return;
  const results = JSON.parse(localStorage.getItem('ct-quiz-results') || '{}');
  wall.innerHTML = QUIZ_BADGES.map(b => {
    let unlocked = false;
    if (b.id === 'master') {
      // All three levels must be perfect (5/5)
      unlocked = QUIZ_LEVELS.every(lv => results[lv.id] && results[lv.id].score === 5);
    } else {
      unlocked = results[b.id] && results[b.id].passed;
    }
    return `<div class="badge-item ${unlocked ? 'unlocked' : 'locked'}" style="--badge-color:${b.color};--badge-glow:${b.glow};">
      <div class="badge-icon">${unlocked ? b.icon : '🔒'}</div>
      <div class="badge-name">${b.name}</div>
      <div class="badge-sub">${unlocked ? '已解鎖' : b.sub}</div>
    </div>`;
  }).join('');
}

function initQuizLevels() {
  const container = document.getElementById('quiz-levels');
  if (!container) return;
  const results = JSON.parse(localStorage.getItem('ct-quiz-results') || '{}');
  container.innerHTML = QUIZ_LEVELS.map(lv => {
    const res = results[lv.id];
    const passed = res && res.passed;
    const locked = lv.unlockReq && (!results[lv.unlockReq] || !results[lv.unlockReq].passed);
    let metaHTML = '';
    if (passed) {
      metaHTML = `<span class="quiz-level-score" style="background:rgba(0,255,136,0.15);color:var(--green);">${res.score}/5 通過</span>`;
    } else if (res) {
      metaHTML = `<span class="quiz-level-score" style="background:rgba(255,64,112,0.15);color:var(--red);">${res.score}/5 未通過</span>`;
    } else if (locked) {
      metaHTML = `<span style="font-size:11px;color:var(--text2);">🔒 需先通過${lv.unlockReq === 'beginner' ? '初階' : '中階'}測驗</span>`;
    } else {
      metaHTML = `<span style="font-size:11px;color:var(--text2);">尚未挑戰</span>`;
    }
    return `<div class="quiz-level-card ${passed ? 'passed' : ''} ${locked ? 'locked-quiz' : ''}" style="--qlv-color:${lv.color};" onclick="startQuiz('${lv.id}')">
      <div class="quiz-level-icon">${lv.icon}</div>
      <div class="quiz-level-title">${lv.title}</div>
      <div class="quiz-level-desc">${lv.desc}</div>
      <div class="quiz-level-meta">${metaHTML}</div>
    </div>`;
  }).join('');
}

function startQuiz(levelId) {
  const level = QUIZ_LEVELS.find(l => l.id === levelId);
  if (!level) return;
  _quizState = { levelId, qIdx: 0, score: 0, answers: [] };
  document.getElementById('quiz-overlay').style.display = 'block';

  renderQuizQuestion();
}

function closeQuiz() {
  document.getElementById('quiz-overlay').style.display = 'none';

  _quizState = null;
}

function renderQuizQuestion() {
  if (!_quizState) return;
  const level = QUIZ_LEVELS.find(l => l.id === _quizState.levelId);
  const q = level.questions[_quizState.qIdx];
  const total = level.questions.length;
  const idx = _quizState.qIdx;

  document.getElementById('quiz-progress-text').textContent = `第 ${idx + 1} / ${total} 題`;
  document.getElementById('quiz-progress-fill').style.width = ((idx + 1) / total * 100) + '%';

  const letters = ['A', 'B', 'C', 'D'];
  document.getElementById('quiz-content').innerHTML = `
    <div class="quiz-question">${q.q}</div>
    <div class="quiz-options">
      ${q.opts.map((opt, i) => `
        <div class="quiz-option" onclick="selectAnswer(${i})" data-idx="${i}">
          <span class="quiz-option-letter">${letters[i]}</span>
          <span>${opt}</span>
        </div>
      `).join('')}
    </div>
    <div class="quiz-explain" id="quiz-explain"></div>
    <button class="btn btn-primary quiz-next-btn" id="quiz-next-btn" onclick="nextQuestion()">${idx < total - 1 ? '下一題 →' : '查看結果'}</button>
  `;
}

function selectAnswer(optIdx) {
  if (!_quizState) return;
  const level = QUIZ_LEVELS.find(l => l.id === _quizState.levelId);
  const q = level.questions[_quizState.qIdx];
  const correct = q.ans === optIdx;
  if (correct) _quizState.score++;
  _quizState.answers.push(optIdx);

  // Disable all options and show result
  document.querySelectorAll('.quiz-option').forEach((el, i) => {
    el.classList.add('disabled');
    if (i === q.ans) el.classList.add('correct');
    if (i === optIdx && !correct) el.classList.add('wrong');
  });

  // Show explanation
  const explainEl = document.getElementById('quiz-explain');
  explainEl.className = 'quiz-explain show ' + (correct ? 'correct-explain' : 'wrong-explain');
  explainEl.innerHTML = (correct ? '✅ <strong>正確！</strong> ' : '❌ <strong>答錯了。</strong> ') + q.explain;

  // Show next button
  document.getElementById('quiz-next-btn').classList.add('show');
}

function nextQuestion() {
  if (!_quizState) return;
  const level = QUIZ_LEVELS.find(l => l.id === _quizState.levelId);
  _quizState.qIdx++;

  if (_quizState.qIdx >= level.questions.length) {
    showQuizResult();
    return;
  }
  renderQuizQuestion();
  document.querySelector('.quiz-card').scrollTop = 0;
}

function showQuizResult() {
  const level = QUIZ_LEVELS.find(l => l.id === _quizState.levelId);
  const score = _quizState.score;
  const total = level.questions.length;
  const passed = score >= 4;
  const perfect = score === total;

  // Save result
  const results = JSON.parse(localStorage.getItem('ct-quiz-results') || '{}');
  const prev = results[_quizState.levelId];
  // Only save if better than previous
  if (!prev || score > prev.score) {
    results[_quizState.levelId] = { score, passed, date: new Date().toISOString() };
    localStorage.setItem('ct-quiz-results', JSON.stringify(results));
  } else if (passed && !prev.passed) {
    results[_quizState.levelId] = { score, passed, date: new Date().toISOString() };
    localStorage.setItem('ct-quiz-results', JSON.stringify(results));
  }

  document.getElementById('quiz-progress-fill').style.width = '100%';
  document.getElementById('quiz-progress-text').textContent = '測驗完成';

  let resultIcon, resultTitle, resultMsg, badgeHTML = '';
  const scoreColor = passed ? 'var(--green)' : 'var(--red)';

  if (perfect) {
    resultIcon = '🎉';
    resultTitle = '滿分通過！';
    resultMsg = '太厲害了！你已經完全掌握這個階段的知識。';
  } else if (passed) {
    resultIcon = '✨';
    resultTitle = '恭喜通過！';
    resultMsg = `答對 ${score} 題，達到通過門檻。繼續加油！`;
  } else {
    resultIcon = '💪';
    resultTitle = '再接再厲';
    resultMsg = `需要答對 4 題以上才能通過。建議回去複習學院課程後再挑戰！`;
  }

  if (passed) {
    const badge = QUIZ_BADGES.find(b => b.id === _quizState.levelId);
    if (badge) {
      badgeHTML = `<div class="quiz-result-badge" style="background:${badge.color}22;color:${badge.color};border:1px solid ${badge.color}44;">
        ${badge.icon} 獲得「${badge.name}」勳章！
      </div>`;
    }
    // Check for master badge
    const allResults = JSON.parse(localStorage.getItem('ct-quiz-results') || '{}');
    const allPerfect = QUIZ_LEVELS.every(lv => allResults[lv.id] && allResults[lv.id].score === 5);
    if (allPerfect) {
      badgeHTML += `<div class="quiz-result-badge" style="background:rgba(0,240,255,0.1);color:var(--cyan);border:1px solid rgba(0,240,255,0.3);">
        💎 獲得「股市大師」終極勳章！
      </div>`;
    }
  }

  document.getElementById('quiz-content').innerHTML = `
    <div class="quiz-result">
      <div class="quiz-result-icon">${resultIcon}</div>
      <div class="quiz-result-title">${resultTitle}</div>
      <div class="quiz-result-score" style="color:${scoreColor};">${score} / ${total}</div>
      ${badgeHTML}
      <div class="quiz-result-msg">${resultMsg}</div>
      <div class="quiz-result-btns">
        <button class="btn btn-secondary" onclick="closeQuiz(); initBadgeWall(); initQuizLevels();">返回學院</button>
        ${!passed ? `<button class="btn btn-primary" onclick="startQuiz('${_quizState.levelId}')">重新挑戰</button>` : ''}
        ${passed && _quizState.levelId !== 'advanced' ? `<button class="btn btn-primary" onclick="startQuiz('${_quizState.levelId === 'beginner' ? 'intermediate' : 'advanced'}')">挑戰下一階</button>` : ''}
      </div>
    </div>
  `;
}

// Init badge & quiz on academy load
function initAcademyFull() {
  initAcademy();
  initBadgeWall();
  initQuizLevels();
}
initAcademyFull();

// ============================================================
// MOBILE BOTTOM NAV (5+1)
// ============================================================
(function() {
  var mbnTabMap = {
    overview:'overview', global:'overview', briefing:'overview', ai:'overview',
    analysis:'analysis', daytrade:'analysis',
    watchlist:'watchlist',
    institutional:'institutional', sectors:'institutional',
    opinion:'opinion'
  };

  window.updateMobileNavActive = function(tabName) {
    var nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;
    var mapped = mbnTabMap[tabName] || null;
    nav.querySelectorAll('.mbn-item').forEach(function(el) {
      el.classList.remove('active');
      if (el.dataset.mbnTab === mapped) el.classList.add('active');
    });
    if (!mapped) {
      var moreBtn = document.getElementById('mbn-more-btn');
      if (moreBtn) moreBtn.classList.add('active');
    }
  };

  window.closeMobileMoreMenu = function() {
    var ov = document.getElementById('mbn-more-overlay');
    if (ov) ov.classList.remove('show');
  };

  function openMobileMoreMenu() {
    var ov = document.getElementById('mbn-more-overlay');
    if (ov) ov.classList.add('show');
  }

  function buildMoreGrid() {
    var grid = document.getElementById('mbn-more-grid');
    if (!grid) return;
    var items = [
      { tab:'academy', label:'學院', icon:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
      { tab:'daytrade', label:'當沖', icon:'<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' },
      { tab:'sectors', label:'題材', icon:'<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 2v10l7 4"/>' },
      { tab:'global', label:'國際', icon:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a16 16 0 0 1 0 20M12 2a16 16 0 0 0 0 20"/>' },
      { tab:'briefing', label:'晨訊', icon:'<path d="M4 4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z"/><path d="M8 8h8M8 12h8M8 16h5"/>' },
      { tab:'ai', label:'AI', icon:'<path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/><path d="M6 10v1a6 6 0 0 0 12 0v-1M8 18h8M10 22h4M12 18v4"/>' },
      { tab:'screener', label:'篩選', icon:'<path d="M3 4h18v2H3zM5 10h14v2H5zM8 16h8v2H8z"/>' },
      { tab:'compare', label:'比較', icon:'<path d="M18 20V10M12 20V4M6 20v-6"/>' }
    ];
    // Mode toggle as first item
    var isSimple = document.body.classList.contains('simple-mode');
    var html = '<div class="mbn-more-item mbn-mode-toggle" id="mbn-mode-toggle" style="border-color:' + (isSimple ? 'rgba(0,240,255,0.3)' : 'rgba(180,77,255,0.3)') + ';">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' +
      '<span style="color:' + (isSimple ? 'var(--cyan)' : 'var(--purple)') + ';">' + (isSimple ? '切換專業' : '切換簡易') + '</span></div>';

    items.forEach(function(it) {
      html += '<div class="mbn-more-item" data-mbn-tab="'+it.tab+'">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">'+it.icon+'</svg>' +
        '<span>'+it.label+'</span></div>';
    });
    // Admin
    html += '<div class="mbn-more-item mbn-more-admin" data-mbn-tab="admin" style="display:none;">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.38.35.94.56 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
      '<span>管理</span></div>';
    // Upgrade
    html += '<div class="mbn-more-item" onclick="closeMobileMoreMenu();showUpgradeModal();">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' +
      '<span>升級 Pro</span></div>';
    // Account
    html += '<div class="mbn-more-item" id="mbn-more-account" onclick="closeMobileMoreMenu();openAuthModal();">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' +
      '<span>帳號</span></div>';

    grid.innerHTML = html;

    // Mode toggle click
    var modeBtn = document.getElementById('mbn-mode-toggle');
    if (modeBtn) {
      modeBtn.addEventListener('click', function() {
        toggleViewMode();
        closeMobileMoreMenu();
        // Rebuild to update label
        setTimeout(buildMoreGrid, 100);
      });
    }

    // Click handlers for tab items
    grid.querySelectorAll('.mbn-more-item[data-mbn-tab]').forEach(function(el) {
      el.addEventListener('click', function() {
        switchTab(el.dataset.mbnTab, true);
        closeMobileMoreMenu();
      });
    });
  }

  function initMobileBottomNav() {
    var nav = document.getElementById('mobile-bottom-nav');
    if (!nav) return;

    // 5 main tab items
    nav.querySelectorAll('.mbn-item[data-mbn-tab]').forEach(function(item) {
      item.addEventListener('click', function() {
        switchTab(item.dataset.mbnTab, true);
        closeMobileMoreMenu();
      });
    });

    // More button
    var moreBtn = document.getElementById('mbn-more-btn');
    if (moreBtn) {
      moreBtn.addEventListener('click', function() {
        var ov = document.getElementById('mbn-more-overlay');
        if (ov && ov.classList.contains('show')) {
          closeMobileMoreMenu();
        } else {
          openMobileMoreMenu();
        }
      });
    }

    // Backdrop close
    var backdrop = document.getElementById('mbn-more-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', closeMobileMoreMenu);
    }
  }

  buildMoreGrid();
  initMobileBottomNav();
})();
