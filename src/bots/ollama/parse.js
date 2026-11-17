// parse.js - Turn raw model text into a legal poker action.

const { normalizeAction } = require('../../engine/betting');

// Reasoning models sometimes emit a visible scratchpad wrapped in  thinking tags.
// A reply truncated mid-thought leaves the opening tag without a closing one, so
// the block is dropped to end-of-text in that case.
const THINKING_BLOCK = /<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi;

// Collect every balanced {...} object in the text, in order. Brace counting
// respects string literals and escapes so braces inside thought/speech are safe.
function findJsonObjects(text) {
  const candidates = [];

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          start = i; // Skip the nested opening braces we just consumed.
          break;
        }
      }
    }
  }

  return candidates;
}

function tryParseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Returns null when the text cannot be parsed, so the caller can decide which
// fallback policy to use.
function parseAction(rawText, observation) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;

  let clean = rawText.replace(THINKING_BLOCK, ' ').trim();
  // Strip markdown code fences if present.
  clean = clean.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, '$1').trim();

  let parsed = tryParseObject(clean);
  if (!parsed) {
    // Prefer the last object: any preamble may itself contain brace-y prose.
    const candidates = findJsonObjects(clean);
    for (let i = candidates.length - 1; i >= 0 && !parsed; i--) {
      parsed = tryParseObject(candidates[i]);
    }
  }

  if (!parsed) return null;

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
