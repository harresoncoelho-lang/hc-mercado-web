// Regra de vigência das sanções (sancoes-ui.js) e o selo reutilizável.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../sancoes-ui.js");

const HOJE = "2026-11-19";
const s = (o) => ({ cadastro: "CEIS", cnpj: "11222333000181", tipo_sancao: "Suspensão", data_inicio: "2025-01-01", data_fim: null, fora_da_lista: false, ...o });

test("sancoesDoCnpj separa vigentes e expiradas do CNPJ (máscara aceita)", () => {
  const lista = [
    s({ codigo_sancao: "1", data_fim: "2027-07-18" }),
    s({ codigo_sancao: "2", data_fim: null }),               // indeterminada: vigente, primeiro
    s({ codigo_sancao: "3", data_fim: HOJE }),               // termina hoje: ainda vigente
    s({ codigo_sancao: "4", data_fim: "2026-11-18" }),       // ontem: expirada
    s({ codigo_sancao: "5", data_fim: "2030-01-01", fora_da_lista: true }), // saiu da lista da CGU: expirada
    s({ codigo_sancao: "6", cnpj: "99888777000166" }),        // outra empresa
    null,
  ];
  const r = S.sancoesDoCnpj(lista, "11.222.333/0001-81", HOJE);
  assert.deepEqual(r.vigentes.map((x) => x.codigo_sancao), ["2", "1", "3"]);
  assert.deepEqual(r.expiradas.map((x) => x.codigo_sancao), ["5", "4"]);
});

test("sancoesDoCnpj: CNPJ ou data inválidos devolvem vazio", () => {
  assert.deepEqual(S.sancoesDoCnpj([s({})], "123", HOJE), { vigentes: [], expiradas: [] });
  assert.deepEqual(S.sancoesDoCnpj([s({})], "11222333000181", "19/11/2026"), { vigentes: [], expiradas: [] });
  assert.deepEqual(S.sancoesDoCnpj(null, "11222333000181", HOJE), { vigentes: [], expiradas: [] });
});

test("textoSancao: CEIS impede contratar; CNEP diz o tipo; encerradas", () => {
  assert.equal(S.textoSancao(s({ data_fim: "2027-07-18" }), HOJE), "Empresa com sanção vigente (CEIS) — impedida de contratar até 18/07/2027");
  assert.equal(S.textoSancao(s({}), HOJE), "Empresa com sanção vigente (CEIS) — impedida de contratar por prazo indeterminado");
  assert.equal(S.textoSancao(s({ cadastro: "CNEP", tipo_sancao: "Multa" }), HOJE), "Empresa com sanção vigente (CNEP) — Multa (sem data de fim)");
  assert.equal(S.textoSancao(s({ data_fim: "2023-07-13" }), HOJE), "Sanção encerrada (CEIS) em 13/07/2023");
  assert.equal(S.textoSancao(s({ fora_da_lista: true }), HOJE), "Sanção encerrada (CEIS) — fora da lista da CGU");
});

// DOM mínimo: só o que montarSelo usa.
function docFalso() {
  const el = (tag) => ({ tag, className: "", dataset: {}, attrs: {}, filhos: [], textContent: "",
    setAttribute(k, v) { this.attrs[k] = v; }, append(...f) { this.filhos.push(...f); } });
  return { createElement: el };
}

test("montarSelo: vigente vira alerta; só expiradas, status neutro; nada, null", () => {
  const doc = docFalso();
  assert.equal(S.montarSelo(doc, { vigentes: [], expiradas: [] }, HOJE), null);
  const v = S.montarSelo(doc, S.sancoesDoCnpj([s({ data_fim: "2027-07-18", orgao_sancionador: "Órgão X", uf_orgao: "DF" })], "11222333000181", HOJE), HOJE);
  assert.equal(v.dataset.situacao, "vigente");
  assert.equal(v.attrs.role, "alert");
  assert.equal(v.filhos[0].textContent, "Empresa com sanção vigente (CEIS) — impedida de contratar até 18/07/2027");
  assert.match(v.filhos[1].filhos[0].textContent, /Suspensão · Órgão X\/DF · desde 01\/01\/2025/);
  const e = S.montarSelo(doc, S.sancoesDoCnpj([s({ data_fim: "2020-01-01" })], "11222333000181", HOJE), HOJE);
  assert.equal(e.dataset.situacao, "expirada");
  assert.equal(e.attrs.role, "status");
  const muitas = S.montarSelo(doc, { vigentes: Array.from({ length: 7 }, () => s({})), expiradas: [] }, HOJE);
  assert.equal(muitas.filhos[1].filhos.length, 5);
  assert.equal(muitas.filhos[2].textContent, "e mais 2.");
});
