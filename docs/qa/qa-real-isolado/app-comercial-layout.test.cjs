// Prova de layout real: Chromium headless renderiza o módulo real empresa-identificacao-ui.js
// com a folha real app-comercial.css e mede posições. Não confere strings de CSS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const raiz = path.resolve(__dirname, '..', '..', '..');
const SHOTS = process.env.LAYOUT_SHOTS_DIR || null;

async function medir(largura) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: largura, height: 900 } });
    const css = fs.readFileSync(path.join(raiz, 'ds-tokens.css'), 'utf8') + '\n' + fs.readFileSync(path.join(raiz, 'app-comercial.css'), 'utf8');
    const js = fs.readFileSync(path.join(raiz, 'empresa-identificacao-ui.js'), 'utf8');
    await page.setContent(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="app-principal"><div id="identificacao" tabindex="-1"></div></main></body></html>`);
    await page.addScriptTag({ content: js });
    await page.evaluate(() => {
      EmpresaIdentificacaoUI.renderizar(document.getElementById('identificacao'), {
        aberto: true, semMinuta: true, empresaId: 'e', ativo: () => true, solicitar: async () => ({}),
      });
    });
    const r = await page.evaluate(() => {
      const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cy: b.top + b.height / 2 }; };
      const det = document.querySelector('#identificacao details');
      const q = (s) => document.querySelector(s);
      return {
        details: box(det),
        summary: box(q('#identificacao summary')),
        razaoLabel: box(q('label[for="empresa-identificacao-razao"]')),
        razao: box(q('#empresa-identificacao-razao')),
        cnpjLabel: box(q('label[for="empresa-identificacao-cnpj"]')),
        cnpj: box(q('#empresa-identificacao-cnpj')),
        docLabel: box(q('label[for="empresa-identificacao-documento"]')),
        documento: box(q('#empresa-identificacao-documento')),
        tipo: box(q('select[aria-label="Tipo de documento"]')),
        arquivo: box(q('input[type="file"]')),
        checkbox: box(q('#empresa-identificacao-revisao')),
        revisaoLabel: box(q('label[for="empresa-identificacao-revisao"]')),
        salvar: box(q('#identificacao details button.defesa-botao:last-of-type')),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        grade: getComputedStyle(det).display,
      };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `identificacao_${largura}.png`), fullPage: true, scale: 'device' });
    return r;
  } finally {
    await browser.close();
  }
}

const mesmaLinha = (a, b) => Math.abs(a.cy - b.cy) < 14;

test('desktop 1280px: label à esquerda e campo à direita, mesma linha', async () => {
  const r = await medir(1280);
  assert.ok(r.razaoLabel.r <= r.razao.l + 1, 'label da razão deve ficar antes do campo');
  assert.ok(mesmaLinha(r.razaoLabel, r.razao), 'razão: label e campo na mesma linha');
  assert.ok(mesmaLinha(r.cnpjLabel, r.cnpj), 'CNPJ: label e campo na mesma linha');
  assert.ok(r.razao.w > 200, 'campo de razão deve ter largura de coluna de campo');
  assert.ok(mesmaLinha(r.docLabel, r.documento), 'documento: label e select na mesma linha');
  assert.ok(r.summary.w > r.details.w * 0.9, 'summary ocupa a largura toda');
  assert.ok(r.tipo.w > r.details.w * 0.6, 'select de tipo ocupa a largura toda');
  assert.ok(r.arquivo.w > r.details.w * 0.6, 'arquivo ocupa a largura toda');
  assert.ok(r.checkbox.r <= r.revisaoLabel.l + 1, 'checkbox antes do texto do checkbox');
  assert.ok(mesmaLinha(r.checkbox, r.revisaoLabel), 'checkbox e label na mesma linha');
  assert.ok(r.revisaoLabel.t > r.arquivo.t, 'checkbox fica depois do arquivo');
  assert.ok(r.overflow <= 0, 'sem rolagem horizontal no desktop');
});

test('mobile 375px: uma coluna, rótulo acima do campo, checkbox e label na mesma linha', async () => {
  const r = await medir(375);
  assert.ok(r.razaoLabel.b <= r.razao.t + 1, 'rótulo da razão fica acima do campo');
  assert.ok(r.razao.w > r.details.w * 0.8, 'campo ocupa a largura da coluna');
  assert.ok(r.cnpjLabel.b <= r.cnpj.t + 1, 'rótulo do CNPJ fica acima do campo');
  assert.ok(r.docLabel.b <= r.documento.t + 1, 'rótulo do documento fica acima do select');
  assert.ok(r.tipo.w > r.details.w * 0.8, 'select de tipo ocupa a largura da coluna');
  assert.ok(mesmaLinha(r.checkbox, r.revisaoLabel), 'checkbox e label na mesma linha');
  assert.ok(r.checkbox.r <= r.revisaoLabel.l + 1, 'checkbox antes do texto');
  assert.ok(r.overflow <= 0, 'sem rolagem horizontal no mobile');
});
