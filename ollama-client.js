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
      balanced: 'You are a disciplined, mathematically sharp poker professional. You calculate pot odds, fold weak hands facing pressure, and protect your tournament chips.',
      aggressive: 'You are an aggressive poker shark. You bet big with strong hands and bluff in position, but you know when to let go of beat hands.',
      tight: 'You are an ultra-disciplined rock. You fold marginal hands quickly, never gamble on weak high-cards, and only commit chips with solid pairs or better.',
      wild: 'You are an unpredictable high-roller gambler who loves applying pressure, but you still care about not going broke.',
      trash_talker: 'You are a clever poker shark who loves to needle the opponent while playing fundamentally sound, risk-conscious poker.'
    };

    const guide = personaGuides[persona] || personaGuides.balanced;

    return `You are playing Heads-Up No-Limit Texas Hold'em Poker against a human player.
${guide}

CORE OBJECTIVE:
Your goal is to WIN the 50,000 tournament and eliminate your opponent. YOU DEEPLY CARE ABOUT WINNING AND AVOIDING ELIMINATION. Every chip you preserve by folding is a chip you keep toward victory.

DISCIPLINED POKER PRINCIPLES (HOW WINNING PROS PLAY):
1. FOLDING IS STRATEGIC DISCIPLINE, NOT WEAKNESS:
   - Amateurs call every bet and go broke. World champions fold 50-70% of hands when facing raises without strong equity.
   - If you hold only High Card (unpaired) or a weak underpair and face a bet: FOLD! Never donate chips with weak hands.
   - If the Pot Odds require higher equity than your hand possesses: FOLD!
2. FREE CARD RULE:
   - If "check" is in VALID_ACTIONS (call cost is 0), NEVER fold! Always check to see the next card for free.
3. VALUE BETTING:
   - Only bet or raise when you hold genuine strength: Two Pair, Trips, Straight, Flush, or strong top pairs (AA/KK/QQ/AK).
4. TIME LIMIT:
   - You have up to 180 seconds to decide. Keep your output concise and immediate.
5. POKER FACE RULE:
   - In your 'speech', NEVER reveal what cards or rank you hold, whether you are bluffing, or what your hand strength is. Use psychological table talk only.

RESPONSE SCHEMA:
You MUST respond with ONLY a single valid JSON object in this exact schema:
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
    const handDesc = obs.handDescription || 'Evaluating...';
    const handRating = obs.handRating || 'Unknown';
    const strengthScore = obs.handStrengthScore !== undefined ? obs.handStrengthScore : 5;
    const callCost = obs.callAmountRequired || 0;
    const potOdds = obs.potOddsPct || '0';
    const riskPct = obs.stackRiskPct || '0';

    let strategicAdvice = '';
    if (callCost === 0) {
      strategicAdvice = 'Cost to call is 0. Check for a free look at the next card, or raise if holding a strong hand.';
    } else if (strengthScore <= 3) {
      strategicAdvice = `WARNING: You hold a WEAK hand (${handDesc}, strength ${strengthScore}/10) facing a bet of ${callCost}. Calling here has NEGATIVE expected value. FOLDING is the mathematically disciplined play!`;
    } else if (strengthScore <= 5 && Number(potOdds) > 28) {
      strategicAdvice = `Marginal holding (${handDesc}) facing steep pot odds (${potOdds}%). FOLD unless you have strong reason to suspect a pure bluff.`;
    } else if (strengthScore >= 7) {
      strategicAdvice = `STRONG HOLDING (${handDesc}, strength ${strengthScore}/10). Raise for value or call to trap.`;
    } else {
      strategicAdvice = `Playable equity (${handDesc}). Evaluate if pot odds (${potOdds}%) justify calling ${callCost}.`;
    }

    return `=== POKER SITUATION & MATHEMATICAL EQUITY ANALYSIS ===
- Stage: ${obs.gameStage.toUpperCase()}
- Dealer: ${obs.dealer.toUpperCase()} (You are ${obs.isLlmDealer ? 'DEALER / SB' : 'BIG BLIND'})
- Your Hole Cards: [${obs.llmHoleCards.join(', ')}]
- Community Board Cards: [${obs.communityCards.join(', ') || 'None (Preflop)'}]
- YOUR CURRENT HAND: ${handDesc}
- HAND RATING: ${handRating} (Strength: ${strengthScore} / 10)
- Blinds: ${obs.blinds.smallBlind} / ${obs.blinds.bigBlind} | Total Pot: ${obs.pot}
- Your Chips: ${obs.llmChips} | Opponent Chips: ${obs.humanChips}
- Current Call Cost: ${callCost} (${callCost === 0 ? 'FREE TO CHECK' : `Costs ${riskPct}% of your chips`})
- Pot Odds Needed to Call: ${potOdds}%
- VALID_ACTIONS: [${obs.validActions.join(', ')}]
- Recent Hand Actions:
${obs.recentActions.map(a => `  * ${a}`).join('\n') || '  (Opening hand)'}

STRATEGY GUIDANCE:
${strategicAdvice}

Time Limit: ${timeLimitSec} seconds. Output strict JSON only:`;
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

    // Assess hand strength using authoritative evaluation score if present
    const cards = obs.llmHoleCards || [];
    let handStrength = 0.5; // Baseline

    if (obs.handStrengthScore !== undefined) {
      handStrength = Math.min(1.0, Math.max(0.1, obs.handStrengthScore / 10));
    } else if (cards.length >= 2) {
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
