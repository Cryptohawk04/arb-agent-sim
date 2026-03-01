'use strict';

const { state } = require('./state');

const LIMITS = {
  dailyMax: 10.00,
  weeklyMax: 30.00,
  exposureMax: 150.00,
  maxPositionSize: 25.00,
  defaultSizeMin: 10.00,
  defaultSizeMax: 15.00,
  minEdge: 0.03
};

function checkPreTrade(size, edge) {
  const reasons = [];
  let allowed = true;
  let adjustedSize = size;

  // Circuit breaker
  if (state.risk.circuitBreaker) {
    return { allowed: false, size, reasons: ['Circuit breaker is OPEN'] };
  }

  // Edge threshold
  if (edge < LIMITS.minEdge) {
    allowed = false;
    reasons.push(`Edge ${(edge * 100).toFixed(1)}% below min ${(LIMITS.minEdge * 100).toFixed(1)}%`);
  }

  // Position size cap
  if (adjustedSize > LIMITS.maxPositionSize) {
    adjustedSize = LIMITS.maxPositionSize;
    reasons.push(`Capped at max $${LIMITS.maxPositionSize}`);
  }

  // Exposure check
  const newExposure = state.risk.exposure + adjustedSize;
  if (newExposure > LIMITS.exposureMax) {
    const remaining = LIMITS.exposureMax - state.risk.exposure;
    if (remaining <= 0) {
      allowed = false;
      reasons.push(`Max exposure $${LIMITS.exposureMax} reached`);
    } else {
      adjustedSize = Math.min(adjustedSize, remaining);
      reasons.push(`Reduced to $${remaining.toFixed(2)} (exposure limit)`);
    }
  }

  // Daily loss limit
  if (state.risk.dailyLoss >= LIMITS.dailyMax) {
    allowed = false;
    state.risk.circuitBreaker = true;
    reasons.push(`Daily loss limit -$${LIMITS.dailyMax} breached`);
  }

  // Weekly loss limit
  if (state.risk.weeklyLoss >= LIMITS.weeklyMax) {
    allowed = false;
    state.risk.circuitBreaker = true;
    reasons.push(`Weekly loss limit -$${LIMITS.weeklyMax} breached`);
  }

  return { allowed, size: adjustedSize, reasons };
}

function updateRisk() {
  // Recalculate exposure from open positions
  let totalExposure = 0;
  for (const p of state.positions) {
    totalExposure += Math.abs(p.current * p.size);
  }
  state.risk.exposure = parseFloat(totalExposure.toFixed(2));
  state.bankroll.exposure = state.risk.exposure;
}

module.exports = { checkPreTrade, updateRisk, LIMITS };
