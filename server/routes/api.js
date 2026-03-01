'use strict';

const express = require('express');
const router = express.Router();
const { state, getClientState } = require('../sim/state');
const engine = require('../sim/engine');
const events = require('../sim/events');

// GET /api/state — full state snapshot
router.get('/state', (req, res) => {
  res.json(getClientState());
});

// GET /api/events — Server-Sent Events stream
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial connected event
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  // Keep alive ping every 15s
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  events.addSSEClient(res);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// POST /api/sim/control — pause, resume, set tick rate, inject failures, reset
router.post('/sim/control', express.json(), (req, res) => {
  const { action, tickRate, seed, agentId } = req.body;

  switch (action) {
    case 'pause':
      engine.stop();
      return res.json({ ok: true, action: 'paused' });

    case 'resume':
      engine.start();
      return res.json({ ok: true, action: 'resumed' });

    case 'setTickRate':
      if (!tickRate) return res.status(400).json({ error: 'tickRate required' });
      engine.setTickRate(tickRate);
      return res.json({ ok: true, action: 'tick_rate_set', tickRate: state.sim.tickRate });

    case 'reset':
      engine.reset(seed);
      return res.json({ ok: true, action: 'reset', seed: state.sim.seed });

    case 'injectFailure':
      if (!agentId) return res.status(400).json({ error: 'agentId required' });
      const injected = engine.injectFailure(agentId);
      return res.json({ ok: injected, action: 'failure_injected', agentId });

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
});

// GET /api/sim/info — sim metadata
router.get('/sim/info', (req, res) => {
  res.json({
    mode: state.sim.mode,
    running: state.sim.running,
    tickRate: state.sim.tickRate,
    tickCount: state.sim.tickCount,
    seed: state.sim.seed,
    startedAt: state.sim.startedAt,
    sseClients: events.clientCount(),
    uptime: process.uptime()
  });
});

module.exports = router;
