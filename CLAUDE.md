# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LicitaPlena (formerly "HC Licitações") — a SaaS site that helps Brazilian companies find and analyze public
procurement opportunities (licitações/editais) from PNCP (Portal Nacional de Contratações Públicas), the
Portal da Transparência, Sistema S, and convênios. It's a static-HTML front end (no framework, no bundler)
backed by Supabase (auth + Postgres) and a handful of Netlify Functions, fed by scraper/robot scripts that run
on GitHub Actions cron jobs.

Comments and commit messages throughout the codebase are in Brazilian Portuguese and often explain *why* a
decision was made (frequently referencing cost/quota constraints or a "Diagnóstico Crítico" security review).
Read them — they carry real architectural context that isn't obvious from the code alone.

## Commands

There is no build step, bundler, or test suite. This is deployed as-is by Netlify (`netlify.toml`:
`publish = "."`, `functions = "netlify/functions"`).

- Install function dependencies (root `package.json` — used by Netlify's function bundler even though the
  functions live under `netlify/functions/`): `npm install`
- Run a robot/collector script locally, e.g.: `node scripts/atualizar_dados.js`
- Run the email digest script (Python, standalone stdlib + `requests`-style calls):
  `python scripts/boletim_editais.py`
- Local Netlify dev (functions + static files together): `netlify dev` (requires Netlify CLI)
- No lint/format/test commands are configured.

Robot scripts read secrets from environment variables (`SUPABASE_SERVICE_ROLE_KEY`,
`TRANSPARENCIA_TOKEN`, `EMAIL_REMETENTE`, `EMAIL_SENHA_APP`, etc.) — see the relevant `.github/workflows/*.yml`
for which vars each script expects when running locally.

## Architecture

### Front end: single-file HTML pages, no framework

Each page is a self-contained `.html` file with inline `<style>` and `<script>` — no React/Vue, no npm build,
no shared JS modules (except `supabase-config.js`, loaded via `<script src="supabase-config.js">`). Duplication
across pages (CSS variables, header markup) is intentional/expected in this codebase, not an oversight to fix.

- `index.html` — public marketing/landing page, no data fetching, no auth.
- `login.html` / `cadastro.html` — Supabase Auth sign-in/sign-up. Login checks `clientes.status === "aprovado"`
  after authenticating (accounts require manual admin approval) and signs the user back out if not approved.
- `painel.html` — the actual product (~5,000 lines). All authenticated features live here: boletim de editais
  (daily opportunity digest), radar/busca de oportunidades, diagnóstico de mercado, raio-X de fornecedor,
  Kanban de acompanhamento, consulta de preços públicos, and the AI tools (resumo de edital, pergunta ao
  edital). Access-gated by an IIFE at the top of `<head>` that redirects to `login.html` if there's no valid
  Supabase session or the client isn't `aprovado`.
- `admin.html` — internal approval dashboard for pending client signups (separate from `painel.html`).
- `termos-de-uso.html`, `politica-privacidade.html`, `politica-cookies.html` — static legal pages, linked from
  every page's footer.

State that needs to persist per-user client-side (saved filters, Kanban board, notification "read" markers)
is kept in `localStorage`, not Supabase — look for the `chaveArmazenamento`/`lerConjunto`/`salvarMapa`-style
helpers in `painel.html`.

### Data flow: three tiers, deliberately separated by cost

1. **Small, versioned JSON in `data/`** (`contratos_meta.json`, `mercado_meta.json`, `oportunidades_abertas.json`,
   etc.) — committed to git, served as static files, cached 5 min / stale-while-revalidate 1h per
   `netlify.toml`. `painel.html` fetches these directly.
2. **Large/growing data in Supabase Postgres** (`contratos`, `mercado_atas` tables — see
   `supabase/schema_dados_mercado.sql`) — queried live from `painel.html` using the Supabase client with the
   public anon key (RLS restricts `SELECT` to `authenticated` users only; writes are service-role-only, from
   the robot). This replaced committing multi-MB JSON files (`contratos_recentes.json`,
   `mercado_segmentos.json` — now gitignored) directly to git, because every commit to those files triggered a
   full Netlify production redeploy.
3. **Small "key → JSON blob" data** (`convenios`, `sistema_s_am`, `editais_vistos` history) lives in a generic
   `dados_robo` Supabase table (`chave text primary key, dado jsonb`) via `scripts/supabase_dados.js`'s
   `buscarBlob`/`salvarBlob` — same rationale: avoid git commits (and redeploys) on every robot run.

When touching the data pipeline, preserve this split: don't casually add a new large file to `data/` (it'll
get committed daily by the cron robots and redeploy the whole site), and don't add new git-committed blobs for
data that changes frequently — extend the `dados_robo` table pattern instead.

### Robots (`scripts/*.js`, `scripts/boletim_editais.py`)

Run on schedule via `.github/workflows/*.yml` (all cron in UTC — see each workflow's comments for the
Brasília-time conversion, no DST). Key ones:

