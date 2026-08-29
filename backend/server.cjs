// server.cjs — Rádio do Gugu / Contos de Terror (estação 7)
// =============================================================================
// Criado 28/08/2026 (Etapa 4) — clone enxuto do server.cjs do Libertação.
// Backend Node.js + Express + Socket.IO. Fila única sequencial (FASE 2
// validada em Devocional 12). Mural público texto curto, sala privada
// texto longo.
//
// Atualizado 28/08/2026 — endpoints do mentor locutor:
//   - /api/catalogo-contos (lista acervo da skill mentor-contos-terror)
//   - /api/conto/:slug (conteúdo completo de um conto)
//   - /api/now-playing (icecast status-json proxy)
//   - /api/sala/message agora aceita conto_slug pra injetar contexto
//   - /api/oracoes ganha alias /api/mural (mantém retrocompat)
//
// Pendências:
//   - Voz clonada do Gugu (PENDENTE) — usa MiniMax speech-2.8-hd por enquanto
//   - Catálogo de músicas brega (carregar em /root/radio-gugu-music/musicas/)
//
// Mudanças vs libertação:
//   - PORTA 3006 (em vez de 3001)
//   - Perfil Hermes: radio-gugu (em vez de radio-libertacao)
//   - Persona: Gugu (em vez de Irmão Eliseu)
//   - Tema: terror + brega (em vez de devocional)
//   - SEM versículo bíblico, SEM fallback_oracao.sh
//   - Filtro anti-mistura mantém (defesa em profundidade)
// =============================================================================

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

var import_express = __toESM(require("express"), 1);
var import_http = __toESM(require("http"), 1);
var import_cors = __toESM(require("cors"), 1);
var import_socket = require("socket.io");
var import_child_process = require("child_process");
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_url = require("url");
var import_meta = {};
var __filename = typeof __filename !== "undefined" ? __filename : (0, import_url.fileURLToPath)(import_meta.url);
var __dirname = typeof __dirname !== "undefined" ? __dirname : import_path.default.dirname(__filename);

// =============================================================================
// CONFIG (específico Gugu)
// =============================================================================
var PORT = process.env.PORT || 3006;
var SITE_DIR = process.env.SITE_DIR_OVERRIDE || __dirname;
var AUDIO_DIR = import_path.default.join(__dirname, "audios");
var DATA_DIR = import_path.default.join(__dirname, "data");
var RADIO_GUGU_DIR = "/root/radio-gugu-music";
var HERMES_CALL = import_path.default.join(RADIO_GUGU_DIR, "hermes_call_gugu.sh");
var TOCA_PEDIDO = import_path.default.join(RADIO_GUGU_DIR, "lib/toca_pedido_gugu.sh");
var MUSICAS_DIR_REAL = import_path.default.join(RADIO_GUGU_DIR, "musicas");
// Mentor contos skill — acervo carregado em memória no startup
var SKILL_CONTOS_DIR = "/root/.hermes/profiles/radio-gugu/skills/mentor-contos-terror/chapters";

// =============================================================================
// CATÁLOGO DINÂMICO (músicas brega)
// =============================================================================
function scanMusicasDir() {
  const out = [];
  if (!import_fs.default.existsSync(MUSICAS_DIR_REAL)) {
    console.log(`[catálogo] pasta ${MUSICAS_DIR_REAL} não existe — sem músicas por enquanto`);
    return out;
  }
  const files = import_fs.default.readdirSync(MUSICAS_DIR_REAL).filter((f) => f.toLowerCase().endsWith(".mp3")).sort();
  for (const filename of files) {
    const base = filename.replace(/\.mp3$/i, "");
    const semNumero = base.replace(/^\d+\.\s*/, "");
    const partes = semNumero.split(" - ").map((s) => s.trim()).filter(Boolean);
    let titulo = "", artista = "";
    if (partes.length >= 2) {
      titulo = partes[0];
      artista = partes[1];
    } else if (partes.length === 1) {
      titulo = partes[0];
      artista = "";
    } else {
      titulo = base;
      artista = "";
    }
    out.push([titulo, artista, filename]);
  }
  return out;
}
var CATALOGO_BREGA = scanMusicasDir();
console.log(`[catalogo] dinamico: ${CATALOGO_BREGA.length} faixas brega em ${MUSICAS_DIR_REAL}`);

