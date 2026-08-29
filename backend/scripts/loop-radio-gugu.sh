#!/usr/bin/env bash
# loop-radio-gugu.sh — Mantém a AutoDJ do radio-gugu tocando em loop
# Cria: 28/08/2026
#
# Problema: a estação 7 do AzuraCast (radio_gugu) tem só 4 MP3s. Quando toca
# tudo, a station_queue esvazia e o liquidsoap cai no fallback error.mp3.
#
# Solução: este script re-popula a station_queue com os 4 itens da playlist,
# escalonando timestamps em 1s de intervalo. Rodar a cada ~12 min via cron.
#
# Como o liquidsoap lê da queue (não do filesystem via playlist source=songs),
# sem re-população ele para depois de 1 ciclo.
#
# Uso:
#   bash /root/radio-gugu-music/scripts/loop-radio-gugu.sh [station_id]
#   # default station_id=7
#
# Gotcha: NÃO mexer em is_played=1 (mantém histórico), só INSERT novos rows.
# O AzuraCast marca os antigos como played e os novos entram em produção.

set -euo pipefail

STATION_ID="${1:-7}"
LOG_TAG="[loop-radio-gugu]"

echo "${LOG_TAG} populando station_queue da estação ${STATION_ID}"

sudo docker exec azuracast mariadb -uroot -pFr7tg6LYaEnRyGk3afdf azuracast -e "
INSERT INTO station_queue
  (song_id, station_id, playlist_id, media_id, sent_to_autodj, is_played, is_visible,
   timestamp_cued, duration, artist, title)
SELECT
  CONCAT('media:', sm.id),
  ${STATION_ID},
  (SELECT id FROM station_playlists WHERE station_id = ${STATION_ID} AND is_enabled = 1 LIMIT 1) AS playlist_id,
  sm.id,
  0, 0, 1,
  NOW(6) + INTERVAL (ROW_NUMBER() OVER (ORDER BY sm.id)) SECOND,
  sm.length,
  sm.artist,
  sm.title
FROM station_media sm
INNER JOIN storage_location sl ON sl.id = sm.storage_location_id
WHERE sl.path = CONCAT('/var/azuracast/stations/', (
    SELECT CONCAT(short_name) FROM station WHERE id = ${STATION_ID}
  ), '/media')
  AND NOT EXISTS (
    SELECT 1 FROM station_queue q
    WHERE q.station_id = ${STATION_ID} AND q.media_id = sm.id AND q.is_played = 0
  );
" 2>&1 | tail -3

# Forçar liquidsoap a recarregar (pega da queue)
sudo docker exec azuracast curl -s -X POST "http://127.0.0.1:9041/playlist.skip" >/dev/null 2>&1 || true

NEW=$(sudo docker exec azuracast mariadb -uroot -pFr7tg6LYaEnRyGk3afdf azuracast -N -B -e "
SELECT COUNT(*) FROM station_queue WHERE station_id=${STATION_ID} AND is_played=0 AND sent_to_autodj=0;
" 2>&1 | tail -1)

echo "${LOG_TAG} ✅ fila populada: ${NEW} itens não tocados"
