// poker-engine.js - Complete Texas Hold'em Engine & 7-Card Evaluator

const SUITS = ['s', 'h', 'd', 'c']; // Spades, Hearts, Diamonds, Clubs
const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLORS = { s: 'black', h: 'red', d: 'red', c: 'black' };
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_NAMES = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

const HAND_RANKS = {
  ROYAL_FLUSH: 9,
  STRAIGHT_FLUSH: 8,
  FOUR_OF_A_KIND: 7,
  FULL_HOUSE: 6,
  FLUSH: 5,
  STRAIGHT: 4,
  THREE_OF_A_KIND: 3,
  TWO_PAIR: 2,
  ONE_PAIR: 1,
  HIGH_CARD: 0
};

const HAND_NAMES = {
  9: 'Royal Flush',
  8: 'Straight Flush',
  7: 'Four of a Kind',
  6: 'Full House',
  5: 'Flush',
  4: 'Straight',
  3: 'Three of a Kind',
  2: 'Two Pair',
  1: 'One Pair',
  0: 'High Card'
};

class Card {
  constructor(rank, suit) {
    this.rank = rank; // 2..14
    this.suit = suit; // 's', 'h', 'd', 'c'
  }

  get rankName() {
    return RANK_NAMES[this.rank];
  }

  get suitSymbol() {
    return SUIT_SYMBOLS[this.suit];
  }

  get suitColor() {
    return SUIT_COLORS[this.suit];
  }

  toString() {
    return `${this.rankName}${this.suitSymbol}`;
  }

  toCode() {
    return `${this.rankName}${this.suit}`;
  }

  toJSON() {
    return {
      rank: this.rank,
      suit: this.suit,
      rankName: this.rankName,
      suitSymbol: this.suitSymbol,
      suitColor: this.suitColor,
      display: this.toString(),
      code: this.toCode()
    };
  }

  static fromString(str) {
    str = str.trim();
    const suitChar = str.slice(-1).toLowerCase();
    const rankStr = str.slice(0, -1).toUpperCase();
    let rank;
    if (rankStr === 'A') rank = 14;
    else if (rankStr === 'K') rank = 13;
    else if (rankStr === 'Q') rank = 12;
    else if (rankStr === 'J') rank = 11;
    else if (rankStr === 'T' || rankStr === '10') rank = 10;
    else rank = parseInt(rankStr, 10);
    return new Card(rank, suitChar);
  }
}

class Deck {
  constructor() {
    this.cards = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push(new Card(rank, suit));
      }
    }
    this.shuffle();
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw() {
    if (this.cards.length === 0) throw new Error('Deck is empty');
    return this.cards.pop();
  }

  drawCards(count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      drawn.push(this.draw());
    }
    return drawn;
  }
}

// 7-card best 5-card combination evaluator
function evaluate7Cards(cards) {
  if (cards.length < 5) {
    return { rankValue: -1, handName: 'Incomplete', score: -1, kickers: [] };
  }

  // Generate all 5-card combinations from the given cards
  const combinations = getCombinations(cards, 5);
  let bestEval = null;

  for (const combo of combinations) {
    const evaluation = evaluate5Cards(combo);
    if (!bestEval || compareHands(evaluation, bestEval) > 0) {
      bestEval = evaluation;
    }
  }

  return bestEval;
}

function getCombinations(arr, k) {
  const result = [];
  function backtrack(start, combo) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      backtrack(i + 1, combo);
      combo.pop();
    }
  }
  backtrack(0, []);
  return result;
}

