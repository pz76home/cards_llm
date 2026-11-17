// parse.js - Turn raw model text into a legal poker action.

const { normalizeAction } = require('../../engine/betting');

// Returns null when the text cannot be parsed, so the caller can decide which
// fallback policy to use.
function parseAction(rawText, observation) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  let clean = rawText.trim();
  // Strip markdown code fences if present.
  clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();

  let parsed = null;
  try {
    parsed = JSON.parse(clean);
  } catch {
    // Try to find first JSON object in text.
    const match = clean.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {}
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const thought = parsed.thought || 'Calculating pot equity...';
  const speech = parsed.speech || 'Let us see what happens.';

  // Single shared coercion: unknown actions fall back to a legal one and
  // raise amounts are clamped to the engine's real min/max bounds.
  const legalActions = Array.isArray(observation.legalActions) && observation.legalActions.length
    ? observation.legalActions
    : (observation.validActions || ['fold', 'check', 'call']).map(type => ({ type }));
  const { type: action, amount } = normalizeAction(parsed, legalActions);

  return {
    action,
    amount,
    thought,
    speech
  };
}

module.exports = { parseAction };
