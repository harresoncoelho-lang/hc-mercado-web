import { createHash } from 'node:crypto';
import kit from '../netlify/functions/_kit_documentos.js';
import { validateContext } from '../extensao-leitura/adapter.mjs';
import { validarLote } from '../extensao-leitura/prevalidacao-lote.mjs';

const { preparar, decimal, totalItem, uuid } = kit;
const four = value => `${value / 10000n}.${String(value % 10000n).padStart(4, '0')}`;
const cnpj = value => typeof value === 'string' ? value.replace(/\D/g, '') : null;
const reject = motivo => ({ valido: false, motivo, lote: null, writeAuthorized: false, portalAuthorizationRequired: true });

// Adaptador server-side isolado: contexto, vínculo e catálogo devem vir de leitura autorizada atual.
export function propostaParaLote(abertura, snapshotPortal, confiavel) {
  const d = abertura?.documento; const ctx = confiavel?.contextoKit; const v = confiavel?.vinculo;
  if (!d || !ctx?.empresa || !ctx?.processo || !v || typeof ctx.userId !== 'string' || !ctx.userId
    || ![d.id, ctx.empresa.id, ctx.empresa.organizacao_id, ctx.processo.id].every(uuid)
    || d.tipo !== 'proposta' || d.empresaId !== ctx.empresa.id || d.processoId !== ctx.processo.id || d.organizacaoId !== ctx.empresa.organizacao_id
    || ctx.processo.empresa_id !== ctx.empresa.id || ctx.processo.organizacao_id !== ctx.empresa.organizacao_id
    || v.empresaId !== ctx.empresa.id || v.processoId !== ctx.processo.id || v.organizacaoId !== ctx.empresa.organizacao_id
    || !Array.isArray(ctx.itens) || new Set(ctx.itens.map(i => i?.id)).size !== ctx.itens.length
    || ctx.itens.some(i => !i || !uuid(i.id) || i.processo_id !== ctx.processo.id || i.organizacao_id !== ctx.empresa.organizacao_id)) return reject('escopo');
  if (abertura.revisaoVigente !== true || !Number.isSafeInteger(d.versao) || d.versao < 1
    || d.revisadoPor !== ctx.userId || d.revisao?.revisadoPor !== ctx.userId || d.revisao?.versao !== d.versao
    || !/^[a-f0-9]{64}$/.test(d.revisao?.hash || '')) return reject('revisao');
  if (!d.dados || typeof d.dados !== 'object' || Array.isArray(d.dados)
    || Object.keys(d.dados).length !== 1 || !Object.hasOwn(d.dados, 'proposta')) return reject('dados_kit');
  let prepared;
  try { prepared = preparar(ctx, { tipo: d.tipo, ...d.dados }); } catch { return reject('dados_kit'); }
  // Envelope de prepararPeca (kit-documentos.js), não exportado; paridade testada contra o handler real.
  const expectedHash = createHash('sha256').update(JSON.stringify({ documentoId: d.id, versao: d.versao, revisaoHashLegado: prepared.revisaoHash })).digest('hex');
  if (d.revisao.hash !== expectedHash) return reject('revisao');
  const expected = v.contextoPortal;
  if (!expected || cnpj(expected.cnpj) !== cnpj(ctx.empresa.cnpj)) return reject('cnpj');
  const context = validateContext(snapshotPortal, expected);
  if (context.status !== 'confirmado') return reject('contexto_portal');
  if (!Array.isArray(confiavel.catalogo) || !Array.isArray(confiavel.mapeamento)) return reject('mapeamento');
  const mapping = new Map(); const targets = new Set();
  for (const entry of confiavel.mapeamento) {
    if (!entry || !uuid(entry.itemKitId) || !ctx.itens.some(i => i.id === entry.itemKitId)
      || typeof entry.itemPortalId !== 'string' || !/^[1-9]\d{0,17}$/.test(entry.itemPortalId)
      || mapping.has(entry.itemKitId) || targets.has(entry.itemPortalId)) return reject('mapeamento');
    mapping.set(entry.itemKitId, entry.itemPortalId); targets.add(entry.itemPortalId);
  }
  const lines = [];
  for (const itemId of d.dados.proposta.itemIds) {
    const item = ctx.itens.find(i => i.id === itemId); const portalId = mapping.get(itemId);
    if (!portalId) return reject('mapeamento');
    const q = decimal(item.quantidade, 3); const p = decimal(item.valor_unitario_proposta, 2);
    if (q * p !== totalItem(item.quantidade, item.valor_unitario_proposta) * 1000n) return reject('precisao_divergente');
    const line = { id: portalId, quantidade: four(q * 10n), unitario: four(p * 100n) };
    for (const key of ['marca', 'modelo']) if (item[key] !== null && item[key] !== undefined && item[key] !== '') line[key] = item[key];
    lines.push(line);
  }
  const lote = validarLote(confiavel.catalogo, lines);
  if (!lote.valido) return reject('catalogo_ou_lote');
  return { valido: true, documentoId: d.id, versao: d.versao, revisaoHash: expectedHash,
    contexto: context.observed, lote, writeAuthorized: false, portalAuthorizationRequired: true };
}
