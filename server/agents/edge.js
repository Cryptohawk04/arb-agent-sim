'use strict';

const { state, jitter, clamp, rng, pick, TICKERS, SIDES } = require('../sim/state');
const events = require('../sim/events');

function onTick() {
  const agent = state.agents.find(a => a.id === 'edge');
  if (!agent) return;

  agent.lastTickAt = Date.now();

  // Edge agent ranks opportunities
  const ranked = [...state.edges].sort((a, b) => b.edge - a.edge);
  const aboveThreshold = ranked.filter(e => (e.edge / 100) >= state.strategy.edgeThreshold);

  if (state.sim.tickCount % 10 === 0 && aboveThreshold.length > 0) {
    events.emit('edge_ranking', {
      total: state.edges.length,
      aboveThreshold: aboveThreshold.length,
      top: aboveThreshold[0]?.ticker,
      topEdge: aboveThreshold[0]?.edge
    });
  }
}

module.exports = { onTick };
