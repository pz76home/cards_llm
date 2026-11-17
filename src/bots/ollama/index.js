// ollama/index.js - The Ollama-backed opponent bot.
// Composes transport + prompts + parser, and degrades to a fallback bot on
// non-cancellation failures.

const { buildSystemPrompt, buildUserPrompt, DEFAULT_DECISION_TIMEOUT_MS } = require('./prompts');
const { parseAction } = require('./parse');
const { isExternalAbort } = require('./transport');

class OllamaBot {
  constructor({ model, transport, fallback = null }) {
    this.model = model;
    this.transport = transport;
    this.fallback = fallback;
  }

  async getAction(observation, {
    persona = 'balanced',
    timeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
    keepAlive = '2h',
    numGpu = 999,
    signal
  } = {}) {
    const systemPrompt = buildSystemPrompt(persona, observation);
    const userPrompt = buildUserPrompt(observation, timeoutMs);

    try {
      console.log(`[OllamaBot] Turn decision for '${this.model}': ${Math.round(timeoutMs / 1000)}s limit, num_gpu: ${numGpu}...`);

      const rawText = await this.transport.generateText({
        model: this.model,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        keepAlive,
        numGpu,
        temperature: persona === 'wild' ? 0.85 : 0.4,
        topP: 0.9,
        numPredict: 150,
        timeoutMs,
        signal
      });

      const parsed = parseAction(rawText, observation);
      if (parsed) {
        console.log(`[OllamaBot] Move decision received from '${this.model}'.`);
        return parsed;
      }

      console.warn(`[OllamaBot] Could not parse a move from '${this.model}' - using fallback bot.`);
      return this.fallbackMove(observation, persona);
    } catch (err) {
      // A user/manager cancellation must propagate: the caller already applied
      // its own replacement action and nothing else may be executed.
      if (isExternalAbort(err, signal)) {
        throw err;
      }

      console.warn(`[OllamaBot] Error querying ${this.model}:`, err.message, '- Falling back to heuristic AI');
      const fallback = this.fallbackMove(observation, persona);
      fallback.speech = `(Ollama turn time note: ${err.message}) ${fallback.speech}`;
      return fallback;
    }
  }

  fallbackMove(observation, persona) {
    if (this.fallback) {
      const decision = this.fallback.getAction(observation, { persona });
      // Always return a fresh object so annotation cannot mutate shared state.
      return { ...decision };
    }

    const valid = observation.validActions || [];
    return {
      action: valid.includes('check') ? 'check' : 'fold',
      amount: 0,
      thought: 'No model move available.',
      speech: 'I will play it safe this hand.'
    };
  }
}

module.exports = { OllamaBot };
