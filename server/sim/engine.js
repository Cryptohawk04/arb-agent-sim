'use strict';

const { state, rng, jitter, clamp, pick, fmtTime, reseed,
        TICKERS, SOURCES, DIRECTIONS, SIDES } = require('./state');
const events = require('./events');
const risk = require('./risk');
const broker = require('./broker');

let tickTimer = null;

function tick() {
  if (!state.sim.running) return;

  state.sim.tickCount++;
  const now = Date.now();

  // ---- 1. Update market prices (positions) ----
  for (const p of state.positions) {
    const drift = (rng() - 0.48) * 0.3; // slight upward bias
    p.current = parseFloat(clamp(p.current + drift, p.entry * 0.5, p.entry * 2.0).toFixed(2));
    const dir = p.side === 'LONG' ? 1 : -1;
    p.pnl = parseFloat(((p.current - p.entry) * p.size * dir).toFixed(2));
  }

  // ---- 2. Update edge opportunities ----
  for (const e of state.edges) {
    e.edge = parseFloat(clamp(jitter(e.edge, 1.2), 0.1, 12.0).toFixed(1));
    e.profit = parseFloat(clamp(jitter(e.profit, 1.5), 0.50, 25.0).toFixed(2));
    // Random status transitions
    if (rng() > 0.92) {
      const statuses = ['active', 'pending', 'filled'];
      e.status = pick(statuses);
    }
  }

  // Occasionally add/rotate edges
  if (rng() > 0.85 && state.edges.length < 8) {
    const t = pick(TICKERS);
    state.edges.push({
      id: `e${state.sim.tickCount}`,
      ticker: t,
      edge: parseFloat((1.0 + rng() * 6.0).toFixed(1)),
      profit: parseFloat((1.0 + rng() * 12.0).toFixed(2)),
      side: pick(SIDES),
      status: 'pending'
    });
  }
  if (state.edges.length > 7) state.edges.shift();

  // ---- 3. Generate signals ----
  if (rng() > 0.4) {
    const signal = {
      source: pick(SOURCES),
      dir: pick(DIRECTIONS),
      symbol: pick(TICKERS),
      time: fmtTime()
    };
    state.signals.unshift(signal);
    if (state.signals.length > 30) state.signals.pop();

    events.emit('signal', signal);
  }

  // ---- 4. Update bankroll ----
  let totalPnl = 0;
  for (const p of state.positions) totalPnl += p.pnl;
  state.bankroll.current = parseFloat((state.bankroll.starting + totalPnl + jitter(0, 0.5)).toFixed(2));
  state.bankroll.dailyPnl = parseFloat(jitter(state.bankroll.current - state.bankroll.starting, 1.0).toFixed(2));
  state.bankroll.weeklyPnl = parseFloat((state.bankroll.dailyPnl + jitter(4.0, 2.0)).toFixed(2));

  // ---- 5. Update risk gauges ----
  state.risk.dailyLoss = parseFloat(clamp(
    jitter(Math.max(0, -state.bankroll.dailyPnl), 0.5), 0, 10
  ).toFixed(2));
  state.risk.weeklyLoss = parseFloat(clamp(
    jitter(Math.max(0, -state.bankroll.weeklyPnl + 5), 1.0), 0, 30
  ).toFixed(2));
  risk.updateRisk();

  // ---- 6. Update agent heartbeats ----
  for (const a of state.agents) {
    const elapsed = ((now - a.lastTickAt) / 1000).toFixed(0);
    a.lastSeen = `${elapsed}s ago`;
    a.latency = `${Math.max(1, Math.round(jitter(15, 20)))}ms`;
    a.lastTickAt = now;

    // Random agent degradation (rare)
    if (rng() > 0.97) {
      a.status = 'yellow';
      a.consecutiveErrors++;
      if (a.consecutiveErrors > 2) a.status = 'red';
    } else {
      a.status = 'green';
      a.consecutiveErrors = 0;
    }
  }

  // ---- 7. Edge strategy v0: auto-create order plans for high edge ----
  for (const e of state.edges) {
    if (e.status === 'pending' && (e.edge / 100) >= state.strategy.edgeThreshold) {
      const plan = broker.createOrderPlan(e);
      if (plan) {
        e.status = 'active';
        // Attempt fill
        const fill = broker.fillOrder(plan);
        if (fill) {
          e.status = 'filled';
        }
      }
    }
  }

  // ---- 8. Generate occasional errors ----
  if (rng() > 0.88) {
    const errorTemplates = [
      { level: 'WARN', msg: `Rate limit approaching — ${Math.round(700 + rng() * 300)}/1000 calls` },
      { level: 'ERR',  msg: `Timeout fetching ${pick(TICKERS)} from provider ${pick(['A', 'B', 'C'])} (retry ${Math.ceil(rng() * 3)}/3)` },
      { level: 'INFO', msg: 'Risk monitor recalibrated — new exposure ceiling active' },
      { level: 'WARN', msg: `Spread widened beyond threshold on ${pick(TICKERS)} — skipping` },
      { level: 'INFO', msg: `Edge scan complete — ${Math.round(2 + rng() * 5)} opportunities above threshold` },
      { level: 'ERR',  msg: `Websocket reconnected after ${(0.5 + rng() * 3).toFixed(1)}s disconnect` },
      { level: 'INFO', msg: `Paper fill: ${pick(SIDES)} ${pick(TICKERS)} @ $${(5 + rng() * 15).toFixed(2)}` }
    ];
    const err = pick(errorTemplates);
    const entry = { time: fmtTime(), level: err.level, msg: err.msg };
    state.errors.unshift(entry);
    if (state.errors.length > 50) state.errors.pop();
    events.emit('error', entry);
  }

  // ---- 9. Update PnL history occasionally ----
  if (state.sim.tickCount % 20 === 0) {
    const dayIdx = state.sim.tickCount % 7;
    state.pnlHistory[dayIdx].value = parseFloat(
      jitter(state.pnlHistory[dayIdx].value, 2.0).toFixed(2)
    );
  }

  // Update strategy stats
  if (state.strategy.totalFills > 0) {
    const winPositions = state.positions.filter(p => p.pnl > 0).length;
    state.strategy.wins = winPositions;
    state.strategy.losses = state.positions.length - winPositions;
    state.strategy.winRate = parseFloat(
      ((state.strategy.wins / Math.max(1, state.positions.length)) * 100).toFixed(1)
    );
  }

  // Emit tick event
  events.emit('tick', {
    tickCount: state.sim.tickCount,
    balance: state.bankroll.current,
    exposure: state.risk.exposure,
    positionCount: state.positions.length,
    edgeCount: state.edges.length,
    signalCount: state.signals.length
  });
}

