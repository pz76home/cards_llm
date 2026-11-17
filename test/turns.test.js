// Turn execution: single-flight, cancellation and stale-result rejection.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');
const { TurnManager, TurnPendingError } = require('../src/turns');

function gameWithLlmToAct() {
  const game = new TexasHoldemGame({ startingChips: 50000 });
  game.startNewHand();
  // Human (small blind / button) calls; the LLM is now to act preflop.
  game.executeAction('human', 'call');
  assert.equal(game.activePlayer, 'llm');
  return game;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fixedFallback(decision = { action: 'check', amount: 0, thought: 'fb thought', speech: 'fb speech' }) {
  return { getAction: () => ({ ...decision }) };
}

test('a second concurrent turn is rejected while one is pending', async () => {
  const game = gameWithLlmToAct();
  const pending = deferred();
  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const first = manager.start(game, { getAction: () => pending.promise }, {});
  await Promise.resolve();

  assert.equal(manager.isPending(), true);
  await assert.rejects(
    () => manager.start(game, { getAction: () => pending.promise }, {}),
    (err) => err instanceof TurnPendingError && err.code === 'TURN_PENDING'
  );

  pending.resolve({ action: 'check', amount: 0, thought: 't', speech: 's' });
  const result = await first;
  assert.equal(result.decision.action, 'check');
  assert.equal(manager.isPending(), false);
});

test('cancel applies exactly one quick-bot action and ignores the late reply', async () => {
  const game = gameWithLlmToAct();
  const pending = deferred();
  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const inFlight = manager.start(game, { getAction: () => pending.promise }, { persona: 'balanced' });
  await Promise.resolve();

  const cancelled = manager.cancel(game);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.decision.thought, 'fb thought');
  assert.equal(game.stage, 'flop');
  assert.equal(game.pot, 2000);
  assert.equal(manager.isPending(), false);

  // The model finally answers with a raise. It must be discarded.
  pending.resolve({ action: 'raise', amount: 40000, thought: 'late', speech: 'late' });
  const late = await inFlight;

  assert.equal(late.cancelled, true);
  assert.equal(game.stage, 'flop');
  assert.equal(game.pot, 2000);
  assert.equal(game.currentBet, 0);
  assert.notEqual(game.lastLlmThought, 'late');
});

test('cancel is a no-op when no turn is pending', () => {
  const game = gameWithLlmToAct();
  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const result = manager.cancel(game);
  assert.equal(result.cancelled, false);
  assert.equal(game.activePlayer, 'llm');
  assert.equal(game.pot, 2000);
});

test('a timed-out model plays exactly one fallback action', async () => {
  const game = gameWithLlmToAct();
  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const err = new Error('simulated timeout');
  err.name = 'TimeoutError';

  const result = await manager.start(game, { getAction: async () => { throw err; } }, {});

  assert.equal(result.cancelled, undefined);
  assert.equal(result.decision.thought, 'fb thought');
  assert.equal(game.stage, 'flop');
  assert.equal(game.pot, 2000);
  assert.equal(game.activePlayer, 'llm');
});

test('abortPending prevents a late model reply from executing', async () => {
  const game = gameWithLlmToAct();
  const pending = deferred();
  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const inFlight = manager.start(game, { getAction: () => pending.promise }, {});
  await Promise.resolve();

  assert.equal(manager.abortPending(), true);
  assert.equal(manager.isPending(), false);

  pending.resolve({ action: 'all-in', amount: 0, thought: 'late', speech: 'late' });
  const result = await inFlight;

  assert.equal(result.cancelled, true);
  assert.equal(game.stage, 'preflop');
  assert.equal(game.pot, 2000);
  assert.equal(game.humanChips, 49000);
});

test('a stale turn cannot execute after the game moved on', async () => {
  const game = gameWithLlmToAct();
  const pending = deferred();
  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const inFlight = manager.start(game, { getAction: () => pending.promise }, {});
  await Promise.resolve();
  const capturedTurnId = game.turnId;

  // Something else advances the game (new hand) while the model is thinking.
  game.startNewHand();
  assert.equal(game.handCount, 2);
  assert.notEqual(game.turnId, capturedTurnId);

  pending.resolve({ action: 'raise', amount: 20000, thought: 'stale', speech: 'stale' });
  const result = await inFlight;

  assert.equal(result.stale, true);
  assert.equal(game.handCount, 2);
  assert.equal(game.pot, 1500); // blinds only, no raise applied
  assert.notEqual(game.lastLlmThought, 'stale');
});

test('an illegal model action is auto-corrected into a legal one', async () => {
  const game = new TexasHoldemGame({ startingChips: 50000 });
  game.startNewHand();
  // Human raises, so the LLM is facing a bet and cannot check.
  game.executeAction('human', 'raise', 2000);
  assert.equal(game.activePlayer, 'llm');

  const manager = new TurnManager({ fallbackBot: fixedFallback() });

  const result = await manager.start(game, {
    getAction: async () => ({ action: 'check', amount: 0, thought: 'bad', speech: 'bad' })
  }, {});

  assert.equal(result.corrected, true);
  // The safe replacement (fold) settled the hand instead of leaving it stuck.
  assert.equal(game.stage, 'showdown');
  assert.equal(game.pot, 0);
  assert.equal(game.winner, 'human');
});

test('the engine bumps turnId whenever state can advance', () => {
  const game = gameWithLlmToAct();
  const before = game.turnId;

  game.executeAction('llm', 'check');
  assert.ok(game.turnId > before);

  const beforeHand = game.turnId;
  game.startNewHand();
  assert.ok(game.turnId > beforeHand);
});
