# Web Search de Contos (msg 3396)

**Data:** 2026-09-01
**Status:** ✅ Em produção (E2E validado 2026-09-01 21:58)

## O que faz

Quando o ouvinte pede um conto que **não está** nos 19 contos locais do acervo
(`/root/radio-gugu-music/backend/data/contos-baixados.json`), o Gugu:

1. Detecta o no-match em `conferirContoNoAcervo(pedido)` (heurística título+autor,
   ≥50% token overlap com min 2 tokens comuns).
2. Chama `/usr/local/bin/web_search_gugu.sh "<titulo>" "<autor>"` que:
   - Verifica cache JSON (50 contos máx, FIFO).
   - Se miss: usa Wikisource PT-BR `opensearch` API → `parse` API.
   - Se página curta (<800 chars = índice), segue links internos (até 8, mais
     profundos primeiro).
   - Filtra UI noise do MediaWiki (`projetosirmãos`, `verbetenaWikipédia`,
     `categorianoCommons`, `itemWikidata`, linhas só com nº de página, CAIXA ALTA).
   - Valida PT-BR (rejeita se >5% chars CJK/cyrillic/hebrew/arabic).
   - Cacheia `{texto, url}` e emite `__URL__:<url>` em stderr.
3. Monta fala no `montarFalaContoWeb()` com abertura + trecho de 800 chars
   + tag final com URL ("Texto completo lá no Wikisource, criatura").
4. Fallback: se web_search falhar, usa `gerarLocucaoTerrorFallback` (Hermes LLM).

## Arquivos

- `/usr/local/bin/web_search_gugu.sh` — script bash → Python único heredoc,
  sem shell word-splitting em títulos com caracteres especiais.
- `/root/radio-gugu-music/backend/dist/server.cjs` — funções:
  - `extrairTituloDoPedido(pedido)` — strip "me conte...", "história de...", etc.
  - `conferirContoNoAcervo(pedido)` — match no acervo local.
  - `tentarBuscarContoNaWeb(titulo, autor)` — spawn script + extrai URL de `__URL__:`.
  - `montarFalaContoWeb(nome, titulo, autor, texto, url)` — formata locução.
  - `gerarLocucaoT Terror(nome, pedido, username, ehConto)` — orquestra.
- `/root/radio-gugu-music/backend/data/contos-baixados.json` — cache FIFO 50 contos.

## E2E validado

- Pedido: "me conte O Gato Preto do Edgar Allan Poe"
- Resultado: 20552 chars de "O gato preto" no Wikisource PT-BR, fala gerada
  começa em "Com respeito á historia..." (sem header noise), termina com
  "Texto completo lá no Wikisource, criatura. Dormia com a luz acesa."
- URL persistida no cache: `https://pt.wikisource.org/wiki/O%20gato%20preto`

## Limitações conhecidas

- Wikisource opensearch só casa títulos que **começam com** o termo buscado.
  Histórias como "William Wilson" do Poe não aparecem direto.
- Wikisource PT-BR não tem tradução pra vários contos estrangeiros (Stevenson,
  Lovecraft, etc.) — nesses casos o script retorna `__CONTO_NAO_ENCONTRADO__`
  e cai no fallback Hermes.
- Cache de 50 contos: ao exceder, FIFO descarta os mais antigos (recria
  perdendo URL — irrelevante, o Wikisource é estável).

## Pendência (tarefa #148)

TTS em `falar_gugu.sh` precisa chunking para contos >5000 chars (atualmente
envia tudo de uma vez e MiniMax TTS pode cortar/truncar). Não bloqueia
funcionalidade, mas afeta qualidade em contos longos.
