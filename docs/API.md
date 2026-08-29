# API Reference

> Base URL: `https://radiodogugu.automacaojs.us` (produção) ou `http://localhost:3006` (dev)

## Stream

### `GET /stream`
Proxy do stream ao vivo (IceCast mount `/live`). MP3 128kbps stereo.

```bash
curl -o live.mp3 http://localhost:3006/stream
ffplay http://localhost:3006/stream
```

Resposta: `audio/mpeg` streaming. Headers importantes:
- `Icy-MetaData: 0` (desabilitado pra evitar cortes)
- `Transfer-Encoding: chunked`

### `GET /api/now-playing`
Faixa atual e contagem de listeners.

```bash
curl http://localhost:3006/api/now-playing
```

Resposta:
```json
{
  "title": "REI NUCLEAR",
  "artist": "BANDA FURACÃO DO TECNO",
  "listeners": 1,
  "isLocucao": false
}
```

## Mural de pedidos

### `POST /api/oracoes`
Enfileira um pedido do mural. Pode ser conto ou música.

```bash
curl -X POST http://localhost:3006/api/oracoes \
  -H 'Content-Type: application/json' \
  -d '{
    "nome": "Conto-Pedido",
    "pedido": "O último andar",
    "contexto": "aba-conto"
  }'
```

Body (campos):
- `nome` (string, obrigatório) — Nome do "pedinte". Se for `"Conto-Pedido"` OU `contexto="aba-conto"`, é tratado como conto
- `pedido` (string, obrigatório) — Título do conto OU pedido genérico
- `username` (string, opcional) — Nome do ouvinte pro mural
- `contexto` (string, opcional) — `"aba-conto"` força modo conto

Resposta:
```json
{
  "sucesso": true,
  "oracao": {
    "id": "ped-1787961250266",
    "nome": "Conto-Pedido",
    "pedido": "O último andar",
    "fala": "Tá na mão, ... posso te contar 'Na cripta'...",
    "ehConto": true,
    "criadaEm": "2026-08-28T23:54:10.266Z"
  },
  "fila": {
    "enfileirada": true,
    "duracao": "pregar"
  }
}
```

## Chat em tempo real

### WebSocket `/socket.io/`
Conecta via Socket.IO. Eventos:

**Emitir (cliente → servidor):**
- `chat:msg` — `{ texto: string, autor?: string }`
- `mural:novo` — `{ pedido: string, autor: string }`

**Receber (servidor → cliente):**
- `chat:msg` — `{ id, texto, autor, ts }`
- `mural:novo` — `{ id, pedido, autor, ts, status }`
- `tocando:agora` — `{ title, artist, duracao }`

```js
const socket = io('http://localhost:3006');
socket.emit('chat:msg', { texto: 'Boa noite, Gugu!' });
socket.on('chat:msg', msg => console.log(msg));
```

## Acervo de contos

### `GET /api/conto/:slug`
Retorna metadados + abertura narrada de um conto do acervo.

```bash
curl http://localhost:3006/api/conto/o-barril-de-amontillado
```

Resposta:
```json
{
  "slug": "o-barril-de-amontillado",
  "titulo": "O Barril de Amontillado",
  "autor": "Edgar Allan Poe",
  "abertura": "Era de noite. Eu havia bebido demais...",
  "duracao_estimada": 1800
}
```

### `GET /api/conto/lista`
Lista todos os contos disponíveis.

```bash
curl http://localhost:3006/api/conto/lista
```

Resposta:
```json
{
  "total": 19,
  "contos": [
    { "slug": "o-barril-de-amontillado", "titulo": "O Barril de Amontillado", "autor": "Edgar Allan Poe" },
    ...
  ]
}
```

## Errors

Todos os endpoints podem retornar:
- `400 Bad Request` — body inválido
- `429 Too Many Requests` — limite de pedidos/minuto
- `502 Bad Gateway` — AzuraCast offline
- `503 Service Unavailable` — Hermes indisponível

```json
{
  "erro": "fila lotada",
  "codigo": "QUEUE_FULL",
  "detalhes": "máx 5 locuções em sequência"
}
```

## Rate limits

| Endpoint | Limite |
|----------|--------|
| POST /api/oracoes | 10 req/min por IP |
| POST /api/sala/chat | 30 req/min por IP |
| GET /stream | sem limite (é stream) |
| Demais GETs | 60 req/min por IP |
