// transport.js - HTTP transport for a local Ollama server.
// Knows nothing about poker: no prompts, no action parsing, no fallbacks.

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const MODEL_LIST_TIMEOUT_MS = 3500;
const PRELOAD_TIMEOUT_MS = 300000;

function normalizeUrl(url) {
  return (url || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
}

function isTimeoutError(err) {
  return Boolean(err) && err.name === 'TimeoutError';
}

// True when the caller's own signal aborted the request (user skip, new game),
// as opposed to an Ollama timeout or a plain network failure.
function isExternalAbort(err, signal) {
  if (!signal || !signal.aborted) return false;
  if (isTimeoutError(signal.reason) || isTimeoutError(err)) return false;
  return true;
}

class OllamaTransport {
  constructor(baseUrl = DEFAULT_OLLAMA_URL) {
    this.baseUrl = normalizeUrl(baseUrl);
  }

  setBaseUrl(url) {
    this.baseUrl = normalizeUrl(url);
  }

  async listModels() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
      });

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
        models
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

  async getLoadedModels() {
    try {
      const res = await fetch(`${this.baseUrl}/api/ps`, {
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
      });

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

  // Warm a model into VRAM/RAM ahead of time.
  async preloadModel(model, keepAlive = '2h', numGpu = 999) {
    if (!model || model === 'builtin-heuristic') {
      return { success: true, message: 'Built-in bot requires no VRAM' };
    }

    try {
      console.log(`[OllamaTransport] Preloading model '${model}' (keep_alive: ${keepAlive}, num_gpu: ${numGpu})...`);

      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          keep_alive: keepAlive,
          options: {
            num_gpu: Number(numGpu) || 999
          }
        }),
        signal: AbortSignal.timeout(PRELOAD_TIMEOUT_MS)
      });

      if (!res.ok) {
        throw new Error(`Ollama returned status ${res.status}`);
      }
      return { success: true, message: `Model ${model} loaded into memory` };
    } catch (err) {
      console.warn(`[OllamaTransport] Preload failed for ${model}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // Single non-streaming generation call. `signal` lets a turn manager cancel
  // it; the timeout is composed with that signal.
  async generateText({
    model,
    prompt,
    keepAlive = '2h',
    numGpu = 999,
    temperature = 0.4,
    topP = 0.9,
    numPredict = 150,
    timeoutMs = 180000,
    signal
  }) {
    const timeoutSignal = AbortSignal.timeout(Math.max(1, Number(timeoutMs) || 180000));
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        keep_alive: keepAlive,
        options: {
          temperature,
          top_p: topP,
          num_gpu: Number(numGpu) || 999,
          num_predict: numPredict
        }
      }),
      signal: combined
    });

    if (!res.ok) {
      const err = new Error(`Ollama returned status ${res.status}`);
      err.name = 'OllamaHttpError';
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return data.response || '';
  }
}

module.exports = {
  OllamaTransport,
  DEFAULT_OLLAMA_URL,
  isTimeoutError,
  isExternalAbort
};
