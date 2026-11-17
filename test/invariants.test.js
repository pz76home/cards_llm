// Property test: chips are never created or destroyed, at any point.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');

const STARTING = 50000;

// Small deterministic PRNG so failures are reproducible from the seed.
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertConserved(game, label) {
  assert.equal(game.humanChips + game.llmChips + game.pot, 2 * STARTING, label);
  assert.ok(game.humanChips >= 0, `${label}: human chips negative`);
  assert.ok(game.llmChips >= 0, `${label}: llm chips negative`);
  assert.ok(game.pot >= 0, `${label}: pot negative`);
  assert.ok(game.humanBet >= 0 && game.llmBet >= 0, `${label}: bet negative`);
}

for (const seed of [1, 42, 1337]) {
  test(`chip conservation fuzz (seed ${seed})`, () => {
    const random = mulberry32(seed);
    const game = new TexasHoldemGame({ startingChips: STARTING });
    assert.equal(game.startNewHand(), true);
    assertConserved(game, 'start');

    const MAX_STEPS = 5000;
    let steps = 0;

    while (!game.isGameOver && steps < MAX_STEPS) {
      if (game.stage === 'showdown') {
        if (!game.startNewHand()) break;
        assertConserved(game, `new hand ${steps}`);
        steps++;
        continue;
      }

      const player = game.activePlayer;
      assert.ok(player === 'human' || player === 'llm', `step ${steps}: active player ${player}`);

      const legal = game.getValidActions(player, true);
      assert.ok(legal.length > 0, `step ${steps}: no legal actions for ${player} in ${game.stage}`);

      // Resigning would end the match instantly; keep the fuzz playing.
      const candidates = legal.filter(action => action.type !== 'give_up');
      const choice = candidates[Math.floor(random() * candidates.length)];

      let amount = 0;
      if (choice.type === 'raise') {
        amount = choice.min + Math.floor(random() * (choice.max - choice.min + 1));
      }

      game.executeAction(player, choice.type, amount);
      assertConserved(game, `step ${steps} ${player} ${choice.type} ${amount}`);
      steps++;
    }

    assert.ok(steps > 0 && steps < MAX_STEPS, `fuzz finished in ${steps} steps`);
  });
}
