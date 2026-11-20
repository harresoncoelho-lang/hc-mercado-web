const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'FIXTURES-AUTH-UI.sql'),'utf8');
test('seed exige duas contas aprovadas e recusa conflito sem alterar Auth/clientes',()=>{
 assert.match(sql,/operador-a@qa\.invalid/);assert.match(sql,/operador-b@qa\.invalid/);
 assert.match(sql,/email_confirmed_at is not null/);assert.match(sql,/status='aprovado'/);
 assert.doesNotMatch(sql,/(?:insert into|update|delete from)\s+(?:auth\.|public\.clientes)/i);
 assert.doesNotMatch(sql,/on conflict|create or replace|delete from|truncate/i);
 assert.ok(sql.indexOf('Fixtures ou organização preexistentes')<sql.indexOf('insert into public.operacao_organizacoes'));
});
test('fixture 51+200 registra baseline, sem confirmação falsa ou Storage SQL',()=>{
 assert.match(sql,/generate_series\(1,51\)/);assert.match(sql,/generate_series\(1,200\)/);
 assert.match(sql,/count_md5/);assert.match(sql,/FIXTURES_QA_CRIADAS_IDENTIFICACAO_PENDENTE/);
 assert.doesNotMatch(sql,/(?:insert into|update)\s+(?:public\.operacao_identificacao_empresa|storage\.)/i);
 assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
});
