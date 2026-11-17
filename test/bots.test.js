// Bot layer: factory, heuristic legality, and Ollama parsing/fallback policy.
const test = require('node:test');
const assert = require('node:assert/strict');
const { TexasHoldemGame } = require('../poker-engine');
const { createBot, HeuristicBot, OllamaBot } = require('../src/bots');
const { OllamaTransport, DEFAULT_OLLAMA_URL } = require('../src/bots/ollama/transport');
const { parseAction } = require('../src/bots/ollama/parse');

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

// Reasoning models (Qwen3 and friends) will spend the whole token budget on a
// visible scratchpad unless thinking is turned off and JSON output is required.
test('OllamaBot disables model thinking and asks the transport for JSON', async () => {
  const obs = observationAt('preflop');
  let captured = null;
  const bot = new OllamaBot({
    model: 'fake',
    transport: fakeTransport(async (request) => {
      captured = request;
      return '{"action":"check","thought":"t","speech":"s"}';
    }),
    fallback: new HeuristicBot()
  });

  const decision = await bot.getAction(obs, {});
  assertLegal(obs, decision, 'configured request');
  assert.equal(captured.think, false);
  assert.equal(captured.format, 'json');
  assert.ok(captured.numPredict >= 300, `numPredict ${captured.numPredict} leaves no room for the JSON`);
});

test('generateText sends think:false, format:json and a usable token budget', async () => {
  let captured = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ response: '{"action":"check"}' }) };
  };

  try {
    const transport = new OllamaTransport();
    const text = await transport.generateText({ model: 'fake', prompt: 'p' });
    assert.equal(text, '{"action":"check"}');
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(captured.body.think, false);
  assert.equal(captured.body.format, 'json');
  assert.ok(captured.body.options.num_predict >= 300);
});

test('parseAction ignores a reasoning preamble and reads the JSON object', () => {
  // Force a real call decision: the human raises, so calling is legal.
  const game = newGame();
  game.executeAction('human', 'raise', 3000);
  const obs = game.getLlmObservation();
  const raw = 'Here is my thinking: folding looks fine {but maybe not}.\n' +
    '{"action":"call","thought":"pot odds","speech":"I call."}';
  const decision = parseAction(raw, obs);

  assert.equal(decision.action, 'call');
  assert.equal(decision.thought, 'pot odds');
  assert.equal(decision.speech, 'I call.');
});

test('parseAction strips closed and truncated thinking blocks', () => {
  const obs = observationAt('preflop');

  const closed = '<thinking>I should check {for free}.</thinking>' +
    '{"action":"check","thought":"free card","speech":"Check."}';
  assert.equal(parseAction(closed, obs).action, 'check');

  const trailing = '{"action":"check","thought":"t","speech":"s"} <thinking>I am done';
  assert.equal(parseAction(trailing, obs).action, 'check');
});

test('parseAction returns null when the reply is cut off mid-thought', () => {
  const obs = observationAt('preflop');
  assert.equal(parseAction('Here is my thinking: 1. Analyze the input\n2. Look at the pot', obs), null);
});
