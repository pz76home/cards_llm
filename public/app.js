// app.js - Texas Hold'em vs Ollama Frontend Application

// State variables
let gameState = null;
let currentBlinds = null;
let timerInterval = null;
let isSoundEnabled = true;
let isRequestPending = false;
let customOllamaUrl = 'http://127.0.0.1:11434';
let configuredTimeout = 180000; // 180 seconds (3 mins) decision limit
let configuredKeepAlive = '2h';
let configuredNumGpu = 999;
let configuredNumParallel = 1;
let configuredFlashAttention = 1;
let loadedModelsInVram = [];
let llmThinkingTimer = null;
let llmThinkingSeconds = 0;
let isPreloading = false;
let isLlmAbortRequested = false;

// Web Audio API Sound Synthesizer
class SoundEffects {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  playChip() {
    if (!isSoundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800 + Math.random() * 200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playCard() {
    if (!isSoundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 0.06;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    noise.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
  }

  playCheck() {
    if (!isSoundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playWin() {
    if (!isSoundEnabled) return;
    this.init();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major arpeggio
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.1);
      gain.gain.setValueAtTime(0.25, this.ctx.currentTime + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.1 + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + idx * 0.1);
      osc.stop(this.ctx.currentTime + idx * 0.1 + 0.3);
    });
  }
}

const sounds = new SoundEffects();

// DOM elements
const blindsDisplay = document.getElementById('blindsDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const timerLabel = document.getElementById('timerLabel');
const blindCappedBadge = document.getElementById('blindCappedBadge');
const handNumberBadge = document.getElementById('handNumberBadge');
const modelSelect = document.getElementById('modelSelect');
const personaSelect = document.getElementById('personaSelect');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const ollamaStatusPill = document.getElementById('ollamaStatusPill');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const logToggleBtn = document.getElementById('logToggleBtn');
const logDrawer = document.getElementById('logDrawer');
const closeLogBtn = document.getElementById('closeLogBtn');
const logList = document.getElementById('logList');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const ollamaUrlInput = document.getElementById('ollamaUrlInput');
const timeoutSelect = document.getElementById('timeoutSelect');
const keepAliveSelect = document.getElementById('keepAliveSelect');
const numGpuInput = document.getElementById('numGpuInput');
const numParallelInput = document.getElementById('numParallelInput');
const flashAttentionSelect = document.getElementById('flashAttentionSelect');
const vramStatusBadge = document.getElementById('vramStatusBadge');
const preloadBtn = document.getElementById('preloadBtn');
const skipLlmWaitBtn = document.getElementById('skipLlmWaitBtn');
const showShowdownThoughtsCheckbox = document.getElementById('showShowdownThoughtsCheckbox');
let showShowdownThoughts = false;

// Table DOM elements
const llmInfoBox = document.getElementById('llmInfoBox');
const humanInfoBox = document.getElementById('humanInfoBox');
const llmDisplayName = document.getElementById('llmDisplayName');
const llmDealerBtn = document.getElementById('llmDealerBtn');
const humanDealerBtn = document.getElementById('humanDealerBtn');
const llmChipsDisplay = document.getElementById('llmChipsDisplay');
const humanChipsDisplay = document.getElementById('humanChipsDisplay');
const llmBetDisplay = document.getElementById('llmBetDisplay');
const humanBetDisplay = document.getElementById('humanBetDisplay');
const llmSpeechBox = document.getElementById('llmSpeechBox');
const llmThoughtBox = document.getElementById('llmThoughtBox');
const llmCardsRow = document.getElementById('llmCardsRow');
const humanCardsRow = document.getElementById('humanCardsRow');
const communityCardsRow = document.getElementById('communityCardsRow');
const humanHandEval = document.getElementById('humanHandEval');
const potAmountDisplay = document.getElementById('potAmountDisplay');
const winnerBanner = document.getElementById('winnerBanner');

// Controls
const btnFold = document.getElementById('btnFold');
const btnCheckCall = document.getElementById('btnCheckCall');
const btnRaise = document.getElementById('btnRaise');
const btnAllIn = document.getElementById('btnAllIn');
const btnNextHand = document.getElementById('btnNextHand');
const giveUpBtn = document.getElementById('giveUpBtn');
const raiseSlider = document.getElementById('raiseSlider');
const raiseAmountInput = document.getElementById('raiseAmountInput');
const presetMinBtn = document.getElementById('presetMinBtn');
const presetHalfPotBtn = document.getElementById('presetHalfPotBtn');
const presetPotBtn = document.getElementById('presetPotBtn');
const preset2xBtn = document.getElementById('preset2xBtn');
const presetAllInBtn = document.getElementById('presetAllInBtn');

// Game Over Modal
const gameOverModal = document.getElementById('gameOverModal');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverMsg = document.getElementById('gameOverMsg');
const gameOverStats = document.getElementById('gameOverStats');
const restartGameBtn = document.getElementById('restartGameBtn');

// Load settings from localStorage
function loadSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('texas_holdem_settings') || '{}');
    if (saved.customOllamaUrl) customOllamaUrl = saved.customOllamaUrl;
    if (saved.configuredTimeout) configuredTimeout = Number(saved.configuredTimeout);
    if (saved.configuredKeepAlive) configuredKeepAlive = saved.configuredKeepAlive;
    if (saved.configuredNumGpu !== undefined) configuredNumGpu = Number(saved.configuredNumGpu);
    if (saved.configuredNumParallel !== undefined) configuredNumParallel = Number(saved.configuredNumParallel);
    if (saved.configuredFlashAttention !== undefined) configuredFlashAttention = Number(saved.configuredFlashAttention);
    if (saved.showShowdownThoughts !== undefined) showShowdownThoughts = Boolean(saved.showShowdownThoughts);

