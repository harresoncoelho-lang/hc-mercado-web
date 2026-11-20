/* global document, window, fetch */
(function () {
  'use strict';
  const opcao = document.getElementById('solicitar-decisao-cliente'), status = document.getElementById('decisao-cliente-status');
  fetch('/api/decisao-oportunidade').then(r => r.json()).then(r => {
    opcao.disabled = !r.habilitada;
    status.textContent = r.habilitada ? 'O destinatário confirma em uma página. Válido por 7 dias.' : 'Confirmação do cliente aguardando ativação. O envio habitual do resumo continua disponível.';
  }).catch(() => { status.textContent = 'Confirmação indisponível. Você pode enviar o resumo normalmente.'; });
  document.getElementById('decisoes-clientes-atualizar').addEventListener('click', async ev => {
    const botao = ev.currentTarget, lista = document.getElementById('decisoes-clientes-lista');
    botao.disabled = true; lista.textContent = 'Consultando respostas…';
    try {
      const { data } = await window.__sbClient.auth.getSession();
      const r = await fetch('/api/decisao-oportunidade',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session?.access_token || ''}`},body:JSON.stringify({acao:'listar'})});
      const dados = await r.json();
      if (!r.ok) throw Error(dados.erro || 'Não foi possível consultar as respostas.');
      lista.replaceChildren();
      for (const d of dados.decisoes || []) {
        const item = document.createElement('p');
        const decisao = d.decisao === 'participar' ? 'Quer participar' : d.decisao === 'nao_participar' ? 'Não quer participar' : d.envio_status === 'falhou' ? 'Envio recusado' : d.envio_status !== 'enviado' ? 'Envio não confirmado — confira antes de reenviar' : new Date(d.expira_em) < new Date() ? 'Link expirado' : 'Aguardando resposta';
        item.textContent = `${d.empresa_nome} · ${d.edital} · ${d.destinatario} — ${decisao}${d.respondido_em ? ` · ${d.nome_declarado}, ${new Date(d.respondido_em).toLocaleString('pt-BR')}` : ''}`;
        lista.append(item);
      }
      if (!lista.children.length) lista.textContent = 'Nenhuma solicitação enviada ainda.';
    } catch (e) { lista.textContent = e.message; }
    finally { botao.disabled = false; }
  });
})();
