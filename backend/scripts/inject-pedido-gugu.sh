#!/usr/bin/env bash
# =============================================================================
# inject-pedido-gugu.sh — Envia MP3 pro AzuraCast estação 7 (Rádio do Gugu)
# =============================================================================
# FIX 28/08/2026 20:10 — Restaurado padrão FASE 3 Devocional 12: ffmpeg SEM
# -ice_name/-ice_description. O título da estação é atualizado via API REST do
# AzuraCast DEPOIS que o inject começa (em paralelo).
#
# Validação FASE 3 (28/08): sem flags ICY, liquidsoap consome bytes puros até
# ffmpeg desconectar (End_of_file normal). Com flags, dá Failure("int_of_string")
# e corta 13-17s do final.
#
# FIX 29/08/2026 00:50 — Duração FIXA configurável (GUGU_FIXED_DURATION).
# O Isaías pediu: "tem que configurar o tempo que é gerado para que fique
# fixado o tempo que for tocado a voz injetada". Antes, fala de 5-8s terminava
# rápido e liquidsoap caía no error.mp3 (silêncio). Agora: se audio original
# é menor que FIXED_DURATION, concatena silêncio no final. Se for maior,
# corta no FIXED_DURATION. Default = 30s.
#
# Também: força repopulação da fila ANTES de injetar (warm-up), pra evitar
# race condition com AutoDJ track_sensitive.
#
# Uso: inject-pedido-gugu.sh /path/to/audio.mp3 [titulo_da_fala]
# Env: GUGU_FIXED_DURATION=30 (segundos, 0 = sem fixar)
# =============================================================================

set -e

ARQUIVO="${1:-}"
TITULO_FALA="${2:-Locutor IA Gugu}"
FIXED_DURATION="${GUGU_FIXED_DURATION:-30}"

if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "ERRO: ARQUIVO inválido: '${ARQUIVO}'" >&2
  exit 1
fi

DJ_HOST="127.0.0.1"
DJ_PORT="9045"
DJ_MOUNT="/live"
DJ_USER="source"
DJ_PASS="RtqxAwgn"

# === Duração real do arquivo ===
DUR_REAL=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$ARQUIVO" 2>/dev/null | cut -d. -f1)
DUR_REAL=${DUR_REAL:-0}

# === Padding para duração fixa (se solicitada) ===
ARQUIVO_INJECT="$ARQUIVO"
if [ "${FIXED_DURATION}" -gt 0 ] 2>/dev/null; then
  TMP_PADDED="/tmp/inject_gugu_padded_$$.mp3"
  if [ "${DUR_REAL}" -lt "${FIXED_DURATION}" ]; then
    # Adiciona silêncio de cauda até completar FIXED_DURATION
    SILENCIO_SEG=$((FIXED_DURATION - DUR_REAL))
    ffmpeg -hide_banner -loglevel error -y \
      -i "$ARQUIVO" \
      -f lavfi -t "${SILENCIO_SEG}" -i "anullsrc=r=44100:cl=stereo" \
      -filter_complex "[0:a]asetpts=PTS-STARTPTS[v];[1:a]asetpts=PTS-STARTPTS[s];[v][s]concat=n=2:v=0:a=1[out]" \
      -map "[out]" -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 "$TMP_PADDED" 2>/dev/null
    if [ -f "$TMP_PADDED" ] && [ "$(stat -c %s "$TMP_PADDED" 2>/dev/null || echo 0)" -gt 1000 ]; then
      ARQUIVO_INJECT="$TMP_PADDED"
      DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$ARQUIVO_INJECT" 2>/dev/null | cut -d. -f1)
      echo "[inject-gugu] padded ${DUR_REAL}s → ${DUR}s (FIXED_DURATION=${FIXED_DURATION})" >&2
    else
      echo "[inject-gugu] ⚠️ padding falhou, usando arquivo original" >&2
    fi
  elif [ "${DUR_REAL}" -gt "${FIXED_DURATION}" ]; then
    # Corta em FIXED_DURATION (silencia cauda do líquido)
    TMP_TRIM="/tmp/inject_gugu_trim_$$.mp3"
    ffmpeg -hide_banner -loglevel error -y -i "$ARQUIVO" -t "${FIXED_DURATION}" \
      -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 "$TMP_TRIM" 2>/dev/null
    if [ -f "$TMP_TRIM" ] && [ "$(stat -c %s "$TMP_TRIM" 2>/dev/null || echo 0)" -gt 1000 ]; then
      ARQUIVO_INJECT="$TMP_TRIM"
      echo "[inject-gugu] trim ${DUR_REAL}s → ${FIXED_DURATION}s (FIXED_DURATION)" >&2
    fi
  fi
fi

DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$ARQUIVO_INJECT" 2>/dev/null | cut -d. -f1)
DUR=${DUR:-30}

# === Warm-up: força repopulação da fila ANTES de injetar ===
# (race condition com liquidsoap track_sensitive=true)
if [ -x /root/radio-gugu-music/scripts/keep-autodj-alive.sh ]; then
  /root/radio-gugu-music/scripts/keep-autodj-alive.sh 7 >/dev/null 2>&1 || true
fi

# === Injeta no DJ mount da estação 4 do AzuraCast ===
LOG="/tmp/inject-gugu-$$.log"
setsid nohup ffmpeg -hide_banner -loglevel warning -re \
  -i "$ARQUIVO_INJECT" \
  -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 \
  -f mp3 \
  -content_type audio/mpeg \
  "http://${DJ_USER}:${DJ_PASS}@${DJ_HOST}:${DJ_PORT}${DJ_MOUNT}" \
  > "$LOG" 2>&1 &

INJECT_PID=$!
echo "[inject-gugu] ffmpeg PID=${INJECT_PID} arquivo=${ARQUIVO_INJECT##*/} dur=${DUR}s destino=liquidsoap_harbor:${DJ_PORT}${DJ_MOUNT} titulo='${TITULO_FALA}'" >&2
echo "$INJECT_PID"