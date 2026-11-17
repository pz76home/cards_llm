# AGENT.md — Engineering Guide & Phase Log

This file is for anyone — human or AI agent — changing this repository. It
records the architecture, the invariants that must never regress, and exactly
what each refactor phase changed.

---

## 1. Project constraints

- **Zero npm dependencies.** No build step, no bundler, no TypeScript.
- **`node server.js` must always work.** Nothing may require a compile step.
- **Tests:** `npm test` (runs `node --test`). Every behavioural change needs a
  test in `test/`.
- **Node 24+** is assumed: the bot transport uses `AbortSignal.any()` and
  `AbortSignal.timeout()`.

---

## 2. Architecture map

```
poker-engine.js              Game rules, deck, 7-card evaluator, client state
ollama-client.js             Legacy facade over src/bots (do not extend it)
server.js                    Zero-dependency HTTP API + static file server
public/                      Vanilla HTML/CSS/JS client
src/engine/betting.js        Single source of truth for betting legality
src/bots/heuristic.js        Built-in rule-based bot
src/bots/ollama/transport.js HTTP to Ollama only (no poker knowledge)
src/bots/ollama/prompts.js   Persona guides + prompt templates
src/bots/ollama/parse.js     Model text -> legal action
src/bots/ollama/index.js     OllamaBot (composes transport/prompts/parse)
src/bots/index.js            createBot() factory
src/turns.js                 Single-flight LLM turn manager
```

### Bot contract

```js
bot.getAction(observation, {
  persona, timeoutMs, keepAlive, numGpu, signal
}) -> { action, amount, thought, speech }   // action is already legal
```

- `createBot({ model, transport })` returns `HeuristicBot` for
  `builtin-heuristic`, an empty model, or a missing transport; otherwise
  `OllamaBot`.
- All bots must derive legality from `observation.legalActions` /
  `observation.raiseMin` / `observation.raiseMax`. Never re-derive poker rules
  inside a bot.

---

## 3. Invariants (do not regress)

1. **Chip conservation.** At every point
   `humanChips + llmChips + pot === 2 * startingChips`. `settleHand()` is the
   only terminal path for a hand; it refunds uncalled chips, pays the pot and
   zeroes `pot`/bets. Never pay a pot by calling `addChips()` directly.
2. **Redaction.** LLM hole cards and thoughts are gated on `showdownReached`,
   not `stage === 'showdown'`, because a fold also ends in the showdown stage
   without comparing hands. A match-ending `give_up` may reveal.
3. **One betting truth.** `src/engine/betting.js` owns call amounts, raise
   bounds and legal actions. `TexasHoldemGame.getValidActions()` delegates to
   it; the LLM observation, prompts and bot output coercion all read the same
   data.
4. **`give_up` is human-only.** It is excluded from the LLM observation and
   schema; `normalizeAction` maps a model that asks for it onto a legal action.
5. **Exactly one action per LLM turn.** `TurnManager` enforces single-flight,
   a monotonic `game.turnId` rejects stale results, and `token.aborted` blocks
   a late resolution after a cancel.
6. **External abort is not a timeout.** `OllamaBot` rethrows a caller abort; it
   only falls back to the heuristic on timeout, HTTP or parse failure (and
   annotates the speech with `(Ollama turn time note: ...)`).
7. **Settled pot reads 0.** After a hand, `pot` is `0` and `lastPotWon` carries
   the amount the banner should report.

---

## 4. Phase log

### Phase 0 — Test safety net (commit `c787c1e`)

Added the first automated suite and wired `npm test` to `node --test`.

| File | Covers |
| --- | --- |
| `test/evaluator.test.js` | every hand category, wheel/steel wheel, best-of-seven, kickers, ties |
| `test/blinds.test.js` | level boundaries (0 / 599 / 600 / 1200 / 1800 s) and the 2,500 cap |
| `test/game.test.js` | blinds, heads-up turn order, BB option, check-down, fold refunds, all-in runout, dealer alternation, resign, illegal actions |
| `test/invariants.test.js` | seeded chip-conservation fuzz (3 seeds, up to 5,000 actions each) |
| `test/redaction.test.js` | cards/thoughts hidden through live hands and folds, revealed at a real showdown |

### Phase 1 — One betting truth + settlement fixes (commit `c787c1e`)

- **New `src/engine/betting.js`**: `getCallAmount`, `getRaiseBounds`,
  `getLegalActions`, `normalizeAction`, plus player/bet/chip helpers.
- **`poker-engine.js`**
  - `getValidActions()` now delegates to the shared module.
  - New `settleHand(winner, { showdown })` used by fold, showdown and give-up.
  - New `showdownReached` / `lastPotWon` in client state; folding no longer
    reveals the LLM hand.
  - `getLlmObservation()` now returns `legalActions`, `raiseMin`, `raiseMax`,
    and never offers `give_up`.
- **`ollama-client.js`** (pre-Phase 3): prompt enum generated from legal
  actions, `LEGAL_RAISE_RANGE` added, `normalizeAction` used for parsing, the
  incorrect `humanCurrentBet * 2` raise clamp deleted.
- **`test/betting.test.js`** added.
- Verification: 35/35 tests, a 100-seed stress fuzz (489 hands / 1,178
  actions, no conservation violations) and a live server smoke.

### Phase 2 — Not implemented on this branch

No code was written under this number. After Phase 1 the work moved directly to
Phase 3 by agreement; Phase 1's verification (100-seed fuzz and live smoke) was
the only additional work done in between. This section stays as a placeholder so
phase numbering remains stable — fill it in if a Phase 2 scope is picked up.

### Phase 3 — Bot abstraction + race-free turns (this change)

