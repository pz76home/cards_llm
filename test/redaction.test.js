// The LLM's hole cards and thoughts must never leak before a real showdown.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');

function newGame() {
  const game = new TexasHoldemGame({ startingChips: 50000 });
  game.startNewHand();
  return game;
}

function checkDownToShowdown(game) {
  game.executeAction('human', 'call');
  game.executeAction('llm', 'check');
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(game.stage, street);
    game.executeAction('llm', 'check');
    game.executeAction('human', 'check');
  }
}

test('LLM hole cards and thoughts stay hidden during a live hand', () => {
  const game = newGame();
  const state = game.getClientState();

  assert.equal(state.llmHoleCards, null);
  assert.equal(state.lastLlmThought, '');
  assert.equal(state.showdownReached, false);
});

test('folding does not reveal the opponent hand', () => {
  const game = newGame();
  game.executeAction('human', 'fold');

  const state = game.getClientState();
  assert.equal(state.stage, 'showdown');
  assert.equal(state.showdownReached, false);
  assert.equal(state.llmHoleCards, null);
  assert.equal(state.lastLlmThought, '');
});

test('folding after an LLM move does not reveal the opponent hand', () => {
  const game = newGame();
  game.executeAction('human', 'call');

  const state = game.getClientState();
  assert.equal(state.activePlayer, 'llm');
  assert.equal(state.llmHoleCards, null);
});

test('a real showdown reveals both hands', () => {
  const game = newGame();
  checkDownToShowdown(game);

  const state = game.getClientState();
  assert.equal(state.showdownReached, true);
  assert.equal(state.llmHoleCards.length, 2);
  assert.equal(state.humanHoleCards.length, 2);
  assert.equal(state.communityCards.length, 5);
});

test('a match-ending resign may still reveal the hand', () => {
  const game = newGame();
  game.executeAction('human', 'give_up');

  const state = game.getClientState();
  assert.equal(state.isGameOver, true);
  assert.equal(state.llmHoleCards.length, 2);
});
