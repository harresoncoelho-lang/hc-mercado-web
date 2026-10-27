/* global document, location, history, fetch, URLSearchParams */
(function () {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1)), token = params.get('token');
  history.replaceState(null,'',location.pathname);
  const form = document.getElementById('decisao'), mensagem = document.getElementById('mensagem');
  async function consultar(dados) {
    const r = await fetch('/api/decisao-oportunidade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...dados})});
    const resposta = await r.json();
    if (!r.ok) throw Error(resposta.erro || 'Não foi possível registrar. Tente novamente.');
    return resposta;
  }
  function mostrar(r) {
    document.getElementById('contexto').hidden = false;
    document.getElementById('empresa').textContent = `${r.empresa} · CNPJ ${r.cnpj}`;
    document.getElementById('edital').textContent = `Licitação ${r.edital}`;
    document.getElementById('objeto').textContent = r.objeto;
    document.getElementById('validade').textContent = `Link válido até ${new Date(r.expiraEm).toLocaleString('pt-BR')}.`;
    form.hidden = !!r.decisao;
    mensagem.textContent = r.decisao ? `Decisão registrada: ${r.decisao === 'participar' ? 'quero participar' : 'não quero participar'}. Seu assessor já pode consultar sua resposta.` : 'Confira os dados abaixo antes de confirmar.';
  }
  if (!/^[a-f0-9]{64}$/.test(token || '')) { mensagem.textContent = 'Link inválido. Peça um novo envio ao assessor.'; return; }
  const escolha = params.get('escolha');
  if (['participar','nao_participar'].includes(escolha)) form.querySelector(`[value="${escolha}"]`).checked = true;
  consultar({acao:'consultar'}).then(mostrar).catch(e => { mensagem.textContent = e.message; });
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const botao = document.getElementById('confirmar'); botao.disabled = true;
    try { mostrar(await consultar({acao:'confirmar',decisao:form.querySelector('[name=escolha]:checked')?.value,nome:document.getElementById('nome').value.trim(),confirmado:document.getElementById('revisado').checked})); }
    catch (e) { mensagem.textContent = e.message; }
    finally { botao.disabled = false; }
  });
})();
