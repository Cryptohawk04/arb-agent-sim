'use strict';

const { state } = require('../sim/state');
const events = require('../sim/events');

function onTick() {
  const agent = state.agents.find(a => a.id === 'execution');
  if (!agent) return;

  agent.lastTickAt = Date.now();

  // Execution agent monitors pending orders
  const pendingEdges = state.edges.filter(e => e.status === 'active');
  if (pendingEdges.length > 0 && state.sim.tickCount % 8 === 0) {
    events.emit('exec_status', {
      pendingOrders: pendingEdges.length,
      openPositions: state.positions.length,
      mode: 'PAPER'
    });
  }
}

module.exports = { onTick };
