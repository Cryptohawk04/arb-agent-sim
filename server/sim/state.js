'use strict';

// ---- Seeded PRNG (Mulberry32) ----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

let _rng = mulberry32(42);

function rng() { return _rng(); }
function reseed(s) { _rng = mulberry32(s); }
function jitter(val, range) { return val + (rng() - 0.5) * range; }
function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

// ---- Ticker universe ----
const TICKERS = [
  'AAPL 03/06 230C', 'SPY 03/06 580P', 'TSLA 03/13 250C',
  'NVDA 03/06 890C', 'QQQ 03/13 500P', 'AMD 03/13 180P',
  'GOOG 03/06 185P', 'AMZN 03/06 210C', 'META 03/13 620C',
  'MSFT 03/06 430C', 'NFLX 03/13 950C', 'JPM 03/06 220C'
];

const SOURCES = ['FLOW', 'GREEKS', 'SWEEP', 'VOL', 'SKEW', 'GAMMA'];
const DIRECTIONS = ['BUY', 'SELL', 'HOLD'];
const SIDES = ['BUY', 'SELL'];
const POS_SIDES = ['LONG', 'SHORT'];

// ---- Helper (declared before use in state initializer) ----
function fmtTime(d) {
  const now = d || new Date();
  return now.toTimeString().slice(0, 8);
}

// ---- State object ----
const state = {
  // Sim control
  sim: {
    running: true,
    tickRate: 3000,      // ms between ticks
    tickCount: 0,
    seed: 42,
    mode: 'SIM_PAPER',   // always SIM_PAPER
    startedAt: new Date().toISOString(),
  },

  // Bankroll
  bankroll: {
    starting: 250.00,
    current: 258.42,
    exposure: 87.30,
    dailyPnl: 4.17,
    weeklyPnl: 8.42
  },

  // Top edges
  edges: [
    { id: 'e1', ticker: 'AAPL 03/06 230C', edge: 3.8, profit: 6.12, side: 'BUY', status: 'active' },
    { id: 'e2', ticker: 'SPY 03/06 580P',  edge: 2.4, profit: 4.55, side: 'BUY', status: 'pending' },
    { id: 'e3', ticker: 'TSLA 03/13 250C', edge: 5.1, profit: 8.90, side: 'BUY', status: 'active' },
    { id: 'e4', ticker: 'NVDA 03/06 890C', edge: 1.9, profit: 3.20, side: 'SELL', status: 'filled' },
    { id: 'e5', ticker: 'QQQ 03/13 500P',  edge: 2.7, profit: 5.40, side: 'BUY', status: 'pending' }
  ],

  // Open positions
  positions: [
    { id: 'p1', ticker: 'AAPL 03/06 230C', side: 'LONG',  size: 2, entry: 4.30, current: 4.85, pnl: 1.10 },
    { id: 'p2', ticker: 'TSLA 03/13 250C', side: 'LONG',  size: 1, entry: 8.10, current: 9.45, pnl: 1.35 },
    { id: 'p3', ticker: 'NVDA 03/06 890C', side: 'SHORT', size: 1, entry: 12.50, current: 11.78, pnl: 0.72 }
  ],

  // Recent signals
  signals: [],

  // Agent health
  agents: [
    { id: 'monitor',   name: 'Monitor Agent',    status: 'green', lastSeen: '2s ago', latency: '12ms', lastTickAt: Date.now(), consecutiveErrors: 0 },
    { id: 'edge',      name: 'Edge Calculator',  status: 'green', lastSeen: '4s ago', latency: '28ms', lastTickAt: Date.now(), consecutiveErrors: 0 },
    { id: 'execution', name: 'Order Executor',   status: 'green', lastSeen: '1s ago', latency: '8ms',  lastTickAt: Date.now(), consecutiveErrors: 0 },
    { id: 'risk',      name: 'Risk Monitor',     status: 'green', lastSeen: '3s ago', latency: '15ms', lastTickAt: Date.now(), consecutiveErrors: 0 },
    { id: 'signals',   name: 'Signal Scanner',   status: 'green', lastSeen: '5s ago', latency: '22ms', lastTickAt: Date.now(), consecutiveErrors: 0 },
    { id: 'watchdog',  name: 'Watchdog',         status: 'green', lastSeen: '2s ago', latency: '35ms', lastTickAt: Date.now(), consecutiveErrors: 0 }
  ],

  // Risk gauges
  risk: {
    dailyLoss: 2.83,
    weeklyLoss: 5.58,
    exposure: 87.30,
    dailyMax: 10.00,
    weeklyMax: 30.00,
    exposureMax: 150.00,
    circuitBreaker: false
  },

  // Error log (newest first)
  errors: [
    { time: fmtTime(), level: 'INFO', msg: 'Simulation engine initialized — SIM_PAPER mode' }
  ],

  // PnL history (7-day)
  pnlHistory: [
    { day: 'Mon', value: -1.20 },
    { day: 'Tue', value: 0.85 },
    { day: 'Wed', value: 2.40 },
    { day: 'Thu', value: 1.15 },
    { day: 'Fri', value: 3.50 },
    { day: 'Sat', value: 4.17 },
    { day: 'Sun', value: 8.42 }
  ],

  // Strategy state
  strategy: {
    name: 'edge_v0',
    edgeThreshold: 0.03,
    maxPositionSize: 25.00,
    defaultSize: 12.50,
    totalOrders: 0,
    totalFills: 0,
    winRate: 0,
    wins: 0,
    losses: 0
  }
};

function getClientState() {
  // Return state shaped exactly for UI consumption
  return {
    sim: { ...state.sim },
    bankroll: { ...state.bankroll },
    edges: state.edges.map(e => ({
      ticker: e.ticker, edge: e.edge, profit: e.profit, side: e.side, status: e.status
    })),
    positions: state.positions.map(p => ({
      ticker: p.ticker, side: p.side, size: p.size, entry: p.entry, current: p.current, pnl: p.pnl
    })),
    signals: state.signals.slice(0, 15).map(s => ({
      source: s.source, dir: s.dir, symbol: s.symbol, time: s.time
    })),
    agents: state.agents.map(a => ({
      name: a.name, status: a.status, lastSeen: a.lastSeen, latency: a.latency
    })),
    risk: {
      dailyLoss: state.risk.dailyLoss,
      weeklyLoss: state.risk.weeklyLoss,
      exposure: state.risk.exposure
    },
    errors: state.errors.slice(0, 20).map(e => ({
      time: e.time, level: e.level, msg: e.msg
    })),
    pnlHistory: [...state.pnlHistory],
    strategy: { ...state.strategy }
  };
}

module.exports = {
  state, rng, reseed, jitter, clamp, pick, fmtTime, getClientState,
  TICKERS, SOURCES, DIRECTIONS, SIDES, POS_SIDES
};
