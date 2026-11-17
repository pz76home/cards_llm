// betting.js - Single source of truth for betting rules and action legality.
// The engine, the Ollama client and the heuristic bot all read from here so
// call amounts, raise bounds and action coercion can never drift apart.

function otherPlayer(player) {
  return player === 'human' ? 'llm' : 'human';
}

function getPlayerBet(game, player) {
  return player === 'human' ? game.humanBet : game.llmBet;
}

function getPlayerChips(game, player) {
  return player === 'human' ? game.humanChips : game.llmChips;
}

// Chips the player must add to match the current bet.
function getCallAmount(game, player) {
  return Math.max(0, game.currentBet - getPlayerBet(game, player));
}

// Legal raise bounds in "chips added" units, plus the call amount.
function getRaiseBounds(game, player) {
  const chips = getPlayerChips(game, player);
  const bet = getPlayerBet(game, player);
  const callAmount = getCallAmount(game, player);
  const bigBlind = game.getCurrentBlinds().bigBlind;

  // A raise must at least double the current bet, or add a full big blind.
  const minRaiseTotal = Math.max(game.currentBet * 2, game.currentBet + bigBlind);
  const minAdditional = Math.min(chips, minRaiseTotal - bet);

  return {
    min: Math.max(callAmount + 1, minAdditional),
    max: chips,
    callAmount
  };
}

// Full legal action list for a player. `ignoreTurn` lets callers describe what
// the player *could* do (used for the LLM observation). `includeResign` keeps
// give_up human-only.
function getLegalActions(game, player, { ignoreTurn = false, includeResign = true } = {}) {
  if (game.stage === 'showdown' || game.stage === 'ended' || game.isGameOver) {
    return [];
  }
  if (!ignoreTurn && player !== game.activePlayer) {
    return [];
  }

  const opponent = otherPlayer(player);
  const chips = getPlayerChips(game, player);
  const opponentChips = getPlayerChips(game, opponent);

  // A player with no chips behind is already all-in.
  if (chips === 0) {
    return [];
  }

  const callAmount = getCallAmount(game, player);
  const actualCall = Math.min(chips, callAmount);
  const actions = [{ type: 'fold', label: 'Fold' }];

  if (callAmount === 0) {
    actions.push({ type: 'check', label: 'Check' });
  } else {
    actions.push({
      type: 'call',
      label: `Call ${actualCall}${actualCall === chips ? ' (All-In)' : ''}`,
      amount: actualCall
    });
  }

  // Raising requires chips beyond the call and an opponent who can respond.
  if (chips > callAmount && opponentChips > 0) {
    const bounds = getRaiseBounds(game, player);
    actions.push({
      type: 'raise',
      label: 'Raise',
      min: bounds.min,
      max: bounds.max,
      callAmount
    });
    actions.push({
      type: 'all-in',
      label: `All-In (${chips})`,
      amount: chips
    });
  }

  if (includeResign) {
    actions.push({ type: 'give_up', label: 'Give Up / Resign' });
  }

  return actions;
}

// Coerce any model/bot output into an action that is guaranteed legal.
function normalizeAction(raw, legalActions) {
  const legal = legalActions || [];
  const types = legal.map(a => a.type);
  const rawType = raw && (raw.action || raw.type);
  let type = String(rawType || '').toLowerCase().trim();
  let amount = Number(raw && raw.amount) || 0;

  if (type === 'bet' && types.includes('raise')) {
    type = 'raise';
  }

  if (!types.includes(type)) {
    if (types.includes('check')) type = 'check';
    else if (types.includes('call')) type = 'call';
    else if (types.includes('fold')) type = 'fold';
    else type = types[0] || 'fold';
  }

  if (type === 'raise') {
    const bounds = legal.find(a => a.type === 'raise');
    const min = bounds && Number.isFinite(bounds.min) ? bounds.min : 0;
    const max = bounds && Number.isFinite(bounds.max) ? bounds.max : Infinity;
    amount = Math.max(min, Math.min(max, amount || min));
  } else if (type === 'call') {
    const call = legal.find(a => a.type === 'call');
    amount = call ? call.amount : 0;
  } else {
    amount = 0;
  }

  return { type, amount };
}

module.exports = {
  otherPlayer,
  getPlayerBet,
  getPlayerChips,
  getCallAmount,
  getRaiseBounds,
  getLegalActions,
  normalizeAction
};
