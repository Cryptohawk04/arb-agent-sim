/* ============================================================
   ARBITRAGE AI AGENT — CONTROL CENTER
   v1.0.0 — Backend-driven SIM mode
   ============================================================ */

'use strict';

// ---- STATE ----
var DATA = null;
var sseSource = null;
var sseConnected = false;
var pollTimer = null;
var agentEventLogs = {
  monitor: [], edge: [], execution: [], signals: [], watchdog: []
};

// ---- FORMATTERS ----
function fmt$(val) {
  var abs = Math.abs(val).toFixed(2);
  return val < 0 ? '-$' + abs : '$' + abs;
}

function fmtPnl(val) {
  var abs = Math.abs(val).toFixed(2);
  return val < 0 ? '-$' + abs : '+$' + abs;
}

function pnlClass(val) {
  return val > 0 ? 'positive' : val < 0 ? 'negative' : '';
}

function pnlColorVar(val) {
  return val > 0 ? 'bankroll-stat__value--green' : val < 0 ? 'bankroll-stat__value--red' : '';
}

// ---- CLOCK ----
function updateClock() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, '0');
  var m = String(now.getMinutes()).padStart(2, '0');
  var s = String(now.getSeconds()).padStart(2, '0');
  var timeStr = h + ':' + m + ':' + s;
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var dateStr = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear();
  setText('headerTime', timeStr);
  setText('headerDate', dateStr);
  setText('lastSync', timeStr);
}

function setText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ---- HASH ROUTER ----
function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  var hash = (location.hash || '#overview').replace('#', '');
  var allTabs = document.querySelectorAll('.tab-content');
  var allLinks = document.querySelectorAll('.tab-link');

  for (var i = 0; i < allTabs.length; i++) {
    var tabId = allTabs[i].id.replace('tab-', '');
    if (tabId === hash) {
      allTabs[i].classList.remove('tab-content--hidden');
      allTabs[i].style.display = '';
    } else {
      allTabs[i].classList.add('tab-content--hidden');
    }
  }

  for (var j = 0; j < allLinks.length; j++) {
    if (allLinks[j].getAttribute('data-tab') === hash) {
      allLinks[j].classList.add('tab-link--active');
    } else {
      allLinks[j].classList.remove('tab-link--active');
    }
  }
}

// ---- API FETCH ----
async function fetchState() {
  try {
    var resp = await fetch('/api/state');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    DATA = await resp.json();
    renderAll(DATA);
  } catch (err) {
    console.error('[fetch] State error:', err);
  }
}

