// Unit tests for the 7-card evaluator and hand comparison.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Card, evaluate5Cards, evaluate7Cards, compareHands, HAND_RANKS } = require('../poker-engine');

function cards(str) {
  return str.trim().split(/\s+/).map(Card.fromString);
}

test('evaluate5Cards recognises every hand category', () => {
  const cases = [
    ['As Ks Qs Js Ts', HAND_RANKS.ROYAL_FLUSH],
    ['9h 8h 7h 6h 5h', HAND_RANKS.STRAIGHT_FLUSH],
    ['9s 9h 9d 9c 2s', HAND_RANKS.FOUR_OF_A_KIND],
    ['Ks Kh Kd 2s 2h', HAND_RANKS.FULL_HOUSE],
    ['Ah Kh 9h 5h 3h', HAND_RANKS.FLUSH],
    ['9s 8d 7c 6h 5s', HAND_RANKS.STRAIGHT],
    ['7s 7h 7d Kc 2s', HAND_RANKS.THREE_OF_A_KIND],
    ['As Ah Kd Kc 2s', HAND_RANKS.TWO_PAIR],
    ['Qs Qh 9d 5c 2s', HAND_RANKS.ONE_PAIR],
    ['As Kh 9d 5c 2s', HAND_RANKS.HIGH_CARD]
  ];

  for (const [hand, expected] of cases) {
    const result = evaluate5Cards(cards(hand));
    assert.equal(result.rankValue, expected, hand);
    assert.equal(result.cards.length, 5, hand);
  }
});

test('the wheel is a five-high straight, not an ace-high straight', () => {
  const result = evaluate5Cards(cards('Ah 2s 3d 4c 5h'));
  assert.equal(result.rankValue, HAND_RANKS.STRAIGHT);
  assert.deepEqual(result.kickers, [5]);
  assert.match(result.description, /5 High/);
});

test('the steel wheel is a five-high straight flush', () => {
  const result = evaluate5Cards(cards('Ah 2h 3h 4h 5h'));
  assert.equal(result.rankValue, HAND_RANKS.STRAIGHT_FLUSH);
  assert.deepEqual(result.kickers, [5]);
});

test('evaluate7Cards picks the best five of seven', () => {
  assert.equal(evaluate7Cards(cards('As Ks Qs Js Ts 2h 2d')).rankValue, HAND_RANKS.ROYAL_FLUSH);
  // A seven-card flush that also contains a pair must be scored as a flush.
  assert.equal(evaluate7Cards(cards('Ah Kh 9h 5h 3h Kc Kd')).rankValue, HAND_RANKS.FLUSH);
  // A full house that needs the board pair must be found.
  assert.equal(evaluate7Cards(cards('9s 9h 9d 2s 2h 7c 8d')).rankValue, HAND_RANKS.FULL_HOUSE);
});

test('quad kicker decides the winner', () => {
  const aces = evaluate7Cards(cards('9s 9h 9d 9c Ah 2d 3d'));
  const kings = evaluate7Cards(cards('9s 9h 9d 9c Kh 2d 3d'));

  assert.equal(aces.rankValue, HAND_RANKS.FOUR_OF_A_KIND);
  assert.ok(compareHands(aces, kings) > 0);
  assert.ok(compareHands(kings, aces) < 0);
});

test('full house ranks by trips before the pair', () => {
  const acesFull = evaluate5Cards(cards('As Ah Ad Qc Qh'));
  const kingsFull = evaluate5Cards(cards('Ks Kh Kd Ac Ah'));

  assert.ok(compareHands(acesFull, kingsFull) > 0);
  assert.ok(compareHands(kingsFull, acesFull) < 0);
});

test('flushes compare all five cards', () => {
  const high = evaluate5Cards(cards('Ah Kh 9h 5h 3h'));
  const low = evaluate5Cards(cards('Ah Kh 9h 5h 2h'));

  assert.ok(compareHands(high, low) > 0);
  assert.ok(compareHands(low, high) < 0);
});

test('equal hands compare as a split', () => {
  const board = '2s 3h 4d 5c 9s';
  const human = evaluate7Cards(cards(`As Kd ${board}`));
  const llm = evaluate7Cards(cards(`Ah Kc ${board}`));

  assert.equal(compareHands(human, llm), 0);
});
