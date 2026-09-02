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
// Catálogo via m3u do AzuraCast (fonte de verdade) — copiado via cron/systemd
// do volume Docker real, que tem 67 faixas. Host só vê 4 por causa do mount stale.
var CATALOGO_M3U = import_path.default.join(RADIO_GUGU_DIR, "catalogo.m3u");
// Mentor contos skill — acervo carregado em memória no startup
var SKILL_CONTOS_DIR = "/root/.hermes/profiles/radio-gugu/skills/mentor-contos-terror/chapters";

// =============================================================================
// PERSISTÊNCIA DE PEDIDOS (29/08/2026) — JSON simples em data/pedidos.json
// =============================================================================
var PEDIDOS_FILE = import_path.default.join(DATA_DIR, "pedidos.json");
function loadOracoes() {
  try {
    if (!import_fs.default.existsSync(PEDIDOS_FILE)) return [];
    const raw = import_fs.default.readFileSync(PEDIDOS_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn("[pedidos] erro ao carregar pedidos.json:", e.message);
    return [];
  }
}
function saveOracoes(arr) {
  try {
    import_fs.default.writeFileSync(PEDIDOS_FILE, JSON.stringify(arr.slice(-200), null, 2), "utf8");
  } catch (e) {
    console.error("[pedidos] erro ao salvar pedidos.json:", e.message);
  }
}

// =============================================================================
// CATÁLOGO DINÂMICO (músicas brega)
// =============================================================================
function scanMusicasDir() {
  // Prioridade 1: m3u do AzuraCast (67 faixas com tags corretas)
  if (import_fs.default.existsSync(CATALOGO_M3U)) {
    try {
      const text = import_fs.default.readFileSync(CATALOGO_M3U, "utf8");
      const re = /annotate:title="([^"]*)",artist="([^"]*)",duration="[^"]*",[^:]*:media:([^:]+\.mp3)$/;
      const out = [];
      for (const line of text.split("\n")) {
        const m = re.exec(line.trim());
        if (!m) continue;
        out.push([m[1] || "", m[2] || "", m[3]]);
      }
      if (out.length > 0) return out;
    } catch (e) {
      console.warn("[catálogo] erro lendo m3u, fallback pra readdir:", e.message);
    }
  }
  // Fallback: readdir do path visível (geralmente só 4 por causa do mount stale)
  const out = [];
  if (!import_fs.default.existsSync(MUSICAS_DIR_REAL)) {
    console.log(`[catálogo] pasta ${MUSICAS_DIR_REAL} não existe — sem músicas por enquanto`);
    return out;
  }
  const files = import_fs.default.readdirSync(MUSICAS_DIR_REAL).filter((f) => f.toLowerCase().endsWith(".mp3")).sort();
  for (const filename of files) {
    const base = filename.replace(/\.mp3$/i, "");
    const semNumero = base.replace(/^\d+[\.\-_\s]+/, "");
    let titulo = "", artista = "";
    if (semNumero.includes(" - ")) {
      const partes = semNumero.split(" - ").map((s) => s.trim()).filter(Boolean);
      titulo = partes[0] || semNumero;
      artista = partes[1] || "";
    } else if (semNumero.includes("-")) {
      const tokens = semNumero.split("-").map((s) => s.trim()).filter(Boolean);
      if (tokens.length >= 3) {
        artista = tokens[0];
        titulo = tokens.slice(1).join(" ");
      } else {
        titulo = tokens.join(" ");
        artista = "";
      }
    } else {
      titulo = semNumero;
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
var HERMES_TIMEOUT_MS = 90000;
var HERMES_FALHA_RE = /__HERMES_FAILED__|^$/;
function safe(s) { return String(s || "").replace(/"/g, '\\"'); }

function callHermesOnce(text) {
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

function callHermes(text, username) {
  // Tenta 1x; se falhar (timeout LLM, 9router fora, etc), tenta de novo após 5s
  // (problema visto 29/08 às 12:01-12:05 — LLM deu timeout 2x seguidas, mural ficou mudo).
  return callHermesOnce(text).then((r1) => {
    if (r1 !== "__HERMES_FAILED__") return r1;
    console.warn(`[hermes] retry após 5s (username=${username || "?"})`);
    return new Promise((res) => setTimeout(() => res(callHermesOnce(text)), 5000));
  });
}

// =============================================================================
// GERAR LOCUÇÃO BREGA / SALVE (30/08/2026) — locução curta pro Mural de Pedidos
// Rápido (música/salve do Top 10 do brega pernambucano ou pedido livre).
// Voz de locutor noturno BREGA, não terror. 150-250 chars, cita nome + faixa.
// =============================================================================
function gerarLocucaoBregaSalve(nome, pedido, username) {
  // Tenta casar artista/faixa no catálogo (resolverMusica)
  const matched = typeof resolverMusica === "function" ? resolverMusica(pedido) : null;
  const blocoCatalogo = matched && matched.achou
    ? `\n\n[CATÁLOGO ENCONTRADO] Artista: ${matched.artista}. Faixa: ${matched.faixa}. Use este match no salve.`
    : `\n\n[CATÁLOGO NÃO ENCONTRADO] Se o ouvinte só citou artista, escolha um clássico correspondente do seu repertório brega pernambucano (Reginaldo Rossi, Carlos Alexandre, Bartô Galeno, Amado Batista etc.).`;

  const promptBrega = `Mural de Pedidos Rápidos da Rádio do Gugu — salve do ouvinte ${nome}: "${pedido}".${blocoCatalogo}

Responda como o Gugu LOCUTOR NOTURNO BREGA: voz rouca, direta, calorosa, como radialista de madrugada. SEM terror, SEM suspense, SEM histórias. É BREGA puro.

Estrutura obrigatória:
1. Citar o nome do ouvinte com carinho (ex: "${nome} no pedaço", "${nome} tá na área")
2. Anunciar a faixa ou o artista pedido com entusiasmo brega (ex: "manda ver com Reginaldo Rossi", "Bregaço na certa")
3. Frase curta de despedida (ex: "fé em Deus e fone no ouvido", "aprecia essa que é boa")
4. Total: 150 a 250 chars (locução de ~10-18 segundos)

VARIE os bordões — não repita sempre o mesmo. PT-BR nordestino, sem markdown, sem emojis, sem nomes de ferramentas. Comece DIRETO na fala, sem prefácio.`;

  return callHermes(promptBrega, username || "Mural-Brega").then((hermesResp) => {
    if (hermesResp === "__HERMES_FAILED__" || !hermesResp || hermesResp.length < 30) {
      console.warn("[brega] Hermes falhou/curto — fallback genérico");
      if (matched && matched.achou) {
        return `${nome} no pedaço, o Gugu mandou ${matched.artista} — ${matched.faixa} na fita. Fica ligado que o brega não perdoa.`;
      }
      return `${nome} no pedaço, o Gugu tá preparando teu brega. Fica de fone que vem coisa boa.`;
    }
    // Filtro anti-mistura (defesa em profundidade — mesma lógica do mural terror)
    const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
    const CYR_RE = /[Ѐ-ӿ]/g;
    const HEB_RE = /[֐-׿]/g;
    const ARABIC_RE = /[؀-ۿ]/g;
    const texto = hermesResp || "";
    const totalChars = texto.length;
    if (totalChars >= 50) {
      const estrangeiroCount =
        (texto.match(CJK_RE) || []).length +
        (texto.match(CYR_RE) || []).length +
        (texto.match(HEB_RE) || []).length +
        (texto.match(ARABIC_RE) || []).length;
      const pctEstrangeiro = estrangeiroCount / totalChars;
      if (pctEstrangeiro > 0.30) {
        console.warn(`[brega] FILTRO pegou idioma estrangeiro (${(pctEstrangeiro*100).toFixed(1)}%)`);
        return `${nome}, o Gugu tá com chiado no estúdio mas teu brega já tá no forno. Aguenta aí.`;
      }
      if (estrangeiroCount > 0) {
        return texto
          .replace(CJK_RE, "").replace(CYR_RE, "").replace(HEB_RE, "").replace(ARABIC_RE, "")
          .replace(/\s{2,}/g, " ").trim();
      }
    }
    return texto.trim();
  });
}

// =============================================================================
// GERAR LOCUÇÃO TERROR (substitui gerarLocucaoDevocional)
// =============================================================================
// --- Web search de contos de domínio público (01/09/2026, msg 3396) ---
// Quando o pedido do ouvinte não bate com nenhum dos 19 contos do acervo, o Gugu
// consulta o Wikisource PT-BR via /usr/local/bin/web_search_gugu.sh (pipeline:
// cache JSON → opensearch → parse API). Se achar, monta fala de abertura +
// trecho do conto (sem LLM — evita narrativa inventada). Se não achar, cai no
// fluxo Hermes com catálogo injetado (comportamento anterior).
// =============================================================================
function extrairTituloDoPedido(pedido) {
  // Remove prefixos de comando + cita autor no final ("de Poe", "do Machado")
  let t = String(pedido || "");
  t = t.replace(/^(me\s+)?(conte|conta|conta-me|narra|narre|manda|fala|solte|larga|quero ouvir|ouça|escuta|ouve|toca|traz|bota|coloca)\s+/i, "");
  t = t.replace(/\s+(conto|hist[óo]ria|causo|caso)\s+(de|sobre|do|da)\s+/gi, " ");
  t = t.replace(/^(um|uma|o|a|os|as)\s+/i, "");
  t = t.replace(/^(conto|hist[óo]ria|causo|caso)\s+/i, "");
  t = t.replace(/\s+(por favor|pfv|pf)$/i, "");
  return t.trim().replace(/\s+/g, " ");
}

function conferirContoNoAcervo(pedido) {
  // Detecta se o pedido do ouvinte É um conto do acervo (match de ALTA confiança).
  // Estratégia: primeiro limpa o pedido (extrai "O Gato Preto" de "me conte O Gato Preto de Poe"),
  // depois compara com o título de cada conto do acervo. Match parcial exige que pelo menos
  // 70% do título do acervo esteja contido no pedido OU vice-versa. Tokens descartáveis
  // (conte/narra/etc) são removidos antes pra evitar falso positivo.
  if (!Array.isArray(ACERVO_CONTOS) || ACERVO_CONTOS.length === 0) return null;
  const tituloLimpo = extrairTituloDoPedido(pedido);
  if (!tituloLimpo || tituloLimpo.length < 4) return null;
  const k = norm(tituloLimpo);

  // 1. Match exato
  let m = ACERVO_CONTOS.find((c) => norm(c.titulo) === k || norm(`${c.titulo} ${c.autor}`) === k);
  if (m) return m;

  // 2. Match parcial (≥70% de overlap) — só títulos >=8 chars pra evitar falso curto
  m = ACERVO_CONTOS.find((c) => {
    const t = norm(c.titulo);
    if (t.length < 8) return false;
    if (k.includes(t)) return true;
    if (t.includes(k) && k.length >= 8) return true;
    // Overlap de 3+ tokens sequenciais (t títulos curtos tipo "vovo" caem aqui)
    const tokensP = k.split(/\s+/).filter((w) => w.length >= 4);
    const tokensT = t.split(/\s+/).filter((w) => w.length >= 4);
    if (tokensP.length === 0 || tokensT.length === 0) return false;
    const comuns = tokensT.filter((tok) => tokensP.includes(tok)).length;
    const denom = Math.max(tokensP.length, tokensT.length);
    return comuns / denom >= 0.5 && comuns >= 2;
  });
  if (m) return m;

  return null;
}

function tentarBuscarContoNaWeb(tituloOriginal, autorOriginal = "Autor Desconhecido") {
  // Chama /usr/local/bin/web_search_gugu.sh "<titulo>" "<autor>".
  // Estratégia de extração do autor: split último "de/do/da" e usa como hint.
  // Wikisource opensearch funciona melhor com query mais curta e explícita — tenta
  // primeiro com a extração, depois cai pra titulo completo se o autor for "Autor Desconhecido".
  return new Promise((resolve) => {
    let autor = "Autor Desconhecido";
    let tituloLimpo = tituloOriginal;
    // Procura "de/do/da" apenas na última palavra/frase (autor vem no fim do pedido)
    const reAutor = /^(.+?)\s+(?:de|do|da|por)\s+([A-ZÁ-Ú][^0-9]+)$/i;
    const m = String(tituloOriginal).match(reAutor);
    if (m && m[2].trim().split(/\s+/).length <= 6) {
      tituloLimpo = m[1].trim();
      autor = m[2].trim();
    }
    const proc = (0, import_child_process.spawn)(
      "bash",
      ["/usr/local/bin/web_search_gugu.sh", tituloLimpo, autor],
      { timeout: 30000 }
    );
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => stdout += d.toString());
    proc.stderr.on("data", (d) => stderr += d.toString());
    proc.on("close", (code) => {
      const txt = (stdout || "").trim();
      // stderr do script: prioriza linha "__URL__:<url>" explícita (cache hit
      // e fresh fetch emitem). Fallback: regex no log "→ https://..." que existia
      // antes do cache hit não ter URL persistida.
      let urlFound = null;
      const explicitMatch = stderr.match(/__URL__:(https:\/\/[^\s]+)/);
      if (explicitMatch) {
        urlFound = explicitMatch[1];
      } else {
        const urlMatch = stderr.match(/https:\/\/pt\.wikisource\.org\/wiki\/[^\s→]+/);
        urlFound = urlMatch ? urlMatch[0] : null;
      }
      if (code === 0 && txt && txt.length >= 800 && !txt.startsWith("__CONTO")) {
        resolve({
          ok: true,
          texto: txt,
          url: urlFound,
          autor,
          titulo: tituloLimpo,
          chars: txt.length,
        });
        return;
      }
      const motivo = txt && txt.startsWith("__CONTO") ? txt : `exit=${code}`;
      console.warn(`[web_search_gugu] falhou (${motivo}) pra "${tituloLimpo}" de "${autor}" (stderr: ${stderr.slice(-200).replace(/\n/g, " ")})`);
      resolve({ ok: false, motivo });
    });
    proc.on("error", (e) => {
      console.warn(`[web_search_gugu] spawn error: ${e.message}`);
      resolve({ ok: false, motivo: e.message });
    });
  });
}

function montarFalaContoWeb(nome, titulo, autor, texto, url) {
  // Pega as primeiras 600-900 chars do conto (depois de título/UI/Markup)
  // e monta fala Gugu no formato: abertura + trecho + tag "continua no ar"
  const limpa = String(texto || "")
    .replace(/\s+/g, " ")
    .trim();
  // Heurística: pula título+UI até achar começo de narrativa (frases longas com verbo)
  const paragrafos = String(texto || "").split(/\n\n+/);
  let trecho = "";
  for (const p of paragrafos) {
    const pLimpo = p.trim();
    if (!pLimpo) continue;
    if (pLimpo.length < 60) continue;
    trecho = pLimpo.slice(0, 800);
    break;
  }
  if (!trecho) trecho = limpa.slice(0, 800);
  // Sanitiza: tira pontuação estranha / aspas tipográficas
  trecho = trecho.replace(/["""]/g, '"').replace(/[''']/g, "'");
  // Abertura estilo Gugu
  const abertura = `${nome}, o Gugu foi buscar essa na coleção da casa. Saiu um conto de ${autor} — "${titulo}" — pra abrir o porão. Ouve só o começo:`;
  const tagFinal = url
    ? `... continua no porão. Texto completo lá no Wikisource, criatura. Dormia com a luz acesa.`
    : `... continua no porão. Se quiser o final, manda o Gugu repetir a dose.`;
  return `${abertura}\n\n${trecho}\n\n${tagFinal}`;
}

function gerarLocucaoTerror(nome, pedido, username, ehConto = false) {
  // =====================================================================
  // FLUXO 1 — WEB SEARCH (01/09/2026, msg 3396): se ehConto E pedido não bate
  // com nenhum dos 19 contos do acervo, tenta buscar domínio público na web.
  // Se achar, monta fala sem chamar LLM (texto já vem pronto do Wikisource).
  // =====================================================================
  if (ehConto) {
    const matched = conferirContoNoAcervo(pedido);
    if (!matched) {
      const tituloExtraido = extrairTituloDoPedido(pedido);
      if (tituloExtraido && tituloExtraido.length >= 4) {
        console.log(`[conte] "${pedido}" → web_search "${tituloExtraido}" (sem match no acervo)`);
        return tentarBuscarContoNaWeb(tituloExtraido).then((res) => {
          if (res && res.ok) {
            const fala = montarFalaContoWeb(nome, res.titulo, res.autor, res.texto, res.url);
            console.log(`[conte] ✅ web search: ${res.chars} chars de "${res.titulo}" (${res.autor}) → url=${res.url}`);
            return fala;
          }
          console.log(`[conte] web_search falhou (${res && res.motivo}), caindo pra Hermes`);
          return gerarLocucaoTerrorFallback(nome, pedido, username, true);
        });
      }
    }
  }
  // Se matched ou não ehConto, fluxo normal
  return gerarLocucaoTerrorFallback(nome, pedido, username, ehConto);
}

function gerarLocucaoTerrorFallback(nome, pedido, username, ehConto = false) {
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

INSTRUÇÃO DE NARRATIVA: quando o ouvinte pede um conto, NÃO gere só a vinheta. Você deve NARRAR O CONTO INTEIRO no ar. Estrutura:
- 1 frase de abertura sombria (max 80 chars) citando o título e o autor
- AMBIENTAÇÃO (20% do conto): lugar, cheiro, hora, clima — frases longas, detalhadas
- INSTALAÇÃO dos personagens (20%): quem, o que quer, por que está lá
- ESCALADA da tensão (40%): fatos estranhos crescendo, presságios, dúvidas do protagonista
- CLÍMAX + desfecho sombrio (20%): revelação, violência ou horror, fim abrupto
Total: 1200-1800 chars (~80-120s de narração em speed 0.85). Tom íntimo, gótico, NPR de madrugada. Detalhes sensoriais (cheiro, textura, som), diálogos curtos entre aspas, pausas longas indicadas por "...". SEM markdown, SEM emojis, SEM nomes de ferramentas, SEM prefácio tipo "Vou narrar". Comece DIRETO com a fala do Gugu.

Se NÃO houver match claro do pedido com nenhum conto, diga: "Esse tema não tá no porão do Gugu. Posso te contar [NOME_DO_CONTO_MAIS_PRÓXIMO] do acervo que tem clima parecido — quer que eu mande?". Máx 200 chars.`;
  }

  const promptTerror = `Mural da Rádio do Gugu — pedido do ouvinte ${nome}: "${pedido}". Responda como o Gugu: locutor de histórias de terror, voz grave e envolvente.${catalogoContosBloco}
${ehConto ? "" : `Se o pedido for pra tocar uma música brega, gere APENAS a vinheta de chamada (máx 80 chars): "Tá na mão, ${nome}. Vem com o Gugu e o brega que não perdoa."`}
PT-BR puro, sem markdown, sem nomes de ferramentas, sem versículo bíblico, sem emojis. Fale como se tivesse sussurrando no microfone.

REGRA CRÍTICA: NUNCA invente histórias com "torre de transmissão", "rádio" ou qualquer elemento do cenário da Rádio do Gugu. Se o ouvinte pedir algo que não existe no acervo, escolha o conto do acervo com tema MAIS parecido e avise: "Esse tema não tá no porão do Gugu, mas posso te contar [NOME] que tem clima parecido. Manda ver?".

IMPORTANTE: responda APENAS com a fala do Gugu — nada de comentários, raciocínio, metadados, contagem de caracteres, prefácio tipo "Resposta:" ou "Dentro do limite:". Comece direto na fala.`;
  return callHermes(
    promptTerror,
    username || "Mural-Gugu"
  ).then((hermesResp) => {
    if (hermesResp === "__HERMES_FAILED__" || !hermesResp || hermesResp.length < 30) {
      console.warn(`[mural] Hermes falhou/curto — usando fallback com conto aleatório`);
      // Fallback MELHOR: escolhe um conto aleatório do acervo e apresenta,
      // em vez de só "preparando" (silêncio no ar = bug visto 29/08 às 12:05).
      if (ehConto && Array.isArray(ACERVO_CONTOS) && ACERVO_CONTOS.length > 0) {
        const c = ACERVO_CONTOS[Math.floor(Math.random() * ACERVO_CONTOS.length)];
        return `Boa noite, ${nome}. O Gugu abriu o porão e escolheu pra você: "${c.titulo}", de ${c.autor}. Fica de orelha em pé que essa vem agora.`;
      }
      return `Tá na mão, ${nome}. O Gugu tá preparando teu pedido. Fica ligado.`;
    }
    // FILTRO ANTI-MISTURA (defesa em profundidade — tolerância >30% estrangeiro)
    // FIX (29/08/2026 13:42): antes rejeitava fala inteira com 1 caractere CJK.
    // Bug visto: o prompt tinha 1 kanji (鬼) que às vezes ecoava na resposta
    // OU o LLM leve (gpt-oss-120b) inseria 1-2 ideogramas em narrativa longa.
    // Resultado: contos válidos de 1500+ chars caiam no fallback brega de 118.
    // Agora: conta caracteres não-latinos; só rejeita se >30% do texto for estrangeiro.
    const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
    const CYR_RE = /[Ѐ-ӿ]/g;
    const HEB_RE = /[֐-׿]/g;
    const ARABIC_RE = /[؀-ۿ]/g;
    const texto = hermesResp || "";
    const totalChars = texto.length;
    if (totalChars >= 50) {
      const cjkCount = (texto.match(CJK_RE) || []).length;
      const cyrCount = (texto.match(CYR_RE) || []).length;
      const hebCount = (texto.match(HEB_RE) || []).length;
      const arabicCount = (texto.match(ARABIC_RE) || []).length;
      const estrangeiroCount = cjkCount + cyrCount + hebCount + arabicCount;
      const pctEstrangeiro = estrangeiroCount / totalChars;
      if (pctEstrangeiro > 0.30) {
        console.warn(`[mural] FILTRO pegou idioma estrangeiro (${(pctEstrangeiro*100).toFixed(1)}% do texto) — usando fallback Gugu`);
        return `Tá na mão, ${nome}. O Gugu tá com interferência na biblioteca de contos, mas prepara o fone que vem coisa boa.`;
      }
      // Limpa caracteres CJK isolados (1-2 no meio de texto PT-BR é ruído, não troca idioma)
      if (estrangeiroCount > 0) {
        const limpo = texto
          .replace(CJK_RE, "")
          .replace(CYR_RE, "")
          .replace(HEB_RE, "")
          .replace(ARABIC_RE, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        console.log(`[mural] filtro removeu ${estrangeiroCount} chars estrangeiros isolados (era ${(pctEstrangeiro*100).toFixed(1)}%)`);
        return limpo;
      }
    }
    return texto.trim();
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

  // Polling FIX (29/08/2026 13:42): checa SEMPRE se o worker morreu, independente
  // da fila. Antes verificava só se filaLocucoes.length===0 — deadlock quando
  // havia >1 item enfileirado (worker morria mas polling nunca disparava,
  // processandoLocucao ficava stuck=true pra sempre).
  const poll = setInterval(() => {
    let pidAlive = false;
    try {
      process.kill(proc.pid, 0); // retorna 0 se existe, throw se morto
      pidAlive = true;
    } catch (e) {
      pidAlive = false;
    }
    if (!pidAlive) {
      clearInterval(poll);
      processandoLocucao = false;
      const durSeg = Math.round((Date.now() - t0) / 1000);
      filaStats.processadas++;
      filaStats.ultimoTempoSeg = durSeg;
      io.emit("fila-status", {
        processando: false,
        tamanho: filaLocucoes.length,
        itens: filaLocucoes.map((i) => ({ id: i.id, nome: i.nome, duration: i.duration })),
        stats: filaStats
      });
      console.log(`[fila] ✅ id=${item.id} dur=${durSeg}s status=concluido (fila restante=${filaLocucoes.length})`);
      // Próxima (recursão correta: só continua se há itens)
      if (filaLocucoes.length > 0) {
        setImmediate(processarProximaLocucao);
      } else {
        console.log("[fila] vazia, worker livre");
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
  const oracoes = loadOracoes();
  res.json({ total: oracoes.length, recentes: oracoes.slice(-50).reverse() });
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

  // Persiste no JSON (mantém últimos 200)
  const oracoes = loadOracoes();
  oracoes.push({ id: nova.id, nome: nova.nome, pedido: nova.pedido, fala: nova.fala, ehConto: nova.ehConto, contexto: contexto || (nova.ehConto ? "aba-conto" : "musica"), criadaEm: nova.criadaEm });
  saveOracoes(oracoes);

  // Enfileira pra tocar no ar
  await falarNoAr(fala, duracao);

  res.status(202).json({ sucesso: true, oracao: nova, fila: { enfileirada: true, duracao } });
});

// =============================================================================
// SALA PRIVADA (chat 1:1 com Gugu) — texto longo
// =============================================================================
app.post("/api/sala/message", async (req, res) => {
  // Frontend Studio (commit 899b9cd) envia payload { username, text, contexto, tipo }.
  // Aceita também legacy { nome, pedido, contexto } e { username, text }.
  const body = req.body || {};
  const username = (body.username || body.nome || "").toString().trim().slice(0, 50);
  const text = (body.text || body.pedido || "").toString().trim().slice(0, 500);
  const contexto = (body.contexto || "").toString();
  const tipo = (body.tipo || "").toString();
  const conto_slug = body.conto_slug;
  if (!username || !text) return res.status(400).json({ erro: "username e text obrigatórios" });

  // =============================================================================
  // ROTEAMENTO POR TIPO/CONTEXTO (30/08/2026) — separação Mural do Medo vs Pedido Brega/Salve
  // =============================================================================
  // - tipo === "pedido_rapido" ou (contexto === "musica" sem tipo "chat")
  //   → Pedido rápido BREGA/SALVE: gera locução curta 150-250 chars, fala no ar com duration "curta"
  // - tipo === "conto_terror" ou contexto === "aba-conto"
  //   → Mural do Medo CONTO: skill mentor-contos-terror, narrativa 1200-1800 chars, fala no ar "pregar"
  // - tipo === "chat" ou (sem tipo e contexto === "musica")
  //   → Sala privada normal: resposta longa no chat, NÃO injeta direto no ar
  // =============================================================================
  const ehPedidoRapido = tipo === "pedido_rapido" || (tipo === "" && contexto === "musica" && /brega|salve|toca|manda|coloca|quero ouvir/i.test(text));
  const ehContoTerror = tipo === "conto_terror" || contexto === "aba-conto";

  if (ehPedidoRapido) {
    // MURAL DE PEDIDOS RÁPIDOS (Brega/Salve/Top 10) — locução curta no ar
    console.log(`[brega] pedido rápido de ${username}: "${text}" (tipo=${tipo}, contexto=${contexto})`);
    try {
      const fala = await gerarLocucaoBregaSalve(username, text, "Mural-Brega");
      const duracao = "curta";
      const nova = {
        id: `ped-${Date.now()}`,
        nome: username,
        pedido: text,
        fala,
        ehConto: false,
        contexto: "musica",
        criadaEm: new Date().toISOString()
      };
      // Persiste
      const oracoes = loadOracoes();
      oracoes.push({ id: nova.id, nome: nova.nome, pedido: nova.pedido, fala: nova.fala, ehConto: false, contexto: "musica", criadaEm: nova.criadaEm });
      saveOracoes(oracoes);
      io.emit("oracao-nova", nova);
      // Enfileira no ar (duration "curta")
      await falarNoAr(fala, duracao);
      return res.status(202).json({
        sucesso: true,
        resposta: fala,
        oracao: nova
      });
    } catch (e) {
      console.error("[brega] erro ao processar pedido rápido:", e.message);
      return res.json({
        sucesso: false,
        resposta: "⚠️ O Gugu tá com chiado no estúdio. Tenta de novo em alguns minutos, criatura.",
        erro: e.message
      });
    }
  }

  if (ehContoTerror) {
    // MURAL DO MEDO (Conto de Terror) — narrativa longa no ar
    console.log(`[conto] mural do medo pedido de ${username}: "${text}" (tipo=${tipo}, contexto=${contexto})`);
    try {
      const fala = await gerarLocucaoTerror(username, text, "Mural-Conto", true);
      const duracao = "pregar";
      const nova = {
        id: `ped-${Date.now()}`,
        nome: username,
        pedido: text,
        fala,
        ehConto: true,
        contexto: "aba-conto",
        criadaEm: new Date().toISOString()
      };
      // Persiste
      const oracoes = loadOracoes();
      oracoes.push({ id: nova.id, nome: nova.nome, pedido: nova.pedido, fala: nova.fala, ehConto: true, contexto: "aba-conto", criadaEm: nova.criadaEm });
      saveOracoes(oracoes);
      io.emit("oracao-nova", nova);
      // Enfileira no ar (duration "pregar" sem limite)
      await falarNoAr(fala, duracao);
      return res.status(202).json({
        sucesso: true,
        resposta: fala,
        oracao: nova
      });
    } catch (e) {
      console.error("[conto] erro ao processar mural do medo:", e.message);
      return res.json({
        sucesso: false,
        resposta: "⚠️ O Gugu tá com interferência na biblioteca de contos. Tenta de novo em alguns minutos, criatura.",
        erro: e.message
      });
    }
  }

  // SALA PRIVADA (chat 1:1 com Gugu) — fluxo original abaixo

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

  if (conto_slug) {
    const conto = ACERVO_CONTOS.find((c) => c.slug === conto_slug);
    if (conto && import_fs.default.existsSync(conto.arquivoPath)) {
      const md = import_fs.default.readFileSync(conto.arquivoPath, "utf-8");
      const corpo = md.split(/^---\s*$/m)[1] || md;
      // Limita a 3000 chars pra não estourar context window
      contextoConto = `\n\n[CONTEXTO: o ouvinte está discutindo o conto "${conto.titulo}" de ${conto.autor}. Tipo: ${conto.tipo}. Sinopse: ${conto.sinopse}. Conteúdo (truncado em 3000 chars):\n---\n${corpo.slice(0, 3000)}\n---]`;
    }
  }

  // Detecta se tá pedindo história/conto no sala — se sim, injeta catálogo
  // pra LLM NÃO inventar (bug visto 29/08/2026: sempre repetia a mesma história fake)
  const querConto = /conte uma hist|conta uma hist|conte um conto|conta um conto|conte uma est|conta uma est|me conta uma hist|me conte uma hist|hist[óo]ria de terror|conto de terror|conte um caso|conta um caso|conte algo de terror|conta algo de terror|conte um causo|conta um causo|conte uma lenda|conta uma lenda/i.test(text);
  let catalogoBloco = "";
  if (querConto && Array.isArray(ACERVO_CONTOS) && ACERVO_CONTOS.length > 0 && !conto_slug) {
    // Pega 6 contos aleatórios pra variar a cada pedido (evita repetir sempre o mesmo)
    const embaralhado = [...ACERVO_CONTOS].sort(() => Math.random() - 0.5).slice(0, 6);
    const lista = embaralhado.map((c, i) => `${i + 1}. "${c.titulo}" — ${c.autor} (${c.tipo}) — ${c.sinopse}`).join("\n");
    catalogoBloco = `

INSTRUÇÃO DE NARRAÇÃO NA SALA PRIVADA: quando o ouvinte pedir pra ouvir/contar/narrar um conto (frases tipo "conte", "narra", "manda", "vai", "manda ver", "conta essa"), NÃO gere só uma apresentação. Você deve NARRAR O CONTO INTEIRO no chat. Estrutura:
- 1 frase de abertura sombria (máx 80 chars) citando o título e o autor
- AMBIENTAÇÃO (20%): lugar, hora, cheiro, clima — frases longas, detalhadas
- INSTALAÇÃO dos personagens (20%): quem, o que quer, por que está lá
- ESCALADA da tensão (40%): fatos estranhos crescendo, presságios, dúvidas
- CLÍMAX + desfecho sombrio (20%): revelação, violência ou horror, fim abrupto
Total: 1500-2200 chars. Tom íntimo, gótico, NPR de madrugada. Detalhes sensoriais (cheiro, textura, som), diálogos curtos entre aspas, pausas longas indicadas por "...". SEM markdown, SEM emojis, SEM prefácio tipo "Vou narrar". Comece DIRETO com a fala do Gugu. NÃO termine com pergunta — a narrativa fala por si.

Se o ouvinte só quiser INDICAÇÃO ("qual você recomenda?", "tem algo de amor?"), aí sim responda curto (máx 300 chars), cite 1 conto, faça UMA pergunta final.

Acervo do Gugu (escolha UM destes 6 contos diferentes a cada pedido — VARIE, não repita sempre o mesmo):
${lista}`;
  }

  const promptSala = `[Sala-Privada ${username}] ${text}${contextoConto}${catalogoBloco}\n\nResponda como o Gugu (locutor de terror): tom grave, sussurrado, envolvente. SEM markdown, SEM emojis, SEM nomes de ferramentas. SEM versículo bíblico. PT-BR puro.${querConto ? "\n\nNARRE O CONTO INTEIRO conforme INSTRUÇÃO DE NARRAÇÃO NA SALA PRIVADA acima." : " Se pedirem indicação de conto, indique 1 do acervo e pergunte se quer ouvir no ar (máx 300 chars)."} VARIE o conto escolhido a cada pedido — não repita o mesmo. Se houver CONTEXTO de conto acima, USE-O pra fundamentar (cite detalhes do conto, personagens, clímax) — não invente.${querConto ? "" : " IMPORTANTE: só narre INTEIRO quando o ouvinte disser claramente \"conte/narra/manda\" — caso contrário só indique."}

REGRA CRÍTICA: É terminantemente proibido inventar histórias originais (tipo "torre de transmissão às 03:33", "rádio amaldiçoada", "voz esquecida no microfone"). Esses clichês com elementos do cenário NÃO SÃO do acervo e devem ser recusados. SEMPRE escolha um conto REAL do Acervo do Gugu listado acima. Se o ouvinte pedir algo específico que não bate com nenhum conto do acervo, ofereça o conto mais próximo e avise que não é exato.`;
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
// FIX (29/08/2026 17:05): antes forçava "curta" (30s máx) — falas de conto da
// sala privada (1500-2200 chars = 60-120s) eram TRUNCADAS em 30s. Usuário
// ouvia metade e a música voltava no meio. Agora detecta conto na fala e
// usa "pregar" (sem limite). Critérios: tamanho >= 600 chars OU presença
// de marcadores narrativos ("Era uma noite", "Chama-se", autor clássico).
// =============================================================================
app.post("/api/sala/broadcast", async (req, res) => {
  const { username, fala } = req.body || {};
  if (!username || !fala) return res.status(400).json({ erro: "username e fala obrigatórios" });

  // Detecta se é conto (mesmo regex do front pra decidir "pode_enviar_para_radio")
  const ehContoSala = fala.length >= 600 ||
    /conte uma hist|conta uma hist|conte um conto|conta um conto|hist[óo]ria de terror|conto de terror|Era uma noite|Chama-se|Edgar Allan Poe|H.P. Lovecraft|H\.P\. Lovecraft|Machado de Assis|Stephen King|Shirley Jackson|Thomas Hardy|Hugh Walpole|Henrique Coelho Neto|Marciano Henriques|George Sand/i.test(fala);
  const duration = ehContoSala ? "pregar" : "curta";

  console.log(`[sala] ${username} mandou pro ar: "${fala.slice(0, 80)}..." (chars=${fala.length}, duration=${duration})`);

  await falarNoAr(fala, duration);

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
  // FIX 2026-08-30: icecast 9040 virou FONTE PRIMÁRIA (metadata real do liquidsoap).
  // AzuraCast API 9090 fica como fallback (sabe elapsed/remaining mas atrasa a metadata
  // quando playlist usa annotate: com song_id gen-* que não existe no banco).
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
        if (Array.isArray(src)) { /* pega o primeiro source */ }
        const s = Array.isArray(src) ? src[0] : src;
        if (s && typeof s === "object" && (s.title || s.artist)) {
          return res.json({
            title: s.title || "",
            artist: s.artist || "",
            listeners: parseInt((data.icestats && data.icestats.listeners) || "0", 10),
            bitrate: parseInt(s.bitrate || "192", 10),
            server_name: (data.icestats && data.icestats.server_name) || "Rádio do Gugu"
          });
        }
        // icecast vazio → cai no fallback
        return fallbackAzuraCast(res);
      } catch (e) {
        return fallbackAzuraCast(res, "icecast parse falhou: " + e.message);
      }
    });
  });
  upstream.on("error", (e) => {
    console.error("[now-playing] icecast indisponivel:", e.message);
    return fallbackAzuraCast(res, "icecast offline");
  });
  upstream.on("timeout", () => {
    console.error("[now-playing] icecast timeout");
    upstream.destroy();
    return fallbackAzuraCast(res, "icecast timeout");
  });
  upstream.end();

  // Fallback AzuraCast API 9090 (mantido pra quando icecast cair)
  function fallbackAzuraCast(res, prevErr) {
    const fb = import_http.default.request({ host: "127.0.0.1", port: 9090, path: "/api/nowplaying/radio_gugu", method: "GET", timeout: 3000 }, (u) => {
      let b = ""; u.on("data", (d) => b += d.toString()); u.on("end", () => {
        try {
          const data = JSON.parse(b);
          const np = data.now_playing || {};
          const nx = data.playing_next || {};
          const npSong = np.song || {};
          const nxSong = nx.song || {};
          const npRemain = typeof np.remaining === "number" ? np.remaining : 999;
          let titulo, artista;
          if (npRemain <= 0 && nxSong.title) {
            titulo = nxSong.title; artista = nxSong.artist;
          } else if (npSong.title) {
            titulo = npSong.title; artista = npSong.artist;
          } else { titulo = ""; artista = ""; }
          const listeners = (data.listeners && data.listeners.total) || 0;
          const bitrate = ((data.station && data.station.mounts && data.station.mounts[0] && data.station.mounts[0].bitrate) || 192);
          return res.json({
            title: titulo, artist: artista, listeners, bitrate,
            server_name: (data.station && data.station.name) || "Rádio do Gugu",
            ...(prevErr ? { warning: prevErr } : {})
          });
        } catch (e) {
          return res.json({ title: "", artist: "", listeners: 0, error: "azuracast parse falhou: " + e.message });
        }
      });
    });
    fb.on("error", () => res.json({ title: "", artist: "", listeners: 0, error: "icecast+azuracast offline" }));
    fb.on("timeout", () => { fb.destroy(); res.json({ title: "", artist: "", listeners: 0, error: "azuracast fallback timeout" }); });
    fb.end();
  }
});

// Alias /api/mural → /api/oracoes (retro-compat + semântica mais clara)
app.get("/api/mural", (req, res) => res.redirect(307, "/api/oracoes"));
app.post("/api/mural", (req, res) => res.redirect(307, "/api/oracoes"));

// =============================================================================
// WEB DJ — /admin/estudio (criado 31/08/2026 msg 3297)
// Rota protegida por Basic Auth. Carrega iframe da interface oficial Web DJ
// do AzuraCast (webdj.automacaojs.us/webdj/radio_gugu) — subdomínio já
// roteado pelo tunnel CF (Edge v91). Streamer "gugu-teste" ativo no banco.
// Login e senha vêm do .env-web-dj (chmod 600) — MVP, evoluir pra Supabase.
// =============================================================================
(function loadWebDjEnv() {
  try {
    const envPath = import_path.default.join(__dirname, ".env-web-dj");
    if (!import_fs.default.existsSync(envPath)) {
      console.warn("[web-dj] .env-web-dj não encontrado em", envPath);
      return;
    }
    const raw = import_fs.default.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    console.error("[web-dj] erro ao carregar .env-web-dj:", e.message);
  }
})();

var WEB_DJ_USER = process.env.WEB_DJ_USER || "gugu";
var WEB_DJ_PASS = process.env.WEB_DJ_PASS || "dj-gugu-2026";
var WEB_DJ_IFRAME_URL = "https://webdj.automacaojs.us/public/radio_gugu/dj";

function webDjBasicAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Gugu Web DJ", charset="UTF-8"');
    return res.status(401).send("Autenticação necessária");
  }
  let decoded = "";
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch (e) {
    return res.status(400).send("Header Authorization inválido");
  }
  const idx = decoded.indexOf(":");
  const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
  const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (user === WEB_DJ_USER && pass === WEB_DJ_PASS) return next();
  res.set("WWW-Authenticate", 'Basic realm="Gugu Web DJ", charset="UTF-8"');
  return res.status(403).send("Credenciais inválidas");
}

app.get("/admin/estudio", webDjBasicAuth, (req, res) => {
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Cache-Control", "no-store");
  res.set("Content-Security-Policy", "frame-src https://webdj.automacaojs.us; script-src 'self' 'unsafe-inline' https://webdj.automacaojs.us; style-src 'self' 'unsafe-inline' https://webdj.automacaojs.us; img-src 'self' data: https:; connect-src 'self' https://webdj.automacaojs.us wss://webdj.automacaojs.us");
  res.type("html").send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gugu — Estúdio de Transmissão</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0a0612; color: #f3e8ff; font-family: system-ui, sans-serif; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #1a0f2e; border-bottom: 1px solid #4c1d95; }
  header h1 { margin: 0; font-size: 16px; color: #c084fc; font-weight: 700; letter-spacing: 0.5px; }
  header .pill { background: #4c1d95; color: #f3e8ff; font-size: 11px; padding: 3px 9px; border-radius: 999px; }
  header .user { margin-left: auto; font-size: 12px; color: #a78bfa; }
  header .user b { color: #f3e8ff; }
  main { display: grid; grid-template-rows: auto 1fr; height: calc(100vh - 51px); }
  .hint { background: #1e1b4b; color: #ddd6fe; font-size: 12px; padding: 8px 16px; line-height: 1.5; border-bottom: 1px solid #312e81; }
  .hint b { color: #c4b5fd; }
  iframe { width: 100%; height: 100%; border: 0; background: #0a0612; }
</style>
</head>
<body>
<header>
  <h1>🎙️ Gugu — Estúdio</h1>
  <span class="pill">Rádio do Gugu · estação 7</span>
  <span class="user">logado como <b>${WEB_DJ_USER}</b></span>
</header>
<main>
  <div class="hint">
    <b>Web DJ no navegador</b> — carrega a interface oficial do AzuraCast (subdomínio <code>webdj.automacaojs.us</code>).
    Logue com o usuário <b>isaias@automacaojs.us</b> do AzuraCast (ou com a conta DJ <b>gugu-teste</b>) e clique em
    <b>Connect</b>. O AutoDJ vai ceder o microfone e a playlist volta automaticamente quando você desconectar.
    Pra encerrar a sessão, feche esta aba.
  </div>
  <iframe src="${WEB_DJ_IFRAME_URL}" allow="microphone; camera; autoplay; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</main>
</body>
</html>`);
});

app.get("/api/web-dj/status", (req, res) => {
  res.json({
    iframe_url: WEB_DJ_IFRAME_URL,
    streamer_active: true,
    streamer_username: "gugu-teste",
    shoutcast_host: "127.0.0.1",
    shoutcast_port: 9045,
    shoutcast_mount: "/live",
    auth_required: true,
    auth_method: "Basic"
  });
});

// =============================================================================
// ADMIN GERENTE — painel pra upload/delete de mídia da estação 7
// Adicionado 2026-09-01 — não toca em rotas existentes
// =============================================================================

// Sessões em memória (Map simples, suficiente pro painel)
const adminSessions = new Map();
const SESSION_TTL_MS = 8 * 3600 * 1000;

function createSessionToken() {
  // 32 bytes hex via openssl (sempre disponível em Linux)
  try {
    return import_child_process.execSync("openssl rand -hex 32", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    // fallback: Date.now + Math.random (menos seguro mas funciona)
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

function createSession(userId, email) {
  const token = createSessionToken();
  adminSessions.set(token, { userId: parseInt(userId), email, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

function validateSession(req) {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("admin_token="));
  if (!cookie) return null;
  const token = cookie.split("=")[1];
  const s = adminSessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { adminSessions.delete(token); return null; }
  return s;
}

// Valida e-mail/senha direto no MariaDB do AzuraCast
// Estratégia: copiar verify.php pro container UMA VEZ no startup, depois usar stdin
// (evita expansão de $ pelo shell que quebra password_verify com hash argon2)
let _verifyPhpCopied = false;
function ensureVerifyPhpInContainer() {
  if (_verifyPhpCopied) return;
  try {
    const phpCode = `<?php\n$lines = explode("\\n", file_get_contents('php://stdin'), 3);\n$senha = trim($lines[0] ?? '');\n$hash = trim($lines[1] ?? '');\nif (!$senha || !$hash) { echo "EMPTY"; exit; }\necho password_verify($senha, $hash) ? "OK" : "FAIL";\n`;
    const fs = require("fs");
    const tmpPhp = "/tmp/.azuracast-verify-" + process.pid + ".php";
    fs.writeFileSync(tmpPhp, phpCode);
    import_child_process.execSync("docker cp " + tmpPhp + " azuracast:/tmp/.verify.php", { stdio: "ignore" });
    fs.unlinkSync(tmpPhp);
    _verifyPhpCopied = true;
  } catch (e) {
    console.error("[admin] falha ao copiar verify.php:", e.message);
  }
}

function checkAzuraCastCredentials(email, senha) {
  return new Promise((resolve) => {
    ensureVerifyPhpInContainer();
    const safeEmail = String(email).replace(/['"\\;]/g, "");
    const sql = `SELECT u.id, u.email, u.auth_password, GROUP_CONCAT(uhr.role_id) AS role_ids\n                 FROM users u\n                 LEFT JOIN user_has_role uhr ON uhr.user_id = u.id\n                 WHERE u.email = '${safeEmail}'\n                 GROUP BY u.id`;
    const cmd = `docker exec -e MYSQL_PWD='9ZrfJAANw4cE' azuracast mariadb -u azuracast azuracast -N -e "${sql.replace(/"/g, '\\"')}"`;
    import_child_process.exec(cmd, { timeout: 10000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      const parts = stdout.trim().split("\t");
      if (parts.length < 3) return resolve(null);
      const [id, dbEmail, hash, roleIds] = parts;
      if (!hash || hash[0] !== "$") return resolve(null);
      // Passa senha e hash via stdin (sem argv shell, evita expansão de $)
      const stdinData = String(senha) + "\n" + hash + "\n";
      const proc = import_child_process.spawn("docker", ["exec", "-i", "azuracast", "php", "/tmp/.verify.php"]);
      let out = "", errOut = "";
      proc.stdout.on("data", d => out += d.toString());
      proc.stderr.on("data", d => errOut += d.toString());
      proc.on("close", code => {
        if (code !== 0 || out.trim() !== "OK") return resolve(null);
        resolve({ id: parseInt(id), email: dbEmail, roleIds: roleIds || "" });
      });
      proc.on("error", () => resolve(null));
      proc.stdin.write(stdinData);
      proc.stdin.end();
    });
  });
}

// Login
app.post("/api/admin/login", (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ ok: false, error: "e-mail e senha obrigatórios" });
  checkAzuraCastCredentials(email, senha).then(user => {
    if (!user) return res.status(401).json({ ok: false, error: "credenciais inválidas" });
    // Verificar se tem role 3 (Gerente Gugu) — única permitida nesse painel
    const roles = (user.roleIds || "").split(",").filter(Boolean);
    if (!roles.includes("3")) {
      return res.status(403).json({ ok: false, error: "você não tem permissão de gerente da Rádio do Gugu (precisa da role 3)" });
    }
    const token = createSession(user.id, user.email);
    res.cookie("admin_token", token, { httpOnly: true, sameSite: "strict", maxAge: SESSION_TTL_MS });
    res.json({ ok: true, email: user.email });
  }).catch(e => res.status(500).json({ ok: false, error: e.message }));
});

// Logout
app.post("/api/admin/logout", (req, res) => {
  const cookie = (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("admin_token="));
  if (cookie) {
    const tok = cookie.split("=")[1];
    adminSessions.delete(tok);
  }
  res.clearCookie("admin_token");
  res.json({ ok: true });
});

// Helper: chama API AzuraCast autenticada via cookie de sessão
// Estratégia: faz POST em /login com form data pra obter cookie app_session,
// depois usa esse cookie nas chamadas subsequentes
let _azSessionCookie = null;
let _azSessionExp = 0;

async function getAzuraSession() {
  if (_azSessionCookie && Date.now() < _azSessionExp) return _azSessionCookie;
  return new Promise((resolve, reject) => {
    const loginData = "username=gerente_gugu@automacaojs.us&password=GuguRadio2026%21";
    const req = import_http.default.request({
      host: "127.0.0.1", port: 9090, path: "/login", method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(loginData)
      },
      timeout: 10000
    }, (up) => {
      // Pega Set-Cookie do response
      const sc = up.headers["set-cookie"] || [];
      let cookie = "";
      for (const c of sc) {
        const m = c.match(/app_session=([^;]+)/);
        if (m) { cookie = "app_session=" + m[1]; break; }
      }
      up.on("data", () => {});
      up.on("end", () => {
        if (!cookie) return reject(new Error("AzuraCast login não retornou cookie app_session"));
        _azSessionCookie = cookie;
        _azSessionExp = Date.now() + 6 * 3600 * 1000; // 6h
        resolve(cookie);
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout azuracast login")); });
    req.write(loginData);
    req.end();
  });
}

function azuraApi(path, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    getAzuraSession().then(cookie => {
      const url = new URL("http://127.0.0.1:9090" + path);
      const opts = {
        host: url.hostname, port: url.port, path: url.pathname + url.search, method,
        headers: { "Cookie": cookie, "Content-Type": "application/json" },
        timeout: 30000
      };
      const req2 = import_http.default.request(opts, (up) => {
        let b = "";
        up.on("data", d => b += d.toString());
        up.on("end", () => {
          try { resolve({ status: up.statusCode, data: JSON.parse(b) }); }
          catch { resolve({ status: up.statusCode, data: b }); }
        });
      });
      req2.on("error", reject);
      req2.on("timeout", () => { req2.destroy(); reject(new Error("timeout azuracast api")); });
      if (body) req2.write(JSON.stringify(body));
      req2.end();
    }).catch(reject);
  });
}

// Lista mídia
app.get("/api/admin/list", async (req, res) => {
  const sess = validateSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "não autenticado" });
  try {
    const r = await azuraApi("/api/station/7/files");
    if (r.status !== 200) return res.status(r.status).json({ ok: false, error: "azuracast api erro", status: r.status, data: r.data });
    const items = (Array.isArray(r.data) ? r.data : []).map(f => ({
      id: f.id,
      path: f.path,
      title: f.title || (f.path || "").split("/").pop().replace(/\.mp3$/i, ""),
      length: f.length || 0,
      length_text: f.length_text || "",
      mtime: f.mtime,
      is_vinheta: ((f.path || "").toLowerCase().includes("vinheta") || (f.path || "").toLowerCase().includes("jingle"))
    }));
    res.json({ ok: true, total: items.length, items });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Upload mídia (música ou vinheta) — recebe JSON com base64
app.post("/api/admin/upload", async (req, res) => {
  const sess = validateSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "não autenticado" });
  const { filename, data_b64, tipo } = req.body || {};
  if (!filename || !data_b64) return res.status(400).json({ ok: false, error: "filename e data_b64 obrigatórios" });
  if (!/\.(mp3|wav|ogg|m4a)$/i.test(filename)) return res.status(400).json({ ok: false, error: "apenas .mp3/.wav/.ogg/.m4a" });

  try {
    const buf = Buffer.from(data_b64, "base64");
    if (buf.length > 50 * 1024 * 1024) return res.status(400).json({ ok: false, error: "arquivo > 50MB" });
    if (buf.length < 1024) return res.status(400).json({ ok: false, error: "arquivo < 1KB, parece inválido" });

    const safeBase = filename.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
    const finalName = (tipo === "vinheta" ? "vinheta_" : "") + safeBase;
    const finalPath = "/var/azuracast/stations/radio_gugu/media/" + finalName;

    // Escrever via docker exec no container (base64 → arquivo)
    const b64 = buf.toString("base64");
    // Sanitizar b64 (só letras/dígits/+/=/) e o nome do arquivo
    const safeB64 = b64.replace(/[^A-Za-z0-9+/=]/g, "");
    const safeFinal = finalName.replace(/[^a-zA-Z0-9._-]/g, "");
    const cmd = `docker exec azuracast bash -c "echo '${safeB64}' | base64 -d > ${finalPath.replace(/[^a-zA-Z0-9._/-]/g, "")} && chown papercl+:papercl+ ${finalPath.replace(/[^a-zA-Z0-9._/-]/g, "")} && echo OK"`;
    const result = import_child_process.execSync(cmd, { timeout: 60000 }).toString().trim();
    if (result !== "OK") throw new Error("escrita falhou: " + result);

    // Re-escanear mídia no AzuraCast (não precisa restartar — só trigger scan)
    setTimeout(() => {
      import_child_process.exec("docker exec azuracast supervisorctl signal USR2 station_7:station_7_backend 2>&1 || true", () => {});
    }, 500);

    res.json({ ok: true, filename: safeFinal, size: buf.length, tipo: tipo || "musica" });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Deletar mídia
app.delete("/api/admin/media/:id", async (req, res) => {
  const sess = validateSession(req);
  if (!sess) return res.status(401).json({ ok: false, error: "não autenticado" });
  const fileId = parseInt(req.params.id);
  if (!fileId || isNaN(fileId)) return res.status(400).json({ ok: false, error: "id inválido" });
  try {
    const r = await azuraApi("/api/station/7/file/" + fileId, "DELETE");
    res.json({ ok: r.status === 200 || r.status === 204, status: r.status, data: r.data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Página HTML do painel admin
app.get("/admin/gerente", (req, res) => {
  res.sendFile(import_path.default.join(SITE_DIR, "admin-gerente.html"));
});

// Quem sou eu (debug)
app.get("/api/admin/me", (req, res) => {
  const sess = validateSession(req);
  if (!sess) return res.status(401).json({ ok: false });
  res.json({ ok: true, email: sess.email, userId: sess.userId });
});

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
