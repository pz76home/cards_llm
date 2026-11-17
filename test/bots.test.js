// Bot layer: factory, heuristic legality, and Ollama parsing/fallback policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');
const { createBot, HeuristicBot, OllamaBot } = require('../src/bots');
const { DEFAULT_OLLAMA_URL } = require('../src/bots/ollama/transport');

function newGame() {
  const game = new TexasHoldemGame({ startingChips: 50000 });
  game.startNewHand();
  return game;
}

// Observation for the LLM at a given street. `getLlmObservation` ignores whose
// turn it is, so this works even while the human is to act preflop.
function observationAt(stage) {
  const game = newGame();

  if (stage === 'preflop') return game.getLlmObservation();

  game.executeAction('human', 'call');
  game.executeAction('llm', 'check');
  if (stage === 'flop') return game.getLlmObservation();

  game.executeAction('llm', 'check');
  game.executeAction('human', 'check');
  if (stage === 'turn') return game.getLlmObservation();

  game.executeAction('llm', 'check');
  game.executeAction('human', 'check');
  assert.equal(game.stage, 'river');
  return game.getLlmObservation();
}

function assertLegal(obs, decision, label = '') {
  assert.ok(obs.validActions.includes(decision.action), `${label} illegal action ${decision.action} not in [${obs.validActions}]`);
  assert.equal(typeof decision.thought, 'string');
  assert.equal(typeof decision.speech, 'string');
  if (decision.action === 'raise') {
    assert.ok(Number.isFinite(decision.amount), `${label} raise amount not finite`);
    assert.ok(decision.amount >= obs.raiseMin, `${label} raise ${decision.amount} below min ${obs.raiseMin}`);
    assert.ok(decision.amount <= obs.raiseMax, `${label} raise ${decision.amount} above max ${obs.raiseMax}`);
  }
}

function fakeTransport(generateText) {
  return { generateText };
}

function throwNamed(name) {
  const err = new Error(`simulated ${name}`);
  err.name = name;
  throw err;
}

test('createBot picks the built-in bot when no model is selected', () => {
  const transport = fakeTransport(async () => '{}');

  assert.ok(createBot({ model: 'builtin-heuristic', transport }) instanceof HeuristicBot);
  assert.ok(createBot({ model: '', transport }) instanceof HeuristicBot);
  assert.ok(createBot({}) instanceof HeuristicBot);
  assert.ok(createBot({ model: 'llama3' }) instanceof HeuristicBot);

  const llm = createBot({ model: 'llama3', transport });
  assert.ok(llm instanceof OllamaBot);
  assert.equal(llm.model, 'llama3');
  assert.ok(llm.fallback instanceof HeuristicBot);
});

test('the built-in bot always returns a legal action on every street', () => {
  const bot = new HeuristicBot();

  for (const stage of ['preflop', 'flop', 'turn', 'river']) {
    const obs = observationAt(stage);
    for (let i = 0; i < 25; i++) {
      assertLegal(obs, bot.getAction(obs, { persona: 'balanced' }), `${stage} #${i}`);
    }
  }
});

test('OllamaBot accepts plain JSON from the model', async () => {
  const obs = observationAt('preflop');
  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async () => JSON.stringify({
      action: 'raise',
      amount: 5000,
      thought: 'value bet',
      speech: 'Pay up.'
    })),
    fallback: new HeuristicBot()
  });

  const decision = await bot.getAction(obs, {});
  assert.deepEqual(decision, {
    action: 'raise',
    amount: 5000,
    thought: 'value bet',
    speech: 'Pay up.'
  });
});

test('OllamaBot accepts fenced JSON and clamps an out-of-range raise', async () => {
  const obs = observationAt('preflop');
  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async () => '```json\n{"action":"raise","amount":9999999,"thought":"t","speech":"s"}\n```'),
    fallback: new HeuristicBot()
  });

  const decision = await bot.getAction(obs, {});
  assertLegal(obs, decision, 'fenced');
  assert.equal(decision.action, 'raise');
  assert.equal(decision.amount, obs.raiseMax);
});

test('OllamaBot coerces an unparseable reply through the fallback bot', async () => {
  const obs = observationAt('preflop');
  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async () => 'I feel lucky, I fold... no wait, raise!'),
    fallback: {
      getAction: () => ({ action: 'check', amount: 0, thought: 'fallback thought', speech: 'fallback speech' })
    }
  });

  const decision = await bot.getAction(obs, {});
  assertLegal(obs, decision, 'garbage');
  assert.equal(decision.action, 'check');
  assert.equal(decision.thought, 'fallback thought');
});

test('OllamaBot never resigns even when the model asks to give up', async () => {
  const obs = observationAt('preflop');
  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async () => JSON.stringify({
      action: 'give_up',
      amount: 0,
      thought: 'too hard',
      speech: 'I quit.'
    })),
    fallback: new HeuristicBot()
  });

  const decision = await bot.getAction(obs, {});
  assertLegal(obs, decision, 'give_up');
  assert.notEqual(decision.action, 'give_up');
});

test('OllamaBot falls back on a timeout and annotates the speech', async () => {
  const obs = observationAt('preflop');
  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async () => throwNamed('TimeoutError')),
    fallback: {
      getAction: () => ({ action: 'check', amount: 0, thought: 'fb', speech: 'Quick bot.' })
    }
  });

  const decision = await bot.getAction(obs, { timeoutMs: 5 });
  assert.equal(decision.action, 'check');
  assert.match(decision.speech, /^\(Ollama turn time note: simulated TimeoutError\) Quick bot\.$/);
});

test('OllamaBot rethrows an external cancellation instead of playing on', async () => {
  const obs = observationAt('preflop');
  const controller = new AbortController();
  controller.abort();

  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async () => throwNamed('AbortError')),
    fallback: {
      getAction: () => {
        throw new Error('fallback must not run after an external abort');
      }
    }
  });

  await assert.rejects(
    () => bot.getAction(obs, { signal: controller.signal }),
    /simulated AbortError/
  );
});

test('the compatibility facade still exposes the old client API', () => {
  const { OllamaClient, DEFAULT_OLLAMA_URL: facadeUrl } = require('../ollama-client');
  assert.equal(facadeUrl, DEFAULT_OLLAMA_URL);

  const client = new OllamaClient('http://127.0.0.1:11434/');
  assert.equal(client.baseUrl, 'http://127.0.0.1:11434');

  const obs = observationAt('preflop');
  const decision = client.parseLlmResponse('{"action":"check","thought":"t","speech":"s"}', obs);
  assert.deepEqual(decision, { action: 'check', amount: 0, thought: 't', speech: 's' });

  assert.equal(client.rankToVal('As'), 14);
  assert.equal(client.rankToVal('Td'), 10);
  assertLegal(obs, client.heuristicAiMove(obs, 'tight'), 'facade heuristic');
});
