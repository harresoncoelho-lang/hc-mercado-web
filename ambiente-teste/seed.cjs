// Dados fictícios do ambiente de teste (chamado por subir.cjs; só fala com o Supabase LOCAL).
// Senhas geradas a cada subida e gravadas só em ambiente-teste/seed.local.json (gitignored).
// Editais: os mais recentes do PNCP para AM (rede real, leitura pública); sem rede, cai num edital fixo.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const SAIDA = path.join(__dirname, 'seed.local.json');
const senha = () => crypto.randomBytes(15).toString('base64url') + 'a1!';
const dia = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function semear(chaves) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(chaves.API_URL)) throw new Error('seed só roda contra o Supabase local');
  const h = { apikey: chaves.SERVICE_ROLE_KEY, Authorization: `Bearer ${chaves.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const pedir = async (metodo, caminho, corpo, extra = {}) => {
    const r = await fetch(chaves.API_URL + caminho, { method: metodo, headers: { ...h, Prefer: 'return=representation', ...extra }, body: corpo && JSON.stringify(corpo) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} -> ${r.status} ${t.slice(0, 400)}`);
    return t ? JSON.parse(t) : null;
  };
  const inserir = (tabela, linhas) => pedir('POST', `/rest/v1/${tabela}`, linhas);

  const usuarios = {};
  for (const [papel, nome] of [['gestor', 'Gestora Teste'], ['operador', 'Operador Teste'], ['leitura', 'Leitura Teste'], ['outra_org', 'Gestor Outra Org']]) {
    const email = `${papel.replace('_', '-')}@teste-licitaplena.example.com`, s = senha();
    const u = await pedir('POST', '/auth/v1/admin/users', { email, password: s, email_confirm: true, user_metadata: { nome } });
    usuarios[papel] = { id: u.id, email, senha: s, nome };
  }
  await inserir('clientes', Object.values(usuarios).map(u => ({ id: u.id, nome: u.nome, email: u.email, empresa: 'Empresa Fictícia de Teste', cnpj: '11222333000181',
    status: 'aprovado', plano: 'teste', aceite_termos: true, estados_interesse: ['AM'] })));

  const [orgA] = await inserir('operacao_organizacoes', [{ nome: 'Organização Teste A (fictícia)', owner_id: usuarios.gestor.id }]);
  const [orgB] = await inserir('operacao_organizacoes', [{ nome: 'Organização Teste B (fictícia)', owner_id: usuarios.outra_org.id }]);
  const [empA1, empA2] = await inserir('operacao_empresas', [
    { organizacao_id: orgA.id, razao_social: 'Papelaria Aurora Teste LTDA', cnpj: '11222333000181', responsavel: 'Gestora Teste' },
    { organizacao_id: orgA.id, razao_social: 'Materiais Horizonte Teste LTDA', cnpj: '12345678000195', responsavel: 'Gestora Teste' }]);
  const [empB] = await inserir('operacao_empresas', [{ organizacao_id: orgB.id, razao_social: 'Empresa Sigilosa Outra Org LTDA', cnpj: '11444777000161' }]);
  await inserir('operacao_membros', [
    { organizacao_id: orgA.id, usuario_id: usuarios.gestor.id, papel: 'gestor', empresa_id: null },
    { organizacao_id: orgA.id, usuario_id: usuarios.operador.id, papel: 'operador', empresa_id: empA1.id },
    { organizacao_id: orgA.id, usuario_id: usuarios.leitura.id, papel: 'leitura', empresa_id: null },
    { organizacao_id: orgB.id, usuario_id: usuarios.outra_org.id, papel: 'gestor', empresa_id: null }]);
  // Validades variadas: vencido, vence em 5 dias, em 25, em 120, sem vencimento.
  await inserir('operacao_documentos', [
    ['CND Federal', -10], ['CND Estadual', 5], ['FGTS (CRF)', 25], ['Certidão Trabalhista (CNDT)', 120], ['Contrato Social', null]]
    .map(([tipo, n]) => ({ organizacao_id: orgA.id, empresa_id: empA1.id, tipo, titulo: `${tipo} (fictício)`, emissao: dia(-30), vencimento: n === null ? null : dia(n), criado_por: usuarios.gestor.id })));
  await inserir('operacao_documentos', [{ organizacao_id: orgB.id, empresa_id: empB.id, tipo: 'CND Federal', titulo: 'Documento sigiloso da outra org', vencimento: dia(30) }]);

  const editais = await editaisPncp();
  await inserir('oportunidades_abertas', editais.map(r => ({ chave: r.numeroControlePNCP, numero_controle_pncp: r.numeroControlePNCP, objeto: r.objeto, uf: r.uf,
    publicacao: r.publicacao?.slice(0, 10) || null, encerramento: r.encerramento?.slice(0, 10) || null, dado: r })));
  // Processo já no Funil (dispara a esteira); os demais editais ficam no boletim para o teste "Tenho interesse".
  const p = editais[0];
  const [procA] = await inserir('operacao_processos', [{ organizacao_id: orgA.id, empresa_id: empA1.id, numero: `${p.numeroCompra}/${p.anoCompra}`, objeto: p.objeto.slice(0, 500),
    orgao: p.orgao, modalidade: p.modalidadeNome, status: 'preparacao', decisao: 'participar', origem_externa_id: p.numeroControlePNCP,
    url_origem: urlPncp(p.numeroControlePNCP), criado_por: usuarios.gestor.id }]);
  const [procB] = await inserir('operacao_processos', [{ organizacao_id: orgB.id, empresa_id: empB.id, numero: 'SIGILOSO 01/2026', objeto: 'Processo sigiloso da outra organização', status: 'preparacao' }]);

  const resumo = { gerado_em: new Date().toISOString(), site: 'http://127.0.0.1:8788', usuarios,
    ids: { orgA: orgA.id, orgB: orgB.id, empA1: empA1.id, empA2: empA2.id, empB: empB.id, procA: procA.id, procB: procB.id },
    editais: editais.map(e => e.numeroControlePNCP) };
  fs.writeFileSync(SAIDA, JSON.stringify(resumo, null, 2));
  return `seed: 4 usuários (senhas em ambiente-teste/seed.local.json), orgs A/B, 3 empresas, 6 documentos, ${editais.length} editais (${editais.fonte}), processo ${p.numeroControlePNCP} no Funil`;
}