    ollamaUrlInput.value = customOllamaUrl;
    timeoutSelect.value = String(configuredTimeout);
    keepAliveSelect.value = configuredKeepAlive;
    numGpuInput.value = configuredNumGpu;
    numParallelInput.value = configuredNumParallel;
    flashAttentionSelect.value = String(configuredFlashAttention);
    showShowdownThoughtsCheckbox.checked = showShowdownThoughts;
  } catch {}
}

function saveCurrentSettings() {
  try {
    const settings = {
      customOllamaUrl,
      configuredTimeout,
      configuredKeepAlive,
      configuredNumGpu,
      configuredNumParallel,
      configuredFlashAttention,
      showShowdownThoughts
    };
    localStorage.setItem('texas_holdem_settings', JSON.stringify(settings));
  } catch {}
}

// Initialize app
window.addEventListener('DOMContentLoaded', async () => {
  loadSavedSettings();
  setupEventListeners();
  await scanOllamaModels();
  await startNewGame();
  startTimerTicker();
});

function setupEventListeners() {
  refreshModelsBtn.addEventListener('click', scanOllamaModels);

  modelSelect.addEventListener('change', () => {
    const selectedText = modelSelect.options[modelSelect.selectedIndex].text;
    llmDisplayName.textContent = selectedText.replace(/🤖\s*/, '').replace(/\s*\(.*?\)/, '');
    updateVramBadge();
  });

  preloadBtn.addEventListener('click', preloadSelectedModel);
  vramStatusBadge.addEventListener('click', preloadSelectedModel);

  skipLlmWaitBtn.addEventListener('click', async () => {
    isLlmAbortRequested = true;
    skipLlmWaitBtn.textContent = 'Switching to Quick Bot...';
    try {
      const res = await fetch('/api/game/llm-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'builtin-heuristic',
          persona: personaSelect.value
        })
      });
      const data = await res.json();
      gameState = data.state;
      sounds.playChip();
      renderState();
      checkIfLlmTurn();
    } catch (err) {
      console.error('Error switching move:', err);
    }
  });

  soundToggleBtn.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    soundToggleBtn.textContent = isSoundEnabled ? '🔊' : '🔇';
  });

  logToggleBtn.addEventListener('click', () => {
    logDrawer.classList.toggle('open');
  });

  closeLogBtn.addEventListener('click', () => {
    logDrawer.classList.remove('open');
  });

  settingsBtn.addEventListener('click', () => {
    timeoutSelect.value = String(configuredTimeout);
    keepAliveSelect.value = configuredKeepAlive;
    numGpuInput.value = configuredNumGpu;
    numParallelInput.value = configuredNumParallel;
    flashAttentionSelect.value = String(configuredFlashAttention);
    showShowdownThoughtsCheckbox.checked = showShowdownThoughts;
    settingsModal.classList.add('active');
  });

  cancelSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  saveSettingsBtn.addEventListener('click', async () => {
    customOllamaUrl = ollamaUrlInput.value.trim() || 'http://127.0.0.1:11434';
    configuredTimeout = Number(timeoutSelect.value) || 180000;
    configuredKeepAlive = keepAliveSelect.value || '2h';
    configuredNumGpu = Number(numGpuInput.value) || 999;
    configuredNumParallel = Number(numParallelInput.value) || 1;
    configuredFlashAttention = Number(flashAttentionSelect.value) || 1;
    showShowdownThoughts = showShowdownThoughtsCheckbox.checked;

    saveCurrentSettings();
    settingsModal.classList.remove('active');
    await scanOllamaModels();
  });

  // Action Buttons
  btnFold.addEventListener('click', () => handleHumanAction('fold'));
  btnCheckCall.addEventListener('click', () => {
    const hasCall = gameState.validActions.find(a => a.type === 'call');
    if (hasCall) {
      handleHumanAction('call', hasCall.amount);
    } else {
      handleHumanAction('check');
    }
  });

  btnRaise.addEventListener('click', () => {
    const amount = Number(raiseAmountInput.value);
    handleHumanAction('raise', amount);
  });

  btnAllIn.addEventListener('click', () => {
    handleHumanAction('all-in', gameState.humanChips);
  });

  btnNextHand.addEventListener('click', requestNextHand);

  giveUpBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to resign and surrender this match?')) {
      handleHumanAction('give_up');
    }
  });

  restartGameBtn.addEventListener('click', async () => {
    gameOverModal.classList.remove('active');
    await startNewGame();
  });

  // Raise slider sync
  raiseSlider.addEventListener('input', () => {
    raiseAmountInput.value = raiseSlider.value;
    updateRaiseButtonText();
  });

  raiseAmountInput.addEventListener('input', () => {
    raiseSlider.value = raiseAmountInput.value;
    updateRaiseButtonText();
  });

  // Raise presets
  presetMinBtn.addEventListener('click', () => {
    const raiseAct = gameState.validActions.find(a => a.type === 'raise');
    if (raiseAct) {
      setRaiseValue(raiseAct.min);
    }
  });

  presetHalfPotBtn.addEventListener('click', () => {
    const amt = Math.floor(gameState.pot * 0.5);
    clampAndSetRaise(amt);
  });

  presetPotBtn.addEventListener('click', () => {
    clampAndSetRaise(gameState.pot);
  });

  preset2xBtn.addEventListener('click', () => {
    clampAndSetRaise(gameState.pot * 2);
  });

  presetAllInBtn.addEventListener('click', () => {
    if (gameState) setRaiseValue(gameState.humanChips);
  });
}

