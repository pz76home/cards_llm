// bots/index.js - Bot factory. All bots share:
//   getAction(observation, { persona, timeoutMs, keepAlive, numGpu, signal })
//   → { action, amount, thought, speech }   (already legal)

const { HeuristicBot } = require('./heuristic');
const { OllamaBot } = require('./ollama');

function createBot({ model, transport } = {}) {
  if (!model || model === 'builtin-heuristic' || !transport) {
    return new HeuristicBot();
  }

  return new OllamaBot({
    model,
    transport,
    fallback: new HeuristicBot()
  });
}

module.exports = { createBot, HeuristicBot, OllamaBot };
