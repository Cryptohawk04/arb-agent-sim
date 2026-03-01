# Arbitrage AI Agent — SIM Control Center

Always-on simulation system with a Node.js backend that owns all state. The UI connects via REST + Server-Sent Events for real-time updates.

**Mode: SIM + PAPER only.** No real-money execution. No production venue connectors.

## Quick Start

```bash
# Docker (recommended)
docker compose up --build

# Open http://localhost:8080
```

### Local Development

```bash
npm install
npm run dev        # auto-restart on changes
# or
npm start          # production
```

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                  Express Server (port 8080)                   │
│                                                              │
│  GET  /api/state          → full state snapshot (JSON)       │
│  GET  /api/events         → SSE stream (real-time ticks)     │
│  POST /api/sim/control    → pause/resume/tickRate/reset      │
│  GET  /api/sim/info       → sim metadata                     │
│  GET  /                   → static UI from /public           │
├────────────────────────────────────────────────────────────────┤
│                    Simulation Engine                          │
│                                                              │
│  Seeded PRNG (Mulberry32) → deterministic tick loop          │
│  Per tick:                                                    │
│    1. Price drift on open positions                           │
│    2. Edge opportunity rotation                               │
│    3. Signal generation (BUY/SELL/HOLD)                      │
│    4. Bankroll + PnL recalculation                           │
│    5. Risk gauge updates                                      │
│    6. Agent heartbeat refresh                                 │
│    7. Edge Strategy v0: auto-order when edge >= 3%           │
│    8. Error log generation                                    │
│    9. PnL history drift                                       │
├────────────────────────────────────────────────────────────────┤
│                     6 Agents (tick hooks)                     │
│                                                              │
│  monitor   → anomaly detection, watchlist                    │
│  edge      → edge ranking, threshold filtering               │
│  execution → paper order tracking                            │
│  signals   → BUY/SELL/HOLD aggregation, bias detection       │
│  watchdog  → stale agent detection, health heartbeat         │
│  risk      → pre-trade checks, circuit breaker               │
├────────────────────────────────────────────────────────────────┤
│                    Paper Broker                               │
│  2% spread · 0.5% slippage · 85% fill rate                  │
├────────────────────────────────────────────────────────────────┤
│                     JSONL Event Log                           │
│  data/events-YYYY-MM-DD.jsonl                                │
└────────────────────────────────────────────────────────────────┘
```

## UI Tabs

| Tab | Content |
|-----|---------|
| **Overview** | Full dashboard: bankroll, PnL chart, risk gauges, edges, positions, signals, agents, errors |
| **Monitor** | Agent detail stats, anomaly count, event log |
| **Edge** | Edge rankings table, above-threshold count, top edge |
| **Exec** | Paper-only mode, order/fill counts, open positions |
| **Risk** | Full risk gauges, daily/weekly loss, exposure, circuit breaker status |
| **Signals** | Full signal feed, BUY/SELL counts, market bias |
| **Watchdog** | Agent status matrix, tick count, inject failure buttons |
| **Strategy** | Edge V0 config, win rate, W/L record |

## API

### `GET /api/state`
Returns the full state object consumed by the UI.

### `GET /api/events`
Server-Sent Events stream. Events include:
- `tick` — each engine cycle
- `signal` — new signal generated
- `error` — error log entry
- `fill` — paper order filled
- `order_plan` — order plan created
- `monitor_scan`, `edge_ranking`, `exec_status`, `signal_summary`, `watchdog_heartbeat` — agent events

### `POST /api/sim/control`
Control the simulation:
```json
{ "action": "pause" }
{ "action": "resume" }
{ "action": "setTickRate", "tickRate": 5000 }
{ "action": "reset", "seed": 12345 }
{ "action": "injectFailure", "agentId": "monitor" }
```

### `GET /api/sim/info`
Sim metadata: mode, running, tickRate, tickCount, seed, uptime, SSE client count.

## Repo Structure

```
arb-sim/
├── public/
│   ├── index.html         # Dashboard UI with 8 tabs
│   ├── style.css          # Dark terminal aesthetic
│   └── app.js             # Fetch + SSE + hash router
├── server/
│   ├── server.js          # Express entry point
│   ├── sim/
│   │   ├── state.js       # All mutable state + seeded PRNG
│   │   ├── engine.js      # Deterministic tick loop
│   │   ├── broker.js      # Paper broker (spread + slippage)
│   │   ├── risk.js        # Pre-trade risk checks
│   │   └── events.js      # SSE broadcast + JSONL logger
│   ├── agents/
│   │   ├── monitor.js     # Anomaly detection
│   │   ├── edge.js        # Edge ranking
│   │   ├── execution.js   # Order tracking
│   │   ├── signals.js     # Signal aggregation
│   │   └── watchdog.js    # Health monitoring
│   └── routes/
│       └── api.js         # REST + SSE endpoints
├── data/                  # JSONL event logs (auto-created, gitignored)
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Docker

```bash
docker compose up --build       # build + start
docker compose up -d            # detached
docker compose logs -f          # tail logs
docker compose down             # stop
```

Persists event logs to `./data/` via volume mount.