- `atualizar_dados.js` — main PNCP collector. **Incremental**, not a full re-scrape: reads existing data,
  fetches only what's new since last run (with a small overlap window for late publications), merges, and
  prunes anything older than `RETENCAO_DIAS` (730 days default). Has two independently time-boxed phases
  (contracts nationwide vs. market-segment atas) because the atas phase is much more expensive per record.
  Followed in the same workflow by a chain of enrichment scripts (`coletar_empresas.js`,
  `coletar_fornecedores_sicaf.js`, `enriquecer_*.js`) that build up a private prospecting database
  (`data/empresas.json`, `data/fornecedores/*`) — these are gitignored from the *public* site and instead
  pushed to a separate private repo (`hc-painel-interno`) via a PAT (`PAINEL_INTERNO_TOKEN`).
- `coletar_convenios.js`, `coletar_sistema_s_am.js` — smaller independent collectors, write to the
  `dados_robo` blob table (see above), not to git.
- `boletim_editais.py` — sends the daily email digest to clients; also uses `SUPABASE_SERVICE_ROLE_KEY` for
  the "already seen" history instead of a committed JSON file.
- `SEGMENTOS` in `atualizar_dados.js` (a fixed keyword list) is now only an informational label attached to
  each ata — it no longer filters what gets collected (see the comment on `segmentosQueBatem()`). Both
  `coletarContratos` and `coletarMercadoSegmentos` collect nationally across every segment; the actual
  per-search filtering happens later, as a free-text `ILIKE` query (see `consultarContratosSupabase` /
  `carregarMercadoSegmentos` in `painel.html`) against whatever keywords the user types in Diagnóstico de
  Mercado or Analisar Empresa — not against the fixed list. The per-ata enrichment (UF lookup + itens +
  resultados, up to ~32 PNCP calls per ata) is still the real bottleneck, which is why `mercado_atas` stays
  `parcial: true` with a persistent backlog queue (`filaPendente`) for a while after each deploy.

### Netlify Functions (`netlify/functions/`)

Serverless proxies/AI endpoints. Two categories:

- **Unauthenticated proxies** (`pncp-itens.js`, `pncp-arquivos.js`, `pncp-baixar.js`) — exist purely to route
  around browser CORS restrictions when calling the public PNCP API directly from `painel.html`. No auth, no
  cost, `Access-Control-Allow-Origin: "*"`.
- **Cost-bearing / sensitive functions** (`ia-edital.js`, `despesas-fornecedor.js`, `sancoes.js`) — call paid
  or quota-limited external APIs (Groq LLM, Portal da Transparência). These *must* go through
  `_auth.js`'s `exigirUsuarioLogado()` (validates the Supabase session bearer token) and
  `verificarLimiteDiario()` (per-user daily quota via the `incrementar_uso` Postgres function, fail-open if
  `SUPABASE_SERVICE_ROLE_KEY` isn't configured) and must restrict `Access-Control-Allow-Origin` via
  `origemPermitida()`/`ORIGENS_PERMITIDAS` instead of `"*"`. Any new function that costs money per call or
  touches sensitive/rate-limited data should follow this same pattern — see `_auth.js`'s header comment for
  the incident that motivated it.
- `ia-edital.js` tries to fetch and read the actual edital PDF from PNCP for a structured summary; if that
  fails (non-PNCP source, non-PDF, timeout) it falls back to a shorter summary based on already-collected
  fields, and always signals to the client which mode was used (`fonteLida`).

### Supabase

- `supabase-config.js` holds the public anon/publishable key — safe to expose client-side by design.
  `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) is server-only: used by robot scripts (`scripts/supabase_dados.js`)
  and by `netlify/functions/_auth.js`, never shipped to the browser.
- `supabase/schema_dados_mercado.sql` and `supabase/rls_e_limite_de_uso.sql` are meant to be run manually
  once in the Supabase SQL editor (idempotent — safe to re-run). There's no migration tool; if you change
  schema, update these files and tell the user to re-run the relevant one in Supabase.
- RLS is load-bearing for privacy: `clientes` and `admins` rows are only selectable by their own `auth.uid()`;
  `contratos`/`mercado_atas` are `SELECT`-only for any authenticated user, write-only via service role. Don't
  add a policy that widens read access to "all clients" or similar without it being a deliberate, called-out
  decision — the whole point of `rls_e_limite_de_uso.sql` was closing exactly that kind of leak.

### Security headers

`netlify.toml` sets a strict CSP and other security headers site-wide. `script-src`/`style-src` allow
`'unsafe-inline'` deliberately (inline `<script>`/`<style>` is how every page is built) — don't try to
"fix" that without a real plan to externalize all inline JS/CSS first. `connect-src` is an explicit allowlist
(Supabase, BrasilAPI, IBGE); adding a call to a new external API from front-end JS requires adding its origin
here or the browser will block it.
