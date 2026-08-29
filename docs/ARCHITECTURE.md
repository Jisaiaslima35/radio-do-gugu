# Arquitetura

## Visão geral

```
┌─────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   Browser   │ HTTP  │   Backend Node   │ HTTP  │   AzuraCast      │
│   (PWA)     │◄─────►│   :3006          │◄─────►│   IceCast :9010  │
│             │       │   server.cjs     │       │   Liquidsoap     │
└─────────────┘       └────────┬─────────┘       └──────────────────┘
                              │ HTTP                      ▲
                              │ (TTS)                     │ ffmpeg inject
                              ▼                            │
                       ┌──────────────┐                    │
                       │  MiniMax API │                    │
                       │  speech-2.8  │                    │
                       └──────────────┘                    │
                              ▲                            │
                              │                            │
                       ┌──────┴───────┐                    │
                       │   Hermes     │                    │
                       │  (CLI/IA)    │────────────────────┘
                       │  perfil      │   /usr/local/bin/inject-pedido-gugu.sh
                       │  radio-gugu  │
                       └──────────────┘
```

## Componentes

### Frontend (PWA)
- Vanilla JS — **sem build step** (basta servir arquivos estáticos)
- Service Worker (`sw.js`) com cache-first pra assets
- 2 páginas: `index.html` (player) e `sala.html` (chat + mural)
- Audio player usando `<audio>` HTML5 consumindo `/stream`

### Backend Node.js (`server.cjs`)
- Single process que serve API + arquivos estáticos
- WebSocket via `socket.io` pro chat real-time
- HTTP proxy pro stream IceCast (`/stream`)
- Endpoints REST pro mural, acervo, chat

### Hermes (perfil `radio-gugu`)
- CLI local chamado via `hermes_call_gugu.sh`
- Tem skill `mentor-contos-terror` (e-book splitado)
- Configurado pra responder como "Gugu, locutor de contos"
- TTS via MiniMax API (não via token-plan, via Audio Starter)

### AzuraCast (AutoDJ)
- Estação 7 do AzuraCast
- Mount `/live` exposto na porta 9010 (interno) → 9040 (icecast interno) → 8000 (exposto)
- Playlists em MariaDB (tabela `station_playlists`)
- **Schedule OBRIGATÓRIO** em `station_schedules` (caso contrário fila vazia)

## Fluxo de um pedido

1. Usuário clica chip "O último andar" no mural → POST `/api/oracoes`
2. Backend detecta `ehConto=true` (nome=Conto-Pedido OU contexto=aba-conto)
3. Backend injeta catálogo no prompt do Hermes
4. Hermes gera fala tipo "Esse não tá no porão, mas posso te contar X..."
5. Backend enfileira na fila única (`emitterFala`)
6. Worker processa: `falar_gugu.sh` → MiniMax TTS → MP3
7. `hermes_call_gugu.sh` monta fala+silêncio+vinheta via ffmpeg
8. `inject-pedido-gugu.sh` injeta no harbor 9045/live via ffmpeg
9. Liquidsoap toca no mount /live, AutoDJ retoma quando acaba

## Decisões arquiteturais

### Por que single-process Node.js?
- Simplicidade operacional (1 systemd unit)
- WebSocket + HTTP no mesmo processo
- Sem camada de banco (estado efêmero em memória)

### Por que PWA sem framework?
- PWA instalável sem App Store
- Service Worker dá offline-first nativo
- Zero build step (edita, refresh)
- Bundle final < 50KB

### Por que AzuraCast e não Liquidsoap direto?
- UI de gerenciamento de mídia
- AutoDJ com scheduler visual
- Stream relay (Zeno.fm) configurável
- API REST pra integração

### Por que MiniMax e não Coqui/Chatterbox?
- Qualidade superior em PT-BR
- Voz grave masculina nativa (`Portuguese_Deep-VoicedGentleman`)
- Plano Audio Starter barato (R$13,50)

## Variáveis de ambiente

Veja `.env.example`. Críticas:

- `PORT` — porta do backend (default 3006)
- `HERMES_BIN` — caminho do hermes CLI
- `HERMES_PROFILE` — perfil do Hermes (default `radio-gugu`)
- `AZURACAST_HOST` — host do AzuraCast (default `localhost`)
- `AZURACAST_PORT` — porta do mount /live (default 9010)

## Ports

| Serviço | Porta interna | Exposição |
|---------|---------------|-----------|
| Backend Node.js | 3006 | nginx :80 → CF Tunnel |
| AzuraCast icecast | 8000 | localhost only |
| AzuraCast liquidsoap | 9010/9040 | localhost only |
| Redis (Valkey) | 6379 | localhost only |
| MariaDB | 3306 | localhost only |
