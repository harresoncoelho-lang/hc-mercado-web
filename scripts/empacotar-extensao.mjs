import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// npm run empacotar:extensao -> dist/licitaplena-extensao-<versão>.zip, pronto para "Carregar sem compactação" no
// Chrome/Edge (modo desenvolvedor) depois de descompactar. Antes de escrever, confere o manifesto contra as regras da
// extensão (MV3, permissões mínimas, sem host_permissions/content_scripts/<all_urls>/127.0.0.1, CSP sem rede,
// MODO_AUTOMATICO=false) e junta SÓ os arquivos que o manifesto alcança (popup, worker, ícones e os imports deles):
// teste, fixture e README não vão no pacote. Qualquer arquivo referenciado que falte aborta.
import AdmZip from 'adm-zip';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONTE = path.join(RAIZ, 'extensao-leitura');
const PERMISSOES = new Set(['activeTab', 'scripting', 'notifications', 'storage']);
const HOSTS_OPCIONAIS = new Set(['https://licitaplena.com.br/*', 'https://www.licitaplena.com.br/*', 'https://licitaplena.pages.dev/*', 'https://cnetmobile.estaleiro.serpro.gov.br/*']);

export function conferirManifesto(m) {
  const erros = [];
  if (m.manifest_version !== 3) erros.push('manifest_version deve ser 3');
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(m.version || '')) erros.push('version deve ser X.Y.Z');
  for (const p of m.permissions || []) if (!PERMISSOES.has(p)) erros.push(`permissão não permitida: ${p}`);
  for (const h of m.optional_host_permissions || []) if (!HOSTS_OPCIONAIS.has(h)) erros.push(`site opcional não permitido: ${h}`);
  for (const k of ['host_permissions', 'content_scripts', 'externally_connectable', 'key', 'web_accessible_resources']) if (k in m) erros.push(`${k} não pode estar no pacote de produção`);
  if (/<all_urls>|127\.0\.0\.1|localhost|\*:\/\/\*/.test(JSON.stringify(m))) erros.push('manifesto com site local ou curinga');
  if (!/connect-src 'none'/.test(m.content_security_policy?.extension_pages || '')) erros.push("CSP das páginas precisa de connect-src 'none'");
  if (!m.action?.default_popup || !m.background?.service_worker) erros.push('popup e service worker são obrigatórios');
  return erros;
}

// Arquivos alcançáveis a partir do manifesto (caminhos relativos à pasta da extensão).
export async function arquivosDaExtensao(fonte = FONTE) {
  const m = JSON.parse(await readFile(path.join(fonte, 'manifest.json'), 'utf8'));
  const fila = [m.action.default_popup, m.background.service_worker, ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {})];
  const vistos = new Set();
  while (fila.length) {
    const rel = path.posix.normalize(fila.shift());
    if (vistos.has(rel)) continue;
    if (rel.startsWith('..') || path.posix.isAbsolute(rel)) throw new Error(`referência fora da pasta da extensão: ${rel}`);
    let texto;
    try { texto = await readFile(path.join(fonte, rel), /\.(mjs|js|html|css)$/.test(rel) ? 'utf8' : null); } catch { throw new Error(`arquivo referenciado não existe: ${rel}`); }
    vistos.add(rel);
    if (/\.test\.|(^|\/)fixtures\//.test(rel)) throw new Error(`teste/fixture referenciado pelo pacote: ${rel}`);
    const base = path.posix.dirname(rel);
    const refs = rel.endsWith('.html')
      ? [...texto.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map(x => x[1])
      : rel.endsWith('.mjs') || rel.endsWith('.js') ? [...texto.matchAll(/\b(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]/gm)].map(x => x[1] || x[2] || x[3]) : [];
    for (const r of refs) {
      if (/^[a-z]+:|^\/\//i.test(r)) throw new Error(`${rel} referencia recurso externo: ${r}`);
      fila.push(path.posix.join(base, r.split(/[?#]/)[0]));
    }
  }
  return { manifesto: m, arquivos: [...vistos].sort() };
}

export async function empacotar({ fonte = FONTE, destino = path.join(RAIZ, 'dist') } = {}) {
  const { manifesto, arquivos } = await arquivosDaExtensao(fonte);
  const erros = conferirManifesto(manifesto);
  const leitor = await readFile(path.join(fonte, 'pregao-leitor.mjs'), 'utf8');
  if (!/export const MODO_AUTOMATICO = false;/.test(leitor)) erros.push('MODO_AUTOMATICO precisa ser false');
  if (erros.length) throw new Error(`Manifesto recusado:\n- ${erros.join('\n- ')}`);
  const zip = new AdmZip();
  zip.addFile('manifest.json', await readFile(path.join(fonte, 'manifest.json')));
  for (const a of arquivos) zip.addFile(a, await readFile(path.join(fonte, a)));
  await mkdir(destino, { recursive: true });
  const arquivo = path.join(destino, `licitaplena-extensao-${manifesto.version}.zip`);
  await writeFile(arquivo, zip.toBuffer());
  return { arquivo, versao: manifesto.version, arquivos: ['manifest.json', ...arquivos] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = await empacotar();
  process.stdout.write(`Pacote ${r.versao}: ${r.arquivo}\n${r.arquivos.length} arquivos: ${r.arquivos.join(', ')}\n`);
}
