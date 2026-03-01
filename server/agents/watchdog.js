'use strict';

const { state, fmtTime } = require('../sim/state');
const events = require('../sim/events');

function onTick() {
  const watchdog = state.agents.find(a => a.id === 'watchdog');
  if (!watchdog) return;

  watchdog.lastTickAt = Date.now();

  const now = Date.now();
  const staleThreshold = 60000; // 60s
  let unhealthy = 0;

  for (const a of state.agents) {
    if (a.id === 'watchdog') continue;
    const age = now - a.lastTickAt;
    if (age > staleThreshold) {
      a.status = 'red';
      unhealthy++;
    }
  }

  // Report health every 15 ticks
  if (state.sim.tickCount % 15 === 0) {
    const healthy = state.agents.filter(a => a.status === 'green').length;
    events.emit('watchdog_heartbeat', {
      healthy,
      unhealthy,
      total: state.agents.length,
      circuitBreaker: state.risk.circuitBreaker,
      exposure: state.risk.exposure,
      tickCount: state.sim.tickCount
    });
  }
}

module.exports = { onTick };
