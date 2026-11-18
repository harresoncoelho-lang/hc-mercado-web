// Quality gate rápido do projeto: cobre as Netlify Functions (netlify/functions/**) e os
// robôs de coleta/enriquecimento (scripts/**). O Biome (biome.jsonc) cobre um punhado de
// regras sintáticas curadas; este arquivo cobre o resto — sobretudo regras conscientes de
// ambiente Node (require/module.exports/process) e código morto que só aparece rodando
// contra a base inteira, não arquivo a arquivo.
//
// De propósito, sem preset "recommended" completo de plugin nenhum além do @eslint/js: o
// projeto é JS puro (sem TypeScript, sem framework de UI — o front-end é HTML com <script>
// inline, fora do escopo deste linter por enquanto). Ver docs internos do
// vibe-coding-toolkit (06-eslint-biome-quality-gates.md) pro raciocínio completo.

const js = require("@eslint/js");

// Globals extras de Node >= 18 que os blocos .mjs/.cjs abaixo usam (testes, handlers ESM, QA).
const nodeGlobals = {
  process: "readonly", console: "readonly", Buffer: "readonly", URL: "readonly",
  URLSearchParams: "readonly", AbortController: "readonly", TextEncoder: "readonly",
  TextDecoder: "readonly", Response: "readonly", Request: "readonly", Headers: "readonly",
  ReadableStream: "readonly", atob: "readonly", btoa: "readonly", crypto: "readonly",
  performance: "readonly", structuredClone: "readonly", queueMicrotask: "readonly",
  setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
  clearInterval: "readonly", setImmediate: "readonly", fetch: "readonly",
};
// Contexto de página (Playwright page.evaluate / extensão de navegador).
const browserGlobals = {
  window: "readonly", document: "readonly", location: "readonly",
  getComputedStyle: "readonly", chrome: "readonly",
};

module.exports = [
  {
    ignores: [
      "node_modules/**",
      ".pytest_cache/**",
      ".worktrees/**",
      "data/**",
      "docs/**",
      "vault-obsidian/**",
      ".agents/**",
      ".claude/**",
      "supabase/**",
      "supabase-config.js",
      "scripts/install-plugins.mjs",
      "*.html",
      "publico/**",
    ],
  },
  js.configs.recommended,
  {
    // O próprio arquivo de config também é lido pelo ESLint (roda em Node, CommonJS) —
    // sem isso, "eslint ." reclamava de require/module indefinidos nele mesmo.
    files: ["eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { require: "readonly", module: "writable" },
    },
  },
  {
    files: ["netlify/functions/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        exports: "writable",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        // Usados pelo adaptador do Cloudflare Pages (netlify/functions/_adaptador_cloudflare.js).
        ReadableStream: "readonly",
        Response: "readonly",
        Headers: "readonly",
        Request: "readonly",
        atob: "readonly",
      },
    },
    rules: {
      // Variável ou import nunca usado — quase sempre esquecimento. Erro, mas ignora
      // argumentos de função não usados (comuns em handlers de Netlify Function que
      // recebem (event, context) e só usam um dos dois) e permite prefixar com "_"
      // quando o não-uso é intencional.
      "no-unused-vars": [
        "error",
        { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // catch (e) {} silencioso costuma esconder falha real de rede/parsing nos robôs
      // de coleta — mas várias funções já usam esse padrão de propósito como
      // fail-open (ver netlify/functions/_auth.js). Fica em warn, não error: é uma
      // migração gradual, não uma regra nova travando tudo de uma vez.
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Complexidade ciclomática alta costuma indicar função que deveria ser quebrada
      // em pedaços menores — mas os robôs de coleta têm bastante lógica de
      // paginação/retry legítima. Introduzido em warn (não error) de propósito: é
      // ferramenta de migração, não bloqueio imediato. Ver ESLint warning burndown no
      // vibe-coding-toolkit antes de promover pra error.
      complexity: ["warn", 20],
      // "any" não existe em JS puro, mas == solto é o equivalente prático (coerção de
      // tipo silenciosa) — já causou bug real neste projeto em comparação de UF/CNPJ
      // vindos de fontes heterogêneas.
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Rota do Cloudflare Pages Functions (ESM, runtime Workers) — única fora de CommonJS.
    files: ["functions/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { process: "readonly", Response: "readonly" },
    },
  },
  {
    // Arquivos de teste (node:test) — mesmo ambiente Node, sem regra extra por
    // enquanto.
    files: ["**/*.test.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "writable",
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
      },
    },
  },
  {
    // Módulos ESM (.mjs): handlers, motores, testes e QA rodam em Node, sem o bloco de
    // netlify/scripts acima (que é só *.js / CommonJS).
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: nodeGlobals },
    rules: {
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    // Extensão de leitura: roda no navegador (popup/service worker) e nos testes em Node.
    // catch {} vazio é fail-open de propósito (fechar porta já fechada), como em netlify/.
    files: ["extensao-leitura/**/*.mjs"],
    languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    // Cliente do kit: o catch vazio é limpeza best-effort de porta/cancelamento.
    files: ["kit-documentos-ui.js"],
    languageOptions: { globals: { setTimeout: "readonly", clearTimeout: "readonly" } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    // QA com Playwright (CommonJS): o código dentro de page.evaluate / addScriptTag roda
    // na página e enxerga estas globais, que não existem no Node.
    files: [
      "scripts/anexos_evidencias_ui.cjs",
      "scripts/kit_proposta_ui_escala.cjs",
      "scripts/medir_kit_proposta.cjs",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...nodeGlobals,
        ...browserGlobals,
        require: "readonly", module: "writable", __dirname: "readonly",
        // Definidas pela própria página de teste.
        state: "writable", deps: "writable", ui: "writable", calls: "writable",
        mode: "writable", hash: "writable", release: "writable",
        criarAcompanhamentoOperacional: "readonly", LicitaKitDocumentos: "readonly",
      },
    },
  },
];
