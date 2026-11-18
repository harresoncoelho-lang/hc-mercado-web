/* global Buffer */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const P = require('./perfil-empresa');
// Servidor como referência: o que o navegador aceita tem de passar lá também.
const S = require('./netlify/functions/_empresa_identificacao');

function png(largura, altura, extra = 0) {
  const b = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(largura, 16); b.writeUInt32BE(altura, 20);
  return b;
}
function jpeg(largura, altura) {
  // SOI, APP0 curto, SOF0 com altura/largura.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 0x01, 0x01, 0x11, 0x00]);
}

test('logo: aceita PNG e JPEG pequenos e lê as mesmas dimensões do servidor', () => {
  for (const b of [png(400, 120), jpeg(800, 300)]) {
    const img = P.validarLogo(new Uint8Array(b));
    const ref = S.dimensoesImagem(b);
    assert.equal(img.erro, undefined);
    assert.deepEqual([img.largura, img.altura], [ref.largura, ref.altura]);
    assert.equal(img.ext === 'png' ? 'image/png' : 'image/jpeg', ref.tipo);
  }
});

test('logo: recusa acima de 512 KB, acima de 2000 px, formato desconhecido e JPEG sem dimensões', () => {
  assert.match(P.validarLogo(new Uint8Array(png(10, 10, 512 * 1024))).erro, /512 KB/);
  assert.equal(P.validarLogo(new Uint8Array(png(2000, 2000))).erro, undefined);
  assert.match(P.validarLogo(new Uint8Array(png(2001, 10))).erro, /2000 px/);
  assert.match(P.validarLogo(new Uint8Array(png(10, 0))).erro, /2000 px/);
  assert.match(P.validarLogo(new Uint8Array(Buffer.from('GIF89a......'))).erro, /PNG ou JPEG/);
  assert.match(P.validarLogo(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])).erro, /PNG ou JPEG/);
});

test('logo: hash do navegador e caminho batem com a conferência do servidor', async () => {
  const b = png(300, 100), hash = await P.sha256Hex(new Uint8Array(b));
  assert.equal(hash, createHash('sha256').update(b).digest('hex'));
  const org = '11111111-1111-4111-8111-111111111111', emp = '22222222-2222-4222-8222-222222222222';
  assert.equal(S.tipoCaminhoLogo(P.caminhoLogo(org, emp, hash, 'png'), org, emp, hash), 'image/png');
  assert.equal(S.tipoCaminhoLogo(P.caminhoLogo(org, emp, hash, 'jpg'), org, emp, hash), 'image/jpeg');
});

const perfilSalvo = { nome_fantasia: 'Fictícia', telefone: '(92) 3333-4444', aliquota_efetiva: 6.5, porte: 'me', tributos_fonte: 'manual', cpf_representante: '***.***.***-35', banco: { banco: 'Banco Exemplo', conta: '1234-5' }, proposta_padrao: { validade: '60 dias' } };

test('payload: nada mudou não envia nada; CPF mascarado intacto nunca volta ao servidor', () => {
  const inicial = P.valoresDoPerfil(perfilSalvo), linhas = P.linhasDePremissas([]);
  assert.equal(inicial.aliquota_efetiva, '6,5');
  assert.equal(P.montarPayload(inicial, { ...inicial }, linhas, linhas.map(l => ({ ...l }))), null);
  const corpo = P.montarPayload(inicial, { ...inicial, telefone: ' (92) 98888-7777 ' }, linhas, linhas);
  assert.deepEqual(corpo, { perfil: { telefone: '(92) 98888-7777' } });
  assert.equal('cpf_representante' in corpo.perfil, false);
});

test('payload: grupo jsonb vai inteiro quando um subcampo muda, e passa na validação do servidor', () => {
  const inicial = P.valoresDoPerfil(perfilSalvo), linhas = P.linhasDePremissas([]);
  const corpo = P.montarPayload(inicial, { ...inicial, 'banco.agencia': '0001', aliquota_efetiva: '7,25' }, linhas, linhas);
  assert.deepEqual(corpo.perfil.banco, { banco: 'Banco Exemplo', agencia: '0001', conta: '1234-5', pix: '', favorecido: '' });
  assert.deepEqual(S.validarPerfilEmpresa(corpo.perfil), { banco: { banco: 'Banco Exemplo', agencia: '0001', conta: '1234-5' }, aliquota_efetiva: 7.25 });
});

