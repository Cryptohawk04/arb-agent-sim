'use strict';

const { state, jitter, pick, TICKERS } = require('../sim/state');
const events = require('../sim/events');

function onTick() {
  const agent = state.agents.find(a => a.id === 'monitor');
  if (!agent) return;

  agent.lastTickAt = Date.now();

  // Monitor scans for anomalies
  const anomalyCount = state.edges.filter(e => e.edge > 3.0).length;

  if (anomalyCount > 0 && state.sim.tickCount % 5 === 0) {
    events.emit('monitor_scan', {
      anomalies: anomalyCount,
      topTicker: state.edges[0]?.ticker,
      topEdge: state.edges[0]?.edge
    });
  }
}

module.exports = { onTick };
