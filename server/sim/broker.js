'use strict';

const { state, rng, fmtTime, pick } = require('./state');
const events = require('./events');
const risk = require('./risk');

const SPREAD = 0.02;   // 2% spread cost
const SLIPPAGE = 0.005; // 0.5% slippage

let orderSeq = 100;

function createOrderPlan(edge) {
  const riskCheck = risk.checkPreTrade(state.strategy.defaultSize, edge.edge / 100);
  if (!riskCheck.allowed) {
    events.emit('order_plan_rejected', {
      ticker: edge.ticker,
      edge: edge.edge,
      reasons: riskCheck.reasons
    });
    return null;
  }

  orderSeq++;
  const plan = {
    id: `OP-${orderSeq}`,
    ticker: edge.ticker,
    side: edge.side,
    size: riskCheck.size,
    edge: edge.edge,
    expectedProfit: edge.profit,
    status: 'pending',
    createdAt: fmtTime()
  };

  events.emit('order_plan', {
    orderId: plan.id,
    ticker: plan.ticker,
    side: plan.side,
    size: plan.size,
    edge: plan.edge
  });

  state.strategy.totalOrders++;
  return plan;
}

function fillOrder(plan) {
  // Simulate fill with spread + slippage
  const basePrice = 5.00 + rng() * 15.00;
  const spreadCost = basePrice * SPREAD;
  const slippageCost = basePrice * SLIPPAGE * (rng() > 0.5 ? 1 : -1);
  const fillPrice = parseFloat((basePrice + spreadCost + slippageCost).toFixed(2));

  // Random fill probability: 85% chance of fill
  if (rng() > 0.85) {
    events.emit('fill_rejected', {
      orderId: plan.id,
      ticker: plan.ticker,
      reason: 'No liquidity at price level'
    });
    return null;
  }

  const fill = {
    id: `F-${orderSeq}`,
    orderId: plan.id,
    ticker: plan.ticker,
    side: plan.side === 'BUY' ? 'LONG' : 'SHORT',
    size: Math.max(1, Math.round(plan.size / fillPrice)),
    entry: fillPrice,
    current: fillPrice,
    pnl: 0,
    filledAt: fmtTime()
  };

  // Add to positions
  state.positions.push(fill);
  if (state.positions.length > 8) state.positions.shift();

  // Update exposure
  risk.updateRisk();

  // Update strategy stats
  state.strategy.totalFills++;

  events.emit('fill', {
    fillId: fill.id,
    orderId: plan.id,
    ticker: fill.ticker,
    side: fill.side,
    size: fill.size,
    price: fillPrice,
    mode: 'PAPER'
  });

  return fill;
}

module.exports = { createOrderPlan, fillOrder, SPREAD, SLIPPAGE };
