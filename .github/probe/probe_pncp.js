// Sonda READ-ONLY do endpoint /contratacoes/proposta do PNCP. Só GET. Sem secrets, sem escrita.
// Objetivo: descobrir (1) tamanho máximo de página, (2) campos de paginação/total, (3) filtros que
// particionam UFs com >1000 registros, (4) limiar de 429 por taxa, (5) Retry-After e duração do bloqueio.
const BASE = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";
const DATA_FINAL = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seg = () => ((Date.now() - T0) / 1000).toFixed(0).padStart(4) + "s";
const HDRS = ["retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "server", "via"];

async function get(params, timeoutMs = 25000) {
  const url = `${BASE}?${new URLSearchParams({ dataFinal: DATA_FINAL, ...params })}`;
  const t = Date.now();
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    const texto = await resp.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não-JSON */ }
    const h = {};
    for (const k of HDRS) { const v = resp.headers.get(k); if (v) h[k] = v; }
    return { status: resp.status, ms: Date.now() - t, json, h, corpo: json ? null : texto.slice(0, 160) };
  } catch (e) {
    return { status: e.name === "TimeoutError" ? "TIMEOUT" : "ERRO:" + (e.cause && e.cause.code || e.message), ms: Date.now() - t, json: null, h: {} };
  }
}
const resumo = (r) => r.json ? `n=${(r.json.data || []).length} totalRegistros=${r.json.totalRegistros} totalPaginas=${r.json.totalPaginas} numeroPagina=${r.json.numeroPagina} restantes=${r.json.paginasRestantes}` : `corpo=${r.corpo}`;

(async () => {
  console.log(`== SONDA PNCP proposta ==  dataFinal=${DATA_FINAL}`);

  console.log("\n-- 1) baseline + headers (uf=AC)");
  let r = await get({ uf: "AC", pagina: 1, tamanhoPagina: 50 });
  console.log(seg(), r.status, r.ms + "ms", resumo(r), JSON.stringify(r.h));
  if (r.json && r.json.data && r.json.data[0]) console.log("   campos do item:", Object.keys(r.json.data[0]).join(","));

  console.log("\n-- 2) tamanhoPagina máximo aceito (uf=AC)");
  for (const tp of [10, 50, 100, 200, 500]) {
    r = await get({ uf: "AC", pagina: 1, tamanhoPagina: tp });
    console.log(seg(), `tamanhoPagina=${tp}`, r.status, r.ms + "ms", resumo(r), r.status !== 200 ? (r.corpo || JSON.stringify(r.json).slice(0, 140)) : "");
    await sleep(1500);
  }

  console.log("\n-- 3) UF grande (SP): total, teto de paginação e ordenação");
  r = await get({ uf: "SP", pagina: 1, tamanhoPagina: 50 });
  console.log(seg(), r.status, r.ms + "ms", resumo(r));
  const totalPag = r.json && r.json.totalPaginas;
  const pubs = (j) => (j && j.data || []).map((x) => (x.dataPublicacaoPncp || "").slice(0, 10));
  if (r.json) console.log("   pub p1 (1º..último):", pubs(r.json)[0], "..", pubs(r.json).slice(-1)[0]);
  for (const p of [20, 21, 25, totalPag].filter((v, i, a) => v && a.indexOf(v) === i)) {
    await sleep(1500);
    const rp = await get({ uf: "SP", pagina: p, tamanhoPagina: 50 });
    console.log(seg(), `pagina=${p}`, rp.status, rp.ms + "ms", resumo(rp), rp.json ? `pub ${pubs(rp.json)[0]}..${pubs(rp.json).slice(-1)[0]}` : "");
  }

  console.log("\n-- 4) filtros que podem particionar uma UF (SP)");
  const filtros = [
    { codigoModalidadeContratacao: 6 }, { codigoModalidadeContratacao: 8 },
    { codigoMunicipioIbge: 3550308 }, { codigoModoDisputa: 1 },
    { dataInicial: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10).replace(/-/g, "") },
  ];
  for (const f of filtros) {
    await sleep(1500);
    r = await get({ uf: "SP", pagina: 1, tamanhoPagina: 50, ...f });
    console.log(seg(), JSON.stringify(f), r.status, r.ms + "ms", resumo(r), r.status !== 200 ? (r.corpo || JSON.stringify(r.json).slice(0, 140)) : "");
  }

  console.log("\n-- 5) rampa de taxa até o 1º 429 (UFs variadas, pagina 1..)");
  const ufs = ["MG", "PR", "RJ", "SC", "GO", "BA", "RS", "PE", "CE", "PA"];
  let primeiro429 = null, total = 0, ok = 0, tout = 0, outros = 0;
  for (const intervalo of [1000, 700, 500, 300]) {
    console.log(seg(), `   >> intervalo ${intervalo}ms, até 30 reqs`);
    for (let i = 0; i < 30 && !primeiro429; i++) {
      r = await get({ uf: ufs[i % ufs.length], pagina: 1 + Math.floor(i / ufs.length), tamanhoPagina: 50 });
      total++;
      if (r.status === 200) ok++; else if (r.status === "TIMEOUT") tout++; else if (r.status !== 429) outros++;
      if (r.status === 429) { primeiro429 = { total, intervalo, h: r.h, corpo: r.corpo || JSON.stringify(r.json) }; }
      await sleep(intervalo);
    }
    if (primeiro429) break;
  }
  console.log(seg(), `   total=${total} ok=${ok} timeout=${tout} outros=${outros}`);
  console.log(seg(), "   PRIMEIRO 429:", primeiro429 ? JSON.stringify(primeiro429) : "NENHUM (limite não atingido nesta rampa)");

  if (primeiro429) {
    console.log("\n-- 6) duração do bloqueio: 1 requisição em espera crescente até voltar 200");
    let voltou = null;
    for (const espera of [5, 10, 20, 40, 60, 90, 120, 180]) {
      await sleep(espera * 1000);
      r = await get({ uf: "AC", pagina: 1, tamanhoPagina: 50 });
      console.log(seg(), `   +${espera}s de espera ->`, r.status, JSON.stringify(r.h));
      if (r.status === 200) { voltou = espera; break; }
    }
    console.log(seg(), "   bloqueio terminou após espera acumulada aprox. (s):", voltou);
  }
  console.log("\n== FIM ==");
})();
