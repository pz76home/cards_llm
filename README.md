# ♠ Texas Hold'em Poker vs Local Ollama LLM ♠

A heads-up No-Limit Texas Hold'em poker game played against a local LLM running on **Ollama**.

---

## 🌟 Key Features

1. **Local Ollama LLM Integration & Auto-Detection**:
   - Queries `http://127.0.0.1:11434/api/tags` to discover locally installed models (e.g. `nemotron-3.5-lightning:30b`, `gemma4`, `llama3.2`, `mistral`, `qwen2.5`).
   - Switch models on-the-fly via a dropdown menu.
   - **VRAM Warmup / Preload**: One-click **⚡ Load VRAM** button preloads large models with `keep_alive: 2h`.
   - **Performance Settings**: Configurable `OLLAMA_NUM_GPU=999` (offload all layers to GPU), `OLLAMA_NUM_PARALLEL=1`, and `OLLAMA_FLASH_ATTENTION=1` (Flash Attention enabled).
   - **Turn Decision Timer**: Dedicated 180-second limit for move analysis (separate from VRAM warmup time).
   - Includes **Playstyle Personas**: Balanced Pro, Aggressive Shark, Tight Rock, Wild Gambler, and Trash Talker.
   - Built-in **Smart Practice Bot** fallback if Ollama is not currently active.

2. **Starting Currency & Fair Heads-Up Rules**:
   - Both Human and LLM start with **50,000 chips**.
   - Dealer button ("D") alternates every hand.
   - Dealer posts Small Blind and acts first pre-flop. Non-dealer posts Big Blind and acts first post-flop.

3. **Tournament Blinds Progression**:
   - **00:00 - 10:00**: Small Blind **500** / Big Blind **1,000**
   - **10:00 - 20:00**: Small Blind **1,000** / Big Blind **2,000**
   - **20:00 - 30:00**: Small Blind **2,000** / Big Blind **4,000**
   - **30:00+**: Capped at maximum Small Blind **2,500** / Big Blind **5,000**
   - Real-time countdown timer in the header with visual cap alerts.

4. **Strict Fairness & Integrity**:
   - The LLM **never deals cards** and **never sees the deck or opponent's cards**.
   - Hand dealing and evaluations are handled entirely by an authoritative server-side 7-card Texas Hold'em evaluator.
   - The LLM only receives valid public game state (community cards, pot, current bet, chip stacks, action history) and its own 2 private hole cards.

5. **End of Match Conditions**:
   - The match ends when either player exhausts all 50,000 currency (0 chips remaining).
   - Either player can also **Resign / Give Up** at any time.

6. **Luxury Casino Web Interface**:
   - Green felt poker table with dynamic chip badges and active-player turn glows.
   - Card animations and suit graphics (♠ ♥ ♦ ♣).
   - Real-time LLM speech bubble (banter/dialogue) and strategic thought box.
   - Quick bet preset buttons (Min, 1/2 Pot, Pot, 2x Pot, All-in) + slider + exact amount input.
   - Web Audio API synthesized casino sounds (chip clinks, card deals, check knocks, victory fanfares) — zero external sound files required!
   - Hand history log drawer.

---

## 🚀 Quick Start

### 1. Ensure Ollama is Running (Optional but Recommended)
Open a terminal and start Ollama:
```bash
ollama serve
```
Make sure you have at least one model downloaded (e.g.):
```bash
ollama pull llama3.2
```

### 2. Start the Game Server
Double-click `start.bat` or run in your terminal:
```bash
node server.js
```

### 3. Open in Browser
Visit:
```
http://localhost:3000
```

---

## 📁 Project Structure

```
c:\Games\cards\
├── poker-engine.js      # Authoritative 7-card Texas Hold'em evaluator & heads-up game engine
├── ollama-client.js     # Ollama API client, system prompts, JSON validation & heuristic fallback
├── server.js            # Zero-dependency Node.js HTTP server & API endpoints
├── start.bat            # One-click Windows launcher
├── package.json         # Project metadata & start script
└── public/
    ├── index.html       # Casino poker table UI
    ├── style.css        # Luxury felt styling, responsive layout & animations
    └── app.js           # Client controller, sound synthesizer & game loop
```
