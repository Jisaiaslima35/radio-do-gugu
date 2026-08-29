# Bug Fix: AutoDJ não retoma após fala do locutor

**Data**: 2026-08-29
**Severidade**: CRÍTICO (quebra a rádio inteira — silêncio permanente após fala)
**Sintoma**: Quando o locutor IA fala via mount `/live`, a fala toca normalmente. Quando termina, a rádio fica em silêncio até intervenção manual. O AutoDJ não retoma.

## Causa raiz

`input.harbor(icy = true, port = 9045)` no AzuraCast faz o liquidsoap **parsear
metadados ICY** enviados por clientes DJ. Quando o cliente ffmpeg desconecta
(após EOF do MP3 injetado), o liquidsoap tenta fazer parse de um header ICY
parcial → `Failure("int_of_string")` → **stream trava em estado de erro**, sem
transição `live → radio`.

Antes do fix:
```
2026/08/29 00:50:42 [input_streamer:2] Error while reading from client: Failure("int_of_string")
2026/08/29 00:50:42 [input_streamer:2] Feeding stopped: Ffmpeg_decoder.End_of_file
2026/08/29 00:50:42 [azuracast.api:3] API djoff ... Response (200): true
# ... silêncio pra sempre. AutoDJ não retorna.
```

## Sintomas reproduzidos

- Mural do medo: usuário pede conto → Hermes gera fala → backend injeta
  no `/live` → fala toca (5-8s) → silêncio permanente até alguém reiniciar o
  backend ou matar o `station_7:station_7_backend`
- AutoDJ tocando playlist inteira: nenhuma retomada entre locução e música

## Solução

Mudar `icy = true` → `icy = false` em
`/var/azuracast/stations/<station_short_name>/config/liquidsoap.liq`:

```liquidsoap
# ❌ ERRADO (padrão AzuraCast, quebra com clientes ffmpeg)
live = input.harbor({...}, port = 9045, auth = azuracast.dj_auth, icy = true, ...)

# ✅ CERTO (cliente envia bytes puros, sem header ICY)
live = input.harbor({...}, port = 9045, auth = azuracast.dj_auth, icy = false, ...)
```

Com `icy = false`:
- Cliente ffmpeg envia MP3 puro (sem header ICY) → sem `int_of_string`
- `Failure("int_of_string")` AINDA pode aparecer no log quando cliente
  desconecta, mas é **tratado como warning** — não trava o stream
- Transição `live → radio` acontece normalmente após EOF

Depois do fix:
```
2026/08/29 00:51:45 [live_fallback:3] Switch to input_streamer with transition.
2026/08/29 00:51:45 [lang:3] executing transition to live
2026/08/29 00:52:10 [input_streamer:2] Error while reading from client: Failure("int_of_string")
2026/08/29 00:52:10 [input_streamer:2] Feeding stopped: Ffmpeg_decoder.End_of_file
2026/08/29 00:52:15 [live_fallback:3] Switch to metadata_deduplicate with transition.   ← ✅ AutoDJ retomou!
```

## Aplicação

```bash
# Aplicar o fix no container AzuraCast
sudo docker exec azuracast bash -c \
  'sed -i "s/icy = true/icy = false/g" /var/azuracast/stations/radio_gugu/config/liquidsoap.liq'

# Reiniciar liquidsoap pra recarregar config
sudo docker exec azuracast supervisorctl restart station_7:station_7_backend

# Confirmar que aplicou
sudo docker exec azuracast grep "icy" /var/azuracast/stations/radio_gugu/config/liquidsoap.liq
# Esperado: ..., icy = false, ...
```

## Validação E2E

```bash
# 1. Disparar fala real via mural
curl -X POST http://localhost:3006/api/oracoes \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Conto-Pedido","pedido":"Conte o conto O último andar"}'

# 2. Esperar ~15s (Hermes processa + fala TTS + injeta)

# 3. Verificar liquidsoap.log
sudo docker exec azuracast tail -30 \
  /var/azuracast/stations/radio_gugu/config/liquidsoap.log | \
  grep -E "Switch to|transition|End_of_file|int_of_string"

# Esperado:
#   Switch to input_streamer with transition.   ← fala assume
#   executing transition to live
#   Feeding stopped: Ffmpeg_decoder.End_of_file ← fala termina
#   Switch to metadata_deduplicate with transition.  ← AutoDJ retomou ✅
```

## Lição aprendida

- `icy = true` assume cliente tipo Winamp/Butt (envia metadados ICY binários)
- `icy = false` é o modo correto pra scripts headless (ffmpeg direto, gstreamer)
- Sempre validar `live → radio` transition depois de mexer em `input.harbor`
- `Failure("int_of_string")` é o sintoma universal de mismatch de protocolo ICY

## Script relacionado

`backend/scripts/inject-pedido-gugu.sh` — usa ffmpeg com
`icy_metadata_charset=UTF-8` mas **sem enviar headers ICY**, justamente pra
casar com `icy = false` no liquidsoap. Combinado, o sistema funciona:

```bash
ffmpeg -re -i audio.mp3 -c:a libmp3lame -b:a 128k \
  -f mp3 -content_type audio/mpeg \
  http://source:PASSWORD@host:9045/live
```

**Gotcha**: NÃO adicione `-ice_name` / `-ice_description` (causava `int_of_string`
no Devocional 12 e voltaria a quebrar aqui também).