**Goal:** make Ollama and the built-in bot interchangeable behind one interface,
and make it structurally impossible for one LLM turn to execute twice.

- **New `src/bots/**`**
  - `heuristic.js` — `HeuristicBot`; honours the engine's raise bounds.
  - `ollama/transport.js` — HTTP only; composable abort + timeout signals;
    classifies `TimeoutError`, external abort and HTTP failures.
  - `ollama/prompts.js` — persona guides and prompt builders (enum generated
    from `validActions`).
  - `ollama/parse.js` — plain/fenced/embedded JSON -> `normalizeAction`; `null`
    on junk so the caller chooses a fallback policy.
  - `ollama/index.js` — `OllamaBot` with heuristic fallback; rethrows external
    aborts.
  - `index.js` — `createBot()` factory.
- **New `src/turns.js`** — `TurnManager`, `TurnPendingError`.
  - `start(game, bot, options)` is single-flight.
  - `cancel(game)` aborts the request and applies the heuristic **once**.
  - `abortPending()` is used when the whole game resets.
  - Results: `{ decision, state }`, `{ cancelled, state }`, `{ stale, state }`,
    `{ corrected, decision, state }`, `{ failed, error, state }`.
- **`poker-engine.js`** — monotonic `turnId`, bumped in `startNewHand()` and at
  the top of `executeAction()`.
- **`server.js`**
  - Uses `OllamaTransport` + `createBot` + `TurnManager`; no longer imports
    `OllamaClient`.
  - **`POST /api/game/llm-turn`** returns `409` when a turn is pending, and
    includes `turnId`, `cancelled`, `stale`, `corrected` in its response.
  - **`POST /api/game/llm-turn/cancel`** (new) cancels and plays the quick bot.
  - New game / next hand abort any pending turn.
- **`public/app.js`**
  - Skip Wait calls `/api/game/llm-turn/cancel`; it no longer issues a second
    `llm-turn` (the old double-execution path).
  - Client `AbortController` per turn; only one request in flight.
  - `cancelled` / `stale` responses are ignored; non-OK responses do not
    advance the game.
- **`ollama-client.js`** — now a thin compatibility facade (same public
  methods, `DEFAULT_OLLAMA_URL` re-exported). New code must import
  `src/bots/**` directly.
- **New tests**
  - `test/bots.test.js` — factory selection, heuristic legality on every
    street, OllamaBot plain/fenced JSON, out-of-range raise clamping, garbage
    fallback, `give_up` coercion, timeout fallback annotation, external-abort
    rethrow, facade compatibility.
  - `test/turns.test.js` — single-flight rejection, cancel applies exactly one
    action and discards the late reply, idle cancel no-op, timeout fallback,
    `abortPending`, stale `turnId`, auto-correction, engine `turnId` bumps.
- Verification: 52/52 tests; live smoke against a fake slow Ollama (409 on
  concurrent calls, cancel, late reply ignored, timeout annotation, chips
  conserved); real browser run where Skip Wait resolved in 26 ms with exactly
  one action and no double advance.

---

## 5. API surface

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/ollama/models` | optional `?url=` switches the shared transport base URL |
| GET | `/api/ollama/ps` | models currently loaded in VRAM |
| POST | `/api/ollama/preload` | warm a model (`model`, `keepAlive`, `numGpu`) |
| POST | `/api/game/new` | reset stacks, abort pending turn |
| GET | `/api/game/state` | redacted client state |
| POST | `/api/game/next-hand` | abort pending turn, deal again |
| POST | `/api/game/action` | human action (`action`, `amount`) |
| POST | `/api/game/llm-turn` | run one LLM turn; `409` if one is pending |
| POST | `/api/game/llm-turn/cancel` | abort + apply quick bot immediately |

`llm-turn` result flags:

| Flag | Meaning |
| --- | --- |
| `cancelled` | a cancel/abort won; this handler applied nothing |
| `stale` | `turnId` changed while the model was thinking; result discarded |
| `corrected` | the model's move was rejected by the engine and replaced safely |
| `failed` | no legal action could be applied (HTTP 500) |

---

## 6. Turn race rules

| Situation | Behaviour |
| --- | --- |
| Second `/llm-turn` while one is pending | `409`, no state change |
| `/cancel` while pending | abort request, apply `HeuristicBot` once |
| Aborted request resolves later | `{ cancelled: true }`, no mutation |
| Game advanced during a turn | `{ stale: true }`, no mutation |
| Ollama timeout / HTTP error | heuristic fallback, annotated speech |
| Caller aborts the request | rethrow; never fall back silently |

---

## 7. Testing and verification

```bash
npm test                 # unit + property tests, no network
node server.js           # manual play at http://localhost:3000
```

- Network paths are tested with fake transports; no test may require Ollama.
- For UI or race changes, also run the live smoke: start the server, point the
  shared transport at a deliberately slow fake Ollama, then verify `409`,
  cancel latency, a single history entry, unchanged pot after the late reply,
  and chip conservation.
- Any new terminal hand path must go through `settleHand()` and be added to the
  fuzz/invariant expectations.

---

## 8. Adding a bot

1. Create a class with the `getAction` contract above; return a legal action.
2. Register it in `src/bots/index.js` (`createBot`).
3. Add unit tests with a fake transport / deterministic fallback in
   `test/bots.test.js`.
4. Do not add poker math to the bot — extend `src/engine/betting.js` instead.

## 9. Known deferred work

- Server-driven turns (the action endpoint internally playing the LLM turn)
  were intentionally deferred; the client still drives `/llm-turn`.
- There is one global `TurnManager`, matching the single global game; multiple
  concurrent games will need per-game managers.
