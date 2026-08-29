# Prompt Google Studio — Rádio do Gugu (BRIEFING COMPLETO)

> **Cole este prompt no Google Studio** (após autenticar com a conta
> `jose.isaias@alunos.ifsuldeminas.com.br` ou similar). O Studio vai ler o
> repositório público `https://github.com/Jisaiaslima35/radio-do-gugu` e
> refatorar o frontend.
>
> **Isaías fornecerá uma foto/mock do design desejado depois.** Por enquanto,
> use os wireframes ASCII desta página como referência estrutural (a foto vai
> refinar layout, não mudar contratos).

---

## 🎯 MISSÃO

Refatorar o frontend da Rádio do Gugu mantendo o comportamento funcional mas
**modernizando UX/UI**. O backend Node.js (porta 3006) já está pronto e
exposto em produção via Cloudflare Tunnel. Sua tarefa é construir uma UI
mobile-first, PWA instalável, que consuma os endpoints abaixo.

**Trabalhe sobre o código em `https://github.com/Jisaiaslima35/radio-do-gugu/tree/main/frontend/`.**

---

## 📦 CONTEXTO TÉCNICO

| Item | Valor |
|------|-------|
| Backend URL (prod) | `https://radiodogugu.automacaojs.us` |
| Backend URL (dev local) | `http://localhost:3006` |
| Backend URL (preview) | `https://radio-do-gugu-preview.automacaojs.us` |
| Framework atual | Vanilla JS (sem build step) |
| Stack alvo | Sua escolha (Vite+React, Svelte, vanilla refinado) |
| Mobile-first | SIM — 70% usuários são Android, bottom-nav obrigatório em < 720px |
| PWA | Manifest + Service Worker + offline-first (cache: network-first p/ /stream) |
| Tema | Dark mode, tons roxos/laranjas (terror noturno) |
| Audio engine | HTML5 `<audio>` apontando pra `/stream` (proxy do icecast) |
| Real-time | Socket.IO pro chat e mural |

---