function start() {
  if (tickTimer) return;
  state.sim.running = true;
  tickTimer = setInterval(tick, state.sim.tickRate);
  events.emit('engine', { action: 'started', tickRate: state.sim.tickRate });
  console.log(`[engine] Started — tick rate ${state.sim.tickRate}ms, seed ${state.sim.seed}`);
}

function stop() {
  state.sim.running = false;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  events.emit('engine', { action: 'stopped' });
  console.log('[engine] Stopped');
}

function setTickRate(ms) {
  const rate = Math.max(500, Math.min(30000, ms));
  state.sim.tickRate = rate;
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, rate);
  }
  events.emit('engine', { action: 'tick_rate_changed', tickRate: rate });
}

function reset(seed) {
  stop();
  reseed(seed || 42);
  state.sim.tickCount = 0;
  state.sim.seed = seed || 42;
  state.bankroll.current = state.bankroll.starting;
  state.bankroll.exposure = 0;
  state.bankroll.dailyPnl = 0;
  state.bankroll.weeklyPnl = 0;
  state.positions.length = 0;
  state.signals.length = 0;
  state.risk.dailyLoss = 0;
  state.risk.weeklyLoss = 0;
  state.risk.exposure = 0;
  state.risk.circuitBreaker = false;
  state.strategy.totalOrders = 0;
  state.strategy.totalFills = 0;
  state.strategy.wins = 0;
  state.strategy.losses = 0;
  state.strategy.winRate = 0;
  state.errors = [{ time: fmtTime(), level: 'INFO', msg: `Engine reset — seed ${state.sim.seed}` }];
  events.emit('engine', { action: 'reset', seed: state.sim.seed });
  start();
}

function injectFailure(agentId) {
  const agent = state.agents.find(a => a.id === agentId);
  if (agent) {
    agent.status = 'red';
    agent.consecutiveErrors = 5;
    agent.latency = '999ms';
    const entry = { time: fmtTime(), level: 'ERR', msg: `[INJECTED] Agent ${agent.name} failure` };
    state.errors.unshift(entry);
    events.emit('failure_injected', { agent: agentId });
    return true;
  }
  return false;
}

module.exports = { start, stop, tick, setTickRate, reset, injectFailure };
