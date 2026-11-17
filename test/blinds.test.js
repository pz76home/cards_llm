// Blinds ladder boundaries. 10-minute levels, capped at 2,500 / 5,000.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getBlindsForElapsedSeconds } = require('../poker-engine');

function pick(blinds) {
  return {
    level: blinds.level,
    smallBlind: blinds.smallBlind,
    bigBlind: blinds.bigBlind,
    isCapped: blinds.isCapped,
    secondsToNextLevel: blinds.secondsToNextLevel
  };
}

test('level 1 starts at 500 / 1,000', () => {
  assert.deepEqual(pick(getBlindsForElapsedSeconds(0)), {
    level: 1, smallBlind: 500, bigBlind: 1000, isCapped: false, secondsToNextLevel: 600
  });
  assert.equal(getBlindsForElapsedSeconds(599).secondsToNextLevel, 1);
});

test('level 2 doubles to 1,000 / 2,000 at the ten minute mark', () => {
  assert.deepEqual(pick(getBlindsForElapsedSeconds(600)), {
    level: 2, smallBlind: 1000, bigBlind: 2000, isCapped: false, secondsToNextLevel: 600
  });
});

test('level 3 is 2,000 / 4,000', () => {
  assert.deepEqual(pick(getBlindsForElapsedSeconds(1200)), {
    level: 3, smallBlind: 2000, bigBlind: 4000, isCapped: false, secondsToNextLevel: 600
  });
});

test('level 4 hits the 2,500 cap and reports no next level', () => {
  assert.deepEqual(pick(getBlindsForElapsedSeconds(1800)), {
    level: 4, smallBlind: 2500, bigBlind: 5000, isCapped: true, secondsToNextLevel: null
  });
  assert.deepEqual(pick(getBlindsForElapsedSeconds(86400)), {
    level: 145, smallBlind: 2500, bigBlind: 5000, isCapped: true, secondsToNextLevel: null
  });
});
