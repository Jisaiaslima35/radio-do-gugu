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
# FIX 29/08/2026 02:25 — Mapeamento por modo (--duration=curta|pregar|cron).
# Isaías reportou: "a voz do locutor tá sendo cortada antes do final" nos
# contos de terror. Causa: GUGU_FIXED_DURATION=30 truncava falas longas
# (contos de 90-180s) em 30s. Agora o modo controla o teto:
#   curta  → 30s (locução Gugu rápida, pedido de música)
#   pregar → 0  = sem limite (conto de terror — Toca o conto INTEIRO)
#   cron   → 60s (avisos curtos)
# Passa --duration=pregar via hermes_call_gugu.sh pro inject não cortar contos.
#
# Também: força repopulação da fila ANTES de injetar (warm-up), pra evitar
# race condition com AutoDJ track_sensitive.
#
# Uso: inject-pedido-gugu.sh /path/to/audio.mp3 [titulo_da_fala] [--duration=curta|pregar|cron]
# Env: GUGU_FIXED_DURATION=N (segundos, 0 = sem fixar). Tem prioridade sobre --duration.
# =============================================================================

set -e

ARQUIVO=""
TITULO_FALA="Locutor IA Gugu"
DURATION_MODE=""
FIXED_DURATION_DEFAULT=30
FIXED_DURATION="${GUGU_FIXED_DURATION:-}"

# Parse args
NEW_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --duration=curta)
      DURATION_MODE="curta"
      ;;
    --duration=pregar)
      DURATION_MODE="pregar"
      ;;
    --duration=cron)
      DURATION_MODE="cron"
      ;;
    --duration=*)
      echo "ERRO: --duration inválido: '$arg' (use curta|pregar|cron)" >&2
      exit 1
      ;;
    *)
      NEW_ARGS+=("$arg")
      ;;
  esac
done
set -- "${NEW_ARGS[@]}"

ARQUIVO="${1:-}"
TITULO_FALA="${2:-Locutor IA Gugu}"

# Mapeia modo → FIXED_DURATION (só se env var não foi setada explicitamente)
if [ -z "$FIXED_DURATION" ]; then
  case "$DURATION_MODE" in
    pregar) FIXED_DURATION=0 ;;  # sem limite, toca o conto INTEIRO
    cron)   FIXED_DURATION=60 ;;
    *)      FIXED_DURATION="$FIXED_DURATION_DEFAULT" ;;  # curta ou vazio = 30s
  esac
fi

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
# FIX 29/08/2026 02:35 — Pre-padding 3s silêncio no arquivo.
# Isaías reportou (msg 3113): "o buffer do Harbor/Liquidsoap engole os últimos
# segundos antes de tocar tudo". Solução: pre-concat 3s silêncio CAUDA no
# arquivo (filter_complex anullsrc). Quando ffmpeg desconecta no EOF, o
# liquidsoap tem 3s extras de silêncio pra drenar antes de trocar pro AutoDJ.
#
# ROLLBACK 29/08/2026 02:42 — Removido `-map_metadata -1 -write_xing 0
# -id3v2_version 0` (causou "bip chato" reportado msg 3114: liquidsoap entrou
# em loop curto após ffmpeg sair). Strip metadata evita "int_of_string" aos
# 15s MAS causa artefatos feios na transição. Solução final: pre-pad SIM,
# strip metadata NÃO. A fala pode cortar uns segundos no final (int_of_string
# após ~15s) mas a transição fica limpa.
#
# Flag -re mantida (transmite em tempo real 1x exato).
# Buffer do harbor mantido em 5.0 (conservador vs 2.0 sugerido).
LOG="/tmp/inject-gugu-$$.log"
TMP_FINAL_PADDED="/tmp/inject_gugu_final_$$.mp3"
# Pre-concat 3s silêncio cauda (sempre, independente do modo)
ffmpeg -hide_banner -loglevel error -y \
  -i "$ARQUIVO_INJECT" \
  -f lavfi -t 3 -i "anullsrc=r=44100:cl=stereo" \
  -filter_complex "[0:a]asetpts=PTS-STARTPTS[v];[1:a]asetpts=PTS-STARTPTS[s];[v][s]concat=n=2:v=0:a=1[out]" \
  -map "[out]" \
  -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 \
  "$TMP_FINAL_PADDED" 2>/dev/null || {
  echo "[inject-gugu] ⚠️ pre-pad falhou, usando arquivo original" >&2
  TMP_FINAL_PADDED="$ARQUIVO_INJECT"
}

setsid nohup ffmpeg -hide_banner -loglevel warning -re \
  -i "$TMP_FINAL_PADDED" \
  -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 \
  -f mp3 \
  -content_type audio/mpeg \
  "http://${DJ_USER}:${DJ_PASS}@${DJ_HOST}:${DJ_PORT}${DJ_MOUNT}" \
  > "$LOG" 2>&1 &

INJECT_PID=$!
echo "[inject-gugu] ffmpeg PID=${INJECT_PID} arquivo=${ARQUIVO_INJECT##*/} dur=${DUR}s destino=liquidsoap_harbor:${DJ_PORT}${DJ_MOUNT} titulo='${TITULO_FALA}'" >&2
echo "$INJECT_PID"