function evaluate5Cards(cards) {
  // Sort cards descending by rank
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const ranks = sorted.map(c => c.rank);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight: ranks are distinct and diff between high and low is 4
  const uniqueRanks = Array.from(new Set(ranks));
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      isStraight = true;
      straightHigh = uniqueRanks[0];
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      // Ace-low straight (A-2-3-4-5 wheel)
      isStraight = true;
      straightHigh = 5; // In wheel, 5 is the highest card of the straight
    }
  }

  // Count rank frequencies
  const counts = {};
  for (const r of ranks) {
    counts[r] = (counts[r] || 0) + 1;
  }
  // Group by count then rank desc
  const countGroups = Object.entries(counts)
    .map(([r, count]) => ({ rank: Number(r), count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  // 1. Royal Flush / Straight Flush
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return {
        rankValue: HAND_RANKS.ROYAL_FLUSH,
        handName: HAND_NAMES[HAND_RANKS.ROYAL_FLUSH],
        kickers: [14],
        cards: sorted,
        description: 'Royal Flush'
      };
    }
    return {
      rankValue: HAND_RANKS.STRAIGHT_FLUSH,
      handName: HAND_NAMES[HAND_RANKS.STRAIGHT_FLUSH],
      kickers: [straightHigh],
      cards: sorted,
      description: `Straight Flush (${RANK_NAMES[straightHigh]} High)`
    };
  }

  // 2. Four of a Kind
  if (countGroups[0].count === 4) {
    const quadRank = countGroups[0].rank;
    const kicker = countGroups[1].rank;
    return {
      rankValue: HAND_RANKS.FOUR_OF_A_KIND,
      handName: HAND_NAMES[HAND_RANKS.FOUR_OF_A_KIND],
      kickers: [quadRank, kicker],
      cards: sorted,
      description: `Four of a Kind (${RANK_NAMES[quadRank]}s)`
    };
  }

  // 3. Full House
  if (countGroups[0].count === 3 && countGroups[1].count === 2) {
    const tripRank = countGroups[0].rank;
    const pairRank = countGroups[1].rank;
    return {
      rankValue: HAND_RANKS.FULL_HOUSE,
      handName: HAND_NAMES[HAND_RANKS.FULL_HOUSE],
      kickers: [tripRank, pairRank],
      cards: sorted,
      description: `Full House (${RANK_NAMES[tripRank]}s full of ${RANK_NAMES[pairRank]}s)`
    };
  }

  // 4. Flush
  if (isFlush) {
    return {
      rankValue: HAND_RANKS.FLUSH,
      handName: HAND_NAMES[HAND_RANKS.FLUSH],
      kickers: ranks,
      cards: sorted,
      description: `Flush (${RANK_NAMES[ranks[0]]} High)`
    };
  }

  // 5. Straight
  if (isStraight) {
    return {
      rankValue: HAND_RANKS.STRAIGHT,
      handName: HAND_NAMES[HAND_RANKS.STRAIGHT],
      kickers: [straightHigh],
      cards: sorted,
      description: `Straight (${RANK_NAMES[straightHigh]} High)`
    };
  }

  // 6. Three of a Kind
  if (countGroups[0].count === 3) {
    const tripRank = countGroups[0].rank;
    const kickers = countGroups.slice(1).map(g => g.rank);
    return {
      rankValue: HAND_RANKS.THREE_OF_A_KIND,
      handName: HAND_NAMES[HAND_RANKS.THREE_OF_A_KIND],
      kickers: [tripRank, ...kickers],
      cards: sorted,
      description: `Three of a Kind (${RANK_NAMES[tripRank]}s)`
    };
  }

  // 7. Two Pair
  if (countGroups[0].count === 2 && countGroups[1].count === 2) {
    const highPair = countGroups[0].rank;
    const lowPair = countGroups[1].rank;
    const kicker = countGroups[2].rank;
    return {
      rankValue: HAND_RANKS.TWO_PAIR,
      handName: HAND_NAMES[HAND_RANKS.TWO_PAIR],
      kickers: [highPair, lowPair, kicker],
      cards: sorted,
      description: `Two Pair (${RANK_NAMES[highPair]}s and ${RANK_NAMES[lowPair]}s)`
    };
  }

  // 8. One Pair
  if (countGroups[0].count === 2) {
    const pairRank = countGroups[0].rank;
    const kickers = countGroups.slice(1).map(g => g.rank);
    return {
      rankValue: HAND_RANKS.ONE_PAIR,
      handName: HAND_NAMES[HAND_RANKS.ONE_PAIR],
      kickers: [pairRank, ...kickers],
      cards: sorted,
      description: `Pair of ${RANK_NAMES[pairRank]}s`
    };
  }

  // 9. High Card
  return {
    rankValue: HAND_RANKS.HIGH_CARD,
    handName: HAND_NAMES[HAND_RANKS.HIGH_CARD],
    kickers: ranks,
    cards: sorted,
    description: `High Card (${RANK_NAMES[ranks[0]]})`
  };
}