// ---- SSE ----
function connectSSE() {
  if (sseSource) { sseSource.close(); }

  sseSource = new EventSource('/api/events');

  sseSource.onopen = function () {
    sseConnected = true;
    updateSSEIndicator(true);
    // Stop polling fallback if SSE is working
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  sseSource.onmessage = function (evt) {
    try {
      var event = JSON.parse(evt.data);
      handleSSEEvent(event);
    } catch (e) { /* ignore parse errors */ }
  };

  sseSource.onerror = function () {
    sseConnected = false;
    updateSSEIndicator(false);
    sseSource.close();
    sseSource = null;
    // Fall back to polling
    if (!pollTimer) {
      pollTimer = setInterval(fetchState, 5000);
    }
    // Retry SSE after 10s
    setTimeout(connectSSE, 10000);
  };
}

function handleSSEEvent(event) {
  // On tick events, fetch fresh state
  if (event.type === 'tick') {
    fetchState();
  }

  // Route agent-specific events to their logs
  if (event.type === 'monitor_scan')      pushAgentLog('monitor', event);
  if (event.type === 'edge_ranking')      pushAgentLog('edge', event);
  if (event.type === 'exec_status')       pushAgentLog('execution', event);
  if (event.type === 'signal_summary')    pushAgentLog('signals', event);
  if (event.type === 'watchdog_heartbeat') pushAgentLog('watchdog', event);

  // Signals — prepend to signals list
  if (event.type === 'signal' && DATA) {
    DATA.signals.unshift({
      source: event.source,
      dir: event.dir,
      symbol: event.symbol,
      time: event.time
    });
    if (DATA.signals.length > 30) DATA.signals.pop();
    renderSignals(DATA);
    renderSignalsTab(DATA);
  }

  // Errors
  if (event.type === 'error' && DATA) {
    DATA.errors.unshift({ time: event.time, level: event.level, msg: event.msg });
    if (DATA.errors.length > 50) DATA.errors.pop();
    renderErrors(DATA);
  }
}

function pushAgentLog(agentId, event) {
  if (!agentEventLogs[agentId]) agentEventLogs[agentId] = [];
  agentEventLogs[agentId].unshift(event);
  if (agentEventLogs[agentId].length > 50) agentEventLogs[agentId].pop();
  renderAgentEventLog(agentId);
}

function updateSSEIndicator(connected) {
  var dot = document.getElementById('sseDot');
  var status = document.getElementById('sseStatus');
  if (dot) {
    dot.className = 'sim-sse-dot' + (connected ? ' sim-sse-dot--connected' : '');
    dot.title = connected ? 'SSE connected' : 'SSE disconnected';
  }
  if (status) status.textContent = connected ? 'connected' : 'disconnected';
}

// ---- SIM CONTROLS ----
function initSimControls() {
  var btnPause  = document.getElementById('btnPause');
  var btnResume = document.getElementById('btnResume');
  var btnReset  = document.getElementById('btnReset');
  var tickSelect = document.getElementById('tickRateSelect');

  if (btnPause) btnPause.addEventListener('click', function () {
    simControl({ action: 'pause' });
  });
  if (btnResume) btnResume.addEventListener('click', function () {
    simControl({ action: 'resume' });
  });
  if (btnReset) btnReset.addEventListener('click', function () {
    simControl({ action: 'reset', seed: Math.floor(Math.random() * 99999) });
  });
  if (tickSelect) tickSelect.addEventListener('change', function () {
    var rate = parseInt(this.value);
    simControl({ action: 'setTickRate', tickRate: rate });
    setText('footerTickRate', (rate / 1000) + 's');
  });
}

async function simControl(body) {
  try {
    await fetch('/api/sim/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error('[sim] Control error:', e);
  }
}

// ---- RENDER: BANKROLL ----
function renderBankroll(data) {
  var b = data.bankroll;
  var balEl = document.getElementById('currentBalance');
  if (balEl) {
    balEl.textContent = fmt$(b.current);
    balEl.className = 'bankroll-stat__value ' + pnlColorVar(b.current - b.starting);
  }
  setText('startingBalance', fmt$(b.starting));
  var expEl = document.getElementById('exposure');
  if (expEl) {
    expEl.textContent = fmt$(b.exposure);
    expEl.className = 'bankroll-stat__value' + (b.exposure > 100 ? ' bankroll-stat__value--amber' : '');
  }
  var dailyEl = document.getElementById('dailyPnl');
  if (dailyEl) {
    dailyEl.textContent = fmtPnl(b.dailyPnl);
    dailyEl.className = 'bankroll-stat__value ' + pnlColorVar(b.dailyPnl);
  }
  var weeklyEl = document.getElementById('weeklyPnl');
  if (weeklyEl) {
    weeklyEl.textContent = fmtPnl(b.weeklyPnl);
    weeklyEl.className = 'bankroll-stat__value ' + pnlColorVar(b.weeklyPnl);
  }
}

// ---- RENDER: EDGES TABLE ----
function renderEdges(data) {
  var html = buildEdgesHTML(data.edges);
  var tbody = document.getElementById('edgesBody');
  if (tbody) tbody.innerHTML = html;
  var edgeBody = document.getElementById('edgeRankingsBody');
  if (edgeBody) edgeBody.innerHTML = html;
}

function buildEdgesHTML(edges) {
  var html = '';
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    var statusClass = '';
    if (e.status === 'active')    statusClass = 'status-pill--active';
    else if (e.status === 'pending')  statusClass = 'status-pill--pending';
    else if (e.status === 'filled')   statusClass = 'status-pill--filled';
    else if (e.status === 'rejected') statusClass = 'status-pill--rejected';
    var sideClass = e.side === 'BUY' ? 'positive' : 'negative';
    html += '<tr><td class="info">' + e.ticker + '</td><td class="positive">' + e.edge.toFixed(1) + '%</td><td class="positive">' + fmt$(e.profit) + '</td><td class="' + sideClass + '">' + e.side + '</td><td><span class="status-pill ' + statusClass + '">' + e.status.toUpperCase() + '</span></td></tr>';
  }
  return html;
}

// ---- RENDER: POSITIONS TABLE ----
function renderPositions(data) {
  var tbody = document.getElementById('positionsBody');
  renderPositionsInto(tbody, data);
  var execBody = document.getElementById('execPositionsBody');
  renderPositionsInto(execBody, data);
}

function renderPositionsInto(tbody, data) {
  if (!tbody) return;
  var html = '';
  for (var i = 0; i < data.positions.length; i++) {
    var p = data.positions[i];
    var cls = pnlClass(p.pnl);
    html += '<tr><td class="info">' + p.ticker + '</td><td class="' + (p.side === 'LONG' ? 'positive' : 'negative') + '">' + p.side + '</td><td>' + p.size + '</td><td>' + fmt$(p.entry) + '</td><td>' + fmt$(p.current) + '</td><td class="' + cls + '">' + fmtPnl(p.pnl) + '</td></tr>';
  }
  tbody.innerHTML = html;
}

// ---- RENDER: SIGNALS ----
function renderSignals(data) {
  var container = document.getElementById('signalsList');
  if (!container) return;
  container.innerHTML = buildSignalsHTML(data.signals.slice(0, 10));
}

function renderSignalsTab(data) {
  var container = document.getElementById('signalsFullList');
  if (container) container.innerHTML = buildSignalsHTML(data.signals);

  // Stats
  var buys  = data.signals.filter(function (s) { return s.dir === 'BUY'; }).length;
  var sells = data.signals.filter(function (s) { return s.dir === 'SELL'; }).length;
  setText('signalsTotalCount', data.signals.length);
  setText('signalsBuyCount', buys);
  setText('signalsSellCount', sells);
  var biasEl = document.getElementById('signalsBias');
  if (biasEl) {
    var bias = buys > sells ? 'BULLISH' : buys < sells ? 'BEARISH' : 'NEUTRAL';
    biasEl.textContent = bias;
    biasEl.className = 'agent-detail-stat__value ' + (bias === 'BULLISH' ? 'bankroll-stat__value--green' : bias === 'BEARISH' ? 'bankroll-stat__value--red' : '');
  }
}

function buildSignalsHTML(signals) {
  var html = '';
  for (var i = 0; i < signals.length; i++) {
    var s = signals[i];
    var dirLower = s.dir.toLowerCase();
    html += '<div class="signal-row signal-row--' + dirLower + '"><span class="signal-row__source">' + s.source + '</span><span class="signal-row__dir signal-row__dir--' + dirLower + '">' + s.dir + '</span><span class="signal-row__symbol">' + s.symbol + '</span><span class="signal-row__time">' + s.time + '</span></div>';
  }
  return html;
}

// ---- RENDER: AGENTS ----
function renderAgents(data) {
  var grid = document.getElementById('agentsGrid');
  renderAgentsInto(grid, data);
  var wdGrid = document.getElementById('watchdogAgentsGrid');
  renderAgentsInto(wdGrid, data);
}

function renderAgentsInto(grid, data) {
  if (!grid) return;
  var html = '';
  for (var i = 0; i < data.agents.length; i++) {
    var a = data.agents[i];
    html += '<div class="agent-tile"><div class="agent-dot agent-dot--' + a.status + '"></div><div class="agent-info"><span class="agent-name">' + a.name + '</span><span class="agent-meta">' + a.lastSeen + ' · ' + a.latency + '</span></div></div>';
  }
  grid.innerHTML = html;
}

// ---- RENDER: RISK GAUGES ----
function gaugeColor(pct) {
  if (pct < 50) return 'gauge__fill--green';
  if (pct < 75) return 'gauge__fill--amber';
  return 'gauge__fill--red';
}

function renderRisk(data) {
  var r = data.risk;

  // Overview gauges
  renderGauge('gaugeDailyLoss', r.dailyLoss, 10, '-');
  renderGauge('gaugeWeeklyLoss', r.weeklyLoss, 30, '-');
  renderGaugeExposure('gaugeExposure', r.exposure, 150);

  // Risk tab gauges
  renderGauge('riskGaugeDaily', r.dailyLoss, 10, '-');
  renderGauge('riskGaugeWeekly', r.weeklyLoss, 30, '-');
  renderGaugeExposure('riskGaugeExposure', r.exposure, 150);

  // Risk tab details
  setText('riskDailyLossDetail',  '-' + fmt$(r.dailyLoss));
  setText('riskWeeklyLossDetail', '-' + fmt$(r.weeklyLoss));
  setText('riskExposureDetail',   fmt$(r.exposure));
}

function renderGauge(prefix, value, max, sign) {
  var pct = Math.min((value / max) * 100, 100);
  var fill = document.getElementById(prefix + 'Fill');
  var val  = document.getElementById(prefix + 'Val');
  if (fill) {
    fill.style.width = pct + '%';
    fill.className = 'gauge__fill ' + gaugeColor(pct);
  }
  if (val) val.textContent = (sign || '') + fmt$(value) + ' / ' + (sign || '') + '$' + max.toFixed(2);
}

function renderGaugeExposure(prefix, value, max) {
  var pct = Math.min((value / max) * 100, 100);
  var fill = document.getElementById(prefix + 'Fill');
  var val  = document.getElementById(prefix + 'Val');
  if (fill) {
    fill.style.width = pct + '%';
    fill.className = 'gauge__fill ' + gaugeColor(pct);
  }
  if (val) val.textContent = fmt$(value) + ' / $' + max.toFixed(2);
}

// ---- RENDER: ERROR LOG ----
function renderErrors(data) {
  var el = document.getElementById('errorConsole');
  if (!el) return;
  var html = '';
  var errors = data.errors.slice(0, 20);
  for (var i = 0; i < errors.length; i++) {
    var e = errors[i];
    var levelClass = '';
    if (e.level === 'ERR')  levelClass = 'error-line__level--err';
    else if (e.level === 'WARN') levelClass = 'error-line__level--warn';
    else if (e.level === 'INFO') levelClass = 'error-line__level--info';
    html += '<div class="error-line"><span class="error-line__time">' + e.time + '</span><span class="error-line__level ' + levelClass + '">' + e.level + '</span><span class="error-line__msg">' + e.msg + '</span></div>';
  }
  el.innerHTML = html;
}

// ---- RENDER: AGENT EVENT LOGS ----
function renderAgentEventLog(agentId) {
  var logEl = document.getElementById(agentId + 'EventLog');
  if (!logEl) return;
  var logs = agentEventLogs[agentId] || [];
  if (logs.length === 0) return;
  var html = '';
  for (var i = 0; i < Math.min(logs.length, 20); i++) {
    var ev = logs[i];
    var time = ev.time
      ? ev.time.split('T').pop().slice(0, 8)
      : new Date(ev.ts).toTimeString().slice(0, 8);
    var msg = JSON.stringify(ev).slice(0, 120);
    html += '<div class="error-line"><span class="error-line__time">' + time + '</span><span class="error-line__level error-line__level--info">' + ev.type + '</span><span class="error-line__msg">' + msg + '</span></div>';
  }
  logEl.innerHTML = html;
}

// ---- RENDER: AGENT DETAIL TABS ----
function renderAgentDetails(data) {
  if (!data) return;

  // Monitor tab
  var monAgent = data.agents.find(function (a) { return a.name === 'Monitor Agent'; });
  if (monAgent) {
    setText('monitorStatusVal', monAgent.status.toUpperCase());
    setText('monitorLatency', monAgent.latency);
    setText('monitorLastSeen', monAgent.lastSeen);
    var anomalies = data.edges.filter(function (e) { return e.edge > 3.0; }).length;
    setText('monitorAnomalies', anomalies);
  }

  // Edge tab
  var edgeAgent = data.agents.find(function (a) { return a.name === 'Edge Calculator'; });
  if (edgeAgent) {
    setText('edgeStatusVal', edgeAgent.status.toUpperCase());
    setText('edgeLatency', edgeAgent.latency);
    var aboveThreshold = data.edges.filter(function (e) { return e.edge >= 3.0; }).length;
    setText('edgeAboveThreshold', aboveThreshold);
    var topEdge = data.edges.reduce(function (max, e) { return e.edge > max ? e.edge : max; }, 0);
    setText('edgeTopEdge', topEdge.toFixed(1) + '%');
  }

  // Exec tab
  if (data.strategy) {
    setText('execTotalOrders', data.strategy.totalOrders);
    setText('execTotalFills', data.strategy.totalFills);
    setText('execOpenPositions', data.positions.length);
  }

  // Risk tab
  var circuitText = 'OFF';
  if (data.risk.dailyLoss >= 10 || data.risk.weeklyLoss >= 30) circuitText = 'ON';
  setText('riskCircuitBreaker', circuitText);
  var cbEl = document.getElementById('riskCircuitBreaker');
  if (cbEl) cbEl.className = 'agent-detail-stat__value ' + (circuitText === 'ON' ? 'bankroll-stat__value--red' : 'bankroll-stat__value--green');

  // Watchdog tab
  if (data.sim) {
    setText('watchdogTickCount', data.sim.tickCount);
  }
  var healthy   = data.agents.filter(function (a) { return a.status === 'green'; }).length;
  var unhealthy = data.agents.length - healthy;
  setText('watchdogHealthy', healthy);
  var whEl = document.getElementById('watchdogUnhealthy');
  if (whEl) {
    whEl.textContent = unhealthy;
    whEl.className = 'agent-detail-stat__value ' + (unhealthy > 0 ? 'bankroll-stat__value--red' : '');
  }
  setText('watchdogCircuit', circuitText);

  // Strategy tab
  if (data.strategy) {
    setText('stratThreshold', (data.strategy.edgeThreshold * 100).toFixed(1) + '%');
    setText('stratDefaultSize', fmt$(data.strategy.defaultSize));
    setText('stratTotalOrders', data.strategy.totalOrders);
    setText('stratTotalFills', data.strategy.totalFills);
    setText('stratWinRate', data.strategy.winRate + '%');
    setText('stratWL', data.strategy.wins + ' / ' + data.strategy.losses);
    var wrEl = document.getElementById('stratWinRate');
    if (wrEl) wrEl.className = 'agent-detail-stat__value ' + (data.strategy.winRate > 50 ? 'bankroll-stat__value--green' : data.strategy.winRate > 0 ? 'bankroll-stat__value--amber' : '');
  }

  // Inject failure buttons
  renderInjectGrid(data);
}

function renderInjectGrid(data) {
  var grid = document.getElementById('injectGrid');
  if (!grid) return;
  // Only render once
  if (grid.children.length > 0) return;
  var agents = ['monitor', 'edge', 'execution', 'risk', 'signals', 'watchdog'];
  var names  = ['Monitor', 'Edge', 'Executor', 'Risk', 'Signals', 'Watchdog'];
  var html = '';
  for (var i = 0; i < agents.length; i++) {
    html += '<button class="inject-btn" data-agent="' + agents[i] + '">Inject Failure: ' + names[i] + '</button>';
  }
  grid.innerHTML = html;

  var buttons = grid.querySelectorAll('.inject-btn');
  for (var j = 0; j < buttons.length; j++) {
    buttons[j].addEventListener('click', function () {
      var agentId = this.getAttribute('data-agent');
      simControl({ action: 'injectFailure', agentId: agentId });
      this.style.borderColor = 'var(--red)';
      this.textContent = 'Injected!';
      var btn = this;
      setTimeout(function () {
        btn.style.borderColor = '';
        btn.textContent = 'Inject Failure: ' + agentId;
      }, 2000);
    });
  }
}

// ---- PNL CHART ----
var pnlChart = null;

function initPnlChart(data) {
  if (typeof Chart === 'undefined') return;
  var canvas = document.getElementById('pnlChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');

  var labels   = [];
  var values   = [];
  for (var i = 0; i < data.pnlHistory.length; i++) {
    labels.push(data.pnlHistory[i].day);
    values.push(data.pnlHistory[i].value);
  }

  var cumulative = [];
  var running = 0;
  for (var j = 0; j < values.length; j++) {
    running += values[j];
    cumulative.push(parseFloat(running.toFixed(2)));
  }

  var gradient = ctx.createLinearGradient(0, 0, 0, 180);
  gradient.addColorStop(0, 'rgba(0, 255, 136, 0.18)');
  gradient.addColorStop(1, 'rgba(0, 255, 136, 0.0)');

  pnlChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Cumulative PnL',
        data: cumulative,
        borderColor: '#00ff88',
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointBackgroundColor: '#00ff88',
        pointBorderColor: '#0a0a0f',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#00ff88',
        pointHoverBorderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#14141e',
          borderColor: '#1a1a28',
          borderWidth: 1,
          titleColor: '#8888a0',
          bodyColor: '#00ff88',
          titleFont: { family: 'Outfit', size: 11 },
          bodyFont: { family: 'Fira Code', size: 13, weight: '600' },
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: function (context) {
              var v = context.parsed.y;
              return 'PnL: ' + (v >= 0 ? '+' : '') + '$' + v.toFixed(2);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.03)', drawBorder: false },
          ticks: { color: '#555570', font: { family: 'Fira Code', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.03)', drawBorder: false },
          ticks: {
            color: '#555570',
            font: { family: 'Fira Code', size: 10 },
            callback: function (val) { return '$' + val.toFixed(0); }
          }
        }
      }
    }
  });
}

