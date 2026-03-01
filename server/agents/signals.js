'use strict';

const { state } = require('../sim/state');
const events = require('../sim/events');

function onTick() {
  const agent = state.agents.find(a => a.id === 'signals');
  if (!agent) return;

  agent.lastTickAt = Date.now();

  // Signals agent processes recent signals
  const recentCount = state.signals.filter(s => {
    // Count signals in last few ticks by comparing time strings
    return true;
  }).length;

  if (state.sim.tickCount % 6 === 0) {
    const buys = state.signals.filter(s => s.dir === 'BUY').length;
    const sells = state.signals.filter(s => s.dir === 'SELL').length;
    events.emit('signal_summary', {
      total: state.signals.length,
      buys,
      sells,
      holds: state.signals.length - buys - sells,
      bias: buys > sells ? 'BULLISH' : buys < sells ? 'BEARISH' : 'NEUTRAL'
    });
  }
}

module.exports = { onTick };
