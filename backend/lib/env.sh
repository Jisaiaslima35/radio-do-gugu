#!/bin/bash
# =============================================================================
# env.sh — Configurações globais pra Rádio do Gugu (AzuraCast)
# =============================================================================
# Criado 28/08/2026 (Etapa 4) — clone do env.sh do Libertação, ajustado pra
# estação 4 do AzuraCast e perfil Hermes radio-gugu.
# ATENÇÃO: paths/dirs ainda serão ajustados quando a estação 4 for criada
# (Etapa 5). Harbor, porta e senha DJ serão preenchidos após Etapa 5.
# =============================================================================

# === LOCAL ===
RELAY_DIR="/root/radio-gugu-music"
LOG_DIR="$RELAY_DIR/logs"
VINHETAS_DIR="$RELAY_DIR/vinhetas"
MUSICAS_DIR="$RELAY_DIR/musicas"
TMP_DIR="/tmp/radio-gugu-music"

# === ÁUDIO ===
ENCODER="mp3"
BITRATE="128k"
SAMPLE_RATE="44100"

# === TIMING ===
FALA_URGENTE_DURACAO=30       # segundos que o relay fica ativo pra fala urgente
TOCA_PEDIDO_DURACAO=300       # 5 min pra música tocar (brega)
VINHETA_TIMEOUT=45            # cron job timeout safety
WAKE_UP_TIME=3                # tempo pro stream subir antes de injetar

# === TTS ENGINE ===
# "gugu_clone" = voz clonada do Gugu (MiniMax, melhor qualidade PT-BR) — PENDENTE
# "piper"        = Modelo neural local (offline, fallback)
# "speech-2.8-hd" = MiniMax direto, voz grave genérica — USAR ENQUANTO NÃO TEMOS CLONE
TTS_ENGINE="speech-2.8-hd"
TTS_VOICE="male-pt-br-grave"

# Caminho do script python de TTS clonado (PENDENTE — criar clone do Gugu)
# TTS_SCRIPT="/root/.hermes/skills/productivity/gugu-voice-clone/scripts/falar_com_minha_voz.py"
# Enquanto isso, usar MiniMax direto via API
TTS_SCRIPT="/usr/local/bin/falar_gugu.sh"  # PENDENTE

mkdir -p "$LOG_DIR" "$TMP_DIR"
