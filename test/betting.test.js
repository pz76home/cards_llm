// Shared betting rules: legality, raise bounds and model-output coercion.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');
const {
  getCallAmount,
  getRaiseBounds,
  getLegalActions,
  normalizeAction
} = require('../src/engine/betting');

function newGame() {
  const game = new TexasHoldemGame({ startingChips: 50000 });
  game.startNewHand();
  return game;
}

test('call amounts and raise bounds come from one place', () => {
  const game = newGame();

  assert.equal(getCallAmount(game, 'human'), 500);
  assert.equal(getCallAmount(game, 'llm'), 0);

  const bounds = getRaiseBounds(game, 'human');
  assert.equal(bounds.callAmount, 500);
  assert.equal(bounds.min, 1500);
  assert.equal(bounds.max, 49500);
});

test('legal actions match the heads-up rules', () => {
  const game = newGame();

  const human = getLegalActions(game, 'human').map(a => a.type);
  assert.deepEqual(human, ['fold', 'call', 'raise', 'all-in', 'give_up']);

  const offTurn = getLegalActions(game, 'llm');
  assert.deepEqual(offTurn, []);

  const llm = getLegalActions(game, 'llm', { ignoreTurn: true }).map(a => a.type);
  assert.deepEqual(llm, ['fold', 'check', 'raise', 'all-in', 'give_up']);

  const llmNoResign = getLegalActions(game, 'llm', { ignoreTurn: true, includeResign: false });
  assert.deepEqual(llmNoResign.map(a => a.type), ['fold', 'check', 'raise', 'all-in']);
});

test('the LLM observation never offers resign and carries raise bounds', () => {
  const game = newGame();
  const obs = game.getLlmObservation();

  assert.ok(!obs.validActions.includes('give_up'));
  assert.ok(obs.legalActions.every(a => a.type !== 'give_up'));
  assert.equal(obs.raiseMin, 1000);
  assert.equal(obs.raiseMax, 49000);
});

test('normalizeAction clamps raises to the legal range', () => {
  const game = newGame();
  const legal = getLegalActions(game, 'human');

  assert.deepEqual(normalizeAction({ action: 'raise', amount: 10 }, legal), { type: 'raise', amount: 1500 });
  assert.deepEqual(normalizeAction({ action: 'raise', amount: 1e9 }, legal), { type: 'raise', amount: 49500 });
  assert.deepEqual(normalizeAction({ action: 'bet', amount: 5000 }, legal), { type: 'raise', amount: 5000 });
});

test('normalizeAction maps unknown actions to a legal fallback', () => {
  const game = newGame();
  const facingBet = getLegalActions(game, 'human');

  assert.deepEqual(normalizeAction({ action: 'dance' }, facingBet), { type: 'call', amount: 500 });
  assert.deepEqual(normalizeAction({ action: 'call', amount: 999999 }, facingBet), { type: 'call', amount: 500 });

  game.executeAction('human', 'call');
  const freeCheck = getLegalActions(game, 'llm');
  assert.deepEqual(normalizeAction({ action: 'dance' }, freeCheck), { type: 'check', amount: 0 });
});

test('a model asking to resign with no legal resign simply plays on', () => {
  const game = newGame();
  const llmLegal = getLegalActions(game, 'llm', { ignoreTurn: true, includeResign: false });

  // Free to check, so the coerced action must not end the match.
  assert.deepEqual(normalizeAction({ action: 'give_up' }, llmLegal), { type: 'check', amount: 0 });
});
