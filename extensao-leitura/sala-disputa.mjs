// Leitor da SALA DE DISPUTA do Compras.gov.br — só a interface. NÃO IMPLEMENTADO: precisa da sala real
// (ou do ambiente de treinamento) aberta pelo dono logado, para conhecer URL, estrutura da página e mensagens.
// Regra da casa: este módulo só LÊ. Nunca clica, nunca preenche o campo de lance, nunca navega
// (mesma regra de MODO_AUTOMATICO=false em pregao-leitor.mjs). Quem envia o lance é a pessoa, no portal.
//
// Contrato quando for implementado — lerSala(documento) devolve UMA leitura por item em disputa:
//   { ok: true, observadoEm: <ms do relógio do computador>, itens: [{
//       itemId: string,            // número do item na compra (ex.: "3")
//       modo: 'aberto' | 'aberto_fechado' | 'fechado_aberto',
//       etapa: 'aberta' | 'aleatoria' | 'fechada' | 'encerrada' | 'aguardando',
//       melhorValor: '12.3400',    // "melhor valor" da tela, 4 casas, ponto decimal
//       meuValor: '12.5000',       // "meu valor"
//       situacao: 'ganhando' | 'perdendo' | 'empate',
//       tempoRestanteMs: number | null,
//     }] }
//   ou { ok: false, motivo } quando a sala não estiver legível (sessão caída, captcha, item não visível).
// Quem chama converte cada item no snapshot do cérebro (motor-lances.js, decide): leading = situacao === 'ganhando',
// bestPrice = melhorValor, ownPrice = meuValor, itemState = etapa aberta ? 'aberto' : 'fechado', session = 'ativa' só com ok.
// Leitura ausente ou ambígua bloqueia a sugestão; nunca é preenchida com palpite.

export const IMPLEMENTADO = false;
export const MOTIVO_NAO_IMPLEMENTADO = 'Leitura da sala de disputa não implementada: precisa da sala real do Compras.gov.br.';
export const MODOS = Object.freeze(['aberto', 'aberto_fechado', 'fechado_aberto']);
export const ETAPAS = Object.freeze(['aberta', 'aleatoria', 'fechada', 'encerrada', 'aguardando']);

export function lerSala(_documento) {
  return { ok: false, motivo: MOTIVO_NAO_IMPLEMENTADO };
}
