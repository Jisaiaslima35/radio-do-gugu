# Deploy Guide

## Infraestrutura necessária

| Recurso | Especificação |
|---------|---------------|
| VPS | 2 vCPU, 4GB RAM, 50GB SSD |
| OS | Ubuntu 24.04 LTS |
| Docker | 27+ com compose |
| Node.js | 22+ (via nvm ou apt) |
| AzuraCast | latest stable (Docker) |
| Domínio | apontando pra VPS |
| Cloudflare Tunnel | recomendado (HTTPS grátis) |

## Passo a passo

### 1. Instalar dependências

```bash
# Node.js 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && nvm use 22

# Docker + compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# ffmpeg (pra injeção)
sudo apt install -y ffmpeg
```

### 2. AzuraCast

```bash
# Subir AzuraCast
mkdir -p /var/azuracast
cd /var/azuracast
curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh | bash
cd azuracast
docker compose up -d

# Criar estação via UI em http://localhost:8000
# Anotar: station_id, harbor_mount, harbor_password
```

### 3. Backend Rádio do Gugu

```bash
# Clonar
cd /opt
sudo git clone https://github.com/Jisaiaslima35/radio-do-gugu.git
sudo chown -R $USER:$USER radio-do-gugu
cd radio-do-gugu/backend

# Instalar deps
npm install

# Copiar env
cp .env.example .env
nano .env  # preencher credenciais
```

### 4. Configurar AzuraCast

**CRÍTICO**: Schedule 24/7 é obrigatório (sem ele, AutoDJ não popula fila).

```bash
sudo docker exec azuracast mariadb -uazuracast -pSENHA azuracast -e "
INSERT INTO station_schedules (playlist_id, start_time, end_time, days, loop_once)
VALUES (N_PLAYLIST, 0, 2359, '1,2,3,4,5,6,7', 0);
"
```

**Substituir error.mp3** (IceCast system-wide em inglês → silêncio 30s):

```bash
# Gerar silêncio local
ffmpeg -f lavfi -t 30 -i "anullsrc=r=44100:cl=stereo" \
    -ac 2 -ar 44100 -codec:a libmp3lame -b:a 128k /tmp/silence.mp3

# Copiar pro container
sudo docker cp /tmp/silence.mp3 azuracast:/usr/local/share/icecast/web/error.mp3
```

### 5. systemd

```bash
sudo cp systemd/radio-gugu-music.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now radio-gugu-music

# Validar
sudo systemctl status radio-gugu-music
curl http://localhost:3006/api/now-playing
```

### 6. nginx

```bash
sudo cp nginx/radio-gugu.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/radio-gugu /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7. Cloudflare Tunnel (HTTPS)

```bash
# Instalar cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install cloudflared

# Login + criar tunnel
cloudflared tunnel login
cloudflared tunnel create radio-gugu
cloudflared tunnel route dns radio-gugu radiodogugu.automacaojs.us

# Configurar
cat > ~/.cloudflared/config.yml <<EOF
tunnel: radio-gugu
credentials-file: /home/$USER/.cloudflared/<UUID>.json

ingress:
  - hostname: radiodogugu.automacaojs.us
    service: http://localhost:80
  - service: http_status:404
EOF

# Rodar
cloudflared tunnel run radio-gugu
```

## Pós-deploy

### Validação E2E

```bash
# 1. Backend respondendo
curl http://localhost:3006/api/now-playing

# 2. Stream tocando
curl -o /tmp/test.mp3 http://localhost:3006/stream
ls -la /tmp/test.mp3

# 3. Mural funcionando
curl -X POST http://localhost:3006/api/oracoes \
    -H 'Content-Type: application/json' \
    -d '{"nome":"Test","pedido":"oi"}'

# 4. AzuraCast playlist rodando
sudo docker exec azuracast mariadb -uazuracast -pSENHA azuracast -e "
SELECT id, title, artist, timestamp_start FROM song_history
WHERE station_id=7 ORDER BY id DESC LIMIT 5;"
```

### Monitoramento

- Logs backend: `/opt/radio-do-gugu/backend/logs/`
- Logs AzuraCast: `sudo docker logs azuracast`
- Logs nginx: `sudo tail -f /var/log/nginx/error.log`
- Cron healthcheck: a cada 5min via `cron` + Telegram

### Backup

```bash
# Banco AzuraCast (diário)
sudo docker exec azuracast mariadb-dump -uazuracast -pSENHA azuracast \
    | gzip > /backup/azuracast-$(date +%Y%m%d).sql.gz

# Mídia (semanal)
rsync -av /var/azuracast/stations/radio_gugu/media/ /backup/media/

# Configuração (git)
cd /opt/radio-do-gugu && git pull  # pra puxar updates
```
