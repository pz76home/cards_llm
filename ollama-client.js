// ollama-client.js - Ollama API client & Poker LLM reasoning engine

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

class OllamaClient {
  constructor(baseUrl = DEFAULT_OLLAMA_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url) {
    this.baseUrl = (url || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  }

  // Fetch list of available models from Ollama
  async listModels() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const data = await res.json();
      const models = (data.models || []).map(m => ({
        name: m.name,
        displayName: m.name,
        size: m.size ? `${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB` : '',
        modified: m.modified_at || ''
      }));

      return {
        online: true,
        url: this.baseUrl,
        models: models
      };
    } catch (err) {
      return {
        online: false,
        url: this.baseUrl,
        error: err.message,
        models: []
      };
    }
  }

  // Fetch list of running models currently loaded in VRAM/RAM
  async getLoadedModels() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${this.baseUrl}/api/ps`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) return [];
      const data = await res.json();
      return (data.models || []).map(m => ({
        name: m.name,
        model: m.model,
        sizeVram: m.size_vram ? `${(m.size_vram / 1024 / 1024 / 1024).toFixed(1)} GB` : '',
        size: m.size ? `${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB` : '',
        expiresAt: m.expires_at || ''
      }));
    } catch {
      return [];
    }
  }

  // Preload a model into VRAM ahead of time (independent warmup timeout)
  async preloadModel(model, keepAlive = '2h', numGpu = 999) {
    if (!model || model === 'builtin-heuristic') {
      return { success: true, message: 'Built-in bot requires no VRAM' };
    }

    try {
      console.log(`[OllamaClient] Preloading model '${model}' into memory (keep_alive: ${keepAlive}, num_gpu: ${numGpu})...`);
      const controller = new AbortController();
      // Generous 5-minute timeout for preloading large 30B-70B models
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          keep_alive: keepAlive,
          options: {
            num_gpu: Number(numGpu) || 999
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Ollama returned status ${res.status}`);
      }
      return { success: true, message: `Model ${model} loaded into memory` };
    } catch (err) {
      console.warn(`[OllamaClient] Preload failed for ${model}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Generate poker move from Ollama with strict 180-second decision limit
  async getAction({
    model,
    observation,
    persona = 'balanced',
    timeoutMs = 180000, // 180 seconds turn decision limit (distinct from VRAM warm up)
    keepAlive = '2h',
    numGpu = 999
  }) {
    if (!model || model === 'builtin-heuristic') {
      return this.heuristicAiMove(observation, persona);
    }

    const systemPrompt = this.buildSystemPrompt(persona);
    const userPrompt = this.buildUserPrompt(observation, timeoutMs);

    try {
      console.log(`[OllamaClient] Turn decision for '${model}': ${Math.round(timeoutMs / 1000)}s limit, num_gpu: ${numGpu}...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          stream: false,
          keep_alive: keepAlive,
          options: {
            temperature: persona === 'wild' ? 0.85 : 0.4,
            top_p: 0.9,
            num_gpu: Number(numGpu) || 999,
            num_predict: 150 // Keep response crisp and fast
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`);
      }

      const data = await response.json();
      const rawText = data.response || '';
      console.log(`[OllamaClient] Move decision received from '${model}' within time limit.`);
      const parsed = this.parseLlmResponse(rawText, observation);
      return parsed;
    } catch (err) {
      console.warn(`[OllamaClient] Error querying ${model}:`, err.message, '- Falling back to Heuristic AI');
      const fallback = this.heuristicAiMove(observation, persona);
      fallback.speech = `(Ollama turn time note: ${err.message}) ${fallback.speech}`;
      return fallback;
    }
  }

  buildSystemPrompt(persona) {
    const personaGuides = {
      balanced: 'You are a balanced, sharp poker professional. You calculate pot odds, mix up your bets, and rarely make blunders.',
      aggressive: 'You are an aggressive poker shark. You love to put maximum pressure on your opponent with big bets, raises, and frequent bluffs.',
      tight: 'You are an ultra-disciplined rock. You fold weak hands quickly, check to control the pot, and only bet big with monsters.',
      wild: 'You are an erratic, unpredictable high-roller gambler. You love shoving all-in, making crazy calls, and trash-talking.',
      trash_talker: 'You are a sarcastic casino regular who constantly banters and teases your opponent with clever poker remarks.'
    };

    const guide = personaGuides[persona] || personaGuides.balanced;

    return `You are playing Heads-Up No-Limit Texas Hold'em Poker against a human player.
${guide}

CRITICAL RULES:
1. You only know your own 2 hole cards and the public board cards. You do NOT know the deck or opponent's cards.
2. You must choose an action strictly from the provided "VALID_ACTIONS" list.
3. If "check" is not in VALID_ACTIONS, you CANNOT check. You must call, raise, or fold.
4. If choosing "raise", specify the total amount to bet (must be >= min_raise and <= your remaining chips).
5. If choosing "give_up", you surrender the entire match. Only choose this if you genuinely want to resign.
6. TIME LIMIT: You have up to 180 seconds to decide your move. Keep your JSON response immediate, concise, and focused.
7. POKER FACE RULE: In your 'speech', NEVER reveal your cards, your hand rank, your equity, or whether you are bluffing. Act like a real poker player keeping a stone poker face! Only use banter, teasing, psychological pressure, or general table comments.
8. You MUST respond with ONLY a single valid JSON object in this exact schema:
{
  "action": "fold" | "check" | "call" | "raise" | "all-in" | "give_up",
  "amount": <number, required only for raise>,
  "thought": "<brief inner poker reasoning in 1-2 sentences>",
  "speech": "<brief poker banter or dialogue to the human player in 1 sentence>"
}
Do not write explanations outside the JSON object.`;
  }

  buildUserPrompt(obs, timeoutMs = 180000) {
    const timeLimitSec = Math.round(timeoutMs / 1000);
    return `=== POKER SITUATION ===
- Stage: ${obs.gameStage.toUpperCase()}
- Dealer: ${obs.dealer.toUpperCase()} (You are ${obs.isLlmDealer ? 'DEALER / SB' : 'BIG BLIND'})
- Blinds: ${obs.blinds.smallBlind} / ${obs.blinds.bigBlind}
- Pot Size: ${obs.pot}
- Your Chips: ${obs.llmChips}
- Human Chips: ${obs.humanChips}
- Your Current Bet: ${obs.llmCurrentBet}
- Human Current Bet: ${obs.humanCurrentBet}
- Amount Needed to Call: ${obs.callAmountRequired}
- Your Hole Cards: [${obs.llmHoleCards.join(', ')}]
- Community Board Cards: [${obs.communityCards.join(', ')}]
- VALID_ACTIONS: [${obs.validActions.join(', ')}]
- Recent Hand Actions:
${obs.recentActions.map(a => `  * ${a}`).join('\n') || '  (Opening hand)'}

Time Limit: You have ${timeLimitSec} seconds for this decision. Choose your move now. Output strict JSON only:`;
  }

  parseLlmResponse(rawText, obs) {
    let clean = rawText.trim();
    // Strip markdown code fences if present
    clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();

    let parsed = null;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Try to find first JSON object in text
      const match = clean.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {}
      }
    }

    if (!parsed || typeof parsed !== 'object') {
      return this.heuristicAiMove(obs, 'balanced');
    }

    let action = (parsed.action || '').toLowerCase().trim();
    let amount = Number(parsed.amount) || 0;
    const thought = parsed.thought || 'Calculating pot equity...';
    const speech = parsed.speech || 'Let us see what happens.';

    // Validate action against allowed validActions
    const valid = obs.validActions || ['fold', 'check', 'call'];

    if (!valid.includes(action)) {
      if (action === 'bet' && valid.includes('raise')) action = 'raise';
      else if (valid.includes('check') && obs.callAmountRequired === 0) action = 'check';
      else if (valid.includes('call')) action = 'call';
      else if (valid.includes('fold')) action = 'fold';
      else action = valid[0];
    }

    // Bounds checking for raise
    if (action === 'raise') {
      const minRaise = Math.max(obs.humanCurrentBet * 2, obs.humanCurrentBet + obs.blinds.bigBlind);
      if (amount < minRaise) amount = minRaise;
      if (amount > obs.llmChips) amount = obs.llmChips;
    }

    return {
      action,
      amount,
      thought,
      speech
    };
  }

  // Built-in intelligent Heuristic AI fallback (plays very realistically)
  heuristicAiMove(obs, persona = 'balanced') {
    const valid = obs.validActions || [];
    const callCost = obs.callAmountRequired || 0;
    const pot = obs.pot || 1;
    const myChips = obs.llmChips || 50000;
    const potOdds = callCost / (pot + callCost);

    // Assess preflop hole cards
    const cards = obs.llmHoleCards || [];
    let handStrength = 0.5; // Baseline

    if (cards.length >= 2) {
      const r1 = this.rankToVal(cards[0]);
      const r2 = this.rankToVal(cards[1]);
      const isPair = r1 === r2;
      const isSuited = cards[0].slice(-1) === cards[1].slice(-1);
      const highRank = Math.max(r1, r2);

      if (isPair) {
        handStrength = highRank >= 10 ? 0.95 : 0.75;
      } else if (highRank >= 12) {
        handStrength = isSuited ? 0.8 : 0.65;
      } else if (isSuited) {
        handStrength = 0.55;
      } else {
        handStrength = 0.35 + (highRank / 28);
      }
    }

    // Persona modifiers
    let aggro = 0;
    if (persona === 'aggressive') aggro = 0.2;
    if (persona === 'wild') aggro = 0.35;
    if (persona === 'tight') aggro = -0.2;

    const effectiveStrength = Math.min(1.0, Math.max(0.1, handStrength + aggro + (Math.random() * 0.15 - 0.075)));

    let action = 'check';
    let amount = 0;
    let thought = '';
    let speech = '';

    if (effectiveStrength > 0.85 && valid.includes('raise') && myChips > callCost * 2) {
      action = 'raise';
      const raiseSize = Math.min(myChips, Math.max(obs.blinds.bigBlind * 3, Math.floor(pot * 0.75)));
      amount = raiseSize;
      thought = `Strong holding (${effectiveStrength.toFixed(2)} equity). Value raising.`;
      speech = persona === 'wild' ? "I'm pushing you hard on this one!" : "Let's make this more interesting.";
    } else if (callCost > 0) {
      // Facing a bet
      if (effectiveStrength > 0.45 || (potOdds < 0.25 && effectiveStrength > 0.3)) {
        action = 'call';
        thought = `Decent pot odds (${(potOdds * 100).toFixed(0)}%) with moderate strength. Calling ${callCost}.`;
        speech = "I'll call that bet.";
      } else if (valid.includes('check')) {
        action = 'check';
        thought = 'Free card available. Checking.';
        speech = 'I check.';
      } else {
        action = 'fold';
        thought = `Weak hand (${effectiveStrength.toFixed(2)}) facing steep bet. Folding.`;
        speech = "Not this time. I fold.";
      }
    } else {
      // No bet to call
      if (effectiveStrength > 0.65 && valid.includes('raise')) {
        action = 'raise';
        amount = Math.min(myChips, Math.max(obs.blinds.bigBlind * 2, Math.floor(pot * 0.5)));
        thought = `Leading out with a bet to seize initiative.`;
        speech = `Betting ${amount}. Ball is in your court.`;
      } else if (valid.includes('check')) {
        action = 'check';
        thought = 'Pot control with medium strength. Checking.';
        speech = 'Check to you.';
      } else {
        action = valid[0] || 'fold';
      }
    }

    return { action, amount, thought, speech };
  }

  rankToVal(cardStr) {
    if (!cardStr) return 2;
    const r = cardStr.slice(0, -1).toUpperCase();
    if (r === 'A') return 14;
    if (r === 'K') return 13;
    if (r === 'Q') return 12;
    if (r === 'J') return 11;
    if (r === 'T' || r === '10') return 10;
    return parseInt(r, 10) || 2;
  }
}

module.exports = {
  OllamaClient,
  DEFAULT_OLLAMA_URL
};
