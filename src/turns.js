// turns.js - Single-flight LLM turn execution with cancellation.
//
// Guarantees that at most ONE action is ever applied per LLM turn, even when a
// slow request is cancelled (Skip Wait) or a new hand starts mid-flight.

const { HeuristicBot } = require('./bots/heuristic');

class TurnPendingError extends Error {
  constructor() {
    super('An LLM turn is already in progress');
    this.name = 'TurnPendingError';
    this.code = 'TURN_PENDING';
  }
}

class TurnManager {
  constructor({ fallbackBot = new HeuristicBot() } = {}) {
    this.fallbackBot = fallbackBot;
    this.pending = null;
  }

  isPending() {
    return this.pending !== null;
  }

  // Abort the pending request without applying a replacement move.
  // Used when the whole game is reset.
  abortPending() {
    if (!this.pending) return false;
    const token = this.pending;
    this.pending = null;
    token.aborted = true;
    token.controller.abort();
    return true;
  }

  // Run one LLM turn. Resolves with:
  //   { decision, state }            action applied
  //   { cancelled: true, state }     cancelled; nothing applied here
  //   { stale: true, state }         game advanced elsewhere; result discarded
  //   { failed: true, error, state } unrecoverable execution failure
  async start(game, bot, options = {}) {
    if (this.pending) throw new TurnPendingError();
    if (game.activePlayer !== 'llm') {
      throw new Error("It is not the LLM's turn");
    }

    const observation = game.getLlmObservation();
    const turnId = game.turnId;
    const controller = new AbortController();
    const token = { controller, turnId, options, aborted: false };
    this.pending = token;

    let decision;
    try {
      decision = await bot.getAction(observation, { ...options, signal: controller.signal });
    } catch (err) {
      if (token.aborted || controller.signal.aborted) {
        return { cancelled: true, state: game.getClientState() };
      }
      // The bot failed without being cancelled: play the safe fallback.
      decision = this.fallbackBot.getAction(game.getLlmObservation(), { persona: options.persona });
    } finally {
      if (this.pending === token) this.pending = null;
    }

    // A cancel may have applied the fallback while we awaited.
    if (token.aborted) {
      return { cancelled: true, state: game.getClientState() };
    }

    // A newer action landed for another reason: never execute a stale move.
    if (game.turnId !== turnId || game.activePlayer !== 'llm') {
      return { stale: true, state: game.getClientState() };
    }

    return this._apply(game, decision);
  }

  // Cancel the pending turn and immediately play the fallback bot instead.
  cancel(game) {
    const token = this.pending;
    if (!token) {
      return { cancelled: false, state: game.getClientState() };
    }

    this.pending = null;
    token.aborted = true;
    token.controller.abort();

    if (game.activePlayer !== 'llm' || game.turnId !== token.turnId) {
      return { cancelled: false, state: game.getClientState() };
    }

    const decision = this.fallbackBot.getAction(game.getLlmObservation(), {
      persona: token.options.persona
    });
    return this._apply(game, decision, { cancelled: true });
  }

  _apply(game, decision, extra = {}) {
    try {
      game.executeAction('llm', decision.action, decision.amount, decision.thought, decision.speech);
    } catch (err) {
      console.error('LLM execution error:', err.message);

      const legal = game.getValidActions('llm', true).map(a => a.type);
      const safeAction = legal.includes('check') ? 'check' : 'fold';
      try {
        game.executeAction('llm', safeAction, 0, 'Auto-correction fallback', '...');
      } catch (fallbackErr) {
        console.error('LLM fallback execution error:', fallbackErr.message);
        return { failed: true, error: fallbackErr.message, state: game.getClientState(), ...extra };
      }

      return { corrected: true, decision, state: game.getClientState(), ...extra };
    }

    return { decision, state: game.getClientState(), ...extra };
  }
}

module.exports = { TurnManager, TurnPendingError };
