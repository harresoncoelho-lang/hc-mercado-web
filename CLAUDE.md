# C:\Users\avell\Documents\hc-mercado-web

> Project memory for Claude Code. Keep this file short and high-signal —
> bloated memory gets ignored. Put hard guarantees in hooks, not prose.

## Behavioral guidelines
<!-- aia-harness:behavioral — non-negotiable; do not edit, reorder, or remove during enrichment -->

1. **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; say so when a simpler approach exists; if something is unclear, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, no abstractions for single-use code, no unrequested configurability, no error handling for impossible scenarios. If 200 lines could be 50, rewrite.
3. **Surgical changes** — touch only what the request requires; match existing style; don't refactor, reformat, or "improve" adjacent code. Remove orphans *your* change created; leave pre-existing dead code alone (mention it, don't delete it). Every changed line should trace directly to the user's request.
4. **Goal-driven execution** — turn tasks into verifiable goals ("fix the bug" → "write a test that reproduces it, then make it pass"). For multi-step work, state a brief plan with a verify check per step, then loop until verified.
5. **Main session = orchestrator — it does not implement.** Plan, decide, coordinate; ALL delegable implementation and analysis goes to a specialist subagent via `Agent`, parallel when scopes don't conflict.

## Stack
JavaScript, Python, SQL · npm

Architecture: **flat**.

## Canonical commands
Always use these exact commands (do not guess):

- **Install:** `npm install`

> **Tests:** `node:test` — run `npm test`. Test what can break (business rules, branching logic, bug regressions); skip trivial/presentational code. Rubric: `.claude/rules/05-testing.md`.

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

There is no build step or bundler. This is deployed as-is by Netlify (`netlify.toml`:
`publish = "."`, `functions = "netlify/functions"`).

- Install function dependencies (root `package.json` — used by Netlify's function bundler even though the
  functions live under `netlify/functions/`): `npm install`
- Run a robot/collector script locally, e.g.: `node scripts/atualizar_dados.js`
- Run the email digest script (Python, standalone stdlib + `requests`-style calls):
  `python scripts/boletim_editais.py`
- Local Netlify dev (functions + static files together): `netlify dev` (requires Netlify CLI)
- No lint/format commands are configured; tests run via `npm test` (`node --test`, see Canonical commands above).

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

## Workflow & Agents

Invoke `superpowers:subagent-driven-development` for **non-trivial** implementation — trigger it when the request meets **≥2** of:

- touches **3+ files** or **2+ domains/layers** (UI + agent, API + DB…)
- is a **new feature / epic / cross-cutting refactor** (not a one-line or single-function change)
- needs a **multi-step plan** or ordered tasks, each with its own verification
- has **unclear scope or root cause** and needs exploration before coding

Skip it — implement inline — for typo/copy fixes, single-function edits, config tweaks, or one-file bugs with an obvious cause.

When dispatching subagents, you MUST use the matching specialist agent from the table below — never the generic agent when a specialist is listed. Cross-reference the task type with the "When to use" column and pass the exact name as `subagent_type`.

Model dispatch: an agent's frontmatter `model` wins; a generic dispatch or a project/user agent with no `model` in frontmatter is force-set to `sonnet` by a PreToolUse hook, so it never silently inherits this session's model — except namespaced plugin agents (`plugin:name`), left unrewritten since their frontmatter isn't reliably hook-resolvable. Pass `model` explicitly yourself for those, or to override for complex work: `haiku` for search/exploration, `sonnet` for implementation, `opus` for architectural judgment — cheapest tier that fits.