// Compare two evaluated hands. Returns > 0 if handA wins, < 0 if handB wins, 0 if tie.
function compareHands(handA, handB) {
  if (handA.rankValue !== handB.rankValue) {
    return handA.rankValue - handB.rankValue;
  }
  const len = Math.max(handA.kickers.length, handB.kickers.length);
  for (let i = 0; i < len; i++) {
    const kA = handA.kickers[i] || 0;
    const kB = handB.kickers[i] || 0;
    if (kA !== kB) {
      return kA - kB;
    }
  }
  return 0;
}

// Blinds schedule calculator
// First 10 minutes: SB 500, BB 1000.
// Doubles every 10 minutes, up to max SB 2500.
function getBlindsForElapsedSeconds(elapsedSec) {
  const periodIndex = Math.floor(elapsedSec / 600); // 10 minutes = 600 seconds
  let smallBlind = 500 * Math.pow(2, periodIndex);
  if (smallBlind > 2500) {
    smallBlind = 2500;
  }
  const bigBlind = smallBlind * 2;
  const isCapped = smallBlind >= 2500;
  const secondsIntoLevel = elapsedSec % 600;
  const secondsToNextLevel = isCapped ? null : 600 - secondsIntoLevel;

  return {
    level: periodIndex + 1,
    smallBlind,
    bigBlind,
    isCapped,
    secondsToNextLevel,
    elapsedSec
  };
}

// Game Manager: Heads-Up Texas Hold'em
class TexasHoldemGame {
  constructor(options = {}) {
    this.startingChips = options.startingChips || 50000;
    this.humanChips = this.startingChips;
    this.llmChips = this.startingChips;

    this.startTime = Date.now();
    this.handCount = 0;
    this.dealer = 'human'; // Alternates between 'human' and 'llm'

    // Current hand state
    this.deck = new Deck();
    this.humanHoleCards = [];
    this.llmHoleCards = [];
    this.communityCards = [];

    this.pot = 0;
    this.humanBet = 0;
    this.llmBet = 0;
    this.currentBet = 0;
    this.minRaise = 0;

    this.stage = 'idle'; // 'preflop', 'flop', 'turn', 'river', 'showdown', 'ended'
    this.activePlayer = null; // 'human' or 'llm'
    this.history = [];
    this.handLogs = [];

    this.winner = null; // Hand winner
    this.winningDescription = '';
    this.isGameOver = false;
    this.gameOverReason = '';

    this.lastLlmThought = '';
    this.lastLlmSpeech = '';
  }

  getElapsedSeconds() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  getCurrentBlinds() {
    return getBlindsForElapsedSeconds(this.getElapsedSeconds());
  }

  startNewHand() {
    if (this.isGameOver) return false;

    // Check if either player is broke
    if (this.humanChips <= 0) {
      this.isGameOver = true;
      this.gameOverReason = 'The LLM has won! You ran out of chips.';
      return false;
    }
    if (this.llmChips <= 0) {
      this.isGameOver = true;
      this.gameOverReason = 'Congratulations! You broke the LLM and won all chips!';
      return false;
    }

    this.handCount++;
    this.deck.reset();
    this.humanHoleCards = this.deck.drawCards(2);
    this.llmHoleCards = this.deck.drawCards(2);
    this.communityCards = [];

    // Switch dealer button each hand (heads up)
    if (this.handCount > 1) {
      this.dealer = this.dealer === 'human' ? 'llm' : 'human';
    }

    const blinds = this.getCurrentBlinds();
    this.pot = 0;
    this.humanBet = 0;
    this.llmBet = 0;
    this.history = [];
    this.winner = null;
    this.winningDescription = '';
    this.lastLlmThought = '';
    this.lastLlmSpeech = '';

    // Heads up rule:
    // Dealer posts Small Blind, Non-dealer posts Big Blind.
    // Preflop: Dealer acts first. Postflop: Non-dealer acts first.
    const sbPlayer = this.dealer;
    const bbPlayer = this.dealer === 'human' ? 'llm' : 'human';

    const actualSB = Math.min(this.getPlayerChips(sbPlayer), blinds.smallBlind);
    const actualBB = Math.min(this.getPlayerChips(bbPlayer), blinds.bigBlind);

    this.deductChips(sbPlayer, actualSB);
    this.deductChips(bbPlayer, actualBB);

    if (sbPlayer === 'human') {
      this.humanBet = actualSB;
      this.llmBet = actualBB;
    } else {
      this.llmBet = actualSB;
      this.humanBet = actualBB;
    }

    this.pot = actualSB + actualBB;
    this.currentBet = Math.max(actualSB, actualBB);
    this.minRaise = actualBB * 2;

    this.stage = 'preflop';
    this.actionsThisRound = { human: false, llm: false };

    this.logAction('dealer', `Hand #${this.handCount} started. Dealer is ${this.dealer.toUpperCase()}. Blinds: ${blinds.smallBlind}/${blinds.bigBlind}`);
    this.logAction(sbPlayer, `posts Small Blind of ${actualSB}${this.getPlayerChips(sbPlayer) === 0 ? ' (ALL-IN)' : ''}`);
    this.logAction(bbPlayer, `posts Big Blind of ${actualBB}${this.getPlayerChips(bbPlayer) === 0 ? ' (ALL-IN)' : ''}`);

    // If either player was put all-in from posting blinds:
    if (this.humanChips === 0 || this.llmChips === 0) {
      this.balanceUncalledBets();
      if (this.humanBet === this.llmBet) {
        this.logAction('dealer', 'A player is All-In from posting blinds! Dealing all board cards to Showdown...');
        this.runOutRemainingCards();
        this.resolveShowdown();
        return true;
      }
      // If bets do not match, the player who owes must call or fold
      this.activePlayer = this.humanBet < this.llmBet ? 'human' : 'llm';
      return true;
    }

    // Preflop: Button (SB) acts first in heads-up
    this.activePlayer = sbPlayer;
    return true;
  }

