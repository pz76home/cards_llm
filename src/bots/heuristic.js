// heuristic.js - Built-in rule-based opponent used offline, on timeouts and
// when the user picks "Built-in Smart Bot".

class HeuristicBot {
  // Same contract as the Ollama bot: always returns a legal action.
  getAction(obs, { persona = 'balanced' } = {}) {
    const valid = obs.validActions || [];
    const callCost = obs.callAmountRequired || 0;
    const pot = obs.pot || 1;
    const myChips = obs.llmChips || 50000;
    const potOdds = callCost / (pot + callCost);

    // Honour the engine's legal raise range instead of inventing bet sizes.
    const raiseMin = Number.isFinite(obs.raiseMin) ? obs.raiseMin : 0;
    const raiseMax = Number.isFinite(obs.raiseMax) ? obs.raiseMax : myChips;
    const clampRaise = (desired) => Math.max(raiseMin, Math.min(raiseMax, Math.floor(desired)));

    // Assess hand strength using authoritative evaluation score if present.
    const cards = obs.llmHoleCards || [];
    let handStrength = 0.5; // Baseline

    if (obs.handStrengthScore !== undefined) {
      handStrength = Math.min(1.0, Math.max(0.1, obs.handStrengthScore / 10));
    } else if (cards.length >= 2) {
      const r1 = this.rankToVal(cards[0]);
      const r2 = this.rankToVal(cards[1]);
      const isPair = r1 === r2;
      const isSuited = cards[0].slice(-1) === cards[1].slice(-1);
      const highRank = Math.max(r1, r2);

      if (isPair) {
        handStrength = highRank >= 10 ? 0.95 : 0.75;
      } else if (highRank >= 12) {
        handStrength = isSuited ? 0.8 : 0.65;
      } else if (isSuited) {
        handStrength = 0.55;
      } else {
        handStrength = 0.35 + (highRank / 28);
      }
    }

    // Persona modifiers.
    let aggro = 0;
    if (persona === 'aggressive') aggro = 0.2;
    if (persona === 'wild') aggro = 0.35;
    if (persona === 'tight') aggro = -0.2;

    const effectiveStrength = Math.min(1.0, Math.max(0.1, handStrength + aggro + (Math.random() * 0.15 - 0.075)));

    let action = 'check';
    let amount = 0;
    let thought = '';
    let speech = '';

    if (effectiveStrength > 0.85 && valid.includes('raise') && myChips > callCost * 2) {
      action = 'raise';
      amount = clampRaise(Math.max(obs.blinds.bigBlind * 3, Math.floor(pot * 0.75)));
      thought = `Strong holding (${effectiveStrength.toFixed(2)} equity). Value raising.`;
      speech = persona === 'wild' ? "I'm pushing you hard on this one!" : "Let's make this more interesting.";
    } else if (callCost > 0) {
      // Facing a bet.
      if (effectiveStrength > 0.45 || (potOdds < 0.25 && effectiveStrength > 0.3)) {
        action = 'call';
        thought = `Decent pot odds (${(potOdds * 100).toFixed(0)}%) with moderate strength. Calling ${callCost}.`;
        speech = "I'll call that bet.";
      } else if (valid.includes('check')) {
        action = 'check';
        thought = 'Free card available. Checking.';
        speech = 'I check.';
      } else {
        action = 'fold';
        thought = `Weak hand (${effectiveStrength.toFixed(2)}) facing steep bet. Folding.`;
        speech = "Not this time. I fold.";
      }
    } else {
      // No bet to call.
      if (effectiveStrength > 0.65 && valid.includes('raise')) {
        action = 'raise';
        amount = clampRaise(Math.max(obs.blinds.bigBlind * 2, Math.floor(pot * 0.5)));
        thought = 'Leading out with a bet to seize initiative.';
        speech = `Betting ${amount}. Ball is in your court.`;
      } else if (valid.includes('check')) {
        action = 'check';
        thought = 'Pot control with medium strength. Checking.';
        speech = 'Check to you.';
      } else {
        action = valid[0] || 'fold';
      }
    }

    return { action, amount, thought, speech };
  }

  rankToVal(cardStr) {
    if (!cardStr) return 2;
    const r = cardStr.slice(0, -1).toUpperCase();
    if (r === 'A') return 14;
    if (r === 'K') return 13;
    if (r === 'Q') return 12;
    if (r === 'J') return 11;
    if (r === 'T' || r === '10') return 10;
    return parseInt(r, 10) || 2;
  }
}

module.exports = { HeuristicBot };
