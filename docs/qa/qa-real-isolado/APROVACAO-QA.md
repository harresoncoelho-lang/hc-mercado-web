# Aprovação separada das contas QA — não executada

O coordenador confirmou no QA os usuários A `258eddfe-d761-4ec9-ae63-ee5e5b8db408` e B `c29e43cf-9d01-4171-bcd3-3fadf0e99fde`, e-mails `operador-a@qa.invalid` e `operador-b@qa.invalid`, ambos confirmados, clientes pendentes. O seed permanece exigindo aprovação; nenhum gate foi relaxado.

Após revisão, executar `APROVAR-CLIENTES-QA.sql` exclusivamente no projeto `luguscapasskcsficckf`, previamente conferido na URL. Script exige vínculo e-mail/UUID exato, confirmação Auth, ausência de organizações/membros e dois status pendentes. Bloqueia as linhas dos clientes, fotografa status/aprovado_em/aprovado_por e muda somente status para aprovado. Não inventa aprovado_por, não altera Auth, senha, grants ou outro cliente. Se trigger alterar campos fotografados, a transação falha.

Salvar saída `baselineReversao` integral em evidência da rodada, mais horário e hash do script, antes de criar fixtures. O ato é exclusivamente aprovação técnica de QA, não aprovação comercial; campos de auditoria anteriores são preservados, e o registro externo documenta o ato.

`REVERTER-APROVACAO-QA.sql` nasce bloqueado com array vazio. Depois da limpeza operacional restrita, preencher somente o JSON com a baseline real salva, revisar diff/hash e executar sob autorização da coordenação. Compara estado corrente ao estado esperado após aprovação antes de restaurar os três campos originais, com cast pelo tipo real da tabela. Divergência impede sobrescrita. Sem DELETE, sem remoção de Auth/cliente, sem reaproveitar baseline de outra rodada. O artefato de baseline precisa permanecer confiável; não é assinatura digital.

Esses scripts não demonstram login ou acesso HTTP, não instalam a RPC de escala e não confirmam identificação sem arquivo. Senha continua fora do chat. Conferir triggers reais antes de executar; nenhuma execução SQL foi feita nesta preparação.
