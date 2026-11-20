const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const sql=fs.readFileSync(path.join(__dirname,'ENSAIO-ESCALA-ROLLBACK.sql'),'utf8');
const manifesto=JSON.parse(fs.readFileSync(path.join(__dirname,'ENSAIO-ESCALA-manifesto.json')));
test('pacote único conserva fontes e hashes sem COMMIT/NOTIFY internos',()=>{
 assert.equal(createHash('sha256').update(sql).digest('hex'),manifesto.sha256);
 assert.equal(manifesto.executado,false);assert.equal(manifesto.destino,'luguscapasskcsficckf');
 assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^rollback;$/gm)||[]).length,1);
 assert.doesNotMatch(sql,/^(?:commit;|notify |create temp )/m);
 for(const [i,f] of manifesto.fontes.entries()){
  let original=fs.readFileSync(path.join(root,f.arquivo),'utf8').replaceAll('\r\n','\n');
  assert.equal(createHash('sha256').update(original).digest('hex'),f.sha256);
  original=original.replace(/^begin;\n/m,'');
  original=i===0?original.replace(/commit;\nnotify pgrst,'reload schema';\s*$/,''):original.replace(/^rollback;\n?/m,'');
  assert.ok(sql.includes(`execute $fonte${i}$\n${original}\n$fonte${i}$;`));
 }
});
test('gates, rollback reservado e prova posterior têm ordem explícita',()=>{
 assert.match(sql,/64c94369bded0ca5721959406a8d5434/);assert.match(sql,/postgres=X\/postgres,service_role=X\/postgres/);
 const inicio=sql.indexOf('execute $fonte0$'),ultimo=sql.indexOf('$fonte2$;'),flag=sql.indexOf('gates:=true;'),catchAt=sql.indexOf("exception when sqlstate 'ZQ001'"),prova=sql.indexOf('Definição/permissões não restauradas');
 assert.ok(inicio<ultimo&&ultimo<flag&&flag<catchAt&&catchAt<prova);
 assert.match(sql,/if not gates then raise;end if;/);assert.doesNotMatch(sql,/exception when others/i);
 assert.match(sql,/jsonb_to_recordset\(baseline\)/);assert.match(sql,/is_called::text/);
 assert.ok(sql.lastIndexOf('rollback;')>sql.indexOf("select 'QA_ESCALA_GATES_E_ROLLBACK_OK'"));
});
test('negativo 1001 tem unidades correspondentes, sem herdar item estrangeiro',()=>{
 const inicio=sql.indexOf('select jsonb_agg(id::text) into ids from public.operacao_itens_resultado where processo_id=pa;');
 assert.ok(inicio>0);
 const trecho=sql.slice(inicio,sql.indexOf('end $$;',inicio));
 assert.match(trecho,/dados:=jsonb_set\(dados,'\{proposta,itemIds\}',ids\);/);
 assert.match(trecho,/dados:=jsonb_set\(dados,'\{proposta,unidades\}',\(select jsonb_object_agg\(i,'un'\) from jsonb_array_elements_text\(ids\)s\(i\)\)\);/);
 assert.ok(trecho.indexOf("'{proposta,unidades}'")<trecho.indexOf('perform public.gravar_kit_documento'));
 assert.doesNotMatch(trecho,/jsonb_build_object\(estranho/);
 assert.match(trecho,/count\(distinct i\)/);
 assert.match(trecho,/if sqlerrm<>'Itens duplicados ou excessivos' then raise;end if;/);
});
