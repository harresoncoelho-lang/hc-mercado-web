// Prova estática das dependências FK deste catálogo. Não interpreta SQL geral nem conecta.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const arquivo = process.argv[2];
assert(['01-bootstrap-prekit-staging-v2.sql','01-bootstrap-prekit-staging-v3.sql'].includes(arquivo), 'Indicar candidato v2 ou v3');
const ler = nome => fs.readFileSync(path.join(__dirname,nome),'utf8');
const sql = ler(arquivo);
const origem = JSON.parse(fs.readFileSync(path.join(__dirname,'../../migracoes-capacidade-20261031/catalogo-producao-20261031.json'),'utf8'));
const destino = JSON.parse(ler('catalogo-destino-vazio.json'));
const colunaSimples = /^[a-z_][a-z_0-9]*$/;
function colunas(texto) {
 const lista = texto.split(',').map(x=>x.trim());
 assert(lista.every(x=>colunaSimples.test(x)), 'Coluna complexa exige análise explícita: '+texto);
 return lista.sort().join(',');
}
const chaves = [];
for (const c of [...origem.catalogo.constraints.filter(x=>x.esquema==='public'),...destino.catalogo.constraints]) {
 if (!['p','u'].includes(c.tipo)) continue;
 const m = /^(?:PRIMARY KEY|UNIQUE) \(([^)]+)\)/.exec(c.definicao);
 assert(m && !c.deferivel, 'Chave de suporte exige análise explícita: '+c.nome);
 const comando = `ALTER TABLE ${c.esquema}."${c.tabela}" ADD CONSTRAINT "${c.nome}" ${c.definicao};`;
 chaves.push({relacao:c.esquema+'.'+c.tabela,colunas:colunas(m[1]),nome:c.nome,posicao:c.esquema==='public'?sql.indexOf(comando):-1,gerenciada:c.esquema!=='public'});
}
for (const i of [...origem.catalogo.indices.filter(x=>x.esquema==='public'),...destino.catalogo.indices.filter(x=>x.esquema==='auth'&&x.tabela==='users')]) {
 if (!i.unico || !i.valido || !i.pronto || i.primario || /\bWHERE\b/.test(i.definicao)) continue;
 // Índices de constraints já têm seu provedor acima; incluir só UNIQUE independentes.
 if (chaves.some(c=>c.relacao===i.esquema+'.'+i.tabela&&c.nome===i.nome)) continue;
 const m = / USING btree \(([^)]+)\)$/.exec(i.definicao);
 assert(m, 'Índice único exige análise explícita: '+i.nome);
 chaves.push({relacao:i.esquema+'.'+i.tabela,colunas:colunas(m[1]),nome:i.nome,posicao:i.esquema==='public'?sql.indexOf(i.definicao+';'):-1,gerenciada:i.esquema!=='public'});
}
const faltas = [];
const dependencias = [];
const fks = origem.catalogo.constraints.filter(x=>x.esquema==='public'&&x.tipo==='f');
for (const fk of fks) {
 const m = / REFERENCES (?:(auth|public)\.)?([a-z_0-9]+)\(([^)]+)\)/.exec(fk.definicao);
 assert(m, 'Referência exige análise explícita: '+fk.nome);
 const relacao = (m[1]||'public')+'.'+m[2];
 const alvo = colunas(m[3]);
 const comando = `ALTER TABLE public."${fk.tabela}" ADD CONSTRAINT "${fk.nome}" ${fk.definicao};`;
 const posicao = sql.indexOf(comando);
 assert(posicao>=0, 'FK catalogada não foi emitida: '+fk.nome);
 if (relacao.startsWith('public.')) assert(sql.indexOf(`CREATE TABLE public."${m[2]}" (`)>=0 && sql.indexOf(`CREATE TABLE public."${m[2]}" (`)<posicao, 'Tabela referenciada deve existir antes da FK');
 const provedores = chaves.filter(c=>c.relacao===relacao&&c.colunas===alvo);
 assert(provedores.length, 'Catálogo não fornece chave única para '+fk.nome);
 const valida = provedores.find(c=>c.gerenciada||c.posicao>=0&&c.posicao<posicao);
 const detalhe = {fk:fk.nome,referencia:relacao+'('+alvo+')',linhaFk:sql.slice(0,posicao).split('\n').length,provedores:provedores.map(c=>({nome:c.nome,gerenciada:c.gerenciada,linha:c.gerenciada?null:c.posicao<0?null:sql.slice(0,c.posicao).split('\n').length}))};
 dependencias.push(detalhe);
 if (!valida) faltas.push(detalhe);
}
const resultado = {aprovado:faltas.length===0,arquivo,sha256:crypto.createHash('sha256').update(sql).digest('hex'),sqlExecutado:false,fksVerificadas:fks.length,falhas:faltas,dependencias};
console.log(JSON.stringify(resultado,null,2));
process.exitCode=faltas.length?1:0;