function clampAndSetRaise(amount) {
  const raiseAct = gameState.validActions.find(a => a.type === 'raise');
  if (!raiseAct) return;
  const clamped = Math.max(raiseAct.min, Math.min(raiseAct.max, amount));
  setRaiseValue(clamped);
}

function setRaiseValue(val) {
  raiseSlider.value = val;
  raiseAmountInput.value = val;
  updateRaiseButtonText();
}

function updateRaiseButtonText() {
  btnRaise.textContent = `Raise $${Number(raiseAmountInput.value).toLocaleString()}`;
}

// Ollama Model Detection
async function scanOllamaModels() {
  statusDot.className = 'status-dot';
  statusText.textContent = 'Scanning Ollama...';

  try {
    const res = await fetch(`/api/ollama/models?url=${encodeURIComponent(customOllamaUrl)}`);
    const data = await res.json();

    modelSelect.innerHTML = '';
    loadedModelsInVram = data.loadedModels || [];

    if (data.online && data.models.length > 0) {
      statusDot.className = 'status-dot online';
      statusText.textContent = `Ollama: ${data.models.length} model${data.models.length > 1 ? 's' : ''}`;

      data.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.name} (${m.size || 'local'})`;
        modelSelect.appendChild(opt);
      });

      // Also append heuristic bot as option
      const botOpt = document.createElement('option');
      botOpt.value = 'builtin-heuristic';
      botOpt.textContent = '🤖 Built-in Smart Bot';
      modelSelect.appendChild(botOpt);

      llmDisplayName.textContent = data.models[0].name.replace(/\s*\(.*?\)/, '');
      updateVramBadge();
    } else {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Ollama Offline';

      const botOpt = document.createElement('option');
      botOpt.value = 'builtin-heuristic';
      botOpt.textContent = '🤖 Built-in Smart Bot (Practice Mode)';
      modelSelect.appendChild(botOpt);

      llmDisplayName.textContent = 'Smart Bot';
      llmSpeechBox.textContent = `Ollama not detected at ${customOllamaUrl}. Playing against built-in bot! Run 'ollama serve' to play against local LLMs.`;
      updateVramBadge();
    }
  } catch (err) {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Ollama Offline';
    updateVramBadge();
  }
}

// Update VRAM status badge
function updateVramBadge() {
  const currentModel = modelSelect.value;
  if (!currentModel || currentModel === 'builtin-heuristic') {
    vramStatusBadge.style.display = 'none';
    preloadBtn.style.display = 'none';
    return;
  }

  vramStatusBadge.style.display = 'inline-block';
  preloadBtn.style.display = 'inline-flex';

  const isLoaded = loadedModelsInVram.some(m => m.name === currentModel || m.model === currentModel);
  if (isLoaded) {
    vramStatusBadge.style.background = 'rgba(34, 197, 94, 0.2)';
    vramStatusBadge.style.color = '#4ade80';
    vramStatusBadge.style.borderColor = 'rgba(34, 197, 94, 0.5)';
    vramStatusBadge.textContent = '⚡ Loaded in VRAM';
    preloadBtn.textContent = '✅ Warm';
    preloadBtn.disabled = true;
  } else {
    vramStatusBadge.style.background = 'rgba(148, 163, 184, 0.2)';
    vramStatusBadge.style.color = '#cbd5e1';
    vramStatusBadge.style.borderColor = 'rgba(148, 163, 184, 0.4)';
    vramStatusBadge.textContent = '💤 Cold (Click Load)';
    preloadBtn.textContent = '⚡ Load VRAM';
    preloadBtn.disabled = false;
  }
}

// Preload Model into VRAM
async function preloadSelectedModel() {
  const model = modelSelect.value;
  if (!model || model === 'builtin-heuristic' || isPreloading) return;

  isPreloading = true;
  preloadBtn.textContent = '⏳ Loading VRAM...';
  preloadBtn.disabled = true;
  vramStatusBadge.textContent = '⏳ Loading to VRAM...';
  llmSpeechBox.textContent = `Loading ${model} into GPU VRAM / system RAM... This can take 30-90 seconds on cold start.`;

  try {
    const res = await fetch('/api/ollama/preload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        keepAlive: configuredKeepAlive,
        numGpu: configuredNumGpu
      })
    });
    const data = await res.json();
    loadedModelsInVram = data.loadedModels || [];
    isPreloading = false;
    updateVramBadge();
    sounds.playChip();
    llmSpeechBox.textContent = `Model ${model} is loaded and ready in memory!`;
  } catch (err) {
    isPreloading = false;
    preloadBtn.textContent = '⚡ Load VRAM';
    preloadBtn.disabled = false;
    llmSpeechBox.textContent = `Preload note: ${err.message}`;
  }
}

// Start New Tournament Game
async function startNewGame() {
  try {
    const res = await fetch('/api/game/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startingChips: 50000,
        model: modelSelect.value,
        persona: personaSelect.value
      })
    });
    const data = await res.json();
    gameState = data.state;
    sounds.playCard();
    renderState();
    checkIfLlmTurn();
  } catch (err) {
    console.error('Error starting new game:', err);
  }
}

// Request Next Hand
async function requestNextHand() {
  try {
    sounds.playCard();
    const res = await fetch('/api/game/next-hand', { method: 'POST' });
    const data = await res.json();
    gameState = data.state;
    renderState();
    checkIfLlmTurn();
  } catch (err) {
    console.error('Error next hand:', err);
  }
}

// Human Action
async function handleHumanAction(action, amount = 0) {
  if (isRequestPending || !gameState) return;
  isRequestPending = true;

  if (action === 'fold') sounds.playCard();
  else if (action === 'check') sounds.playCheck();
  else sounds.playChip();

  try {
    const res = await fetch('/api/game/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, amount })
    });
    const data = await res.json();
    gameState = data.state;
    renderState();
    isRequestPending = false;
    checkIfLlmTurn();
  } catch (err) {
    console.error('Error executing action:', err);
    isRequestPending = false;
  }
}

// Check if it's the LLM's turn and query server
async function checkIfLlmTurn() {
  if (!gameState || gameState.stage === 'showdown' || gameState.stage === 'ended' || gameState.isGameOver) {
    if (llmThinkingTimer) clearInterval(llmThinkingTimer);
    skipLlmWaitBtn.style.display = 'none';
    return;
  }

  if (gameState.activePlayer === 'llm') {
    // Show AI thinking indicator
    llmInfoBox.classList.add('active-turn');
    humanInfoBox.classList.remove('active-turn');
    llmThoughtBox.style.display = 'block';

    const chosenModel = modelSelect.value;
    const isLocalLlm = chosenModel && chosenModel !== 'builtin-heuristic';

    // Start live thinking elapsed timer
    llmThinkingSeconds = 0;
    skipLlmWaitBtn.style.display = isLocalLlm ? 'inline-block' : 'none';
    skipLlmWaitBtn.textContent = '⏩ Skip Wait & Use Quick Bot';
    isLlmAbortRequested = false;

    const limitSec = Math.round(configuredTimeout / 1000);
    const updateThinkingLabel = () => {
      if (llmThinkingSeconds > 25 && isLocalLlm) {
        llmThoughtBox.textContent = `[⏳ ${chosenModel} evaluating move... (${llmThinkingSeconds}s / ${limitSec}s limit)]`;
      } else {
        llmThoughtBox.textContent = `[🤖 ${chosenModel} deciding move... (${llmThinkingSeconds}s / ${limitSec}s limit)]`;
      }
    };
    updateThinkingLabel();

    if (llmThinkingTimer) clearInterval(llmThinkingTimer);
    llmThinkingTimer = setInterval(() => {
      llmThinkingSeconds++;
      updateThinkingLabel();
    }, 1000);

    // Disable human controls while LLM thinks
    disableHumanControls(true);

    try {
      const res = await fetch('/api/game/llm-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: chosenModel,
          persona: personaSelect.value,
          timeoutMs: configuredTimeout,
          keepAlive: configuredKeepAlive,
          numGpu: configuredNumGpu
        })
      });

      if (llmThinkingTimer) clearInterval(llmThinkingTimer);
      skipLlmWaitBtn.style.display = 'none';

      // Check if user already skipped this turn
      if (isLlmAbortRequested) return;

      const data = await res.json();
      gameState = data.state;

      sounds.playChip();
      renderState();
      checkIfLlmTurn();
    } catch (err) {
      if (llmThinkingTimer) clearInterval(llmThinkingTimer);
      skipLlmWaitBtn.style.display = 'none';
      console.error('Error in LLM turn:', err);
    }
  } else {
    if (llmThinkingTimer) clearInterval(llmThinkingTimer);
    skipLlmWaitBtn.style.display = 'none';
  }
}

// Render entire game UI from state
function renderState() {
  if (!gameState) return;

  // Blinds & timer
  currentBlinds = gameState.blinds;
  updateBlindsDisplay();

  // Hand Badge
  handNumberBadge.textContent = `Hand #${gameState.handCount || 1}`;

  // Chips
  llmChipsDisplay.textContent = Number(gameState.llmChips).toLocaleString();
  humanChipsDisplay.textContent = Number(gameState.humanChips).toLocaleString();

  // Pot
  potAmountDisplay.textContent = `$${Number(gameState.pot).toLocaleString()}`;

  // Dealer buttons
  llmDealerBtn.style.display = gameState.dealer === 'llm' ? 'inline-flex' : 'none';
  humanDealerBtn.style.display = gameState.dealer === 'human' ? 'inline-flex' : 'none';

  // Current bets
  if (gameState.llmBet > 0) {
    llmBetDisplay.style.display = 'inline-block';
    llmBetDisplay.textContent = `Bet: $${Number(gameState.llmBet).toLocaleString()}`;
  } else {
    llmBetDisplay.style.display = 'none';
  }

  if (gameState.humanBet > 0) {
    humanBetDisplay.style.display = 'inline-block';
    humanBetDisplay.textContent = `Bet: $${Number(gameState.humanBet).toLocaleString()}`;
  } else {
    humanBetDisplay.style.display = 'none';
  }

  // Active turn glow
  if (gameState.activePlayer === 'human') {
    humanInfoBox.classList.add('active-turn');
    llmInfoBox.classList.remove('active-turn');
    disableHumanControls(false);
  } else if (gameState.activePlayer === 'llm') {
    llmInfoBox.classList.add('active-turn');
    humanInfoBox.classList.remove('active-turn');
    disableHumanControls(true);
  } else {
    humanInfoBox.classList.remove('active-turn');
    llmInfoBox.classList.remove('active-turn');
    disableHumanControls(true);
  }

  // Render Human Cards
  renderCardsRow(humanCardsRow, gameState.humanHoleCards);
  if (gameState.humanHandDescription) {
    humanHandEval.style.display = 'block';
    humanHandEval.textContent = gameState.humanHandDescription;
  } else {
    humanHandEval.style.display = 'none';
  }

  // Render LLM Cards (hidden unless showdown or ended)
  if (gameState.llmHoleCards) {
    renderCardsRow(llmCardsRow, gameState.llmHoleCards);
  } else {
    llmCardsRow.innerHTML = `
      <div class="card hidden-card"></div>
      <div class="card hidden-card"></div>
    `;
  }

  // Render Community Cards
  renderCommunityCards(gameState.communityCards);

  // Dialogue & Thoughts: Never leak AI strategy during an active hand!
  if (gameState.lastLlmSpeech) {
    llmSpeechBox.textContent = `"${gameState.lastLlmSpeech}"`;
  }
  // Only show thought at showdown if user explicitly enabled it, otherwise completely hidden
  if (showShowdownThoughts && (gameState.stage === 'showdown' || gameState.stage === 'ended') && gameState.lastLlmThought) {
    llmThoughtBox.style.display = 'block';
    llmThoughtBox.textContent = `[Showdown AI Review: ${gameState.lastLlmThought}]`;
  } else {
    llmThoughtBox.style.display = 'none';
  }

  // Action Buttons state
  updateActionControls();

  // Logs
  renderLogs(gameState.history);

  // Showdown / Winner Announcement
  if (gameState.stage === 'showdown' || gameState.stage === 'ended') {
    winnerBanner.style.display = 'block';
    winnerBanner.textContent = gameState.winningDescription || 'Hand complete!';
    btnNextHand.style.display = gameState.isGameOver ? 'none' : 'inline-block';

    if (gameState.winner === 'human') {
      sounds.playWin();
    }
  } else {
    winnerBanner.style.display = 'none';
    btnNextHand.style.display = 'none';
  }

  // Tournament Game Over check
  if (gameState.isGameOver) {
    gameOverModal.classList.add('active');
    gameOverTitle.textContent = gameState.humanChips > 0 ? '🏆 VICTORY!' : '💀 DEFEAT!';
    gameOverMsg.textContent = gameState.gameOverReason;
    gameOverStats.innerHTML = `
      <div>Hands Played: <strong>${gameState.handCount}</strong></div>
      <div>Your Final Chips: <strong>${gameState.humanChips.toLocaleString()}</strong></div>
      <div>LLM Final Chips: <strong>${gameState.llmChips.toLocaleString()}</strong></div>
    `;
  }
}

// Render cards into container
function renderCardsRow(container, cards) {
  container.innerHTML = '';
  if (!cards || cards.length === 0) {
    container.innerHTML = `
      <div class="card-placeholder"></div>
      <div class="card-placeholder"></div>
    `;
    return;
  }

  cards.forEach(card => {
    const el = createCardElement(card);
    container.appendChild(el);
  });
}

function renderCommunityCards(cards) {
  communityCardsRow.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    if (cards && cards[i]) {
      communityCardsRow.appendChild(createCardElement(cards[i]));
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'card-placeholder';
      communityCardsRow.appendChild(placeholder);
    }
  }
}

