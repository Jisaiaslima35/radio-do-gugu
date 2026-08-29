# Bug Fix: AutoDJ não popula fila sem schedule

**Data**: 2026-08-29
**Severidade**: CRÍTICO (estação 100% parada)
**Sintoma**: Após playlist acabar, fila esvazia. AutoDJ chama `nextsong` a cada 10s mas recebe "Queue is empty".

## Causa raiz

A documentação do AzuraCast não deixa claro, mas a tabela `station_schedules` é **obrigatória** mesmo usando playlist `default`. O `BuildQueueTask` (que popula a fila) só roda quando:

1. Há uma schedule ativa naquele momento
2. OU o worker `azuracast:sync:nowplaying:station {id}` é chamado manualmente

Sem schedule 24/7, mesmo com playlist `default` de weight alto, a fila fica vazia.

## Sintomas

- `song_history` para de receber registros
- liquidsoap log: `Queue is empty!`
- `harbor 9040/live` continua UP mas sem conteúdo
- Stream fica mudo (ou toca error.mp3 fallback)

## Solução

```sql
-- Ver schedules existentes
SELECT * FROM station_schedules WHERE playlist_id IN (
    SELECT id FROM station_playlists WHERE station_id = {station_id}
);

-- Criar schedule 24/7
INSERT INTO station_schedules (playlist_id, start_time, end_time, days, loop_once, start_date, end_date)
VALUES ({playlist_id}, 0, 2359, '1,2,3,4,5,6,7', 0, NULL, NULL);

-- Forçar repopulação imediata
sudo docker exec azuracast php /var/azuracast/www/backend/bin/console \
    azuracast:sync:nowplaying:station {station_id}
```

## Gotcha: formato HHMM vs segundos

```sql
-- ❌ ERRADO (segundos): gera "out of range value for column 'end_time'"
INSERT INTO station_schedules (start_time, end_time) VALUES (0, 86399);

-- ✅ CERTO (HHMM, smallint 0-2359)
INSERT INTO station_schedules (start_time, end_time) VALUES (0, 2359);
```

Smallint cabe até 32767, então 2359 é o último horário válido (23:59).

## Comandos AzuraCast CLI

| Comando | Efeito |
|---------|--------|
| `azuracast:sync:nowplaying:station {id}` | Roda BuildQueueTask + atualiza metadata |
| `azuracast:station-queues:clear` | Limpa fila da estação |
| `azuracast:sync:run` | Sincroniza TUDO (pesado) |

## Lição aprendida

- **Sempre** criar schedule 24/7 ao criar estação nova, mesmo que seja trivial
- Documentar isso no `azuracast/station-setup.md`
- Adicionar check de "tem pelo menos 1 schedule 24/7" no wizard de criação
