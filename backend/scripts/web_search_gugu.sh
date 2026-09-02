#!/usr/bin/env bash
# =============================================================================
# web_search_gugu.sh v5 — Buscar conto de domínio público na web
# =============================================================================
# Pipeline DIRETO via Wikisource API parse (sem Jina, sem Hermes, sem SearXNG).
# Tudo num único script Python pra evitar shell word-splitting em títulos.
#
# Uso:
#   web_search_gugu.sh "A Coruja" "Machado de Assis"
#   web_search_gugu.sh "O Gato Preto" "Edgar Allan Poe"
#
# Exit: 0=ok 1=uso 2=não encontrado 3=erro técnico 4=curto 5=idioma
# =============================================================================
set -e

if [ "$#" -lt 2 ]; then
    echo "[web_search_gugu] uso: $0 <titulo> <autor>" >&2
    exit 1
fi

TITULO="$1"
AUTOR="$2"
CACHE_FILE="/root/radio-gugu-music/backend/data/contos-baixados.json"
CACHE_LIMIT=50

python3 - "$TITULO" "$AUTOR" "$CACHE_FILE" "$CACHE_LIMIT" <<'PYEOF'
import sys, urllib.parse, urllib.request, json, re, os

titulo_pedido, autor_pedido, cache_file, cache_limit = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

UA = "ClaudinhoBot/1.0 (https://automacaojs.us; contato@automacaojs.us) Python-urllib"

class UAOpener(urllib.request.OpenerDirector):
    pass

_opener = urllib.request.build_opener()
_opener.addheaders = [('User-Agent', UA)]
urllib.request.install_opener(_opener)

def slugify(s):
    s = s.lower()
    try:
        s = s.encode('ascii', 'ignore').decode('ascii')
    except Exception:
        pass
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s[:80]

def log(msg):
    print(f"[web_search_gugu] {msg}", file=sys.stderr)

def is_header_noise(line):
    """Detecta linhas de header/UI do Wikisource que vazam pro começo do texto.
    Cobre: navegação, links irmã, números de página, títulos em CAIXA ALTA que
    precedem a narrativa, e marcadores típicos de MediaWiki."""
    s = line.strip()
    if not s:
        return True
    low = s.lower()
    skip_patterns = [
        'voltar', 'mover para', 'barra lateral', 'ferramentas pessoais',
        'páginas afluentes', 'alterações relacionadas', 'hiperligação permanente',
        'informação da página', 'página principal', 'como participar',
        'portal comunitário', 'mudanças recentes', 'obra aleatória',
        'autor aleatório', 'criar conta', 'iniciar sessão', 'wiki source',
        'media wiki', 'política de privacidade', 'isenção de responsabilidade',
        'termos de uso', 'exportar', 'adicionar idiomas',
        'procurar um formato diferente', 'categorias:', 'obtida de',
        'wikimedia foundation', 'powered by mediawiki',
        'epub para', 'mobi para', 'pdf para', 'algo correu mal',
        'descarregar', 'artigos', 'menu principal', 'projetos irmãos',
        'projetos irmaos', 'projetosirmaos', 'projetos irma',
        'verbete na wikipédia', 'verbete na wikipedia',
        'verbetenawikipédia', 'verbetenawikipedia', 'verbetena',
        'categoria no commons', 'categoriano commons', 'categorianoCommons',
        'item wikidata', 'itemwikidata',
        'unidade de texto com digitalização transcluída',
        'novellas extraordinarias por', 'traduzido por', 'william wilson',
        'demonio da perversidade', 'unidade de texto',
        'artigo wikipédia', 'artigo wikipedia',
    ]
    if any(ui in low for ui in skip_patterns):
        return True
    # Linha só com 1-3 palavras curtas (rótulo UI)
    if len(s.split()) <= 2 and len(s) < 25:
        return True
    # Linha só números/códigos (ex: "225610")
    if re.match(r'^\d[\d\s\.]*$', s):
        return True
    # Linha começando com número de página/contagem seguido de palavras
    # (ex: "225610 Novellas extraordinarias— O gato preto ...")
    if re.match(r'^\d{3,}\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]', s):
        return True
    # Título inteiro em CAIXA ALTA de até 60 chars (cabeçalho de seção)
    if s == s.upper() and len(s) <= 60 and any(c.isalpha() for c in s):
        # Mas só se tiver <=8 palavras (título, não corpo em Caps exagerado)
        if len(s.split()) <= 8:
            return True
    return False