function createCardElement(card) {
  const cardDiv = document.createElement('div');
  cardDiv.className = `card ${card.suitColor}`;

  cardDiv.innerHTML = `
    <div class="card-corner">
      <span class="card-rank">${card.rankName}</span>
      <span class="card-suit">${card.suitSymbol}</span>
    </div>
    <div class="card-center">${card.suitSymbol}</div>
    <div class="card-corner" style="transform: rotate(180deg);">
      <span class="card-rank">${card.rankName}</span>
      <span class="card-suit">${card.suitSymbol}</span>
    </div>
  `;
  return cardDiv;
}

// Update Action Buttons
function updateActionControls() {
  const valid = gameState.validActions || [];
  const validTypes = valid.map(a => a.type);

  // Check / Call
  const callAction = valid.find(a => a.type === 'call');
  const checkAction = valid.find(a => a.type === 'check');

  if (callAction) {
    btnCheckCall.textContent = `Call $${callAction.amount.toLocaleString()}`;
    btnCheckCall.disabled = false;
  } else if (checkAction) {
    btnCheckCall.textContent = 'Check';
    btnCheckCall.disabled = false;
  } else {
    btnCheckCall.textContent = 'Check / Call';
    btnCheckCall.disabled = true;
  }

  btnFold.disabled = !validTypes.includes('fold');

  // Raise
  const raiseAction = valid.find(a => a.type === 'raise');
  if (raiseAction) {
    btnRaise.disabled = false;
    raiseSlider.disabled = false;
    raiseAmountInput.disabled = false;
    raiseSlider.min = raiseAction.min;
    raiseSlider.max = raiseAction.max;
    if (Number(raiseAmountInput.value) < raiseAction.min || Number(raiseAmountInput.value) > raiseAction.max) {
      raiseAmountInput.value = raiseAction.min;
      raiseSlider.value = raiseAction.min;
    }
    updateRaiseButtonText();
  } else {
    btnRaise.disabled = true;
    raiseSlider.disabled = true;
    raiseAmountInput.disabled = true;
  }

  // All-in
  btnAllIn.disabled = !validTypes.includes('all-in');
}