// =============================================================================
// CATALOGO DE CONTOS (mentor-contos-terror skill)
// =============================================================================
var SKILL_CONTOS_DIR = "/root/.hermes/profiles/radio-gugu/skills/mentor-contos-terror/chapters";
var SKILL_CONTOS_INDEX = import_path.default.join(SKILL_CONTOS_DIR, "INDEX.md");

function loadContosAcervo() {
  if (!import_fs.default.existsSync(SKILL_CONTOS_INDEX)) {
    console.warn(`[contos] INDEX.md nao encontrado em ${SKILL_CONTOS_DIR}`);
    return [];
  }
  const text = import_fs.default.readFileSync(SKILL_CONTOS_INDEX, "utf-8");
  const contos = [];
  // Regex tolerante: aceita "Duração" ou "Duracao"
  const blocoRe = /### ch(\d+) — ([^\n]+)\n- \*\*Autor:\*\* ([^\n]+)\n- \*\*Tipo:\*\* ([^\n]+)\n- \*\*Dura[çc][aã]o:\*\* ([^\n]+)\n- \*\*Sinopse:\*\* ([^\n]+)\n- \*\*Arquivo:\*\* \[`([^\`]+)`\]/g;
  let m;
  while ((m = blocoRe.exec(text)) !== null) {
    const [, num, titulo, autor, tipo, duracao, sinopse, arquivo] = m;
    const arquivoPath = import_path.default.join(SKILL_CONTOS_DIR, arquivo);
    const slug = arquivo.replace(/^ch\d+-/, "").replace(/\.md$/, "");
    contos.push({
      num: parseInt(num, 10),
      slug,
      titulo: titulo.trim(),
      autor: autor.trim(),
      tipo: tipo.trim(),
      duracao: duracao.trim(),
      sinopse: sinopse.trim(),
      arquivo,
      arquivoPath
    });
  }
  return contos;
}

var ACERVO_CONTOS = loadContosAcervo();
console.log(`[contos] acervo: ${ACERVO_CONTOS.length} contos em ${SKILL_CONTOS_DIR}`);

// =============================================================================
// CLASSIFICADOR DE INTENÇÃO (música vs história)
// =============================================================================
var norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function resolverMusica(pedido) {
  const k = norm(pedido);
  if (!k) return null;
  const tituloBase = (s) => norm(String(s).replace(/\s*\([^)]*\)\s*/g, " "));
  let exato = CATALOGO_BREGA.find(([t, a]) => norm(t) === k || tituloBase(t) === k || norm(`${t} ${a}`) === k);
  if (exato) return exato;
  let parcial = CATALOGO_BREGA.find(([t]) => {
    const tb = tituloBase(t);
    return tb && k.includes(tb);
  });
  if (parcial) return parcial;
  parcial = CATALOGO_BREGA.find(([t]) => {
    const tb = tituloBase(t);
    const words = tb.split(" ").filter((w) => w.length >= 3);
    return words.length > 0 && words.every((w) => k.includes(w));
  });
  return parcial || null;
}

// Detecta se é pedido de CONTO (vs música)
function ehPedidoConto(pedido) {
  const k = norm(pedido);
  return /(conto|historia|história|terror|medo|fantasma|assombracao|assombração|lenda|criatura|misterio|mistério|suspense|arrepi|macabro|sombrio|sangue|pesadelo)/i.test(k);
}

// =============================================================================
// EXPRESS APP
// =============================================================================
var app = (0, import_express.default)();
app.use((0, import_cors.default)());
app.use(import_express.default.json({ limit: "1mb" }));
app.use(import_express.default.static(SITE_DIR));

var server = import_http.default.createServer(app);
var io = new import_socket.Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log(`[io] cliente conectou ${socket.id}`);
  socket.on("disconnect", () => console.log(`[io] cliente saiu ${socket.id}`));
});

