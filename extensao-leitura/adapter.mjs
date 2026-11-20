const ORIGIN = 'https://cnetmobile.estaleiro.serpro.gov.br';
const PATH = '/comprasnet-web/seguro/fornecedor/cadastro-propostas';

export function allowedUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && url.pathname === PATH && !url.username && !url.password && !url.hash
      && [...url.searchParams.keys()].length === 1 && /^\d{17}$/.test(url.searchParams.get('compra') || '');
  } catch { return false; }
}

function cnpj(value) {
  if (typeof value !== 'string' || !/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (/^(\d)\1+$/.test(digits)) return null;
  for (let size = 12; size <= 13; size++) {
    const weights = size === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const remainder = weights.reduce((sum, weight, i) => sum + Number(digits[i]) * weight, 0) % 11;
    if (Number(digits[size]) !== (remainder < 2 ? 0 : 11 - remainder)) return null;
  }
  return digits;
}

function normalizeExpected(value) {
  if (!value || !cnpj(value.cnpj) || !/^\d{6}$/.test(value.uasg || '')
    || !/^[0-9]{1,5}$/.test(value.number || '') || Number(value.number) < 1
    || !/^\d{4}$/.test(value.year || '') || !/^\d{17}$/.test(value.purchaseId || '')) return null;
  return { cnpj: cnpj(value.cnpj), uasg: value.uasg, number: String(Number(value.number)), year: value.year, purchaseId: value.purchaseId };
}

export function validateContext(snapshot, expected) {
  const observed = { cnpj: null, uasg: null, number: null, year: null, purchaseId: null };
  const done = (status) => ({ status, observed: { ...observed }, writeAuthorized: false });
  const wanted = normalizeExpected(expected);
  if (!wanted) return done('esperado_invalido');
  if (!snapshot || !allowedUrl(snapshot.url)) return done('pagina_nao_suportada');
  if (snapshot.collectionComplete !== true || !['headings', 'supplierLabels', 'notices'].every(key =>
    Array.isArray(snapshot[key]) && snapshot[key].length <= 20 && snapshot[key].every(x => typeof x === 'string' && x.length <= 240))) {
    return done('leitura_incompleta');
  }
  if (snapshot.notices.some(text => /sess[aã]o.*expir|acesso n[aã]o autorizado|captcha/i.test(text))) return done('sessao_ou_verificacao_pendente');
  observed.purchaseId = new URL(snapshot.url).searchParams.get('compra');
  const suppliers = snapshot.supplierLabels.map(text => text.match(/^CNPJ do fornecedor\s*:\s*(.+)$/i)).filter(Boolean);
  const ids = [...new Set(suppliers.map(match => cnpj(match[1])))];
  const purchases = [...new Set(snapshot.headings.map(text => text.match(/^Preg[aã]o Eletr[oô]nico N[°ºo.]?\s*(\d{1,5})\/(\d{4})(?:\s|$)/i))
    .filter(Boolean).map(match => `${Number(match[1])}/${match[2]}`))];
  const uasgs = [...new Set(snapshot.headings.map(text => text.match(/^UASG\s+(\d{6})(?:\s|$)/i)).filter(Boolean).map(match => match[1]))];
  if (ids.length > 1 || purchases.length > 1 || uasgs.length > 1) return done('contexto_ambiguo');
  observed.cnpj = ids[0] || null;
  observed.uasg = uasgs[0] || null;
  if (purchases.length === 1) [observed.number, observed.year] = purchases[0].split('/');
  if (!observed.cnpj) return done('identidade_nao_confirmada');
  if (!observed.uasg || !observed.number) return done('compra_nao_confirmada');
  if (Object.keys(wanted).some(key => wanted[key] !== observed[key])) return done('contexto_divergente');
  const result = done('confirmado');
  const page = snapshot.paginaObservada;
  if (page?.completa === true && Array.isArray(page.itens) && page.itens.length > 0 && page.itens.length <= 10
    && new Set(page.itens.map(item => item?.id)).size === page.itens.length
    && page.itens.every(item => item && typeof item.id === 'string' && /^[1-9]\d{0,17}$/.test(item.id)
      && typeof item.descricao === 'string' && item.descricao.length > 0 && item.descricao.length <= 2000
      && typeof item.quantidadeSolicitada === 'string' && item.quantidadeSolicitada.length <= 64 && /^\d+(?:[.,]\d+)?$/.test(item.quantidadeSolicitada)
      && typeof item.unidade === 'string' && item.unidade.length > 0 && item.unidade.length <= 120
      && item.grupo === null && item.exigencias === null)) {
    result.paginaObservada = { parcial: true, itens: page.itens.map(({ id, descricao, quantidadeSolicitada, unidade }) => ({ id, descricao, quantidadeSolicitada, unidade, grupo: null, exigencias: null })) };
  }
  return result;
}
