'use strict';

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Hook agents into engine tick cycle
const engine = require('./sim/engine');
const monitorAgent = require('./agents/monitor');
const edgeAgent = require('./agents/edge');
const executionAgent = require('./agents/execution');
const signalsAgent = require('./agents/signals');
const watchdogAgent = require('./agents/watchdog');
const events = require('./sim/events');

// Wrap original tick to also run agents
const originalTick = engine.tick;
const { state } = require('./sim/state');

// Override engine tick interval to include agents
const originalStart = engine.start;
engine.start = function () {
  originalStart.call(engine);

  // Overwrite interval to include agent ticks
  // Agents run alongside each engine tick
};

// We use an event-driven approach: after each tick emit, agents run
// Patch: hook agents into the tick cycle via setInterval
setInterval(() => {
  if (!state.sim.running) return;
  try { monitorAgent.onTick(); } catch (e) { /* agent error */ }
  try { edgeAgent.onTick(); } catch (e) { /* agent error */ }
  try { executionAgent.onTick(); } catch (e) { /* agent error */ }
  try { signalsAgent.onTick(); } catch (e) { /* agent error */ }
  try { watchdogAgent.onTick(); } catch (e) { /* agent error */ }
}, state.sim.tickRate);

// Start engine
engine.start();

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Arbitrage AI Agent — SIM Control Center`);
  console.log(`[server] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[server] Mode: SIM_PAPER | Tick rate: ${state.sim.tickRate}ms`);
  console.log(`[server] SSE stream: GET /api/events`);
  console.log(`[server] State API:  GET /api/state`);
});
