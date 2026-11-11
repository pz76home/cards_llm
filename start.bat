@echo off
title Texas Hold'em AI Duel (Ollama)

:: Set default Ollama performance environment variables
set OLLAMA_NUM_GPU=999
set OLLAMA_NUM_PARALLEL=1
set OLLAMA_FLASH_ATTENTION=1

echo ========================================================
echo   Texas Hold'em Poker vs Local Ollama LLM
echo ========================================================
echo   OLLAMA_NUM_GPU:          999 (Max GPU offload)
echo   OLLAMA_NUM_PARALLEL:     1   (Dedicated single turn)
echo   OLLAMA_FLASH_ATTENTION:  1   (Enabled for speed/memory)
echo ========================================================
echo.
echo Starting game server on http://localhost:3000 ...
echo.
node server.js
pause
