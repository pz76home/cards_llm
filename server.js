// server.js - Node.js HTTP Server for Texas Hold'em vs Ollama LLM
const http = require('http');
const fs = require('fs');
const path = require('path');
const { TexasHoldemGame } = require('./poker-engine');
const { OllamaTransport, DEFAULT_OLLAMA_URL } = require('./src/bots/ollama/transport');
const { createBot } = require('./src/bots');
const { TurnManager, TurnPendingError } = require('./src/turns');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ollamaTransport = new OllamaTransport(DEFAULT_OLLAMA_URL);
const turnManager = new TurnManager();

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

// Map a TurnManager result onto an HTTP response body.
function sendTurnResult(res, game, result) {
  const state = result.state || game.getClientState();

  if (result.failed) {
    return sendJson(res, 500, { success: false, error: result.error, state });
  }

  return sendJson(res, 200, {
    success: true,
    cancelled: Boolean(result.cancelled),
    stale: Boolean(result.stale),
    corrected: Boolean(result.corrected),
    decision: result.decision,
    turnId: game.turnId,
    state
  });
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
        ollamaTransport.setBaseUrl(customUrl);
      }
      const modelInfo = await ollamaTransport.listModels();
      const loaded = await ollamaTransport.getLoadedModels();
      modelInfo.loadedModels = loaded;
      return sendJson(res, 200, modelInfo);
    }

    // API: Get Loaded Models in VRAM (ollama ps)
    if (req.method === 'GET' && pathname === '/api/ollama/ps') {
      const loaded = await ollamaTransport.getLoadedModels();
      return sendJson(res, 200, { models: loaded });
    }

    // API: Preload Model into VRAM
    if (req.method === 'POST' && pathname === '/api/ollama/preload') {
      const body = await parseJsonBody(req);
      const model = body.model;
      const keepAlive = body.keepAlive || '2h';
      const numGpu = body.numGpu !== undefined ? Number(body.numGpu) : 999;
      const result = await ollamaTransport.preloadModel(model, keepAlive, numGpu);
      const loaded = await ollamaTransport.getLoadedModels();
      return sendJson(res, 200, { ...result, loadedModels: loaded });
    }

    // API: New Game (Reset stacks to 50,000, reset blinds clock)
    if (req.method === 'POST' && pathname === '/api/game/new') {
      const body = await parseJsonBody(req);
      const startingChips = Number(body.startingChips) || 50000;
      selectedModel = body.model || selectedModel;
      selectedPersona = body.persona || selectedPersona;

      // Any request still in flight belongs to the old game.
      turnManager.abortPending();

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
      turnManager.abortPending();
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

    // API: Cancel a pending LLM turn and play the quick bot immediately
    if (req.method === 'POST' && pathname === '/api/game/llm-turn/cancel') {
      const result = turnManager.cancel(currentGame);
      return sendJson(res, 200, {
        success: true,
        cancelled: result.cancelled,
        decision: result.decision,
        state: result.state
      });
    }

    // API: Trigger LLM Turn
    if (req.method === 'POST' && pathname === '/api/game/llm-turn') {
      const game = currentGame;

      if (turnManager.isPending()) {
        return sendJson(res, 409, {
          error: 'An LLM turn is already in progress',
          state: game.getClientState()
        });
      }

      if (game.activePlayer !== 'llm') {
        return sendJson(res, 400, {
          error: "It is not the LLM's turn",
          state: game.getClientState()
        });
      }

      const body = await parseJsonBody(req);
      const model = body.model || selectedModel;
      const persona = body.persona || selectedPersona;
      const timeoutMs = Number(body.timeoutMs) || 180000; // 180 seconds decision limit default
      const keepAlive = body.keepAlive || '2h';
      const numGpu = body.numGpu !== undefined ? Number(body.numGpu) : 999;

      const bot = createBot({ model, transport: ollamaTransport });

      try {
        const result = await turnManager.start(game, bot, {
          persona,
          timeoutMs,
          keepAlive,
          numGpu
        });
        return sendTurnResult(res, game, result);
      } catch (err) {
        if (err instanceof TurnPendingError) {
          return sendJson(res, 409, {
            error: err.message,
            state: game.getClientState()
          });
        }
        if (/not the LLM's turn/i.test(err.message)) {
          return sendJson(res, 400, {
            error: err.message,
            state: game.getClientState()
          });
        }
        console.error('LLM turn failed:', err);
        return sendJson(res, 500, {
          error: err.message,
          state: game.getClientState()
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
  // A second copy must fail with a readable message, not a stack trace.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('====================================================');
      console.error(` Texas Poker is already running on port ${PORT}.   `);
      console.error('                                                    ');
      console.error(` Open http://localhost:${PORT}                      `);
      console.error(' or stop the other server, then start this one.     ');
      console.error('====================================================');
      process.exit(1);
    }

    if (err.code === 'EACCES') {
      console.error(`Port ${PORT} is not available (permission denied). Try another port: PORT=3001 node server.js`);
      process.exit(1);
    }

    console.error('Server failed to start:', err.message);
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` Texas Hold'em vs Ollama Poker Game Running!        `);
    console.log(` Web Interface: http://localhost:${PORT}            `);
    console.log(` Ollama Target: ${ollamaTransport.baseUrl}             `);
    console.log(`====================================================`);
  });
}

module.exports = server;