function updatePnlChart(data) {
  if (!pnlChart) return;
  var values = [];
  var labels = [];
  for (var i = 0; i < data.pnlHistory.length; i++) {
    labels.push(data.pnlHistory[i].day);
    values.push(data.pnlHistory[i].value);
  }
  var cumulative = [];
  var running = 0;
  for (var j = 0; j < values.length; j++) {
    running += values[j];
    cumulative.push(parseFloat(running.toFixed(2)));
  }
  pnlChart.data.labels = labels;
  pnlChart.data.datasets[0].data = cumulative;
  pnlChart.update('none');
}

// ---- SIM INFO ----
function renderSimInfo(data) {
  if (!data || !data.sim) return;
  setText('tickCount', 'T:' + data.sim.tickCount);
}

// ---- RENDER ALL ----
function renderAll(data) {
  if (!data) return;
  renderBankroll(data);
  renderEdges(data);
  renderPositions(data);
  renderSignals(data);
  renderSignalsTab(data);
  renderAgents(data);
  renderRisk(data);
  renderErrors(data);
  renderAgentDetails(data);
  renderSimInfo(data);
  updatePnlChart(data);
  updateClock();
}

// ---- INIT ----
(function () {
  updateClock();
  setInterval(updateClock, 1000);

  initRouter();
  initSimControls();

  // Initial fetch
  fetchState().then(function () {
    if (DATA && typeof Chart !== 'undefined') {
      initPnlChart(DATA);
    }
  });

  // Connect SSE
  connectSSE();

  // Fallback polling (will be stopped if SSE connects)
  pollTimer = setInterval(fetchState, 5000);
}());
