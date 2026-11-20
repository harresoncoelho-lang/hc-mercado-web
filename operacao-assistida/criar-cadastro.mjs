import { propostaParaLote } from './proposta-para-lote.mjs';
import { criarMotor } from '../motor-cadastro/motor.mjs';

// confiavel vem do coordenador servidor, nunca da proposta recebida do cliente.
// Porta/relógio são dependências confiáveis de simulação, não adaptadores do portal.
export function criarCadastro(abertura, snapshotPortal, confiavel, porta, agora) {
  const lote = propostaParaLote(abertura, snapshotPortal, confiavel);
  if (!lote.valido) return { lote, motor: null, writeAuthorized: false };
  const linhas = lote.lote.itens.map(item => {
    const linha = { id: item.id, quantidade: item.quantidade, unitario: item.unitario };
    for (const campo of ['marca', 'modelo', 'fabricante']) {
      if (item[campo] !== null && item[campo] !== undefined) linha[campo] = item[campo];
    }
    return linha;
  });
  try {
    const motor = criarMotor({ contexto: lote.contexto, versao: lote.versao,
      catalogo: confiavel.catalogo, linhas }, porta, agora);
    return { lote, motor, writeAuthorized: false };
  } catch {
    return { lote, motor: null, motivo: 'contrato_motor', writeAuthorized: false };
  }
}
