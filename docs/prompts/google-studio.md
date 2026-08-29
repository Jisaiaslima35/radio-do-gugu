# Prompt Google Studio — Rádio do Gugu

> **Cole este prompt no Google Studio** (após autenticar com a conta `jose.isaias@alunos.ifsuldeminas.com.br` ou similar). O Studio vai ler o repositório público `https://github.com/Jisaiaslima35/radio-do-gugu` e refatorar o frontend (aba Player).

---

## 🎯 MISSÃO

Refatorar o frontend da Rádio do Gugu mantendo a base atual de vanilla JS mas **modernizando UX/UI**, com **5 abas** (Player, Mural, Chat, Contos, Sobre) e **PWA instalável** mobile-first.

Você vai trabalhar sobre o código em `https://github.com/Jisaiaslima35/radio-do-gugu/tree/main/frontend/`.

**Não exponha nenhuma API key pública.** O backend já está pronto e expõe endpoints documentados em `https://github.com/Jisaiaslima35/radio-do-gugu/blob/main/docs/API.md`.

## 📦 CONTEXTO TÉCNICO

| Item | Valor |
|------|-------|
| Backend URL (prod) | `https://radiodogugu.automacaojs.us` |
| Backend URL (dev) | `http://localhost:3006` |
| Backend URL (preview) | `https://radio-do-gugu-preview.automacaojs.us` |
| Framework atual | Vanilla JS (sem build step) |
| Stack alvo | Pode modernizar (Vite + React, ou vanilla refinado) |
| Mobile-first | SIM — 70% usuários são Android |
| PWA | Manifest + Service Worker + offline-first |
| Tema | Dark mode com tons roxos/laranjas (terror) |

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

## 🔌 ENDPOINTS DA API (PÚBLICOS)

Documentação completa: `docs/API.md` no repo. Resumo:

### Stream
- `GET /stream` — audio/mpeg streaming (MP3 128kbps)

### Status
- `GET /api/now-playing` — `{ title, artist, listeners, isLocucao }`

### Mural
- `POST /api/oracoes` — body: `{ nome, pedido, contexto?, username? }` → `{ sucesso, oracao: { fala, ehConto }, fila }`
- `GET /api/oracoes/historico` — array das últimas 20

### Chat
- `WS /socket.io/` — eventos `chat:msg`, `mural:novo`, `tocando:agora`

### Contos
- `GET /api/conto/lista` — `{ total, contos: [{slug, titulo, autor}] }`
- `GET /api/conto/:slug` — `{ slug, titulo, autor, abertura, duracao_estimada }`

## ⚠️ REGRAS IMPORTANTES

1. **NÃO expor API keys** — backend tem as credenciais; frontend só consome endpoints públicos
2. **Mobile-first** — bottom-nav (5 tabs) em vez de top-nav em telas < 720px
3. **PWA** — manifest.json + sw.js com cache-first em assets, network-first em /stream
4. **Acessibilidade** — contraste WCAG AA mínimo, focus visível, aria-labels
5. **Offline graceful** — se cair rede, mostrar "🚫 Sem internet" mas permitir ouvir cache de aberturas
6. **Audio player flutuante** — fixo no bottom em todas as abas (exceto Player)
7. **Voz do Gugu** — sempre TTS, nunca pré-gravado em produção (exceto vinheta)

## 🎨 IDENTIDADE VISUAL

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

## 📂 ESTRUTURA ATUAL

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

## ✅ DELIVERÁVEIS ESPERADOS

1. **Refactor visual** mantendo vanilla JS OU migrar pra React (sua escolha, justifique)
2. **5 abas funcionais** com bottom-nav mobile
3. **PWA instalável** com offline-first
4. **Audio player persistente** entre tabs
5. **Componentes reutilizáveis** (cards de conto, mural, chat)
6. **Build otimizado** (< 200KB JS gzipped)
7. **Acessibilidade** testada com axe DevTools

## 🚀 COMO COMEÇAR

1. Abra Google Studio
2. Cole este prompt
3. Aponte pro repo: `https://github.com/Jisaiaslima35/radio-do-gugu`
4. Peça análise do frontend atual primeiro
5. Sugira plano de refactor (build step? framework? CSS strategy?)
6. Implemente em fases, commite direto na branch `feat/google-studio-refactor`
7. PR aberto quando terminar pra Isaías revisar

---

**Dúvidas?** Mande mensagem no Telegram pro Isaías ou abra issue no repo.