  balanceUncalledBets() {
    if (this.humanBet !== this.llmBet) {
      if (this.humanBet > this.llmBet) {
        const excess = this.humanBet - this.llmBet;
        this.addChips('human', excess);
        this.humanBet = this.llmBet;
        this.pot -= excess;
        this.logAction('dealer', `Refunded uncalled ${excess} to HUMAN`);
      } else {
        const excess = this.llmBet - this.humanBet;
        this.addChips('llm', excess);
        this.llmBet = this.humanBet;
        this.pot -= excess;
        this.logAction('dealer', `Refunded uncalled ${excess} to LLM`);
      }
      this.currentBet = this.humanBet;
    }
  }

  getPlayerChips(player) {
    return player === 'human' ? this.humanChips : this.llmChips;
  }

  deductChips(player, amount) {
    if (player === 'human') {
      this.humanChips -= amount;
    } else {
      this.llmChips -= amount;
    }
  }

  addChips(player, amount) {
    if (player === 'human') {
      this.humanChips += amount;
    } else {
      this.llmChips += amount;
    }
  }

  logAction(player, text) {
    const entry = {
      player,
      text,
      stage: this.stage,
      time: new Date().toLocaleTimeString()
    };
    this.history.push(entry);
    this.handLogs.push(entry);
  }

  // Get valid actions for active player
  getValidActions(player, ignoreTurn = false) {
    if (this.stage === 'showdown' || this.stage === 'ended' || this.isGameOver) {
      return [];
    }
    if (!ignoreTurn && player !== this.activePlayer) {
      return [];
    }

    const opponent = player === 'human' ? 'llm' : 'human';
    const playerChips = this.getPlayerChips(player);
    const opponentChips = this.getPlayerChips(opponent);

    // If player has 0 chips, they are already all-in! No further actions can be taken.
    if (playerChips === 0) {
      return [];
    }

    const playerBet = player === 'human' ? this.humanBet : this.llmBet;
    const callAmount = Math.max(0, this.currentBet - playerBet);
    const actualCall = Math.min(playerChips, callAmount);

    const actions = [];

    // Fold is always valid
    actions.push({ type: 'fold', label: 'Fold' });

    // Check vs Call
    if (callAmount === 0) {
      actions.push({ type: 'check', label: 'Check' });
    } else {
      actions.push({
        type: 'call',
        label: `Call ${actualCall}${actualCall === playerChips ? ' (All-In)' : ''}`,
        amount: actualCall
      });
    }

    // Raise / All-in
    // CRITICAL: Player can only raise if:
    // 1. Player has more chips than callAmount (playerChips > callAmount)
    // 2. AND opponent has chips left (opponentChips > 0)! Opponent cannot be raised if already all-in!
    if (playerChips > callAmount && opponentChips > 0) {
      const minRaiseAmount = Math.max(this.currentBet * 2, this.currentBet + this.getCurrentBlinds().bigBlind);
      const minAdditional = minRaiseAmount - playerBet;
      const actualMinRaise = Math.min(playerChips, minAdditional);
      const maxRaise = playerChips; // All-in

      actions.push({
        type: 'raise',
        label: 'Raise',
        min: actualMinRaise,
        max: maxRaise,
        callAmount: callAmount
      });
      actions.push({
        type: 'all-in',
        label: `All-In (${playerChips})`,
        amount: playerChips
      });
    }

    // Give Up / Resign (ends game)
    actions.push({ type: 'give_up', label: 'Give Up / Resign' });

    return actions;
  }