// =============================================================================
// CALL HERMES (perfil radio-gugu)
// =============================================================================
var HERMES_TIMEOUT_MS = 60000;
var HERMES_FALHA_RE = /__HERMES_FAILED__|^$/;
function safe(s) { return String(s || "").replace(/"/g, '\\"'); }

function callHermes(text, username) {
  return new Promise((resolve) => {
    const proc = (0, import_child_process.spawn)("bash", ["-c", `unset PYTHONPATH PYTHONHOME; /usr/local/bin/hermes -p radio-gugu -z "${safe(text)}"`], {
      timeout: HERMES_TIMEOUT_MS
    });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => stdout += d.toString());
    proc.stderr.on("data", (d) => stderr += d.toString());
    proc.on("close", (code) => {
      const out = (stdout.trim() || stderr.trim() || "").slice(0, 4000);
      if (!out || HERMES_FALHA_RE.test(out)) {
        console.warn(`[hermes] FAILED (code=${code}, out_len=${out.length}, preview="${out.slice(0, 60)}")`);
        resolve("__HERMES_FAILED__");
        return;
      }
      resolve(out);
    });
    proc.on("error", (e) => {
      console.warn(`[hermes] ERROR ${e.message}`);
      resolve("__HERMES_FAILED__");
    });
  });
}

// =============================================================================
// GERAR LOCUÇÃO TERROR (substitui gerarLocucaoDevocional)
// =============================================================================
function gerarLocucaoTerror(nome, pedido, username, ehConto = false) {
  // Quando ehConto=true, injeta o catálogo dos contos disponíveis (skill mentor-contos-terror)
  // pro LLM escolher o mais próximo do pedido. Sem isso, ele chuta e gera "vinheta brega"
  // mesmo quando o usuário pediu um conto (bug visto 28/08/2026).
  let catalogoContosBloco = "";
  if (ehConto && Array.isArray(ACERVO_CONTOS) && ACERVO_CONTOS.length > 0) {
    const lista = ACERVO_CONTOS.map((c, i) => {
      return `${i + 1}. "${c.titulo}" — ${c.autor} — ${c.sinopse}`;
    }).join("\n");
    catalogoContosBloco = `

Acervo da biblioteca do Gugu (${ACERVO_CONTOS.length} contos disponíveis):
${lista}

Procure o conto mais próximo do pedido. Se houver match claro, gere a ABERTURA desse conto (vinheta + 1º parágrafo, máx 200 chars) — começa citando o título e o autor pra confirmar pro ouvinte. Se NÃO houver nenhum conto próximo do pedido, gere: "Tá na mão, ${nome}. Esse não tá no porão do Gugu, mas posso te contar [NOME_DO_CONTO_MAIS_PRÓXIMO] que tem clima parecido. Manda ver?" (máx 200 chars). NÃO gere a vinheta de música brega em hipótese alguma.`;
  }

  const promptTerror = `Mural da Rádio do Gugu — pedido do ouvinte ${nome}: "${pedido}". Responda como o Gugu: locutor de histórias de terror, voz grave e envolvente.${catalogoContosBloco}
${ehConto ? "" : `Se o pedido for pra tocar uma música brega, gere APENAS a vinheta de chamada (máx 80 chars): "Tá na mão, ${nome}. Vem com o Gugu e o brega que não perdoa."`}
PT-BR puro, sem markdown, sem nomes de ferramentas, sem versículo bíblico, sem emojis. Fale como se tivesse sussurrando no microfone.

IMPORTANTE: responda APENAS com a fala do Gugu — nada de comentários, raciocínio, metadados, contagem de caracteres, prefácio tipo "Resposta:" ou "Dentro do limite:". Comece direto na fala.`;
  return callHermes(
    promptTerror,
    username || "Mural-Gugu"
  ).then((hermesResp) => {
    if (hermesResp === "__HERMES_FAILED__" || !hermesResp || hermesResp.length < 30) {
      console.warn(`[mural] Hermes falhou/curto — usando fallback Gugu`);
      return `Tá na mão, ${nome}. O Gugu tá preparando teu pedido. Fica ligado.`;
    }
    // FILTRO ANTI-MISTURA (defesa em profundidade — mesma regra do Libertação)
    const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
    const CYR_RE = /[Ѐ-ӿ]/;
    const HEB_RE = /[֐-׿]/;
    const ARABIC_RE = /[؀-ۿ]/;
    if (CJK_RE.test(hermesResp) || CYR_RE.test(hermesResp) || HEB_RE.test(hermesResp) || ARABIC_RE.test(hermesResp)) {
      console.warn(`[mural] FILTRO pegou idioma estrangeiro — usando fallback Gugu`);
      return `Tá na mão, ${nome}. O Gugu tá com interferência na biblioteca de contos, mas prepara o fone que vem coisa boa.`;
    }
    return hermesResp.trim();
  });
}

// =============================================================================
// FILA ÚNICA SEQUENCIAL (worker único, FASE 2 validada)
// =============================================================================
var filaLocucoes = [];
var processandoLocucao = false;
var filaStats = { processadas: 0, erros: 0, ultimoTempoSeg: 0 };

function enqueueLocucao(nome, pedido, fala, duration) {
  const item = {
    id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nome,
    pedido,
    fala,
    duration: duration || "curta",
    enqueuedAt: Date.now()
  };
  filaLocucoes.push(item);
  io.emit("fila-status", {
    processando: processandoLocucao,
    tamanho: filaLocucoes.length,
    itens: filaLocucoes.map((i) => ({ id: i.id, nome: i.nome, duration: i.duration })),
    stats: filaStats
  });
  console.log(`[fila] item enfileirado id=${item.id} pos=${filaLocucoes.length} (processando=${processandoLocucao})`);
  return item.id;
}

function processarProximaLocucao() {
  if (processandoLocucao) return;
  const item = filaLocucoes.shift();
  if (!item) {
    console.log(`[fila] vazia, worker livre`);
    io.emit("fila-status", { processando: false, tamanho: 0, itens: [], stats: filaStats });
    return;
  }
  processandoLocucao = true;
  const t0 = Date.now();
  console.log(`[fila] processando id=${item.id} duration=${item.duration}`);

  const args = [item.fala, `--duration=${item.duration}`];
  const proc = (0, import_child_process.spawn)("bash", [HERMES_CALL, ...args], {
    detached: true,
    stdio: "ignore"
  });
  proc.unref();

  // Polling: a cada 5s checa se worker liberou (fila vazia + sem proc ativo)
  const poll = setInterval(() => {
    if (filaLocucoes.length === 0) {
      // Nada mais na fila — espera o proc atual terminar
      try {
        process.kill(proc.pid, 0); // checa se ainda existe
      } catch (e) {
        clearInterval(poll);
        processandoLocucao = false;
        const durSeg = Math.round((Date.now() - t0) / 1000);
        filaStats.processadas++;
        filaStats.ultimoTempoSeg = durSeg;
        io.emit("fila-status", { processando: false, tamanho: 0, itens: [], stats: filaStats });
        console.log(`[fila] ✅ id=${item.id} dur=${durSeg}s status=concluido`);
        // Próxima
        setImmediate(processarProximaLocucao);
      }
    }
  }, 5000);
}

// =============================================================================
// falarNoAr — enfileira em vez de injetar direto (FASE 2)
// =============================================================================
async function falarNoAr(texto, duration) {
  enqueueLocucao("", "", texto, duration || "curta");
  processarProximaLocucao();
}

// =============================================================================
// ENDPOINTS
// =============================================================================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "radio-gugu", port: PORT, uptime: process.uptime() });
});

