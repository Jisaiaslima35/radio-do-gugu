# Bug Fix: Vinheta em inglês tocando no AutoDJ

**Data**: 2026-08-29
**Severidade**: ALTO (quebrava experiência do usuário)
**Sintoma**: Quando playlist acabava, AutoDJ tocava uma vinheta em inglês repetidamente, consumindo créditos do MiniMax por engano.

## Causa raiz

IceCast tem um **fallback system-wide** em `/usr/local/share/icecast/web/error.mp3`. Quando o liquidsoap não tem nada na fila E não tem playlist agendada, o servidor icecast serve esse arquivo. Por padrão, ele é uma vinheta genérica em inglês.

Isso fez o usuário pensar que a estação estava "em loop direto" tocando a mesma coisa. Pior: o backend (sem saber) tentava gerar fala via TTS MiniMax pra "substituir", gerando gasto desnecessário de R$13,50 do plano Audio Starter.

## Solução

Substituir `error.mp3` por **silêncio de 30s**:

```bash
# Gerar silêncio
ffmpeg -f lavfi -t 30 -i "anullsrc=r=44100:cl=stereo" \
    -ac 2 -ar 44100 -codec:a libmp3lame -b:a 128k /tmp/silence_30s.mp3

# Backup do original
sudo docker exec azuracast cp /usr/local/share/icecast/web/error.mp3 \
    /usr/local/share/icecast/web/error.mp3.bak-20260829

# Substituir
sudo docker cp /tmp/silence_30s.mp3 azuracast:/usr/local/share/icecast/web/error.mp3

# Restart icecast pra recarregar
sudo docker exec azuracast supervisorctl restart station_7:station_7_frontend
```

## Validação

```bash
# Toca o erro e verifica tamanho
sudo docker exec azuracast ls -la /usr/local/share/icecast/web/error.mp3
# Esperado: ~400KB (30s * 128kbps / 8)

# Verifica duration real
ffprobe /tmp/silence_30s.mp3
# Esperado: Duration: 00:00:30.00
```

## Lição aprendida

- IceCast fallback é **system-wide**, não por estação
- Sempre substituir por silêncio em rádios PT-BR (ou pelo menos pela vinheta certa)
- Documentar em `azuracast/station-setup.md`
- Adicionar ao wizard de criação de rádio
