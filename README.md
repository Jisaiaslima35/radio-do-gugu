# 📻 Rádio do Gugu — Contos de Terror

> Uma rádio web PWA com locutor IA narrando contos clássicos de terror brasileiros e universais. Arquitetura modular pensada pra ser reutilizada por outras rádios de conteúdo narrado.

![Status](https://img.shields.io/badge/status-em_produ%C3%A7%C3%A3o-success)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)
![Backend](https://img.shields.io/badge/backend-Node.js_22-green)
![Frontend](https://img.shields.io/badge/frontend-Vanilla_JS_+_PWA-yellow)
![AutoDJ](https://img.shields.io/badge/AutoDJ-AzuraCast-purple)

## 🎯 O que é

Uma estação de rádio 24/7 que mistura **músicas** com **narrativas do locutor IA "Gugu"**, que:

- Pede contos pelo mural e responde com aberturas narradas
- Conversa no chat como se fosse um locutor de rádio noturno
- Injeta locuções no AutoDJ sem cortar a música
- Tem 19 contos clássicos no acervo (Edgar Allan Poe, Machado de Assis, etc.)

Tecnologia: PWA (instala no celular) + backend Node.js único servindo frontend e API + AzuraCast pra AutoDJ + MiniMax speech-2.8-hd pra TTS.

## ✨ Features

- 🎙️ **Locutor IA com voz grave** (`Portuguese_Deep-VoicedGentleman` via MiniMax)
- 📱 **PWA instalável** (Android/iOS) com offline-first via Service Worker
- 🎵 **AutoDJ 24/7** com fallback graceful (silêncio se playlist acabar, nunca erro)
- 💬 **Chat em tempo real** estilo "ligar pra rádio"
- 📜 **Mural de pedidos** com detecção inteligente (conto vs música)
- 📚 **Acervo de contos** (19 títulos clássicos) com aberturas narradas
- 🎬 **Injeção sem corte** entre locutor e AutoDJ (FASE 3 validado)
- 🌐 **HTTPS via Cloudflare Tunnel** + nginx local

## 🚀 Quick Start

### Pré-requisitos
- Node.js 22+
- AzuraCast rodando (Docker)
- Conta MiniMax com plano Audio Starter
- Docker + docker compose

### Setup em 5 passos

```bash
# 1. Clonar
git clone https://github.com/Jisaiaslima35/radio-do-gugu.git
cd radio-do-gugu

# 2. Backend
cd backend
npm install
cp .env.example .env
# Editar .env com suas credenciais

# 3. AzuraCast — criar estação, ver docs/azuracast/station-setup.md
docker exec azuracast mariadb -uazuracast -pSENHA azuracast -e "
INSERT INTO station_schedules (playlist_id, start_time, end_time, days, loop_once)
VALUES ({playlist_id}, 0, 2359, '1,2,3,4,5,6,7', 0);"

# 4. systemd
sudo cp systemd/radio-gugu-music.service /etc/systemd/system/
sudo systemctl enable --now radio-gugu-music

# 5. nginx
sudo cp nginx/radio-gugu.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/radio-gugu /etc/nginx/sites-enabled/
sudo nginx -s reload
```

Acesse `http://localhost:3006` e teste o mural.

## 📁 Estrutura

```
radio-do-gugu/
├── backend/               # Node.js single-process
│   ├── server.cjs         # API + serve frontend
│   ├── package.json
│   ├── lib/               # Scripts shell auxiliares
│   └── scripts/           # Cron jobs + loop
├── frontend/              # PWA completo (sem build step)
│   ├── index.html         # Player principal
│   ├── sala.html          # Sala de chat/pedidos
│   ├── js/                # app.js, player.js, sala.js, pwa.js
│   ├── css/style.css
│   ├── manifest.json
│   ├── sw.js              # Service Worker
│   └── icons/             # SVG (sem raster binário)
├── systemd/               # Unit file
├── nginx/                 # Config nginx
├── docs/
│   ├── prompts/           # Prompts prontos pra Google Studio / Claude
│   ├── bug-fixes/         # Lições aprendidas
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── DEPLOY.md
└── azuracast/             # SQL + configs AzuraCast
```

## 🧪 Endpoints da API

Resumo (detalhes completos em [`docs/API.md`](docs/API.md)):

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/stream` | Proxy do stream ao vivo (IceCast mount `/live`) |
| GET | `/api/now-playing` | Faixa atual + listeners |
| POST | `/api/oracoes` | Mural de pedidos (contos ou música) |
| POST | `/api/sala/chat` | Chat em tempo real com Hermes |
| GET | `/api/conto/{slug}` | Abertura narrada de um conto do acervo |

## 🔧 Customizando pra outra rádio

O backend `server.cjs` tem **dois pontos de configuração**:

1. `ACERVO_CONTOS` — array de contos do acervo (ou outro conteúdo)
2. Prompt do mural em `gerarLocucaoTerror()` — linha ~420

Trocar:
- Nome da rádio em `frontend/index.html` linha 5
- Voz MiniMax em `backend/lib/falar_gugu.sh` (ou criar `falar_<radio>.sh`)
- Skill do Hermes em `~/.hermes/profiles/<radio>/`
- Estação AzuraCast (criar nova, copiar config)

Veja [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pra detalhes completos.

## 📋 Lições aprendidas

Os bug fixes mais importantes estão documentados em [`docs/bug-fixes/`](docs/bug-fixes/):

- **AutoDJ sem schedule** — playlist `default` sozinha NÃO popula fila (`20260829-autodj-schedule.md`)
- **error.mp3 em inglês** — IceCast system-wide fallback (`20260829-vinheta-ingles.md`)
- **Voz feminina vs masculina** — escolha de voz no MiniMax (`20260828-minimax-voice.md`)

## 🤝 Contribuindo

PRs são bem-vindos. Áreas que ainda precisam:

- [ ] Resolver vazamento de raciocínio do Hermes (Task #16)
- [ ] Implementar now-playing metadata no IceCast (hook backend → AzuraCast API)
- [ ] Implementar upload de músicas via UI
- [ ] Reskinner PWA pra outras narrativas (sertanejo, MPB, etc)

## 📜 Licença

MIT — veja [`LICENSE`](LICENSE).

## 👤 Autor

**Isaías Lima** ([@Jisaiaslima35](https://github.com/Jisaiaslima35)) — Natal/RN, Brasil.
