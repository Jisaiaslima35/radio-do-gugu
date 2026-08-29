# Setup da estação AzuraCast

## Criar estação via UI

1. Acesse http://localhost:8000 (AzuraCast admin)
2. Vá em **Stations → Add Station**
3. Configurações:
   - **Name**: Rádio do Gugu
   - **Description**: Contos de Terror na madrugada
   - **Genre**: Terror / Brega
   - **Timezone**: America/Sao_Paulo
   - **Enable Streamers**: ✅ ON (pra DJ inject)
   - **Source**: SHOUTcast (legacy compatibility)

## Criar playlist

1. **Playlists → Add Playlist**
2. **Name**: default
3. **Type**: Default
4. **Source**: Songs
5. **Playback Order**: Random
6. **Weight**: 7
7. Adicione as 4+ mídias tecnobrega

## CRÍTICO: criar schedule 24/7

AutoDJ **NÃO** popula fila sozinho. Precisa de schedule:

```bash
sudo docker exec azuracast mariadb -uazuracast -pSENHA azuracast -e "
INSERT INTO station_schedules (playlist_id, start_time, end_time, days, loop_once)
VALUES ({playlist_id}, 0, 2359, '1,2,3,4,5,6,7', 0);
"
```

> `start_time`/`end_time` são HHMM (smallint), NÃO segundos.
> 0 = 00:00, 2359 = 23:59. Não cabe valores > 32767 em smallint.

## Configurar DJ Source

Para o `inject-pedido-gugu.sh` funcionar:

1. Vá em **Stations → [Sua Estação] → Streamer/DJ**
2. Copie o **Mount Name** e **Password** (geralmente `/live` e uma string aleatória)
3. Configure em `backend/lib/inject-pedido-gugu.sh`:

```bash
HARBOR_HOST=127.0.0.1
HARBOR_PORT=9045  # veja a config da estação
HARBOR_PASSWORD=SUA_SENHA_AQUI
HARBOR_MOUNT=/live
```

## Substituir error.mp3

IceCast tem fallback `error.mp3` em inglês system-wide. Trocar por silêncio:

```bash
ffmpeg -f lavfi -t 30 -i "anullsrc=r=44100:cl=stereo" \
    -ac 2 -ar 44100 -codec:a libmp3lame -b:a 128k /tmp/silence.mp3

sudo docker cp /tmp/silence.mp3 azuracast:/usr/local/share/icecast/web/error.mp3
```

## Upload de mídia

Via UI em **Stations → [Estação] → Media** ou via SFTP (porta 2022, user `azuracast`):

```bash
sftp -P 2022 azuracast@localhost
> cd stations/radio_gugu/media
> put minha-musica.mp3
> bye
```

Depois clique **Rescan** na UI de mídia.

## Restartar estação

```bash
# Backend (liquidsoap)
sudo docker exec azuracast supervisorctl restart station_7:station_7_backend

# Frontend (icecast)
sudo docker exec azuracast supervisorctl restart station_7:station_7_frontend

# Ambos
sudo docker exec azuracast supervisorctl restart station_7:
```

## Forçar repopulação da fila

Se a fila esvaziar (sem schedule):

```bash
sudo docker exec azuracast php /var/azuracast/www/backend/bin/console \
    azuracast:sync:nowplaying:station 7
```
