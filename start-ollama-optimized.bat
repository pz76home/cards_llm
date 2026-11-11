@echo off
title Ollama Server (Optimized)

:: High-performance environment variables for Ollama
set OLLAMA_NUM_GPU=999
set OLLAMA_NUM_PARALLEL=1
set OLLAMA_FLASH_ATTENTION=1

echo ========================================================
echo   Starting Ollama with High-Performance Poker Flags
echo ========================================================
echo   OLLAMA_NUM_GPU=999          (Offload all layers to GPU)
echo   OLLAMA_NUM_PARALLEL=1       (Maximum single-stream VRAM)
echo   OLLAMA_FLASH_ATTENTION=1    (Flash Attention v2 enabled)
echo ========================================================
echo.
ollama serve
pause
