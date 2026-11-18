import { validarLote } from '../extensao-leitura/prevalidacao-lote.mjs';
import { validateContext } from '../extensao-leitura/adapter.mjs';

const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const context = x => x && Object.fromEntries(['cnpj', 'uasg', 'number', 'year', 'purchaseId'].map(k => [k, x[k]]));

// Porta exclusivamente fictícia. Nenhum transporte ou autorização de portal.
export function criarMotor({ contexto, versao, catalogo, linhas }, porta, agora) {
  const lote = validarLote(catalogo, linhas);
  const ctx = context(contexto);
  if (!lote.valido || lote.requerRevisaoPrecisao || !Number.isSafeInteger(versao) || versao < 1
    || validateContext(null, ctx).status === 'esperado_invalido'
    || porta?.tipo !== 'ficticia' || typeof agora !== 'function'
    || ['lerPagina', 'aplicar', 'conciliar'].some(k => typeof porta[k] !== 'function')) throw Error('Contrato inválido');
  const itens = clone(lote.itens);
  const vinculo = JSON.stringify({ contexto: ctx, versao, itens });
  const confirmados = new Set(); const autorizacoes = new Set();
  let auth = null, busy = false, pendente = null, estado = 'pausado', ultimoTempo = -1;
  function tempo() {
    const n = agora();
    if (!Number.isSafeInteger(n) || n < ultimoTempo) { auth = null; estado = 'relogio_invalido'; return null; }
    ultimoTempo = n; return n;
  }
  function autorizado() {
    const n = tempo();
    if (n === null || !auth) return false;
    if (n >= auth.expiraEm) { auth = null; estado = 'expirado'; return false; }
    return estado === 'ativo';
  }
  function observar(observado) {
    if (!same(context(observado), ctx)) { auth = null; estado = 'contexto_alterado'; return false; }
    return true;
  }
  function status() { return { estado, confirmados: [...confirmados], pendente: clone(pendente), ocupado: busy, writeAuthorized: false }; }
  function confirmar(resposta, comando) {
    return resposta?.status === 'aplicado' && same(resposta.comando, comando);
  }
  return {
    vinculo,
    status,
    autorizar(a) {
      const n = tempo();
      if (busy || pendente || n === null || !a || typeof a.id !== 'string' || !a.id || autorizacoes.has(a.id)
        || a.vinculo !== vinculo || !Number.isSafeInteger(a.expiraEm) || a.expiraEm <= n) return false;
      autorizacoes.add(a.id); auth = clone(a); estado = 'ativo'; return true;
    },
    pausar() { auth = null; estado = 'pausado'; },
    revogar() { auth = null; estado = 'revogado'; },
    observarContexto: observar,
    async executar() {
      if (busy || pendente || !autorizado()) return status();
      busy = true;
      const vistos = new Set(), cursores = new Set(); let cursor = null;
      try {
        // Identidade do lote, não assinatura nem autorização. Web Crypto mantém o motor portátil.
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(vinculo));
        const loteId = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
        while (autorizado()) {
          const chave = JSON.stringify(cursor);
          if (cursores.has(chave)) throw Error('Paginação repetida');
          cursores.add(chave);
          const pagina = await porta.lerPagina({ contexto: clone(ctx), cursor });
          if (!autorizado() || !observar(pagina?.contexto)) break;
          if (!Array.isArray(pagina.ids) || pagina.ids.length > 10 || !pagina.ids.length
            || pagina.ids.some(id => typeof id !== 'string' || vistos.has(id))
            || new Set(pagina.ids).size !== pagina.ids.length
            || !(pagina.proximo === null || typeof pagina.proximo === 'string' && pagina.proximo)) throw Error('Página inválida');
          for (const id of pagina.ids) vistos.add(id);
          for (const id of pagina.ids) {
            const item = itens.find(x => x.id === id);
            if (!item || confirmados.has(id)) continue;
            if (!autorizado()) break;
            const comando = { id: `cadastro-v1:${loteId}:${id}`, contexto: clone(ctx), versao, item: clone(item) };
            pendente = comando;
            let resposta;
            try { resposta = await porta.aplicar(clone(comando)); } catch { estado = 'incerto'; auth = null; return status(); }
            if (confirmar(resposta, comando)) { confirmados.add(id); pendente = null; }
            else if (resposta?.status === 'rejeitado' && same(resposta.comando, comando)) {
              pendente = null; auth = null; estado = 'rejeitado'; return status();
            } else { auth = null; estado = 'incerto'; return status(); }
          }
          if (!autorizado()) break;
          if (pagina.proximo === null) {
            if (itens.some(x => !vistos.has(x.id))) throw Error('Itens ausentes na fonte');
            estado = 'concluido'; auth = null; break;
          }
          cursor = pagina.proximo;
        }
      } catch { auth = null; estado = 'fonte_invalida'; }
      finally { busy = false; }
      return status();
    },
    async reconciliar() {
      if (busy || !pendente) return status();
      busy = true; auth = null;
      try {
        const resultado = await porta.conciliar(clone(pendente));
        if (confirmar(resultado, pendente)) { confirmados.add(pendente.item.id); pendente = null; estado = 'pausado'; }
        else if (resultado?.status === 'nao_aplicado' && same(resultado.comando, pendente)) { pendente = null; estado = 'pausado'; }
        else estado = 'incerto';
      } catch { estado = 'incerto'; }
      finally { busy = false; }
      return status();
    },
  };
}