// =============================================================================
// STREAM PROXY — backend Node 3006 → AzuraCast icecast estação 7 (porta 9010)
// Player no HTML consome /stream que repassa o /live do AzuraCast.
// =============================================================================
app.get("/stream", (req, res) => {
  const upstream = import_http.default.request(
    {
      host: "127.0.0.1",
      port: 9040,
      path: "/live",
      method: "GET",
      headers: { "User-Agent": "radio-gugu-stream-proxy/1.0", "Icy-MetaData": "0" }
    },
    (up) => {
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache, no-store",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      up.pipe(res);
      up.on("error", () => res.end());
    }
  );
  upstream.on("error", (e) => {
    console.error("[stream-proxy] erro upstream AzuraCast:", e.message);
    if (!res.headersSent) res.status(502).json({ error: "stream indisponivel" });
    else res.end();
  });
  const kill = () => upstream.destroy();
  req.on("close", kill);
  req.on("aborted", kill);
  upstream.end();
});

app.get("/api/catalogo", (req, res) => {
  res.json({ total: CATALOGO_BREGA.length, faixas: CATALOGO_BREGA.map(([t, a, f]) => ({ titulo: t, artista: a, arquivo: f })) });
});

app.get("/api/fila", (req, res) => {
  res.json({
    processando: processandoLocucao,
    tamanho: filaLocucoes.length,
    itens: filaLocucoes.map((i) => ({ id: i.id, nome: i.nome, duration: i.duration })),
    stats: filaStats
  });
});

// =============================================================================
// MURAL PÚBLICO (POST /api/oracoes) — texto curto
// =============================================================================
app.get("/api/oracoes", (req, res) => {
  // Retorna últimos N pedidos (mock — sem persistência por enquanto)
  res.json({ total: 0, recentes: [] });
});