function disableHumanControls(disabled) {
  btnFold.disabled = disabled;
  btnCheckCall.disabled = disabled;
  btnRaise.disabled = disabled;
  btnAllIn.disabled = disabled;
  raiseSlider.disabled = disabled;
  raiseAmountInput.disabled = disabled;
}

// Blinds and Timer display
function updateBlindsDisplay() {
  if (!currentBlinds) return;
  blindsDisplay.textContent = `${currentBlinds.smallBlind.toLocaleString()} / ${currentBlinds.bigBlind.toLocaleString()}`;

  if (currentBlinds.isCapped) {
    blindCappedBadge.style.display = 'inline-block';
    timerLabel.textContent = 'Blinds Capped';
    timerDisplay.textContent = 'MAX (2,500)';
  } else {
    blindCappedBadge.style.display = 'none';
    timerLabel.textContent = `Level ${currentBlinds.level} (Next Level)`;
    const mins = Math.floor(currentBlinds.secondsToNextLevel / 60);
    const secs = currentBlinds.secondsToNextLevel % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
}

// Local 1-second countdown ticker
function startTimerTicker() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (currentBlinds && !currentBlinds.isCapped && currentBlinds.secondsToNextLevel > 0) {
      currentBlinds.secondsToNextLevel--;
      updateBlindsDisplay();
    }
  }, 1000);
}

// Render Hand History
function renderLogs(logs) {
  if (!logs) return;
  logList.innerHTML = '';
  logs.forEach(log => {
    const item = document.createElement('div');
    item.className = `log-entry ${log.player}`;
    item.textContent = `[${log.time || ''}] ${log.player.toUpperCase()}: ${log.text}`;
    logList.appendChild(item);
  });
  logList.scrollTop = logList.scrollHeight;
}
