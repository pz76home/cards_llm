// prompts.js - Persona guides and prompt templates for the Ollama opponent.

const DEFAULT_DECISION_TIMEOUT_MS = 180000;

const PERSONA_GUIDES = {
  balanced: 'You are a disciplined, mathematically sharp poker professional. You calculate pot odds, fold weak hands facing pressure, and protect your tournament chips.',
  aggressive: 'You are an aggressive poker shark. You bet big with strong hands and bluff in position, but you know when to let go of beat hands.',
  tight: 'You are an ultra-disciplined rock. You fold marginal hands quickly, never gamble on weak high-cards, and only commit chips with solid pairs or better.',
  wild: 'You are an unpredictable high-roller gambler who loves applying pressure, but you still care about not going broke.',
  trash_talker: 'You are a clever poker shark who loves to needle the opponent while playing fundamentally sound, risk-conscious poker.'
};

function buildSystemPrompt(persona, observation = null) {
  const guide = PERSONA_GUIDES[persona] || PERSONA_GUIDES.balanced;

  // Only advertise actions that are actually legal right now.
  const legalTypes = (observation && Array.isArray(observation.validActions) && observation.validActions.length)
    ? observation.validActions
    : ['fold', 'check', 'call', 'raise', 'all-in'];
  const actionEnum = legalTypes
    .filter(type => type !== 'give_up')
    .map(type => `"${type}"`)
    .join(' | ');

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
  "action": ${actionEnum},
  "amount": <number, required only for raise, within the legal raise range>,
  "thought": "<brief inner poker reasoning in 1-2 sentences>",
  "speech": "<brief poker banter or dialogue to the human player in 1 sentence>"
}
Do not write explanations outside the JSON object.`;
}

function buildUserPrompt(obs, timeoutMs = DEFAULT_DECISION_TIMEOUT_MS) {
  const timeLimitSec = Math.round(timeoutMs / 1000);
  const handDesc = obs.handDescription || 'Evaluating...';
  const handRating = obs.handRating || 'Unknown';
  const strengthScore = obs.handStrengthScore !== undefined ? obs.handStrengthScore : 5;
  const callCost = obs.callAmountRequired || 0;
  const potOdds = obs.potOddsPct || '0';
  const riskPct = obs.stackRiskPct || '0';
  const raiseRange = obs.raiseMin !== null && obs.raiseMin !== undefined
    ? `${obs.raiseMin} - ${obs.raiseMax}`
    : 'Not available this turn';

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
- LEGAL_RAISE_RANGE (chips added): ${raiseRange}
- VALID_ACTIONS: [${obs.validActions.join(', ')}]
- Recent Hand Actions:
${obs.recentActions.map(a => `  * ${a}`).join('\n') || '  (Opening hand)'}

STRATEGY GUIDANCE:
${strategicAdvice}

Time Limit: ${timeLimitSec} seconds. Output strict JSON only:`;
}

module.exports = {
  DEFAULT_DECISION_TIMEOUT_MS,
  PERSONA_GUIDES,
  buildSystemPrompt,
  buildUserPrompt
};
