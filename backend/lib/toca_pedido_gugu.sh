#!/bin/bash
# =============================================================================
# toca_pedido_libertacao.sh — Faz locução do pedido + toca música na Rádio LIBERTAÇÃO
# =============================================================================
# CLONE do lib/toca_pedido.sh (06/08/2026) — única diferença é a porta de
# injeção: inject-pedido-libertacao.sh → harbor 9015/ (estação 2 do AzuraCast).
# O original injeta em inject-pedido.sh → harbor 9025/live (estação 3, Louvor).
# Skill: /root/.hermes/skills/radio-libertacao-operate/SKILL.md (fonte de verdade).
# Uso: ./toca_pedido_libertacao.sh "Amém irmãos, é um pedido do João" "joao.mp3"
# =============================================================================
#
# Uso:
#   ./toca_pedido.sh "Amém irmãos, é um pedido do irmão João" "joao.mp3"
#   ./toca_pedido.sh "Manda a paz pros irmãos da Zona Norte" ""  # só locutor
# =============================================================================
set -e
source /root/radio-libertacao-music/lib/env.sh

# FASE 2 (28/08/2026): cleanup automático via trap EXIT — mesmo se der erro no meio.
TMP_LOCUTOR_MP3=""
TMP_FINAL=""
cleanup() {
    [ -n "$TMP_LOCUTOR_MP3" ] && [ -f "$TMP_LOCUTOR_MP3" ] && rm -f "$TMP_LOCUTOR_MP3" 2>/dev/null || true
    [ -n "$TMP_FINAL" ] && [ -f "$TMP_FINAL" ] && rm -f "$TMP_FINAL" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# === Args ===
TEXTO="${1:-}"
MUSICA="${2:-}"
DURACAO="${3:-$TOCA_PEDIDO_DURACAO}"

if [ -z "$TEXTO" ]; then
    echo "Uso: $0 \"texto do locutor\" [musica.mp3] [duracao_segundos]" >&2
    exit 1
fi

LOG="$LOG_DIR/toca_pedido_$(date +%Y%m%d_%H%M%S).log"
# NÃO usar 'exec > >(tee -a)' — incompatível com spawnDetached do Node.js
# (stdio: 'ignore'). Logging simples via redirect.
exec >>"$LOG" 2>&1
echo "[$(date)] stdout/stderr redirecionado pra $LOG"

echo "==================================="
echo "[$(date)] TOCA PEDIDO"
echo "LOCUTOR: $TEXTO"
echo "MÚSICA:  ${MUSICA:-<nenhuma>}"
echo "DURAÇÃO: ${DURACAO}s"
echo "==================================="

# === 1. Resolve caminho da música ===
MUSICA_PATH=""
if [ -n "$MUSICA" ]; then
    if [ -f "$MUSICA" ]; then
        MUSICA_PATH="$MUSICA"
    elif [ -f "$MUSICAS_DIR/$MUSICA" ]; then
        MUSICA_PATH="$MUSICAS_DIR/$MUSICA"
    else
        echo "ERRO: música não encontrada: $MUSICA" >&2
        echo "Procurei em: $MUSICA e $MUSICAS_DIR/$MUSICA" >&2
        exit 2
    fi
    echo "[1/5] Música encontrada: $MUSICA_PATH"
fi

# === 2. Gera TTS com voz clonada do Isaías (chama falar_com_minha_voz.py direto) ===
TMP_LOCUTOR_MP3="$TMP_DIR/locutor_$$.mp3"
echo "[2/5] Gerando TTS do locutor (voz clonada Isaías)..."
TEXTO_LIMPO=$(echo "$TEXTO" | tr -d '\r' | head -c 500)
if ! python3 "$TTS_SCRIPT" --text "$TEXTO_LIMPO" --speed 0.95 --output "$TMP_LOCUTOR_MP3" >> "$LOG" 2>&1; then
    echo "[2/5] ERRO: TTS falhou. Ver $LOG" >&2
    exit 3
fi
if [ ! -f "$TMP_LOCUTOR_MP3" ] || [ "$(stat -c %s "$TMP_LOCUTOR_MP3" 2>/dev/null || echo 0)" -lt 1000 ]; then
    echo "[2/5] ERRO: MP3 do locutor não foi gerado" >&2
    exit 4
fi
echo "[2/5] Locutor TTS gerado: $(stat -c %s "$TMP_LOCUTOR_MP3") bytes"

# === 3. Monta MP3 final: pre-roll + locutor + (opcional) música ===
TMP_FINAL="$TMP_DIR/pedido_$$.mp3"
echo "[3/5] Montando MP3 final..."

if [ -n "$MUSICA_PATH" ]; then
    # Com música: pre-roll + locutor + pausa + música
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -t 3 -i "anullsrc=r=44100:cl=stereo" \
        -i "$TMP_LOCUTOR_MP3" \
        -f lavfi -t 1 -i "anullsrc=r=44100:cl=stereo" \
        -i "$MUSICA_PATH" \
        -filter_complex "[0:a]asetpts=PTS-STARTPTS[head];[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[lvoz];[2:a]asetpts=PTS-STARTPTS[s];[3:a]aresample=44100,asetpts=PTS-STARTPTS[m];[head][lvoz][s][m]concat=n=4:v=0:a=1[out]" \
        -map "[out]" \
        -c:a libmp3lame -b:a 128k -ar 44100 \
        "$TMP_FINAL"
else
    # Só locutor: pre-roll + locutor
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -t 3 -i "anullsrc=r=44100:cl=stereo" \
        -i "$TMP_LOCUTOR_MP3" \
        -filter_complex "[0:a]asetpts=PTS-STARTPTS[head];[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[lvoz];[head][lvoz]concat=n=2:v=0:a=1[out]" \
        -map "[out]" \
        -c:a libmp3lame -b:a 128k -ar 44100 \
        "$TMP_FINAL"
fi

DUR_REAL=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP_FINAL" 2>/dev/null)
TAMANHO=$(du -h "$TMP_FINAL" | cut -f1)
echo "[3/5] MP3 final: ${DUR_REAL}s, ${TAMANHO}"

# === 4. Injeta no AzuraCast estação 4 (harbor 9025/, RÁDIO DO GUGU) ===
echo "[4/5] Injetando MP3 no AzuraCast (harbor 9025/, estação 4 RÁDIO DO GUGU)..."
INJECT_PID=$(/usr/local/bin/inject-pedido-gugu.sh "$TMP_FINAL" 2>>"$LOG")
echo "[4/5] inject-pedido-gugu.sh PID=${INJECT_PID}"

# === 5. Aguarda injeção terminar ===
DUR_INT=${DUR_REAL%.*}
[ -z "$DUR_INT" ] || [ "$DUR_INT" -lt 5 ] && DUR_INT=5
TEMPO_MAX=$((DUR_INT + 30))
echo "[5/5] Aguardando ffmpeg concluir (max ${TEMPO_MAX}s)..."
ELAPSED=0
while kill -0 "$INJECT_PID" 2>/dev/null && [ "$ELAPSED" -lt "$TEMPO_MAX" ]; do
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done
echo "[5/5] Injeção encerrou após ${ELAPSED}s"

if kill -0 "$INJECT_PID" 2>/dev/null; then
    echo "[5/5] AVISO: ffmpeg travou, matando PID ${INJECT_PID}"
    sudo kill "$INJECT_PID" 2>/dev/null || true
fi

# TMP_LOCUTOR_MP3 e TMP_FINAL são removidos pelo trap EXIT no fim do script.

echo ""
echo "OK Concluido. AzuraCast voltou pro AutoDJ."
echo "Log: $LOG"
