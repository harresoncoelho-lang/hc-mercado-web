(()=>{
 const form=document.getElementById('qa-ia'),out=document.getElementById('qa-ia-resultado'),next=document.getElementById('qa-ia-proxima');let offset=0,proximo=null,version=0;
 function limpar(){version++;offset=0;proximo=null;next.disabled=true;out.textContent='Consulta não realizada.';}
 async function consultar(){const current=++version;out.textContent='Consultando carteira autorizada…';next.disabled=true;
  try{const r=await fetch('/api/ia-leitura',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ferramenta:'listar_empresas_autorizadas',organizacaoId:form.elements.organizacao.value,limit:20,offset})});const data=await r.json();if(current!==version)return;
   if(!r.ok){out.textContent='Consulta indisponível ou acesso recusado.';proximo=null;return;}
   out.textContent=JSON.stringify(data,null,2);proximo=data.nextOffset??null;next.disabled=proximo===null;
  }catch{if(current===version)out.textContent='Teste de integração indisponível.';}
 }
 form.onsubmit=e=>{e.preventDefault();offset=0;consultar();};next.onclick=()=>{if(proximo!==null){offset=proximo;consultar();}};
 form.elements.organizacao.onchange=limpar;document.getElementById('cenario').addEventListener('change',limpar);document.getElementById('qa-login').addEventListener('submit',limpar);document.getElementById('fechar').addEventListener('click',limpar);limpar();
})();
