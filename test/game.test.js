// Heads-up game flow: blinds, turn order, showdown, folds and all-ins.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');

const STARTING = 50000;

function newGame(startingChips = STARTING) {
  const game = new TexasHoldemGame({ startingChips });
  assert.equal(game.startNewHand(), true);
  return game;
}

function checkDownToShowdown(game) {
  // Preflop: dealer (small blind) completes, big blind checks.
  game.executeAction('human', 'call');
  game.executeAction('llm', 'check');

  // Postflop the non-dealer acts first: llm checks, human checks, each street.
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(game.stage, street);
    game.executeAction('llm', 'check');
    game.executeAction('human', 'check');
  }
}

test('the first hand posts blinds and the dealer acts first preflop', () => {
  const game = newGame();

  assert.equal(game.handCount, 1);
  assert.equal(game.dealer, 'human');
  assert.equal(game.stage, 'preflop');
  assert.equal(game.activePlayer, 'human');
  assert.equal(game.pot, 1500);
  assert.equal(game.humanChips, 49500);
  assert.equal(game.llmChips, 49000);
  assert.equal(game.currentBet, 1000);
  assert.equal(game.communityCards.length, 0);
});

test('preflop call and big-blind check advance to the flop', () => {
  const game = newGame();

  game.executeAction('human', 'call');
  assert.equal(game.activePlayer, 'llm');
  assert.equal(game.humanBet, 1000);

  game.executeAction('llm', 'check');
  assert.equal(game.stage, 'flop');
  assert.equal(game.communityCards.length, 3);
  // Non-dealer (llm) acts first postflop.
  assert.equal(game.activePlayer, 'llm');
});

test('checking down runs out five cards and settles the pot', () => {
  const game = newGame();
  checkDownToShowdown(game);

  assert.equal(game.stage, 'showdown');
  assert.equal(game.showdownReached, true);
  assert.equal(game.pot, 0);
  assert.equal(game.lastPotWon, 2000);
  assert.equal(game.humanChips + game.llmChips, 2 * STARTING);
  assert.equal(game.communityCards.length, 5);
  assert.ok(game.winningDescription.length > 0);
});

test('folding refunds the uncalled excess and clears the pot', () => {
  const game = newGame();

  game.executeAction('human', 'fold');

  assert.equal(game.stage, 'showdown');
  assert.equal(game.showdownReached, false);
  assert.equal(game.pot, 0);
  assert.equal(game.lastPotWon, 1000);
  assert.equal(game.humanChips, 49500);
  assert.equal(game.llmChips, 50500);
  assert.equal(game.humanChips + game.llmChips, 2 * STARTING);
});

test('an all-in is called and the board runs out automatically', () => {
  const game = newGame(1500);

  game.executeAction('human', 'all-in');
  assert.equal(game.activePlayer, 'llm');
  assert.equal(game.humanChips, 0);

  game.executeAction('llm', 'call');

  // With a 1,500 stack the loser busts, so the match ends on the same hand.
  assert.equal(game.stage, 'ended');
  assert.equal(game.showdownReached, true);
  assert.equal(game.isGameOver, true);
  assert.equal(game.communityCards.length, 5);
  assert.equal(game.pot, 0);
  assert.equal(game.lastPotWon, 3000);
  assert.equal(game.humanChips + game.llmChips, 3000);
});

test('a new hand resets hand state and re-posts blinds', () => {
  const game = newGame();
  checkDownToShowdown(game);

  game.startNewHand();
  assert.equal(game.stage, 'preflop');
  assert.equal(game.showdownReached, false);
  assert.equal(game.pot, 1500);
  assert.equal(game.humanChips + game.llmChips + game.pot, 2 * STARTING);
});

test('resigning settles the pot before ending the match', () => {
  const game = newGame();

  game.executeAction('human', 'give_up');

  assert.equal(game.isGameOver, true);
  assert.equal(game.stage, 'ended');
  assert.equal(game.pot, 0);
  assert.equal(game.humanChips + game.llmChips, 2 * STARTING);
});

test('the dealer button alternates each hand', () => {
  const game = newGame();
  const firstDealer = game.dealer;

  game.executeAction('human', 'fold');
  game.startNewHand();

  assert.notEqual(game.dealer, firstDealer);
  assert.equal(game.handCount, 2);
});

test('illegal actions are rejected by the engine', () => {
  const game = newGame();

  assert.throws(() => game.executeAction('llm', 'check'), /not llm's turn/);
  game.executeAction('human', 'raise', 2000);
  assert.equal(game.activePlayer, 'llm');
  assert.throws(() => game.executeAction('llm', 'check'), /Cannot check/);
});
