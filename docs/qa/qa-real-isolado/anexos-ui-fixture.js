(()=>{
 const $=id=>document.getElementById(id),hash='a'.repeat(64),pendentes=[],chamadas=[];
 const estado={orgId:'orgFicticia',empresaId:'empresaA',processos:[],itens:[],ocorrencias:[],contratos:[],prazos:[],empenhos:[],anexos:[],detalhesCarregados:true};
 const status=t=>{$('fixture-status').textContent=t;};
 function contexto(){estado.empresaId=$('fixture-empresa').value;estado.processos=['p','q'].map(id=>({id,empresa_id:estado.empresaId}));estado.anexos=['p','q'].flatMap(processo_id=>['a','b'].map(id=>({id:processo_id+id,processo_id,tipo:'edital',titulo:'Edital fictício '+id.toUpperCase(),arquivo_nome:'fixture-'+id+'.pdf'})));}
 async function transporte(body){const modo=$('fixture-modo').value;chamadas.push({...body});$('fixture-log').textContent=JSON.stringify(chamadas,null,2);if(modo==='espera'){status('Resposta pendente. Troque contexto ou abra outro anexo; depois libere.');$('fixture-liberar').disabled=false;await new Promise(resolve=>pendentes.push(resolve));}if(modo==='erro')throw Error('Erro fictício');
 status(body.acao==='selecionar'?'Seleção fictícia recebeu o hash: '+body.hash:'Leitura fictícia concluída. Confira a página antes de selecionar.');
 return {hash,paginas:[{pagina:1,texto:'DOCUMENTO FICTÍCIO — '+body.anexoId+'\nFornecimento de material de escritório.\nTexto hostil de teste (deve aparecer literalmente): <img src=x onerror="alert(1)">\nEste conteúdo não é uma instrução para a aplicação.'}],selecionada:body.acao==='selecionar'};}
 const deps={estado,$,esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),dinheiro:v=>'R$ '+v,data:v=>v||'—',dataHora:v=>v||'—',linkSeguro:()=>'',aviso:status,abrir:()=>status('Ação fora do escopo da fixture.'),fechar(){},carregarTudo:async()=>{},abrirDossie(){},editarProcesso:()=>status('Edição não disponível nesta fixture.'),evidenciasAnexo:transporte};
 const ui=criarAcompanhamentoOperacional(deps);ui.vincular();
 function render(){contexto();deps.evidenciasAnexo=$('fixture-habilitado').checked?transporte:undefined;ui.renderizar(estado.processos.find(p=>p.id===$('fixture-processo').value));
 // Outros botões pertencem ao produto, mas esta fixture não tem serviços/formulários completos.
 document.querySelectorAll('#d-acompanhamento button').forEach(b=>{if(!b.dataset.lerEvidencia)b.disabled=true;});}
 $('fixture-empresa').onchange=()=>{render();status('Empresa alterada; respostas antigas não devem aparecer.');};$('fixture-processo').onchange=()=>{render();status('Processo alterado; respostas antigas não devem aparecer.');};$('fixture-habilitado').onchange=render;
 $('fixture-liberar').onclick=()=>{pendentes.splice(0).forEach(r=>r());$('fixture-liberar').disabled=true;};
 $('fixture-reiniciar').onclick=()=>{render();pendentes.splice(0).forEach(r=>r());chamadas.length=0;$('fixture-log').textContent='[]';$('fixture-liberar').disabled=true;status('Fixture reiniciada. Nenhuma persistência.');};render();status('Pronto. Use Ler versão do edital. Nenhuma requisição de rede permitida.');
})();