## 🏗️ ARQUITETURA DO BACKEND (pra você entender o que tá consumindo)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Usuário (PWA / browser / Android app)                               │
│       │                                                             │
│       │ HTTP/WS                                                     │
│       ▼                                                             │
│ ┌─────────────────────────────────────────────────┐                 │
│ │ Cloudflare Edge (radiodogugu.automacaojs.us)    │                 │
│ └─────────────────────────────────────────────────┘                 │
│       │                                                             │
│       ▼                                                             │
│ ┌─────────────────────────────────────────────────┐                 │
│ │ Backend Node.js (Express + Socket.IO, porta 3006)│                │
│ │                                                  │                │
│ │  • /api/* endpoints (REST)                       │                │
│ │  • /stream (proxy icecast → HTML5 audio)         │                │
│ │  • Socket.IO eventos (chat, mural, broadcast)    │                │
│ │  • Fila in-memory de locuções Gugu               │                │
│ │  • Spawna `hermes_call_gugu.sh` p/ cada locução  │                │
│ └─────────────────────────────────────────────────┘                 │
│       │                                                             │
│       │  TTS (MiniMax Portuguese_Deep-VoicedGentleman)             │
│       ▼                                                             │
│ ┌─────────────────────────────────────────────────┐                 │
│ │ AzuraCast (estação 7, container Docker)          │                │
│ │                                                  │                │
│ │  • input.harbor port 9045 (DJ mount /live)       │                │
│ │  • AutoDJ (playlist 24/7 com brega do nordeste)  │                │
│ │  • Icecast server porta 9040 (output público)    │                │
│ └─────────────────────────────────────────────────┘                 │
│       │                                                             │
│       ▼                                                             │
│  Ouvinte: stream MP3 128kbps via /stream                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Fluxo típico de "pedir um conto":**

1. Frontend faz `POST /api/oracoes` com `{nome: "Conto-Pedido", pedido: "O último andar"}`
2. Backend classifica (ehConto=true via nome/aba) e chama Hermes (LLM com skill `mentor-contos-terror`)
3. Hermes devolve fala (texto curto, tom grave de locutor de terror)
4. Backend enfileira locução in-memory
5. Backend spawna `hermes_call_gugu.sh` que:
   - Chama MiniMax TTS (voice: `Portuguese_Deep-VoicedGentleman`)
   - Concatena com vinheta de cabeça/cauda
   - Injeta no mount `/live` via `inject-pedido-gugu.sh` (ffmpeg)
   - AutoDJ volta sozinho após 30s (FIXED_DURATION)
6. Socket.IO emite `oracao-nova` pra todos os clientes conectados → mural atualiza em real-time

---

## 🔌 CONTRATOS DA API (TODOS OS ENDPOINTS PÚBLICOS)

Base URL: `https://radiodogugu.automacaojs.us` (produção)
CORS: liberado pra qualquer origem (`Access-Control-Allow-Origin: *`)
Sem autenticação — todos endpoints abaixo são públicos.

### 1. Health check
```http
GET /api/health
```
**Response 200:**
```json
{ "ok": true, "service": "radio-gugu", "port": 3006, "uptime": 12345.67 }
```
Uso: ping pra ver se backend tá no ar.

---

### 2. Now playing (o que tá tocando agora)
```http
GET /api/now-playing
```
**Response 200:**
```json
{
  "title": "REI NUCLEAR",
  "artist": "BANDA FURACÃO DO TECNO",
  "listeners": 23,
  "bitrate": 192,
  "server_name": "Radio do Gugu"
}
```
**Resposta em caso de erro do icecast:**
```json
{ "title": "", "artist": "", "listeners": 0, "error": "icecast offline" }
```
Uso: atualizar UI do player a cada 10-15s. **SEMPRE trate o caso de campos vazios** — significa silêncio entre faixas ou erro upstream.

---

### 3. Stream de áudio (proxy)
```http
GET /stream
```
**Response 200:** `Content-Type: audio/mpeg`, `Cache-Control: no-cache`, MP3 128kbps contínuo.
**Response 502:** `{ "error": "stream indisponivel" }` se icecast offline.

Uso: o `<audio>` HTML5 aponta direto pra `/stream`. Conexão persistente. O backend faz proxy transparente do icecast estação 7 (porta 9040) → cliente.

**Latência esperada:** 2-4s entre o AutoDJ tocar e o cliente ouvir (buffer do icecast + crossfade).

---

### 4. Mural — pedir locução/fala (POST = endpoint principal)
```http
POST /api/oracoes
Content-Type: application/json

{
  "nome": "string (obrigatório, máx 50 chars)",
  "pedido": "string (obrigatório, máx 500 chars)",
  "contexto": "string opcional — passe 'aba-conto' se veio da aba de contos"
}
```
**Exemplo real:**
```bash
curl -X POST https://radiodogugu.automacaojs.us/api/oracoes \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Conto-Pedido","pedido":"Conte o conto O último andar"}'
```
**Response 202 (sucesso — locução enfileirada):**
```json
{
  "sucesso": true,
  "oracao": {
    "id": "ped-1787964690889",
    "nome": "Conto-Pedido",
    "pedido": "Conte o conto O último andar",
    "fala": "Pega o fone, criatura... Tá na mão, Conto-Pedido. Esse não tá no porão do Gugu...",
    "ehConto": true,
    "criadaEm": "2026-08-29T00:51:30.889Z"
  },
  "fila": { "enfileirada": true, "duracao": "pregar" }
}
```
**Response 400 (validação):**
```json
{ "erro": "nome e pedido obrigatórios" }
```

**Regras de classificação (`ehConto`):**
- `ehConto = true` se `nome === "Conto-Pedido"` OU `contexto === "aba-conto"` OU texto contém "conto/terror/medo/história"
- Se true → `duracao: "pregar"` (falas longas, até 180s, conta um conto)
- Se false → `duracao: "curta"` (falas curtas, ~30s, Locução Gugu genérica)

**Latência esperada:** 2-8s (Hermes processa + gera fala TTS + injeta no ar).

---

### 5. Mural — histórico (mock, vazio por enquanto)
```http
GET /api/oracoes
```
**Response 200:**
```json
{ "total": 0, "recentes": [] }
```
Uso: backend retorna mock vazio hoje. Use Socket.IO `oracao-nova` pra receber real-time.

---

### 6. Mural — alias retrocompat
```http
GET /api/mural  →  307 redirect → /api/oracoes
POST /api/mural  →  307 redirect → /api/oracoes
```

---

### 7. Fila de locuções em andamento
```http
GET /api/fila
```
**Response 200:**
```json
{
  "processando": false,
  "tamanho": 0,
  "itens": [],
  "stats": { "processadas": 6, "erros": 0, "ultimoTempoSeg": 45 }
}
```
Uso: indicador "Gugu tá falando agora" se `processando: true`.

---

### 8. Catálogo de música brega (legado)
```http
GET /api/catalogo
```
**Response 200:**
```json
{
  "total": 13,
  "faixas": [
    { "titulo": "REI NUCLEAR", "artista": "BANDA FURACÃO DO TECNO", "arquivo": "19-banda-furacao-do-tecno-rei-nuclear.mp3" }
  ]
}
```

---

### 9. Sala privada (chat 1:1 com Gugu)
```http
POST /api/sala/message
Content-Type: application/json

{
  "username": "string (obrigatório)",
  "text": "string (obrigatório)",
  "conto_slug": "string opcional — slug do conto pra dar contexto ao Hermes"
}
```
**Response 200:**
```json
{
  "resposta": "Boa noite, criatura. Esse conto é denso — Edgar Allan Poe costura culpa, vingança e um barril de Amontillado como metáfora pro enterro simbólico. Quer que eu conte no ar?",
  "pode_enviar_para_radio": true,
  "conto_usado": "poe-barril-amontillado"
}
```
Uso: chat lateral (não vai pro ar, só entre usuário e Gugu).

---

### 10. Sala — enviar fala pra rádio (botão "mandar pro ar")
```http
POST /api/sala/broadcast
Content-Type: application/json

{
  "username": "string (obrigatório)",
  "fala": "string (obrigatório) — texto que o Hermes gerou"
}
```
**Response 200:**
```json
{ "sucesso": true, "mensagem": "Fala enviada pra rádio" }
```
Uso: botão na sala que injeta a fala do chat no ar da rádio.

---

### 11. Acervo de contos — catálogo
```http
GET /api/catalogo-contos
```
**Response 200:**
```json
{
  "total": 19,
  "contos": [
    {
      "num": 1,
      "slug": "poe-barril-amontillado",
      "titulo": "O Barril de Amontillado",
      "autor": "Edgar Allan Poe",
      "tipo": "psicologico",
      "duracao": "15min",
      "sinopse": "Montresor vinga-se de Fortunato..."
    }
  ]
}
```

---

### 12. Acervo de contos — conteúdo completo
```http
GET /api/conto/:slug
```
**Exemplo:** `GET /api/conto/poe-barril-amontillado`

**Response 200:**
```json
{
  "num": 1,
  "slug": "poe-barril-amontillado",
  "titulo": "O Barril de Amontillado",
  "autor": "Edgar Allan Poe",
  "tipo": "psicologico",
  "duracao": "15min",
  "sinopse": "Montresor vinga-se de Fortunato...",
  "introducao": "# O Barril de Amontillado\n\nConto de Edgar Allan Poe...",
  "conteudo": "Eu supporteis mil injúrias...",
  "chunks_count": 12
}
```
**Response 404:**
```json
{ "erro": "conto nao encontrado", "slug": "invalido" }
```

---

## 📡 EVENTOS SOCKET.IO

O backend expõe Socket.IO no mesmo host. Conecte-se com biblioteca padrão.

### Cliente conecta e recebe:

| Evento | Payload | Quando dispara |
|--------|---------|----------------|
| `oracao-nova` | `{ id, nome, pedido, fala, ehConto, criadaEm }` | Mural aceitou nova locução |
| `sala-broadcast` | `{ username, fala, timestamp }` | Alguém mandou fala da sala pro ar |

### Cliente pode emitir:

| Evento | Payload | Efeito |
|--------|---------|--------|
| (nenhum público — chat vai por HTTP POST /api/sala/message) | — | — |

### Exemplo de conexão (JS):
```javascript
import { io } from "socket.io-client";
const socket = io("https://radiodogugu.automacaojs.us");

socket.on("oracao-nova", (oracao) => {
  console.log("Nova locução:", oracao);
  // animar mural, mostrar "Gugu vai falar: ..."
});

socket.on("sala-broadcast", ({ username, fala }) => {
  console.log(`${username} mandou pro ar: ${fala}`);
});
```

---

## 🧪 COMO TESTAR ENQUANTO DESENVOLVE

Você **pode e deve** testar contra o backend de produção — é seguro, é público,
e é o mesmo contrato que vai rodar no app final.

### Setup mínimo pra testar:

```bash
# 1. Health check
curl https://radiodogugu.automacaojs.us/api/health

# 2. Now playing
curl https://radiodogugu.automacaojs.us/api/now-playing

# 3. Stream (em background ou player)
# Cole isso no <audio src="https://radiodogugu.automacaojs.us/stream">

# 4. Mural (vai pro ar — cuidado pra não spammar!)
curl -X POST https://radiodogugu.automacaojs.us/api/oracoes \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Studio-Test","pedido":"Conte algo de terror bem rapidinho"}'

# 5. Catálogo de contos
curl https://radiodogugu.automacaojs.us/api/catalogo-contos | jq '.contos | length'
# Esperado: 19
```

### Validações que o Isaías espera que você rode:

1. **Player toca** — abra `/` no navegador, veja `<audio src="/stream">` rodando
2. **Mural envia** — clique "Pedir", espere 5-10s, veja Socket.IO atualizar mural com fala nova
3. **Chat responde** — `POST /api/sala/message` retorna texto PT-BR do Gugu em < 8s
4. **Contos lista** — `/contos` mostra 19 cards com botão "Ouvir abertura" (chama TTS)
5. **PWA instala** — Android Chrome mostra "Adicionar à tela inicial"
6. **Offline graceful** — desligue rede, PWA mostra cache de aberturas mas avisa "sem stream"

### Limites e gotchas que vão te economizar tempo:

- **`/stream` é proxy, não redirect** — CORS já tá ok, mas se virar `<audio crossorigin>` precisa lidar
- **Locução demora 5-10s** — mostrar "Gugu tá preparando..." durante, não travar UI
- **Agora tocando pode vir vazio** (`title: ""`) entre faixas — não é bug, é silêncio natural
- **`processando: true` em `/api/fila`** = tem fala sendo injetada AGORA no ar
- **Erro 502 em `/stream`** = AzuraCast caiu; mostrar "🚧 Manutenção" e tentar reconectar em 30s
- **Erro 401 em Mural** = impossível hoje (sem auth), mas se virar: reautenticar
- **CORS** — backend libera tudo, então fetch/XHR funciona sem proxy

---

## 📐 WIREFRAMES DAS 5 ABAS

### Aba 1: Player (`/`)
```
┌─────────────────────────────────┐
│ 📻 Rádio do Gugu     ☰ Sobre   │
├─────────────────────────────────┤
│                                 │
│      [Arte do conto atual]      │
│                                 │
│    ┌───────────────────────┐    │
│    │ ▶ REI NUCLEAR         │    │
│    │ BANDA FURACÃO DO TECNO│    │
│    └───────────────────────┘    │
│                                 │
│  ──────●─────────────  3:42     │
│  [LOCUÇÃO]  [📜 Mural]  [📚 Contos]│
│                                 │
├─────────────────────────────────┤
│  ♪ Tocando: REI NUCLEAR         │
│  👥 23 ouvintes                 │
└─────────────────────────────────┘
```

### Aba 2: Mural (`/mural`)
```
┌─────────────────────────────────┐
│ 📜 Mural de Pedidos   [Histórico]│
├─────────────────────────────────┤
│ Conte um conto...               │
│ ┌─────────────────────────────┐ │
│ │ Input de texto              │ │
│ └─────────────────────────────┘ │
│ Contos sugeridos:               │
│  [O último andar] [Na cripta]  │
│  [A hora do diabo] [Sombra]    │
│ [📤 Pedir este conto]           │
│                                 │
│ Hoje no ar:                     │
│  ● 23:45 Gugu pediu "A cripta"  │
│  ● 23:30 Foi narrado "O porão" │
└─────────────────────────────────┘
```

### Aba 3: Chat (`/sala`)
```
┌─────────────────────────────────┐
│ 💬 Chat com Gugu    📞 AO VIVO  │
├─────────────────────────────────┤
│ Gugu: Boa noite, querido(a)... │
│ Você: Conta um conto de terror? │
│                                 │
│ Gugu: 🎙️ Vou narrar pra você...│
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Digite sua mensagem...      │ │
│ └─────────────────────────────┘ │
│              [📤 Enviar]        │
│              [📡 Mandar pro ar] │
└─────────────────────────────────┘
```

### Aba 4: Contos (`/contos`)
```
┌─────────────────────────────────┐
│ 📚 Acervo — 19 contos           │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ 🖤 O Barril de Amontillado   │ │
│ │   Edgar Allan Poe           │ │
│ │   [▶ Ouvir abertura]        │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 🖤 A Queda da Casa de Usher │ │
│ │   Edgar Allan Poe           │ │
│ │   [▶ Ouvir abertura]        │ │
│ └─────────────────────────────┘ │
│ ... (mais 17 contos)            │
└─────────────────────────────────┘
```

### Aba 5: Sobre (`/sobre`)
```
┌─────────────────────────────────┐
│ ℹ️  Sobre a Rádio do Gugu       │
├─────────────────────────────────┤
│ 🖤 Conte seu terror favorito    │
│   na linguagem da madrugada.    │
│                                 │
│ Tecnologias:                    │
│  • Locutor IA (MiniMax)         │
│  • AutoDJ (AzuraCast)           │
│  • PWA install                  │
│                                 │
│ 📡 Status: ✅ No ar             │
│ 👥 Ouvintes: 23                 │
│ 🎵 Tocando agora: REI NUCLEAR   │
│                                 │
│ [📲 Instalar PWA]               │
└─────────────────────────────────┘
```

---

## ⚠️ REGRAS IMPORTANTES

1. **NÃO expor API keys** — backend tem as credenciais; frontend só consome endpoints públicos
2. **Mobile-first** — bottom-nav (5 tabs) em vez de top-nav em telas < 720px
3. **PWA** — manifest.json + sw.js com cache-first em assets, network-first em /stream
4. **Acessibilidade** — contraste WCAG AA mínimo, focus visível, aria-labels
5. **Offline graceful** — se cair rede, mostrar "🚫 Sem internet" mas permitir ouvir cache de aberturas
6. **Audio player flutuante** — fixo no bottom em todas as abas (exceto Player)
7. **Voz do Gugu** — sempre TTS via `/api/oracoes`, nunca pré-gravado em produção (exceto vinheta)
8. **Real-time via Socket.IO** — escute `oracao-nova` e `sala-broadcast`, não faça polling no mural
9. **Latência é dinheiro** — MiniMax cobra por chamada TTS, então debounce 1s no botão "Pedir"
10. **Screenshot da foto** — Isaías vai mandar uma foto do design desejado depois; o briefing acima é estrutura, não fidelidade visual

---

## 🎨 IDENTIDADE VISUAL (placeholder — foto vai definir)

| Token | Valor |
|-------|-------|
| Cor primária | `#7c1d3f` (vinho escuro) |
| Cor acento | `#ff6b35` (laranja sangue) |
| Background | `#0d0a0e` (preto profundo) |
| Surface | `#1a1419` (roxo escuro) |
| Text primary | `#e8d8e3` (creme) |
| Text secondary | `#a89aa3` (cinza claro) |
| Success | `#6bcc6b` |
| Danger | `#dc4c4c` |
| Font display | "Cinzel" ou "Playfair Display" |
| Font body | "Inter" ou system-ui |

---

## 📂 ESTRUTURA ATUAL (pra você entender onde mexer)

```
frontend/
├── index.html          # Player (aba 1)
├── sala.html           # Chat (aba 3) — pode ser mergeado
├── manifest.json       # PWA
├── sw.js               # Service Worker
├── js/
│   ├── app.js          # Lógica principal (11KB)
│   ├── player.js       # Áudio player (4KB)
│   ├── sala.js         # Chat socket.io (5KB)
│   └── pwa.js          # Service Worker registration
├── css/style.css       # 17.5KB (sem framework)
└── icons/              # SVG
```

**Sugestão de refactor (decisão sua, justifique):**
- **Opção A**: Manter vanilla JS, modularizar (um .js por aba, ES modules)
- **Opção B**: Migrar pra React + Vite (HMR rápido, ecossistema)
- **Opção C**: Svelte (bundle menor que React, sintaxe enxuta)

Cada opção tem trade-offs. Isaías aceita qualquer uma desde que:
- Bundle JS < 200KB gzipped
- Lighthouse PWA score > 90
- Funcione offline após primeira visita

---

## ✅ DELIVERÁVEIS ESPERADOS

1. **Refactor visual** mantendo vanilla JS OU migrar pra framework (justifique escolha)
2. **5 abas funcionais** com bottom-nav mobile + top-nav desktop
3. **PWA instalável** com offline-first
4. **Audio player persistente** entre tabs (não recarregar ao trocar de aba)
5. **Componentes reutilizáveis** (cards de conto, item do mural, mensagem do chat)
6. **Build otimizado** (< 200KB JS gzipped)
7. **Acessibilidade** testada com axe DevTools
8. **Screenshot tests** mostrando Player + Mural + Chat rodando
9. **Manifest PWA** válido (testar com chrome://inspect/#service-workers)

---

## 🚀 COMO COMEÇAR

1. Abra Google Studio
2. Cole este prompt inteiro
3. Aponte pro repo: `https://github.com/Jisaiaslima35/radio-do-gugu`
4. Rode `curl https://radiodogugu.automacaojs.us/api/health` pra confirmar que o backend tá respondendo
5. Rode `curl https://radiodogugu.automacaojs.us/api/now-playing` pra ver JSON real
6. Leia `frontend/` inteiro antes de propor mudanças
7. Sugira plano de refactor (build step? framework? CSS strategy?)
8. Implemente em fases, commite direto na branch `feat/google-studio-refactor`
9. **Aguarde a foto do Isaías** antes de finalizar pixel-perfect
10. PR aberto quando terminar pra Isaías revisar

---

## 📞 CANAL DE DÚVIDAS

**Telegram do Isaías**: mande msg direta, ele responde em algumas horas.
**Issues no GitHub**: pra bugs ou melhorias na API.

**Antes de perguntar**, verifique:
1. Já leu `docs/API.md` no repo?
2. Já testou o endpoint com `curl`?
3. Já inspecionou a resposta real com DevTools Network?

Se sim e ainda tá travado → pergunte. Caso contrário → pesquise mais.

---

**Boa sorte. O backend é sólido, é só fazer o front brilhar. 🖤**