test('payload: favorecido sugerido pela razão social conta como alteração a salvar', () => {
  const inicial = P.valoresDoPerfil(null), atual = P.sugestoes(inicial, { razao_social: 'Empresa Fictícia Ltda' });
  assert.equal(inicial.tributos_fonte, 'manual');
  const linhas = P.linhasDePremissas([]);
  assert.equal(P.montarPayload(inicial, atual, linhas, linhas).perfil.banco.favorecido, 'Empresa Fictícia Ltda');
  assert.equal(P.sugestoes({ 'banco.favorecido': 'Outro' }, { razao_social: 'X' })['banco.favorecido'], 'Outro');
});

test('premissas: linha Padrão (todos) vem primeiro e só mudança envia a lista inteira', () => {
  const salvas = [{ segmento: 'limpeza', uf: 'AM', tributos_percentual: 8 }, { segmento: '*', uf: '*', margem_percentual: 20 }];
  const linhas = P.linhasDePremissas(salvas);
  assert.deepEqual([linhas[0].segmento, linhas[0].uf, linhas[0].margem_percentual], ['*', '*', '20']);
  assert.deepEqual(P.linhasDePremissas([])[0].segmento, '*');
  const inicial = P.valoresDoPerfil(perfilSalvo);
  const novas = [...linhas.map(l => ({ ...l })), { segmento: 'obras', uf: 'pa', tributos_percentual: '', frete_percentual: '3,5', garantia_percentual: '', margem_percentual: '15', margem_minima_percentual: '10' }];
  const corpo = P.montarPayload(inicial, { ...inicial }, linhas, novas);
  assert.deepEqual(corpo.perfil, {});
  assert.equal(corpo.premissas.length, 3);
  const validadas = S.validarPremissas(corpo.premissas);
  assert.deepEqual(validadas[2], { segmento: 'obras', uf: 'PA', tributos_percentual: null, frete_percentual: 3.5, garantia_percentual: null, margem_percentual: 15, margem_minima_percentual: 10 });
  assert.deepEqual(S.validarPerfilEmpresa(corpo.perfil), {});
});

test('premissas: linha salva removida ou com segmento trocado vai em premissasRemover; Padrão nunca', () => {
  const salvas = [{ segmento: '*', uf: '*', margem_percentual: 20 }, { segmento: 'limpeza', uf: 'AM' }, { segmento: 'obras', uf: '*' }, { segmento: '*', uf: 'PA' }];
  const linhas = P.linhasDePremissas(salvas), inicial = P.valoresDoPerfil(perfilSalvo);
  // Remove "obras", troca a UF de "limpeza" e mantém "*|PA" com mudança só de caixa/espaço.
  const atuais = [linhas[0], { ...linhas[1], uf: 'RR' }, { ...linhas[3], uf: ' pa ' }].map(l => ({ ...l }));
  const corpo = P.montarPayload(inicial, { ...inicial }, linhas, atuais);
  assert.deepEqual(corpo.premissasRemover, [{ segmento: 'limpeza', uf: 'AM' }, { segmento: 'obras', uf: '*' }]);
  assert.equal(corpo.premissas.length, 3);
  // O servidor aceita o par e não vê conflito entre salvar e remover.
  const gravar = new Set(S.validarPremissas(corpo.premissas).map(p => p.segmento + '|' + p.uf));
  assert.ok(S.validarPremissasRemover(corpo.premissasRemover).every(p => !gravar.has(p.segmento + '|' + p.uf)));
  // Só mudar percentual não remove nada.
  assert.equal('premissasRemover' in P.montarPayload(inicial, { ...inicial }, linhas, linhas.map(l => ({ ...l, frete_percentual: '2' }))), false);
  assert.match(P.mensagemDoErro(422, { erro: 'A linha Padrão não pode ser removida.', campo: 'premissasRemover[0]' }), /^Premissas removidas: /);
});

