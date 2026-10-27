/* global module */
(function (raiz) {
  'use strict';
  const emailValido = v => typeof v === 'string' && v.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);
  const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function criarAgenda(storage) {
    const chave = usuario => `lp-contatos-resumo-v1:${usuario}`;
    function ler(usuario) {
      if (!usuario) return [];
      try {
        const dados = JSON.parse(storage.getItem(chave(usuario)) || '[]');
        return Array.isArray(dados) ? dados.filter(c => c && emailValido(c.email) && typeof c.nome === 'string').slice(0,200) : [];
      } catch { return []; }
    }
    function gravar(usuario, lista) {
      if (!usuario) return false;
      try { storage.setItem(chave(usuario), JSON.stringify(lista.slice(0,200))); return true; } catch { return false; }
    }
    return {
      buscar(usuario, termo) { return ler(usuario).filter(c => normalizar(`${c.nome} ${c.email}`).includes(normalizar(termo))); },
      salvar(usuario, destinos, nome) {
        const emails = [...new Set(String(destinos || '').split(/[;,]/).map(e => e.trim().toLowerCase()).filter(Boolean))];
        if (!emails.length || emails.some(e => !emailValido(e))) return false;
        const antes = ler(usuario);
        const novos = emails.map(email => ({ email, nome: emails.length === 1 && String(nome || '').trim() ? String(nome).trim().slice(0,100) : antes.find(c => c.email === email)?.nome || '' }));
        return gravar(usuario, [...novos, ...antes.filter(c => !emails.includes(c.email))]);
      },
      remover(usuario, email) { return gravar(usuario, ler(usuario).filter(c => c.email !== email)); },
    };
  }
  const api = { criarAgenda };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  const doc = raiz.document, busca = doc.getElementById('contatos-resumo-busca'), lista = doc.getElementById('contatos-resumo-lista');
  let storage;
  try { storage = raiz.localStorage; } catch { storage = null; }
  const agenda = criarAgenda(storage);
  function atualizar() {
    lista.replaceChildren();
    const contatos = agenda.buscar(raiz.__clienteIdAtual, busca.value).slice(0,8);
    for (const contato of contatos) {
      const linha = doc.createElement('div'), usar = doc.createElement('button'), remover = doc.createElement('button');
      usar.type = remover.type = 'button';
      usar.textContent = contato.nome ? `${contato.nome} — ${contato.email}` : contato.email;
      usar.addEventListener('click', () => {
        const destino = doc.getElementById('modal-enviar-resumo-destino');
        const emails = destino.value.split(/[;,]/).map(e => e.trim().toLowerCase()).filter(Boolean);
        if (!emails.includes(contato.email)) emails.push(contato.email);
        destino.value = emails.join(', ');
        doc.getElementById('modal-enviar-resumo-nome').value = emails.length === 1 ? contato.nome : '';
        destino.focus();
      });
      remover.textContent = 'Remover';
      remover.setAttribute('aria-label', `Remover contato ${contato.nome || contato.email}`);
      remover.addEventListener('click', () => { agenda.remover(raiz.__clienteIdAtual,contato.email); atualizar(); });
      linha.append(usar,remover); lista.append(linha);
    }
    if (!contatos.length) lista.textContent = 'Nenhum contato salvo encontrado.';
  }
  busca.addEventListener('input', atualizar);
  busca.addEventListener('focus', atualizar);
  api.registrarEnvio = ({usuarioId,destinos,nome}) => {
    const salvo = agenda.salvar(usuarioId,destinos,nome);
    if (usuarioId === raiz.__clienteIdAtual) atualizar();
    return salvo;
  };
  api.atualizar = () => { busca.value = ''; atualizar(); };
  raiz.ContatosResumo = api;
})(globalThis);
