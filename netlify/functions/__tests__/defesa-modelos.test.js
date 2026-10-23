const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { selecionarReferenciaPrivada } = require('../_defesa_modelos');

test('referência privada exige dono e pertinência documental; nunca entrega texto do modelo', async () => {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-modelos-qa-'));
  try {
    const catalogo = { versao: 1, uso: 'privado-local-sem-envio-a-IA', modelos: [{ id: 'modelo-4', rotulo: 'Prazo e logística de apresentação de amostras', temas: ['amostras', 'prazo'], dadosEspecificosNecessarios: ['tempo de fabricação'], textoOriginal: 'CONTEÚDO PRIVADO NÃO ENTREGAR' }] };
    await fs.writeFile(path.join(diretorio, 'catalogo-privado.json'), JSON.stringify(catalogo));
    const env = { DEFESA_MODELOS_PRIVADOS_DIRETORIO: diretorio, DEFESA_MODELOS_USUARIO_ID: 'dono' };
    const body = { tipo: 'impugnacao', questionamento: 'O prazo de apresentação das amostras é suficiente?', objetivo: 'Confirmar logística.' };
    const contexto = { dispensa: false, normas: [{ id: 'lei14133-art164' }], fontes: [{ texto: 'A vencedora deverá apresentar amostras no prazo de três dias.' }] };
    assert.equal(await selecionarReferenciaPrivada(body, contexto, { userId: 'outro' }, env), undefined);
    assert.equal(await selecionarReferenciaPrivada(body, contexto, { userId: 'dono' }, {}), undefined);
    const r = await selecionarReferenciaPrivada(body, contexto, { userId: 'dono' }, env);
    assert.equal(r.id, 'modelo-4');
    assert.equal(r.referenciaPrivada, true);
    assert.ok(!JSON.stringify(r).includes('CONTEÚDO PRIVADO'));
    assert.equal(await selecionarReferenciaPrivada({ ...body, questionamento: 'Prazo de pagamento?', objetivo: '' }, contexto, { userId: 'dono' }, env), undefined);
    assert.equal(await selecionarReferenciaPrivada(body, { ...contexto, fontes: [{ texto: 'Não será exigida a apresentação de amostras.' }] }, { userId: 'dono' }, env), undefined);
    assert.equal(await selecionarReferenciaPrivada(body, { ...contexto, normas: [] }, { userId: 'dono' }, env), undefined);
    for (const texto of ['Fica dispensada a apresentação de amostras.', 'A apresentação de amostras é facultativa.', 'Amostras sem exigência obrigatória.']) {
      assert.equal(await selecionarReferenciaPrivada(body, { ...contexto, fontes: [{ texto }] }, { userId: 'dono' }, env), undefined);
    }
    catalogo.modelos.push({ id: 'modelo-2', rotulo: 'Registro em engenharia', temas: ['CREA'], dadosEspecificosNecessarios: ['justificativa'] });
    await fs.writeFile(path.join(diretorio, 'catalogo-privado.json'), JSON.stringify(catalogo));
    const crea = { ...body, questionamento: 'Por que o registro CREA é exigido?', objetivo: '' };
    assert.equal(await selecionarReferenciaPrivada(crea, { ...contexto, fontes: [{ texto: 'É obrigatório registro no CRA. A menção ao CREA é apenas informativa, sem exigência.' }] }, { userId: 'dono' }, env), undefined);
    const rCrea = await selecionarReferenciaPrivada(crea, { ...contexto, fontes: [{ texto: 'É obrigatório apresentar registro no CREA. Não será exigida amostra.' }] }, { userId: 'dono' }, env);
    assert.equal(rCrea.id, 'modelo-2');
  } finally {
    await fs.rm(path.join(diretorio, 'catalogo-privado.json'));
    await fs.rmdir(diretorio);
  }
});