| Agent | When to use |
|---|---|
| `orchestrator` | Coordinates multi-agent or cross-domain tasks by subdelegating to specialized agents. Use proactively when a task spans multiple domains or requires parallel subagent execution. MUST BE USED instead of dispatching generic agents directly for complex workflows. |
| `code-reviewer` | Reviews any code change for bugs, security, error handling, and test coverage. Use proactively after editing any source file. MUST BE USED before merging a pull request. |
| `security-reviewer` | Reviews code for OWASP Top 10 vulnerabilities, hardcoded secrets, broken auth, and dependency CVEs. Use proactively before any merge that touches auth, input handling, or secrets. MUST BE USED before shipping security-sensitive changes. |
| `typescript-reviewer` | Reviews TypeScript and JavaScript code for type safety (any abuse, non-null assertions), async correctness, injection risks, and prototype pollution. Use proactively after editing .ts or .js files with no React/JSX involvement. |
| `qa-automation-engineer` | Writes and maintains E2E tests (Playwright/Cypress) and CI/CD quality gates. Use proactively after new user flows are implemented or when E2E coverage is missing for a critical path. |
| `test-engineer` | Writes unit and integration tests with TDD discipline, coverage analysis, and edge-case discovery. Use proactively after implementing new logic or when test coverage gaps are identified. |
| `database-architect` | Designs schemas, migrations, indexes, and query strategies for correctness, integrity, and scalability. Use proactively when adding tables, modifying schemas, planning migrations, or diagnosing slow queries. |
| `devops-engineer` | Owns deployment, CI/CD pipelines, infrastructure configuration, and production operations. Use proactively when deploying, configuring servers, setting up CI, or troubleshooting production incidents. |
| `backend-specialist` | Implements and reviews API endpoints, server-side business logic, authentication, and database integration. Use proactively when building or modifying backend services, REST/GraphQL routes, or persistence layers. |
| `performance-optimizer` | Profiles and fixes performance bottlenecks — slow endpoints, high memory usage, poor Core Web Vitals, and database query inefficiency. Use proactively after profiling reveals a bottleneck or when response times degrade. |
| `product-manager` | Clarifies ambiguous requirements and prioritizes roadmap decisions when requirements are undefined before a story exists. Use when discovery and prioritization need structured analysis. |
| `product-owner` | Translates business objectives into actionable technical specs and defines acceptance criteria for existing stories before implementation begins. Use when a story needs clear acceptance criteria before development starts. |
| `project-planner` | Breaks features and epics into ordered, executable tasks with clear acceptance criteria. Use proactively when starting a new feature, sprint, or significant refactor that needs a structured plan before implementation begins. |
| `code-archaeologist` | Reverse-engineers undocumented or legacy code to uncover intent, trace logic, and map hidden dependencies. Use proactively before refactoring unfamiliar legacy code or when you need to understand why existing behavior exists. |
| `debugger` | Finds the root cause of bugs, crashes, and flaky behavior through systematic, evidence-based investigation. Use proactively when a test fails or a defect is reported, before attempting a fix. |
| `explorer-agent` | Maps an unfamiliar or complex codebase — architecture, patterns, dependencies, and risk areas — to inform planning and integration decisions. Use proactively when onboarding to a new codebase or before planning a cross-cutting change. |
| `documentation-writer` | Produces clear, example-rich technical documentation — READMEs, API docs, runbooks, and guides. Use when documentation is explicitly requested or after a feature ships and needs user-facing docs. |
| `penetration-tester` | Simulates attacker techniques to find exploitable vulnerabilities using PTES and OWASP methodologies. Use proactively before a security release, after adding new auth flows, or when a pentest is required. |
| `security-auditor` | Performs defensive SAST reviews, threat modeling, and hardening recommendations using defense-in-depth principles. Use proactively before a major release or after architectural changes that touch auth, data handling, or trust boundaries. |

### Superpowers → Project Specialists (mandatory bridging)
<!-- aia-harness:agent-routing — superpowers→specialist bridge; do not remove -->

Superpowers skills (`superpowers:dispatching-parallel-agents`, `superpowers:subagent-driven-development`,
`superpowers:executing-plans`, `superpowers:systematic-debugging`) show `general-purpose` as the default
`subagent_type` in their examples. **Never dispatch `general-purpose` (or a generic
implementer) when a specialist below covers the domain** — pass the specialist's exact
name as `subagent_type` instead.

> Basis: superpowers itself states "User's explicit instructions (CLAUDE.md) — highest
> priority." This section applies that priority over the agent types its examples suggest.
> The normal flow is unchanged (`superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development`);
> only the dispatched `subagent_type` changes.

| When superpowers would use `general-purpose` for… | Dispatch instead |
|---|---|
| Multi-domain feature — subdelegates to specialists | `orchestrator` |
| Review / audit changed code | `code-reviewer` / `security-reviewer` / `typescript-reviewer` |
| E2E / QA automation | `qa-automation-engineer` |
| Unit / integration tests | `test-engineer` |
| Schema / migration / query / data modeling | `database-architect` |
| Deploy / CI/CD / infra | `devops-engineer` |
| Backend / API / server-side / domain logic | `backend-specialist` |
| Performance profiling / optimization | `performance-optimizer` |
| Understand legacy code before changing it | `code-archaeologist` |
| Bug / crash / root-cause analysis | `debugger` |
| Explore / map an unfamiliar codebase | `explorer-agent` |
| Documentation (only when explicitly requested) | `documentation-writer` |
| Offensive security / pentest | `penetration-tester` |
| Security audit / defensive review | `security-auditor` |

### Parallel wave execution (subagent-driven-development)
<!-- aia-harness:parallel-sdd — parallel wave execution override; do not remove -->

Override `superpowers:subagent-driven-development`'s serial one-implementer-at-a-time default with
parallel waves of independent tasks. Its "never dispatch implementers in parallel" red flag is
superseded here because its two premises are removed: disjoint file ownership per wave, and
controller-serialized commits instead of implementer self-commits. During planning, tag each task
`Files:` / `Depends-on:`; batch tasks with disjoint `Files` and no mutual dependency into one wave,
and dispatch their implementers in a single message using the specialist types from the table above.
Keep the skill's implementer/reviewer prompt contracts intact — the only change is implementers do
NOT self-commit. Untagged or uncertain tasks run serial (no regression). Full protocol:
`.claude/rules/08-parallel-subagent-driven-development.md`.

