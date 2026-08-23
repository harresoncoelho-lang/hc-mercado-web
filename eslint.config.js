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

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "docs/**",
      "vault-obsidian/**",
      ".agents/**",
      ".claude/**",
      "supabase/**",
      "*.html",
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
];