  // Execute an action
  executeAction(player, actionType, amount = 0, thought = '', speech = '') {
    if (player !== this.activePlayer) {
      throw new Error(`It is not ${player}'s turn`);
    }

    if (thought) this.lastLlmThought = thought;
    if (speech) this.lastLlmSpeech = speech;

    const opponent = player === 'human' ? 'llm' : 'human';
    const playerChips = this.getPlayerChips(player);
    const playerBet = player === 'human' ? this.humanBet : this.llmBet;
    const callAmount = Math.max(0, this.currentBet - playerBet);

    // 1. Give Up
    if (actionType === 'give_up') {
      this.isGameOver = true;
      this.stage = 'ended';
      this.activePlayer = null;
      if (player === 'human') {
        this.gameOverReason = 'Human player resigned. LLM wins the tournament!';
        this.logAction('human', 'resigned the game.');
      } else {
        this.gameOverReason = 'LLM conceded the match! Human wins the tournament!';
        this.logAction('llm', 'surrendered and gave up the match.');
      }
      return { success: true, isGameOver: true };
    }

    // 2. Fold
    if (actionType === 'fold') {
      this.logAction(player, 'folds');
      this.winner = opponent;
      this.winningDescription = `${opponent.toUpperCase()} wins pot of ${this.pot} (opponent folded)`;
      this.addChips(opponent, this.pot);
      this.stage = 'showdown';
      this.activePlayer = null;
      this.checkTournamentEnd();
      return { success: true, handComplete: true };
    }

    // 3. Check
    if (actionType === 'check') {
      if (callAmount > 0) {
        throw new Error(`Cannot check when facing a bet of ${callAmount}`);
      }
      this.logAction(player, 'checks');
      this.advanceBettingTurn(player, 'check');
      return { success: true };
    }

    // 4. Call
    if (actionType === 'call') {
      const actualCall = Math.min(playerChips, callAmount);
      this.deductChips(player, actualCall);
      if (player === 'human') {
        this.humanBet += actualCall;
      } else {
        this.llmBet += actualCall;
      }
      this.pot += actualCall;
      const isAllIn = this.getPlayerChips(player) === 0;
      this.logAction(player, `${isAllIn ? 'calls All-In with' : 'calls'} ${actualCall}`);

      // If call is all-in for less than opponent's bet, refund uncalled excess:
      this.balanceUncalledBets();

      this.advanceBettingTurn(player, 'call');
      return { success: true };
    }

    // 5. Raise or All-in
    if (actionType === 'raise' || actionType === 'all-in') {
      const opponentChips = this.getPlayerChips(opponent);
      // Opponent is already all-in! Raising is illegal; treat as call:
      if (opponentChips === 0) {
        return this.executeAction(player, 'call', 0, thought, speech);
      }

      let raiseAmt = actionType === 'all-in' ? playerChips : Number(amount);
      if (isNaN(raiseAmt) || raiseAmt <= callAmount) {
        // If raise amount invalid, treat as call
        raiseAmt = Math.min(playerChips, callAmount);
      }
      if (raiseAmt > playerChips) {
        raiseAmt = playerChips;
      }

      this.deductChips(player, raiseAmt);
      if (player === 'human') {
        this.humanBet += raiseAmt;
        this.currentBet = this.humanBet;
      } else {
        this.llmBet += raiseAmt;
        this.currentBet = this.llmBet;
      }
      this.pot += raiseAmt;

      const isAllIn = this.getPlayerChips(player) === 0;
      this.logAction(player, `${isAllIn ? 'goes All-In with' : 'raises by'} ${raiseAmt}`);
      // Opponent must respond to raise
      this.actionsThisRound[opponent] = false;
      this.advanceBettingTurn(player, 'raise');
      return { success: true };
    }

    throw new Error(`Unknown action type: ${actionType}`);
  }