app.post("/api/oracoes", async (req, res) => {
  const { nome, pedido, contexto } = req.body || {};
  if (!nome || !pedido) return res.status(400).json({ erro: "nome e pedido obrigatórios" });

  // Sinal forte de "é conto": veio da aba Conto do frontend (nome=Conto-Pedido) OU
  // campo contexto explícito. Não basta detecção por palavras-chave porque títulos
  // como "O último andar" não contêm "conto/terror/medo" (bug visto 28/08/2026).
  const ehContoPorContexto = nome === "Conto-Pedido" || contexto === "aba-conto";
  const ehConto = ehContoPorContexto || ehPedidoConto(pedido);
  console.log(`[mural] novo pedido de ${nome}: "${pedido}" (ehConto=${ehConto}, porContexto=${ehContoPorContexto})`);

  const fala = await gerarLocucaoTerror(nome, pedido, "Mural-Gugu", ehConto);
  const duracao = ehConto ? "pregar" : "curta";

  // Emite Socket.IO
  const nova = {
    id: `ped-${Date.now()}`,
    nome: String(nome).slice(0, 50),
    pedido: String(pedido).slice(0, 500),
    fala,
    ehConto,
    criadaEm: new Date().toISOString()
  };
  io.emit("oracao-nova", nova);

  // Enfileira pra tocar no ar
  await falarNoAr(fala, duracao);

  res.status(202).json({ sucesso: true, oracao: nova, fila: { enfileirada: true, duracao } });
});

// =============================================================================
// SALA PRIVADA (chat 1:1 com Gugu) — texto longo
// =============================================================================
app.post("/api/sala/message", async (req, res) => {
  const { username, text, conto_slug } = req.body || {};
  if (!username || !text) return res.status(400).json({ erro: "username e text obrigatórios" });

  // Se o ouvinte mandou conto_slug, injeta o conto como contexto (estilo 21-dias)
  let contextoConto = "";
  if (conto_slug) {
    const conto = ACERVO_CONTOS.find((c) => c.slug === conto_slug);
    if (conto && import_fs.default.existsSync(conto.arquivoPath)) {
      const md = import_fs.default.readFileSync(conto.arquivoPath, "utf-8");
      const corpo = md.split(/^---\s*$/m)[1] || md;
      // Limita a 3000 chars pra não estourar context window
      contextoConto = `\n\n[CONTEXTO: o ouvinte está discutindo o conto "${conto.titulo}" de ${conto.autor}. Tipo: ${conto.tipo}. Sinopse: ${conto.sinopse}. Conteúdo (truncado em 3000 chars):\n---\n${corpo.slice(0, 3000)}\n---]`;
    }
  }

  const promptSala = `[Sala-Privada ${username}] ${text}${contextoConto}\n\nResponda como o Gugu (locutor de terror): tom grave, sussurrado, envolvente. SEM markdown, SEM emojis, SEM nomes de ferramentas. SEM versículo bíblico. Se pedirem um conto, indique resumidamente 1 conto da skill mentor-contos-terror e pergunte se quer ouvir no ar. Se houver CONTEXTO de conto acima, USE-O pra fundamentar a resposta (cite detalhes do conto, personagens, clímax) — não invente, só referencie o que tá no texto. PT-BR puro. Máx 1500 chars.`;
  const resp = await callHermes(promptSala, username);

  if (resp === "__HERMES_FAILED__" || !resp) {
    return res.json({
      resposta: "Tô com interferência na biblioteca, criatura. Tenta de novo em alguns minutos.",
      pode_enviar_para_radio: false
    });
  }

  return res.json({
    resposta: resp,
    pode_enviar_para_radio: /conto|hist[óo]ria|terror/i.test(text),
    conto_usado: conto_slug || null
  });
});

// =============================================================================
// BOTÃO "ENVIAR PRA RÁDIO" (sala → mural)
// =============================================================================
app.post("/api/sala/broadcast", async (req, res) => {
  const { username, fala } = req.body || {};
  if (!username || !fala) return res.status(400).json({ erro: "username e fala obrigatórios" });

  console.log(`[sala] ${username} mandou pro ar: "${fala.slice(0, 80)}..."`);

  await falarNoAr(fala, "curta");

  io.emit("sala-broadcast", { username, fala, timestamp: Date.now() });

  res.json({ sucesso: true, mensagem: "Fala enviada pra rádio" });
});

// =============================================================================
// MENTOR LOCUTOR — endpoints do acervo de contos (28/08/2026)
// =============================================================================

