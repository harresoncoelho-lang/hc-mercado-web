const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ler=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
test('aprovação é ato restrito aos dois UUIDs comprovados, snapshot e status pendente',()=>{
 const s=ler('APROVAR-CLIENTES-QA.sql');
 for(const x of ['258eddfe-d761-4ec9-ae63-ee5e5b8db408','c29e43cf-9d01-4171-bcd3-3fadf0e99fde','operador-a@qa.invalid','operador-b@qa.invalid','email_confirmed_at','for update','baselineReversao','aprovado_em','aprovado_por'])assert.ok(s.includes(x));
 assert.match(s,/update public\.clientes set status='aprovado' where id=r\.id and status='pendente'/);
 assert.doesNotMatch(s,/(?:update|insert into|delete from)\s+auth\.|delete from|grant |alter /i);
 assert.ok(s.indexOf('Contas já possuem organização/vínculo')<s.indexOf('update public.clientes'));
});
test('reversão bloqueada por padrão, exige estado esperado e preserva usuários',()=>{
 const s=ler('REVERTER-APROVACAO-QA.sql');assert.match(s,/baseline jsonb:='\[\]'::jsonb/);
 assert.match(s,/atual is distinct from registro->'depois'/);assert.match(s,/atual is distinct from registro->'antes'/);
 assert.match(s,/Limpeza operacional pendente/);assert.match(s,/where id=id_alvo/);
 assert.doesNotMatch(s,/delete from|update\s+auth\.|insert into\s+auth\./i);
});