test('premissas: linha extra sem segmento e sem UF é barrada antes do envio', () => {
  const linhas = P.linhasDePremissas([{ segmento: 'limpeza', uf: 'AM' }]);
  assert.equal(P.linhaSemChave(linhas), -1);
  const vazia = { segmento: '*', uf: '*', tributos_percentual: '', frete_percentual: '', garantia_percentual: '', margem_percentual: '5', margem_minima_percentual: '' };
  assert.equal(P.linhaSemChave([...linhas, vazia]), 2);
  assert.equal(P.linhaSemChave([...linhas, { ...vazia, uf: 'AM' }]), -1);
});

test('erro 422: campo do servidor vira id da tela e rótulo simples', () => {
  assert.equal(P.idDoCampo('cpf_representante'), 'perfil-cpf_representante');
  assert.equal(P.idDoCampo('banco.conta'), 'perfil-banco-conta');
  assert.equal(P.idDoCampo('premissas[2].uf'), 'perfil-premissas-2-uf');
  assert.equal(P.idDoCampo('premissas[2]'), 'perfil-premissas-2');
  assert.equal(P.idDoCampo('hash'), 'perfil-logo');
  assert.equal(P.idDoCampo('perfil'), null);
  assert.equal(P.idDoCampo(undefined), null);
  assert.equal(P.mensagemDoErro(422, { erro: 'Confira o campo banco.conta.', campo: 'banco.conta' }), 'Confira o campo Conta.');
  assert.equal(P.mensagemDoErro(422, { erro: 'premissas[2].frete_percentual deve ficar entre 0 e 100.', campo: 'premissas[2].frete_percentual' }), 'Premissas, linha 3, Frete (%) deve ficar entre 0 e 100.');
  assert.equal(P.mensagemDoErro(422, { erro: 'CPF inválido. Confira os dígitos.', campo: 'cpf_representante' }), 'CPF do representante: CPF inválido. Confira os dígitos.');
  assert.equal(P.mensagemDoErro(503, { erro: 'qualquer' }), 'O perfil da empresa ainda não está disponível neste ambiente.');
  assert.match(P.mensagemDoErro(403, {}), /só de leitura/);
});

test('ids gerados pelo mapeamento existem para todos os campos do servidor', () => {
  // Erro em campo sem id na tela não destacaria nada: confere a lista inteira do contrato.
  const campos = ['nome_fantasia', 'telefone', 'email', 'inscricao_estadual', 'inscricao_municipal', 'porte', 'regime_tributario', 'aliquota_efetiva', 'tributos_fonte', 'cpf_representante', 'uf_sede', 'banco.banco', 'banco.agencia', 'banco.conta', 'banco.pix', 'banco.favorecido', 'proposta_padrao.validade', 'proposta_padrao.pagamento', 'proposta_padrao.prazo_entrega'];
  const fonte = require('node:fs').readFileSync(require.resolve('./perfil-empresa'), 'utf8');
  for (const c of campos) assert.ok(fonte.includes(`['${c}'`), c);
  assert.deepEqual(Object.keys(P.valoresDoPerfil(null)).sort(), [...campos].sort());
});

test('UF da sede: sugestão do endereço só preenche vazio, vira alteração a salvar e passa no servidor', () => {
  const inicial = P.valoresDoPerfil(null), linhas = P.linhasDePremissas([]);
  const atual = P.sugestoes(inicial, {}, 'AM');
  assert.equal(atual.uf_sede, 'AM');
  const corpo = P.montarPayload(inicial, atual, linhas, linhas);
  assert.deepEqual(S.validarPerfilEmpresa(corpo.perfil), { uf_sede: 'AM' });
  assert.equal(P.sugestoes({ ...inicial, uf_sede: 'PA' }, {}, 'AM').uf_sede, 'PA', 'a escolha salva vence a sugestão');
  assert.equal(P.sugestoes(inicial, {}, 'XX').uf_sede, '', 'sugestão fora da lista é ignorada');
  assert.equal(P.sugestoes(inicial, {}, null).uf_sede, '');
  assert.equal(P.valoresDoPerfil({ uf_sede: 'RR' }).uf_sede, 'RR');
  assert.equal(P.rotuloDoCampo('uf_sede'), 'UF da sede');
});
