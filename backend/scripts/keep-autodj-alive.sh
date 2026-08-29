#!/usr/bin/env bash
# =============================================================================
# keep-autodj-alive.sh — Mantém fila AutoDJ sempre populada (Rádio do Gugu)
# =============================================================================
# Problema: AzuraCast NÃO popula station_queue sozinho mesmo com
# station_schedules. O trigger é o worker "azuracast:sync:nowplaying:station {id}"
# ou um INSERT direto em station_queue com sent_to_autodj=0.
#
# Solução: este script:
# 1. Insere rows em station_queue (a partir de station_playlist_media) com
#    timestamp_cued escalonado e sent_to_autodj=0
# 2. Chama azuracast:sync:nowplaying:station 7 (trigger BuildQueueTask)
# 3. Limpa station_queue antiga (is_played=1 com mais de 24h)
#
# Rodar a cada 1 minuto via cron:
#   * * * * * /root/radio-gugu-music/scripts/keep-autodj-alive.sh >> /root/radio-gugu-music/logs/keep-autodj.log 2>&1
#
# Gotcha: SQL direto em station_queue NÃO popula liquidsoap automaticamente
# — precisa do sync trigger. Sem trigger, queue fica com rows mas liquidsoap
# não vê.
# =============================================================================

set -euo pipefail

STATION_ID="${1:-7}"
LOG_TAG="[keep-autodj-alive]"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
echo "${LOG_TAG} $(date) — populando fila estação ${STATION_ID}"

# Credenciais root do MariaDB dentro do container AzuraCast
DB_USER="root"
DB_PASS="Fr7tg6LYaEnRyGk3afdf"
DB_NAME="azuracast"

# 1. INSERT novos rows em station_queue a partir das mídias da playlist default
#    (não duplica: WHERE NOT EXISTS checa rows ainda não-tocadas pra mesma mídia)
sudo docker exec azuracast mariadb -u${DB_USER} -p${DB_PASS} ${DB_NAME} -e "
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
INNER JOIN station_playlist_media spm ON spm.media_id = sm.id
INNER JOIN station_playlists sp ON sp.id = spm.playlist_id
WHERE sl.path = CONCAT('/var/azuracast/stations/', (
    SELECT short_name FROM station WHERE id = ${STATION_ID}
  ), '/media')
  AND sp.station_id = ${STATION_ID}
  AND sp.is_enabled = 1
  AND NOT EXISTS (
    SELECT 1 FROM station_queue q
    WHERE q.station_id = ${STATION_ID} AND q.media_id = sm.id AND q.is_played = 0
  );
" 2>&1 | tail -2

# 2. Trigger BuildQueueTask (sync nowplaying) — pega rows novas da queue
#    NOTA: pode dar 401 warning se API key mudou, mas mesmo assim o build da
#    queue acontece via WorkerPool. Vamos tentar de 2 formas:
#
#    Forma A: azuracast CLI (pode falhar com 401 em algumas versões)
sudo docker exec azuracast php /var/azuracast/www/backend/bin/console \
    azuracast:sync:nowplaying:station ${STATION_ID} 2>&1 | tail -3 || true

#    Forma B: força um nextsong HTTP API no liquidsoap (sempre funciona)
#    Isso faz o liquidsoap checar a queue imediatamente
sudo docker exec azuracast curl -s -X POST "http://127.0.0.1:9041/playlist.skip" \
    >/dev/null 2>&1 || true

# 3. Cleanup station_queue velha (> 24h, tocada)
sudo docker exec azuracast mariadb -u${DB_USER} -p${DB_PASS} ${DB_NAME} -e "
DELETE FROM station_queue
WHERE station_id = ${STATION_ID}
  AND is_played = 1
  AND timestamp_cued < DATE_SUB(NOW(), INTERVAL 24 HOUR);
" 2>&1 | tail -1

# 4. Reporta estado atual da fila
NEW=$(sudo docker exec azuracast mariadb -u${DB_USER} -p${DB_PASS} ${DB_NAME} -N -B -e "
SELECT COUNT(*) FROM station_queue
WHERE station_id=${STATION_ID} AND is_played=0 AND sent_to_autodj=0;
" 2>&1 | tail -1)

PLAYED=$(sudo docker exec azuracast mariadb -u${DB_USER} -p${DB_PASS} ${DB_NAME} -N -B -e "
SELECT COUNT(*) FROM station_queue
WHERE station_id=${STATION_ID} AND is_played=1;
" 2>&1 | tail -1)

echo "${LOG_TAG} ✅ fila: ${NEW} não-tocadas, ${PLAYED} tocadas"