def extract_text(html):
    text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&[a-z0-9#]+;', '', text)
    text = re.sub(r'[ \t]+', ' ', text).strip()
    text = re.sub(r'\n{2,}', '\n\n', text)
    lines = text.split('\n')
    filtered = []
    for line in lines:
        if is_header_noise(line):
            continue
        filtered.append(line.strip())
    return '\n'.join(filtered)

def get_parse(title):
    api = "https://pt.wikisource.org/w/api.php"
    url = api + "?" + urllib.parse.urlencode({
        "action": "parse",
        "page": title,
        "format": "json",
        "prop": "text|links",
        "redirects": 1,
    })
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            return json.load(r)
    except Exception as e:
        log(f"parse falhou pra {title!r}: {e}")
        return None

def filter_non_latin_ratio(text, threshold=0.05):
    if len(text) <= 100:
        return True
    non_latin = sum(1 for c in text if c in '一-鿿぀-ヿ가-힯Ѐ-ӿ֐-׿؀-ۿ')
    return (non_latin / len(text)) <= threshold

def cache_get(key):
    """Retorna tupla (text, url) ou None. Aceita tanto formato novo (dict) quanto
    legacy (string pura). Migra automaticamente no cache_set."""
    try:
        d = json.load(open(cache_file))
        v = d.get(key)
        if isinstance(v, dict):
            t = v.get('texto', '')
            u = v.get('url')
            if t and len(t) >= 800 and filter_non_latin_ratio(t):
                return (t, u)
        elif isinstance(v, str):
            if len(v) >= 800 and filter_non_latin_ratio(v):
                return (v, None)
    except Exception:
        pass
    return None

def cache_set(key, text, url=None):
    try:
        try:
            d = json.load(open(cache_file))
        except Exception:
            d = {}
        d[key] = {'texto': text, 'url': url}
        if len(d) > cache_limit:
            keys = list(d.keys())
            for k in keys[:len(d) - cache_limit]:
                del d[k]
        tmp = cache_file + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        os.replace(tmp, cache_file)
    except Exception as e:
        log(f"cache write falhou: {e}")

cache_key = f"{slugify(titulo_pedido)}__{slugify(autor_pedido)}"

# --- 1. Cache hit ---
cached = cache_get(cache_key)
if cached:
    cached_text, cached_url = cached
    log(f"cache hit: {cache_key} ({len(cached_text)} chars)")
    if cached_url:
        log(f"__URL__:{cached_url}")
    sys.stdout.write(cached_text)
    sys.exit(0)

# --- 2. Opensearch ---
api = "https://pt.wikisource.org/w/api.php"
url = api + "?" + urllib.parse.urlencode({
    "action": "opensearch",
    "search": titulo_pedido,
    "limit": 20,
    "format": "json",
})
try:
    with urllib.request.urlopen(url, timeout=10) as r:
        data = json.load(r)
except Exception as e:
    log(f"opensearch falhou: {e}")
    sys.exit(3)

candidates = data[1] if len(data) > 1 else []
log(f"opensearch retornou {len(candidates)} candidatos: {candidates}")

titulo_norm = re.sub(r'[^\w\s]', ' ', titulo_pedido.lower()).strip()
titulo_norm = re.sub(r'\s+', ' ', titulo_norm)
autor_tokens = [w for w in autor_pedido.lower().split() if len(w) > 2]

# --- 3. Tenta cada candidato, ordenado por score de match do título ---
def title_score(title):
    t = re.sub(r'[^\w\s]', ' ', title.lower()).strip()
    t = re.sub(r'\s+', ' ', t)
    score = 0
    if t == titulo_norm:
        score += 20
    elif titulo_norm in t or t in titulo_norm:
        score += 10
    # Penal pra páginas genéricas
    if any(title.startswith(p) for p in ('Wikisource:', 'Portal:', 'Categoria:',
                                          'Anexo:', 'Especial:', 'Autor:', 'Ajuda:')):
        score -= 20
    return score

ranked = sorted([(title_score(t), t) for t in candidates], key=lambda x: -x[0])

best_text = None
best_title = None
best_url = None
for score, title in ranked:
    if score <= 0 and best_text:
        break  # já temos resultado bom, não tenta score zero
    log(f"tentando score={score}: {title}")
    data = get_parse(title)
    if not data or 'error' in data:
        continue
    parse_data = data.get('parse', {})
    if not parse_data:
        continue
    html = parse_data.get('text', {}).get('*', '')
    links = parse_data.get('links', [])
    text = extract_text(html)

    if len(text) >= 800 and filter_non_latin_ratio(text):
        best_text = text
        best_title = title
        best_url = "https://pt.wikisource.org/wiki/" + urllib.parse.quote(title)
        break

    # Texto curto: provavelmente índice. Tenta links internos.
    if not best_text:
        # Ordena links por profundidade (mais `/` = mais específico)
        candidate_links = []
        for link in links:
            lt = link.get('*', '')
            if any(lt.startswith(p) for p in ('Categoria:', 'Wikisource:', 'Portal:',
                                                 'Autor:', 'Especial:', 'Ajuda:',
                                                 'Predefinição:', 'Anexo:', 'Media:',
                                                 'Arquivo:', 'Ficheiro:')):
                continue
            depth = lt.count('/')
            candidate_links.append((depth, lt))
        # Mais profundos primeiro; em empate, ordena por match com título
        candidate_links.sort(key=lambda x: (-x[0], x[1]))
        for _, lt in candidate_links[:8]:
            log(f"  seguindo link: {lt}")
            data2 = get_parse(lt)
            if not data2 or 'error' in data2:
                continue
            parse_data2 = data2.get('parse', {})
            if not parse_data2:
                continue
            html2 = parse_data2.get('text', {}).get('*', '')
            text2 = extract_text(html2)
            if len(text2) >= 800 and filter_non_latin_ratio(text2):
                best_text = text2
                best_title = lt
                best_url = "https://pt.wikisource.org/wiki/" + urllib.parse.quote(lt)
                break
        if best_text:
            break

if not best_text:
    log(f"❌ nada >=800 chars encontrado pra {titulo_pedido!r}")
    sys.stdout.write("__CONTO_NAO_ENCONTRADO__")
    sys.exit(2)

# --- 4. Filtros finais ---
if len(best_text) < 800:
    log(f"❌ texto curto ({len(best_text)} chars)")
    sys.stdout.write("__CONTO_CURTO__")
    sys.exit(4)

if not filter_non_latin_ratio(best_text):
    log("❌ texto em idioma não-PT-BR")
    sys.stdout.write("__CONTO_EM_INGLES__")
    sys.exit(5)

# --- 5. Cache + output ---
cache_set(cache_key, best_text, best_url)
log(f"✅ {cache_key} ({len(best_text)} chars) de {best_title} → {best_url}")
if best_url:
    log(f"__URL__:{best_url}")
sys.stdout.write(best_text)
sys.exit(0)
PYEOF
