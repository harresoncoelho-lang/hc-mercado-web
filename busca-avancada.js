/* global module */
// Regras puras da busca do painel (Encontrar Licitações): raio em km e região, filtros salvos com
// nome, "sem interesse" e a sugestão de palavras da IA. Sem DOM nem rede: o painel e a function
// monte-busca-ia usam este mesmo arquivo, e busca-avancada.test.js o testa.
(function (raiz) {
  "use strict";
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ'’]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const REGIOES = {
    Norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
    Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "Centro-Oeste": ["DF", "GO", "MS", "MT"],
    Sudeste: ["ES", "MG", "RJ", "SP"],
    Sul: ["PR", "RS", "SC"],
  };
  const LIMITES = { nome: 60, palavras: 1000, excluir: 600, filtrosPorConta: 20 };

  // Haversine entre [lat, lon] em graus. Raio médio da Terra: 6371 km.
  function distanciaKm(a, b) {
    const rad = (g) => (g * Math.PI) / 180;
    const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // base = data/municipios-centroides.json ({ m: [[nome, UF, lat, lon], ...] }).
  function criarIndice(base) {
    const lista = Array.isArray(base?.m) ? base.m : [];
    const porChave = new Map();
    for (const [nome, uf, lat, lon] of lista) porChave.set(`${norm(nome)}|${uf}`, [lat, lon]);
    return { lista, porChave };
  }
  const coordenada = (indice, municipio, uf) => indice.porChave.get(`${norm(municipio)}|${String(uf || "").toUpperCase()}`) || null;

  // "Manaus - AM" (rótulo da lista de cidades do painel) -> { municipio, uf, coord } ou null.
  function origemDoTexto(indice, texto) {
    const bruto = String(texto || "").trim();
    const m = /^(.+?)\s*[-–/]\s*([A-Za-z]{2})$/.exec(bruto);
    const coord = m && coordenada(indice, m[1], m[2]);
    if (coord) return { municipio: m[1].trim(), uf: m[2].toUpperCase(), coord };
    // Sem UF ("Manaus"): vale se só um município tem esse nome.
    const iguais = indice.lista.filter(([nome]) => norm(nome) === norm(bruto));
    return iguais.length === 1 ? { municipio: iguais[0][0], uf: iguais[0][1], coord: [iguais[0][2], iguais[0][3]] } : null;
  }
  // Sugestões para o campo de cidade (prefixo sem acento, no máximo `max`).
  function sugerirCidades(indice, texto, max = 12) {
    const t = norm(String(texto || "").replace(/\s*[-–/]\s*[A-Za-z]{0,2}$/, ""));
    if (t.length < 2) return [];
    const achadas = [];
    for (const [nome, uf] of indice.lista) {
      if (norm(nome).startsWith(t)) { achadas.push(`${nome} - ${uf}`); if (achadas.length >= max) break; }
    }
    return achadas;
  }
  // UFs que têm algum município dentro do raio: são os estados que a busca precisa consultar.
  function ufsNoRaio(indice, origem, km) {
    const ufs = new Set([origem.uf]);
    for (const [, uf, lat, lon] of indice.lista) if (distanciaKm(origem.coord, [lat, lon]) <= km) ufs.add(uf);
    return [...ufs].sort();
  }
  // true/false; null = município do edital não localizado (ex.: Sistema S só traz a UF).
  function dentroDoRaio(indice, origem, km, municipio, uf) {
    const c = coordenada(indice, municipio, uf);
    return c ? distanciaKm(origem.coord, c) <= km : null;
  }

  const listaDeTexto = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  function textoExcluido(objeto, excluir) {
    const t = norm(objeto);
    return listaDeTexto(excluir).some((e) => norm(e) && t.includes(norm(e)));
  }

  // Filtro salvo com nome: só estes campos entram (nada de dado do edital nem do usuário além do que ele digitou).
  function limparFiltro(f) {
    const o = f && typeof f === "object" ? f : {};
    const txt = (v, max) => String(v ?? "").trim().slice(0, max);
    const filtro = { palavrasRaw: txt(o.palavrasRaw, LIMITES.palavras) };
    const excluir = txt(o.excluir, LIMITES.excluir);
    if (excluir) filtro.excluir = excluir;
    const ufs = [...new Set((Array.isArray(o.ufs) ? o.ufs : []).map((u) => String(u).toUpperCase()).filter((u) => /^[A-Z]{2}$/.test(u)))].slice(0, 27);
    if (ufs.length) filtro.ufs = ufs;
    if (Object.hasOwn(REGIOES, o.regiao)) filtro.regiao = o.regiao;
    const km = Number(o.raio?.km);
    if (o.raio?.municipio && /^[A-Za-z]{2}$/.test(o.raio.uf || "") && km >= 1 && km <= 3000) filtro.raio = { municipio: txt(o.raio.municipio, 80), uf: o.raio.uf.toUpperCase(), km: Math.round(km) };
    for (const c of ["municipio", "esfera", "valorMin", "valorMax", "orgaoTexto"]) if (txt(o[c], 80)) filtro[c] = txt(o[c], 80);
    return filtro;
  }
  function nomeValido(nome) {
    const n = String(nome ?? "").replace(/\s+/g, " ").trim();
    return n.length >= 1 && n.length <= LIMITES.nome ? n : null;
  }
  function resumoFiltro(f) {
    const p = [];
    if (f.palavrasRaw) p.push(f.palavrasRaw.length > 60 ? `${f.palavrasRaw.slice(0, 57)}...` : f.palavrasRaw);
    if (f.raio) p.push(`${f.raio.km} km de ${f.raio.municipio}-${f.raio.uf}`);
    else if (f.regiao) p.push(f.regiao);
    else if (f.ufs?.length) p.push(f.ufs.join(", "));
    if (f.excluir) p.push(`sem: ${f.excluir}`);
    return p.join(" · ");
  }

  // --- "Monte minha busca com IA" ---
  // Nada pessoal vai ao provedor: o texto do usuário perde e-mail, telefone, CPF/CNPJ, links e números longos.
  function limparDescricao(texto) {
    return String(texto || "").replace(/https?:\/\/\S+|www\.\S+/gi, " ").replace(/\S+@\S+/g, " ")
      .replace(/\+?\d[\d\s().\-/]{4,}\d/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  }
  function sanitizarSugestao(bruto) {
    const MAX = { palavras: 8, variacoes: 12, exclusoes: 8 };
    const vistos = new Set();
    const limpar = (lista, max) => {
      const saida = [];
      for (const item of Array.isArray(lista) ? lista : []) {
        const t = String(item ?? "").replace(/[,;\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
        const n = norm(t);
        // Descarta vazio, curto demais, longo demais, com e-mail/arroba ou número longo (dado pessoal) e repetido.
        if (t.length < 3 || t.length > 40 || /@|\d{4,}/.test(t) || vistos.has(n)) continue;
        vistos.add(n);
        saida.push(t);
        if (saida.length >= max) break;
      }
      return saida;
    };
    const palavras = limpar(bruto?.palavras, MAX.palavras);
    const variacoes = limpar(bruto?.variacoes, MAX.variacoes);
    // Uma exclusão não pode repetir termo que a própria busca procura.
    const exclusoes = limpar(bruto?.exclusoes, MAX.exclusoes);
    return { palavras, variacoes, exclusoes };
  }
  // A IA às vezes cerca o JSON com texto ou ```; pega o primeiro objeto.
  function extrairJson(texto) {
    const s = String(texto || "");
    const i = s.indexOf("{"), f = s.lastIndexOf("}");
    if (i < 0 || f <= i) return null;
    try { return JSON.parse(s.slice(i, f + 1)); } catch { return null; }
  }

  // --- Lembretes: o momento do aviso, em horário de Brasília (UTC-3 fixo, como o resto do projeto) ---
  // prazo = timestamp ISO do fim das propostas. Retorna ms UTC do aviso.
  function momentoDoAviso(prazoIso, diasAntes, horaAviso) {
    const prazo = new Date(prazoIso);
    if (Number.isNaN(prazo.getTime())) return null;
    const br = new Date(prazo.getTime() - 3 * 36e5); // relógio de Brasília lido como UTC
    const dia = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() - (Number(diasAntes) || 0), Number(horaAviso) || 0);
    return dia + 3 * 36e5;
  }

  const api = { REGIOES, LIMITES, norm, distanciaKm, criarIndice, coordenada, origemDoTexto, sugerirCidades, ufsNoRaio, dentroDoRaio, textoExcluido, limparFiltro, nomeValido, resumoFiltro, limparDescricao, sanitizarSugestao, extrairJson, momentoDoAviso };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.BuscaAvancada = api;
})(globalThis);