## Architecture map

Domain-specific guidance lives in nested CLAUDE.md files (loaded on demand):

- _Single-tree project; no sub-domains detected._

- `index.html` — landing pública; sem auth, sem fetch de dados.
- `login.html` / `cadastro.html` — Supabase Auth; login rejeita `clientes.status !== "aprovado"`.
- `painel.html` — produto principal (~5k linhas); todas as features autenticadas; IIFE de guarda de sessão no `<head>`.
- `admin.html` — aprovação manual de cadastros pendentes.
- `supabase-config.js` — client Supabase compartilhado (anon key pública), carregado por todas as páginas via `<script src>`.
- `netlify/functions/_auth.js` — helper de auth/CORS/rate-limit consumido pelas functions sensíveis (`ia-edital.js`, `despesas-fornecedor.js`, `sancoes.js`).
- `netlify/functions/pncp-*.js` — proxies públicos sem auth, só para contornar CORS do PNCP.
- `scripts/atualizar_dados.js` — robô principal de coleta PNCP (incremental), roda via GitHub Actions cron.
- `scripts/coletar_*.js` / `enriquecer_*.js` — robôs satélite; escrevem em `data/*.json` ou na tabela `dados_robo`.
- `scripts/boletim_editais.py` — digest diário por email, usa `SUPABASE_SERVICE_ROLE_KEY`.
- `scripts/supabase_dados.js` — helpers `buscarBlob`/`salvarBlob` para a tabela `dados_robo`.
- `supabase/*.sql` — schema e RLS; aplicados manualmente no SQL editor (sem migration tool).
- `data/*.json` — snapshots pequenos versionados em git, servidos como estáticos com cache curto.
- `.github/workflows/*.yml` — agenda cron (UTC) de cada robô.
- `netlify.toml` — config de deploy, CSP/security headers, cache dos `data/*.json`.

## Conventions

- Identificadores e comentários em português, inclusive em nomes internos de função/variável (`buscarBlob`, `verificarLimiteDiario`); comentários explicam o *porquê* (custo, incidente, decisão), não o *o quê* — preserve esse padrão ao editar.
- Sem framework/bundler: cada `.html` é auto-contido (`<style>`/`<script>` inline); duplicação de CSS/markup entre páginas é intencional, não é bug a corrigir.
- Módulos server-side (`netlify/functions/`, `scripts/*.js`) usam CommonJS (`require`/`module.exports`), não ESM.
- Scripts de robô: parâmetros vêm de env vars com default documentado no cabeçalho do arquivo (ex.: `RETENCAO_DIAS`, `LIMITE_MINUTOS`) — não hardcode esses valores.
- Qualquer função que custe dinheiro por chamada ou toque dado sensível deve passar por `_auth.js` (`exigirUsuarioLogado` + `verificarLimiteDiario`) e restringir CORS via `origemPermitida()` — nunca `Access-Control-Allow-Origin: "*"`.
- Erros nas Netlify Functions retornam objetos `{ ok, status, erro }` em vez de lançar exceção; falha de configuração (ex.: chave de serviço ausente) é fail-open por design, não fail-closed.
- Mudança de schema Supabase: editar o `.sql` correspondente em `supabase/` (idempotente) e avisar para rodar manualmente no SQL editor — não há ferramenta de migration.

## Engineering rules
<!-- aia-harness:fixed — non-negotiable; do not edit, reorder, or remove during enrichment -->

- Match the style of surrounding code; do not introduce new patterns unprompted.
- Test what can break — business rules, branching logic, money/security/auth, bug regressions; skip trivial getters, wrappers, config, presentational UI (rubric: `.claude/rules/05-testing.md`).
- Run the test command above before claiming work is complete (no lint/format tooling is configured for this project).
- Never commit secrets; keep them in gitignored env files (`.env`/`.env.local`) — `.claude/settings.local.json` is only for MCP-server credentials referenced by `.mcp.json`.
- Fix every compilation/syntax/lint error found during a session — regardless of whether you edited the file. Never leave the build broken or label errors "pre-existing, not related".
- When performing a code review (user requests it or a workflow triggers it), always use `code-reviewer` and `security-reviewer` and `typescript-reviewer`, applying the `uncle-bob-craft` skill's criteria (Dependency Rule, SOLID in context, code smells) alongside their findings.

@.claude/memory/INSTRUCTIONS.md
@.claude/memory/MEMORY.md

## graphify
<!-- aia-harness:graphify-root — knowledge-graph usage; merged section, do not remove -->

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- Investigating code (file search, implementations, call sites, "where is X"): alongside graphify, dispatch specialist subagents (`model: haiku`) in parallel — never one at a time, never generic-only. Cuts investigation time.

<!-- Generated by aia-harness. Edit freely; re-run /aia-harness:doctor to audit. -->