// Catálogo resumido de contos — pra player/frontend listar
app.get("/api/catalogo-contos", (req, res) => {
  res.json({
    total: ACERVO_CONTOS.length,
    contos: ACERVO_CONTOS.map((c) => ({
      num: c.num,
      slug: c.slug,
      titulo: c.titulo,
      autor: c.autor,
      tipo: c.tipo,
      duracao: c.duracao,
      sinopse: c.sinopse
    }))
  });
});

// Conteúdo completo de um conto (slug = "autor-titulo")
app.get("/api/conto/:slug", (req, res) => {
  const slug = req.params.slug;
  const conto = ACERVO_CONTOS.find((c) => c.slug === slug);
  if (!conto) return res.status(404).json({ erro: "conto nao encontrado", slug });

  if (!import_fs.default.existsSync(conto.arquivoPath)) {
    return res.status(500).json({ erro: "arquivo do conto sumiu", arquivo: conto.arquivo });
  }

  const md = import_fs.default.readFileSync(conto.arquivoPath, "utf-8");
  // Tira o header (até o primeiro ---)
  const partes = md.split(/^---\s*$/m);
  const introducao = partes[0] || "";
  const corpo = (partes[1] || md).trim();

  // chunks_count = quantos "blocos" tem (separados por linha vazia dupla)
  const chunks = corpo.split(/\n{2,}/).filter((b) => b.trim().length > 30).length;

  res.json({
    num: conto.num,
    slug: conto.slug,
    titulo: conto.titulo,
    autor: conto.autor,
    tipo: conto.tipo,
    duracao: conto.duracao,
    sinopse: conto.sinopse,
    introducao: introducao.trim(),
    conteudo: corpo,
    chunks_count: chunks
  });
});

// Now playing — proxy do icecast status-json (estação 7 = porta 9040)
app.get("/api/now-playing", (req, res) => {
  const upstream = import_http.default.request({
    host: "127.0.0.1",
    port: 9040,
    path: "/status-json.xsl",
    method: "GET",
    timeout: 3000
  }, (up) => {
    let body = "";
    up.on("data", (d) => body += d.toString());
    up.on("end", () => {
      try {
        const data = JSON.parse(body);
        const src = data.icestats && data.icestats.source;
        if (Array.isArray(src) && src.length > 0) {
          const playing = src[0];
          return res.json({
            title: playing.title || "",
            artist: playing.artist || "",
            listeners: parseInt(data.icestats.listeners || "0", 10),
            bitrate: parseInt(playing.bitrate || "0", 10),
            server_name: data.icestats.server_name || "Radio do Gugu"
          });
        }
        if (src && typeof src === "object") {
          return res.json({
            title: src.title || "",
            artist: src.artist || "",
            listeners: parseInt(data.icestats.listeners || "0", 10),
            bitrate: parseInt(src.bitrate || "0", 10),
            server_name: data.icestats.server_name || "Radio do Gugu"
          });
        }
        return res.json({ title: "", artist: "", listeners: 0, bitrate: 0 });
      } catch (e) {
        return res.json({ title: "", artist: "", listeners: 0, error: "icecast parse falhou" });
      }
    });
  });
  upstream.on("error", (e) => {
    console.error("[now-playing] icecast indisponivel:", e.message);
    res.json({ title: "", artist: "", listeners: 0, error: "icecast offline" });
  });
  upstream.on("timeout", () => {
    console.error("[now-playing] icecast timeout");
    upstream.destroy();
    res.json({ title: "", artist: "", listeners: 0, error: "icecast timeout" });
  });
  upstream.end();
});

// Alias /api/mural → /api/oracoes (retro-compat + semântica mais clara)
app.get("/api/mural", (req, res) => res.redirect(307, "/api/oracoes"));
app.post("/api/mural", (req, res) => res.redirect(307, "/api/oracoes"));

// =============================================================================
// START
// =============================================================================
server.listen(PORT, () => {
  console.log(`[radio-gugu] backend escutando em http://127.0.0.1:${PORT}`);
  console.log(`[radio-gugu] health: http://127.0.0.1:${PORT}/api/health`);
  console.log(`[radio-gugu] fila: http://127.0.0.1:${PORT}/api/fila`);
  console.log(`[radio-gugu] mural: http://127.0.0.1:${PORT}/api/oracoes`);
  console.log(`[radio-gugu] sala: http://127.0.0.1:${PORT}/api/sala/message`);
});
