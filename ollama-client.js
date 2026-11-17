// ollama-client.js - Backwards-compatible facade over src/bots/**.
//
// The real implementation now lives in:
//   src/bots/ollama/transport.js  HTTP calls to Ollama
//   src/bots/ollama/prompts.js    persona guides + prompt templates
//   src/bots/ollama/parse.js      JSON → legal action
//   src/bots/ollama/index.js      OllamaBot (with heuristic fallback)
//   src/bots/heuristic.js         HeuristicBot
//
// Kept so any external script that did `require('./ollama-client')` keeps
// working. New code should import from src/bots instead.

const { OllamaTransport, DEFAULT_OLLAMA_URL } = require('./src/bots/ollama/transport');
const { buildSystemPrompt, buildUserPrompt } = require('./src/bots/ollama/prompts');
const { parseAction } = require('./src/bots/ollama/parse');
const { OllamaBot } = require('./src/bots/ollama');
const { HeuristicBot } = require('./src/bots/heuristic');

class OllamaClient {
  constructor(baseUrl = DEFAULT_OLLAMA_URL) {
    this.transport = new OllamaTransport(baseUrl);
    this.heuristic = new HeuristicBot();
  }

  get baseUrl() {
    return this.transport.baseUrl;
  }

  setBaseUrl(url) {
    this.transport.setBaseUrl(url);
  }

  listModels() {
    return this.transport.listModels();
  }

  getLoadedModels() {
    return this.transport.getLoadedModels();
  }

  preloadModel(model, keepAlive, numGpu) {
    return this.transport.preloadModel(model, keepAlive, numGpu);
  }

  // Legacy signature: getAction({ model, observation, persona, timeoutMs, ... })
  async getAction({
    model,
    observation,
    persona = 'balanced',
    timeoutMs,
    keepAlive,
    numGpu,
    signal
  }) {
    const bot = new OllamaBot({
      model,
      transport: this.transport,
      fallback: this.heuristic
    });

    return bot.getAction(observation, {
      persona,
      timeoutMs,
      keepAlive,
      numGpu,
      signal
    });
  }

  buildSystemPrompt(persona, observation = null) {
    return buildSystemPrompt(persona, observation);
  }

  buildUserPrompt(observation, timeoutMs) {
    return buildUserPrompt(observation, timeoutMs);
  }

  // Returns null when the text is unparseable (the bot layer decides fallback).
  parseLlmResponse(rawText, observation) {
    return parseAction(rawText, observation);
  }

  heuristicAiMove(observation, persona = 'balanced') {
    return this.heuristic.getAction(observation, { persona });
  }

  rankToVal(cardStr) {
    return this.heuristic.rankToVal(cardStr);
  }
}

module.exports = { OllamaClient, DEFAULT_OLLAMA_URL };