function urlPncp(n) { const [cnpj, , resto] = n.split('-'); const [seq, ano] = resto.split('/'); return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(seq)}`; }

async function editaisPncp() {
  try {
    const r = await fetch(`https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?uf=AM&dataFinal=${dia(365).replaceAll('-', '')}&codigoModalidadeContratacao=6&pagina=1&tamanhoPagina=50`, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    const lista = j.data.filter(i => i.dataEncerramentoProposta && Date.parse(i.dataEncerramentoProposta) > Date.now() + 2 * 86400000)
      .sort((a, b) => String(b.dataPublicacaoPncp).localeCompare(String(a.dataPublicacaoPncp))).slice(0, 15).map(i => ({
        objeto: i.objetoCompra || '', orgao: i.orgaoEntidade?.razaoSocial || 'Órgão não informado', uf: 'AM', municipio: i.unidadeOrgao?.municipioNome || '',
        encerramento: i.dataEncerramentoProposta, publicacao: i.dataPublicacaoPncp, numeroControlePNCP: i.numeroControlePNCP, modalidadeNome: i.modalidadeNome || null,
        modoDisputaNome: i.modoDisputaNome || null, srp: typeof i.srp === 'boolean' ? i.srp : null, situacaoCompraNome: i.situacaoCompraNome || null,
        valorTotalEstimado: i.valorTotalEstimado ?? null, numeroCompra: i.numeroCompra || null, anoCompra: i.anoCompra || null, processo: i.processo || null,
        codigoUnidade: i.unidadeOrgao?.codigoUnidade || null, esferaId: i.orgaoEntidade?.esferaId || null }));
    if (lista.length < 2) throw new Error('PNCP sem editais abertos suficientes');
    return Object.assign(lista, { fonte: 'PNCP ao vivo' });
  } catch (e) {
    console.warn('seed: PNCP indisponível, usando edital fixo:', e.message);
    return Object.assign([{ objeto: 'Registro de preços para aquisição de ração animal (edital real do PNCP, dados fixos)', orgao: 'AADESAM', uf: 'AM', municipio: 'Manaus',
      encerramento: dia(5), publicacao: '2026-06-17', numeroControlePNCP: '13272780000170-1-000022/2026', modalidadeNome: 'Pregão - Eletrônico', numeroCompra: '006', anoCompra: 2026 },
    { objeto: 'Edital fictício de reserva', orgao: 'Órgão fictício', uf: 'AM', encerramento: dia(9), publicacao: dia(-1), numeroControlePNCP: '11222333000181-1-000099/2026', numeroCompra: '099', anoCompra: 2026 }], { fonte: 'fixo (sem rede)' });
  }
}

module.exports = { semear };
