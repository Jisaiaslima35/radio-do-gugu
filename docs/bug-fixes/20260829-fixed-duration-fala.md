# Bug Fix: Duração fixa de fala injetada

**Data**: 2026-08-29
**Severidade**: MÉDIO (UX)
**Sintoma**: Falas curtas do locutor (5-8s) terminavam abruptamente, e a rádio
ficava em silêncio até o AutoDJ retomar. Falas longas (>60s) sobrepunham a
música de fundo, cortando o DJ automático do nada.

## Causa raiz

`backend/scripts/inject-pedido-gugu.sh` injetava o arquivo original sem
controlar duração. Resultado:

| Caso | Duração real | Comportamento |
|------|--------------|---------------|
| Fala curta ("Oi Gugu!") | 5-8s | Silêncio até AutoDJ retomar |
| Fala média (contação) | 25-30s | Truncava a fala no meio |
| Fala longa (conto inteiro) | 60-180s | Cortava a música abruptamente |

## Solução

Variável de ambiente `GUGU_FIXED_DURATION` (default 30s):

```bash
# Fala menor que FIXED_DURATION → adiciona silêncio no final até completar
if [ "${DUR_REAL}" -lt "${FIXED_DURATION}" ]; then
  SILENCIO_SEG=$((FIXED_DURATION - DUR_REAL))
  ffmpeg ... -i "$ARQUIVO" \
    -f lavfi -t "${SILENCIO_SEG}" -i "anullsrc=r=44100:cl=stereo" \
    -filter_complex "[0:a]asetpts=PTS-STARTPTS[v];[1:a]asetpts=PTS-STARTPTS[s];[v][s]concat=n=2:v=0:a=1[out]" \
    -map "[out]" -c:a libmp3lame "$TMP_PADDED"
fi

# Fala maior que FIXED_DURATION → trunca no limite
elif [ "${DUR_REAL}" -gt "${FIXED_DURATION}" ]; then
  ffmpeg ... -i "$ARQUIVO" -t "${FIXED_DURATION}" "$TMP_TRIM"
fi
```

Resultado: toda fala injetada tem **exatamente `FIXED_DURATION` segundos** no
ar. Independente do tamanho do texto do Hermes, a transição locutor → DJ
automático é previsível.

## Validação

```bash
# Fala de teste (26s) com FIXED_DURATION=30
sudo GUGU_FIXED_DURATION=30 /usr/local/bin/inject-pedido-gugu.sh \
  /tmp/fala_real_26s.mp3 "Conto teste"

# Log esperado:
# [inject-gugu] padded 26s → 30s (FIXED_DURATION=30)
# [inject-gugu] ffmpeg PID=... arquivo=inject_gugu_padded_*.mp3 dur=30s ...

# Sem env var, fallback para o original (sem padding)
GUGU_FIXED_DURATION=0 sudo /usr/local/bin/inject-pedido-gugu.sh audio.mp3
# Sem padding — usa arquivo original
```

## Lição aprendida

- Tempo no ar de locução precisa ser **previsível** pro AutoDJ saber quando
  retomar a playlist
- Padding com `anullsrc` é mais simples que `aevalsrc=0` e funciona em qualquer
  sample rate
- Sempre testar com falas curtas E longas antes de marcar como "fix"

## Trade-off conhecido

Quando o locutor fala por exatamente `FIXED_DURATION`, o `FIXED_DURATION`
**inclui silêncio de cauda**. Pra minimizar sensação de "morto no fim",
considerar:

- Fade-out nos últimos 2-3s do áudio injetado (workaround futuro)
- Ou usar `FIXED_DURATION` apenas pra falas curtas e deixar longas sem fixar

Status atual: **aceitável**, mas o fade-out é trabalho futuro.