  advanceBettingTurn(lastPlayer, action) {
    const opponent = lastPlayer === 'human' ? 'llm' : 'human';
    this.actionsThisRound[lastPlayer] = true;

    const betsMatch = this.humanBet === this.llmBet;
    const someoneAllIn = this.humanChips === 0 || this.llmChips === 0;

    // If someone is all-in and bets match:
    // No more betting can take place! Immediately run out remaining board cards to Showdown:
    if (someoneAllIn && betsMatch) {
      this.logAction('dealer', 'All-in action complete. Dealing remaining board cards to Showdown...');
      this.runOutRemainingCards();
      this.resolveShowdown();
      return;
    }

    // If the opponent is all-in (0 chips left) and bets do not match,
    // balance any uncalled portion and proceed to Showdown:
    if (this.getPlayerChips(opponent) === 0) {
      this.balanceUncalledBets();
      this.logAction('dealer', 'All-in action resolved. Dealing remaining board cards to Showdown...');
      this.runOutRemainingCards();
      this.resolveShowdown();
      return;
    }

    // Check if normal round is complete
    const roundComplete = betsMatch && this.actionsThisRound.human && this.actionsThisRound.llm;

    if (roundComplete) {
      if (someoneAllIn) {
        this.runOutRemainingCards();
        this.resolveShowdown();
      } else {
        this.nextStage();
      }
    } else {
      // If opponent has 0 chips left, they cannot act
      if (this.getPlayerChips(opponent) === 0) {
        this.balanceUncalledBets();
        this.runOutRemainingCards();
        this.resolveShowdown();
        return;
      }
      // Turn passes to opponent
      this.activePlayer = opponent;
    }
  }

  nextStage() {
    this.humanBet = 0;
    this.llmBet = 0;
    this.currentBet = 0;
    this.actionsThisRound = { human: false, llm: false };

    if (this.stage === 'preflop') {
      this.stage = 'flop';
      this.deck.draw(); // Burn card
      this.communityCards.push(...this.deck.drawCards(3));
      this.logAction('dealer', `Dealt Flop: ${this.communityCards.map(c => c.toString()).join(' ')}`);
    } else if (this.stage === 'flop') {
      this.stage = 'turn';
      this.deck.draw(); // Burn card
      this.communityCards.push(this.deck.draw());
      this.logAction('dealer', `Dealt Turn: ${this.communityCards[3].toString()}`);
    } else if (this.stage === 'turn') {
      this.stage = 'river';
      this.deck.draw(); // Burn card
      this.communityCards.push(this.deck.draw());
      this.logAction('dealer', `Dealt River: ${this.communityCards[4].toString()}`);
    } else if (this.stage === 'river') {
      this.resolveShowdown();
      return;
    }

    // In heads-up post-flop: Non-dealer acts first!
    const nonDealer = this.dealer === 'human' ? 'llm' : 'human';
    this.activePlayer = nonDealer;
  }

  runOutRemainingCards() {
    while (this.communityCards.length < 5) {
      if (this.communityCards.length === 0) {
        this.deck.draw(); // burn
        this.communityCards.push(...this.deck.drawCards(3));
      } else {
        this.deck.draw(); // burn
        this.communityCards.push(this.deck.draw());
      }
    }
  }

  resolveShowdown() {
    this.stage = 'showdown';
    this.activePlayer = null;

    const humanAllCards = [...this.humanHoleCards, ...this.communityCards];
    const llmAllCards = [...this.llmHoleCards, ...this.communityCards];

    const humanEval = evaluate7Cards(humanAllCards);
    const llmEval = evaluate7Cards(llmAllCards);

    const cmp = compareHands(humanEval, llmEval);

    if (cmp > 0) {
      this.winner = 'human';
      this.winningDescription = `Human wins pot of ${this.pot} with ${humanEval.description}`;
      this.addChips('human', this.pot);
      this.logAction('dealer', `Human wins with ${humanEval.description} vs LLM's ${llmEval.description}`);
    } else if (cmp < 0) {
      this.winner = 'llm';
      this.winningDescription = `LLM wins pot of ${this.pot} with ${llmEval.description}`;
      this.addChips('llm', this.pot);
      this.logAction('dealer', `LLM wins with ${llmEval.description} vs Human's ${humanEval.description}`);
    } else {
      // Split pot
      this.winner = 'split';
      const half = Math.floor(this.pot / 2);
      const remainder = this.pot % 2;
      this.addChips('human', half);
      this.addChips('llm', half + remainder);
      this.winningDescription = `Split pot of ${this.pot} (${humanEval.description})`;
      this.logAction('dealer', `Split pot! Both have ${humanEval.description}`);
    }

    this.checkTournamentEnd();
  }

