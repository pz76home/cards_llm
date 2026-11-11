// server.js - Node.js HTTP Server for Texas Hold'em vs Ollama LLM
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { TexasHoldemGame } = require('./poker-engine');
const { OllamaClient, DEFAULT_OLLAMA_URL } = require('./ollama-client');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ollamaClient = new OllamaClient(DEFAULT_OLLAMA_URL);
let currentGame = new TexasHoldemGame({ startingChips: 50000 });
let selectedModel = '';
let selectedPersona = 'balanced';

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // API: List Ollama Models
    if (req.method === 'GET' && pathname === '/api/ollama/models') {
      const customUrl = reqUrl.searchParams.get('url');
      if (customUrl) {
        ollamaClient.setBaseUrl(customUrl);
      }
      const modelInfo = await ollamaClient.listModels();
      const loaded = await ollamaClient.getLoadedModels();
      modelInfo.loadedModels = loaded;
      return sendJson(res, 200, modelInfo);
    }

    // API: Get Loaded Models in VRAM (ollama ps)
    if (req.method === 'GET' && pathname === '/api/ollama/ps') {
      const loaded = await ollamaClient.getLoadedModels();
      return sendJson(res, 200, { models: loaded });
    }

    // API: Preload Model into VRAM
    if (req.method === 'POST' && pathname === '/api/ollama/preload') {
      const body = await parseJsonBody(req);
      const model = body.model;
      const keepAlive = body.keepAlive || '2h';
      const numGpu = body.numGpu !== undefined ? Number(body.numGpu) : 999;
      const result = await ollamaClient.preloadModel(model, keepAlive, numGpu);
      const loaded = await ollamaClient.getLoadedModels();
      return sendJson(res, 200, { ...result, loadedModels: loaded });
    }

    // API: New Game (Reset stacks to 50,000, reset blinds clock)
    if (req.method === 'POST' && pathname === '/api/game/new') {
      const body = await parseJsonBody(req);
      const startingChips = Number(body.startingChips) || 50000;
      selectedModel = body.model || selectedModel;
      selectedPersona = body.persona || selectedPersona;

      currentGame = new TexasHoldemGame({ startingChips });
      currentGame.startNewHand();

      return sendJson(res, 200, {
        success: true,
        selectedModel,
        selectedPersona,
        state: currentGame.getClientState()
      });
    }

    // API: Current Game State
    if (req.method === 'GET' && pathname === '/api/game/state') {
      return sendJson(res, 200, {
        state: currentGame.getClientState()
      });
    }

    // API: Next Hand
    if (req.method === 'POST' && pathname === '/api/game/next-hand') {
      const started = currentGame.startNewHand();
      return sendJson(res, 200, {
        success: started,
        state: currentGame.getClientState()
      });
    }

    // API: Human Player Action
    if (req.method === 'POST' && pathname === '/api/game/action') {
      const body = await parseJsonBody(req);
      const { action, amount } = body;

      try {
        currentGame.executeAction('human', action, amount);
        return sendJson(res, 200, {
          success: true,
          state: currentGame.getClientState()
        });
      } catch (err) {
        return sendJson(res, 400, {
          error: err.message,
          state: currentGame.getClientState()
        });
      }
    }

    // API: Trigger LLM Turn
    if (req.method === 'POST' && pathname === '/api/game/llm-turn') {
      if (currentGame.activePlayer !== 'llm') {
        return sendJson(res, 400, {
          error: "It is not the LLM's turn",
          state: currentGame.getClientState()
        });
      }

      const body = await parseJsonBody(req);
      const model = body.model || selectedModel;
      const persona = body.persona || selectedPersona;
      const timeoutMs = Number(body.timeoutMs) || 180000; // 180 seconds decision limit default
      const keepAlive = body.keepAlive || '2h';
      const numGpu = body.numGpu !== undefined ? Number(body.numGpu) : 999;

      // Obtain observation strictly filtered for LLM fairness
      const observation = currentGame.getLlmObservation();

      // Query Ollama (or heuristic fallback)
      const decision = await ollamaClient.getAction({
        model,
        observation,
        persona,
        timeoutMs,
        keepAlive,
        numGpu
      });

      // Execute in poker engine
      try {
        currentGame.executeAction(
          'llm',
          decision.action,
          decision.amount,
          decision.thought,
          decision.speech
        );

        return sendJson(res, 200, {
          success: true,
          decision,
          state: currentGame.getClientState()
        });
      } catch (err) {
        console.error('LLM execution error:', err.message);
        // Fallback safety: if an error occurred executing LLM action, auto-fold or check
        const safeAction = observation.validActions.includes('check') ? 'check' : 'fold';
        currentGame.executeAction('llm', safeAction, 0, 'Auto-correction fallback', '...');
        return sendJson(res, 200, {
          success: true,
          corrected: true,
          state: currentGame.getClientState()
        });
      }
    }

    // Serve static files from /public
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') {
      safePath = '/index.html';
    }

    const filePath = path.join(PUBLIC_DIR, safePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Texas Hold'em vs Ollama Poker Game Running!        `);
    console.log(` Web Interface: http://localhost:${PORT}            `);
    console.log(` Ollama Target: ${ollamaClient.baseUrl}             `);
    console.log(`====================================================`);
  });
}

module.exports = server;