  checkTournamentEnd() {
    if (this.humanChips <= 0) {
      this.isGameOver = true;
      this.gameOverReason = 'The LLM has won! You are out of chips.';
      this.stage = 'ended';
    } else if (this.llmChips <= 0) {
      this.isGameOver = true;
      this.gameOverReason = 'Congratulations! You cleaned out the LLM and won!';
      this.stage = 'ended';
    }
  }

  // Safe client state (hiding LLM hole cards unless showdown or ended)
  getClientState() {
    const showLlmCards = this.stage === 'showdown' || this.stage === 'ended';

    const humanAllCards = [...this.humanHoleCards, ...this.communityCards];
    const humanEval = humanAllCards.length >= 5 ? evaluate7Cards(humanAllCards) : null;
    let humanHandDescription = '';
    if (humanEval) {
      humanHandDescription = humanEval.description;
    } else if (this.humanHoleCards.length === 2) {
      if (this.humanHoleCards[0].rank === this.humanHoleCards[1].rank) {
        humanHandDescription = `Pocket Pair of ${this.humanHoleCards[0].rankName}s`;
      } else {
        const highRank = Math.max(this.humanHoleCards[0].rank, this.humanHoleCards[1].rank);
        humanHandDescription = `High Card ${RANK_NAMES[highRank]}`;
      }
    }

    return {
      handCount: this.handCount,
      dealer: this.dealer,
      stage: this.stage,
      activePlayer: this.activePlayer,
      pot: this.pot,
      currentBet: this.currentBet,
      humanChips: this.humanChips,
      llmChips: this.llmChips,
      humanBet: this.humanBet,
      llmBet: this.llmBet,
      communityCards: this.communityCards.map(c => c.toJSON()),
      humanHoleCards: this.humanHoleCards.map(c => c.toJSON()),
      humanHandDescription,
      llmHoleCards: showLlmCards ? this.llmHoleCards.map(c => c.toJSON()) : null,
      llmCardCount: this.llmHoleCards.length,
      blinds: this.getCurrentBlinds(),
      winner: this.winner,
      winningDescription: this.winningDescription,
      isGameOver: this.isGameOver,
      gameOverReason: this.gameOverReason,
      lastLlmThought: showLlmCards ? this.lastLlmThought : '',
      lastLlmSpeech: this.lastLlmSpeech,
      validActions: this.getValidActions('human'),
      history: this.history.slice(-15) // Recent 15 events
    };
  }

  // Information strictly allowed for Ollama (NO deck peek, NO opponent hole cards!)
  getLlmObservation() {
    const callAmount = Math.max(0, this.currentBet - this.llmBet);
    const validActions = this.getValidActions('llm', true);

    return {
      gameStage: this.stage,
      dealer: this.dealer,
      isLlmDealer: this.dealer === 'llm',
      blinds: this.getCurrentBlinds(),
      pot: this.pot,
      llmChips: this.llmChips,
      humanChips: this.humanChips,
      llmCurrentBet: this.llmBet,
      humanCurrentBet: this.humanBet,
      callAmountRequired: callAmount,
      communityCards: this.communityCards.map(c => c.toCode()),
      llmHoleCards: this.llmHoleCards.map(c => c.toCode()),
      validActions: validActions.map(a => a.type),
      recentActions: this.history.slice(-8).map(h => `${h.player}: ${h.text}`)
    };
  }
}

module.exports = {
  Card,
  Deck,
  TexasHoldemGame,
  evaluate7Cards,
  evaluate5Cards,
  compareHands,
  getBlindsForElapsedSeconds,
  HAND_RANKS,
  HAND_NAMES
};
