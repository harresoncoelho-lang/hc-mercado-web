# Plano executável — ponte documental da versão selecionada

Estado: proposta técnica, sem implementação, ativação, SQL ou provedor. Complementa a mesma jornada de anexos/revisão; não cria outro produto ou chat. `validateGroundedAnswer` legado permanece exigindo sua situação documental atual, sem converter seleção técnica em vigência.

## Contrato e escopo

Entrada nova explícita: `validateSelectedAnnexAnswer(context, selectors, candidate, trustedReader)`. Contexto de sessão/carteira é fornecido pelo host confiável; seletores identificam empresa/CNPJ/processo/anexo. O candidato não pode enviar contexto, fontes, estados de revisão ou função de leitura.

`trustedReader` é uma dependência servidor→handler já autenticada, somente para `acao: consultar`, com sessão fixada pelo host. Não recebe/encaminha ações ler/selecionar ou URL arbitrária. Usar `criarHandler` de `netlify/functions/anexos-evidencias.js`, aproveitando contexto derivado do banco, hash recalculado, RLS, autenticação e escopo revalidados. Não importar `_auth` nem conectar implicitamente um destino. Esta dependência não é apresentada como autenticação implementada: composição real permanece no host autorizado.

Resultado novo: `validada_estruturalmente_na_versao_selecionada`, com `vigenciaJuridicaComprovada:false`, `veracidadeVerificada:false`, hash e escopo da versão selecionada. Sem seleção, divergência, revogação ou leitura parcial: bloqueada/insuficiente, sem afirmações.

## Arquivos e tarefas (quatro arquivos; quinto somente se extração de teste necessária)

1. **`netlify/functions/anexos-evidencias.js` — fortalecer fechamento de consultar.** Depois de reler os bytes, reler registro da versão atual com filtros completos e comparar hash, extrator, páginas e estado selecionada com a primeira leitura. Negar se a seleção mudar durante a consulta. Revalidar Auth/escopo no fechamento como hoje. Isso não cria snapshot transacional: remoção/reseleção idêntica entre observações pode não ser detectada; não alegar detecção de todo evento intermediário. Nenhuma mudança de SQL ou grant.
2. **`integracao-ia/grounded-answer.mjs` — entrada específica e reúso estrutural.** Manter export/retorno/fixtures do legado intactos. Acrescentar `validateSelectedAnnexAnswer(context, selectors, candidate, trustedReader)`, com referências internas tipadas e flags falsas de vigência/veracidade. Chamar o helper de autorização compartilhado antes do reader, realizar duas consultas e validar referências, revalidar o snapshot autorizado depois do último await e somente então retornar. Não usar `executeRead` com registros vazios nem fabricar URL. A validação de resposta documental é explícita nessa entrada; autorização não é duplicada.
3. **`integracao-ia/core.mjs` — helpers mínimos compartilhados.** Exportar `authorizeSelectedAnnexRead(context, selectors)` e `revalidateAuthorizedRead(context, snapshot)`. O primeiro usa `authorizedContext(context, 'documentos:read')` e a validação existente de seletores de empresa/CNPJ/processo/documento para construir snapshot imutável: `{scopeName, usuarioId, organizacaoId, empresas, empresaId, cnpj, processoId, documentoId}`. Rejeitar propriedades extras/acessores, exigir IDs e carteira, copiar primitivas e congelar arrays/objetos. O segundo reutiliza a checagem atual de contexto pós-await: ativo, scope, identidade e carteira atuais precisam coincidir com snapshot. Refatorar `executeRead` para compartilhar somente essa checagem final, preservando seu resultado/erros, filtros e seleção. Não alterar `safeSource`, `TOOLS` legadas ou aceitação HTTPS. Referência interna existe exclusivamente na nova entrada documental; não passa pela projeção genérica. Testes de regressão do core e legado devem provar preservação.
4. **`integracao-ia/selected-annex.test.mjs` — integração da ponte.** Incluir aqui também as regressões do handler para seleção alterada com bytes constantes, sem precisar editar um quinto arquivo. Criar fixtures em memória dentro do teste, utilizando PDF fictício real existente e `criarHandler` com doubles REST/Storage; sem novo banco, usuário, arquivo privado ou serviço. Instanciar leitor confiável que executa somente consultar. Verificar percurso registro→seleção→consulta→ponte e todos os bloqueios abaixo. Não mockar o resultado final da ponte nem substituir PDF por texto fixo no teste de percurso.

## Referências internas: contrato distinto, não URL inventada

Referência candidata: `{tipo:'anexo_interno',anexoId,versaoHash,pagina,inicio,fim}`. `inicio/fim` são offsets explícitos no texto da página extraída da versão; limites inteiros e intervalo não vazio. Texto referenciado deve corresponder ao trecho recuperado, sem aceitação de caminho Storage, signed URL, UUID de outra empresa ou `https://` inventado. Esses identificadores não concedem acesso: abrir a fonte continua exigindo a ação de arquivo autenticada existente. Não chamar a referência de link funcional enquanto não houver ligação da UI de resposta à abertura do anexo.

A ponte valida a existência estrutural da página/intervalo na versão selecionada. Não comprova que a afirmação deriva semanticamente do trecho, que uma recomendação está correta ou que não existe retificação externa.

A nova entrada documental específica usa o contrato já limitado do anexo (até20 páginas/150mil caracteres) e valida até20 afirmações, até10 referências por afirmação, cada intervalo até4mil caracteres. Nenhum corte do PDF ou busca que esconda páginas. Se limites do handler forem excedidos, ele falha e a ponte não aceita conclusão. Esse formato é específico da versão selecionada, sem substituir o contrato legado de evidências paginadas.

## Fechamento contra alterações durante a validação

Executar consultar inicialmente; exigir contexto estritamente igual ao autorizado, versão/hash coerentes, `selecionada===true`, páginas completas e forma válida. Validar referências contra esses dados. Executar consultar novamente ao concluir e comparar contexto/hash/extrator/páginas/seleção. Se falhar ou mudar, descartar candidato. Chamar explicitamente `revalidateAuthorizedRead(context, snapshot)` após a segunda consulta e todas as comparações, sem await posterior antes da resposta. Não retornar dados/candidato antes desse fechamento.

Comparação dupla detecta alterações observadas entre leituras; não promete transação conjunta Storage/Postgres nem detecta toda troca ABA. Se exigida identidade do evento de seleção, será necessário retorno de selecionada_em/selecionada_por e contrato versionado separado; este incremento não afirma essa propriedade.

## TDD e critérios bloqueantes

Escrever primeiro testes que falham pelos gaps atuais, implementar mínimo, executar suite legado e nova:

- Legado `validateGroundedAnswer` mantém todos os casos/status; seleção técnica NÃO passa como vigente.
- PDF fictício real: SHA256 dos bytes, página e intervalo reais; resposta válida preserva distinção exigência/recomendação e duas flags falsas.
- CNPJ/empresa/processo/anexo errados negados antes de download; modelo não fornece contexto/scopes/estado.
- Fonte externa, referência de outro anexo/hash, página inexistente, intervalo fora da página/invertido e ID extra recusados.
- Versão não selecionada e troca da seleção com bytes iguais bloqueiam. Hash/bytes alterados e sessão revogada no fechamento bloqueiam.
- Texto hostil no PDF permanece dado; nenhum conteúdo dispara ferramenta/rede/mudança de destinatário. Não alegar imunidade semântica a prompt injection.
- Limites de páginas/bytes/intervalos/afirmações falham sem truncamento. Falha do reader não devolve candidato nem detalhes de transporte.
- Reader observa exclusivamente `consultar`; nenhuma escrita RPC, provider, SMTP ou publicação.

Bloqueia implementação: necessidade de enfraquecer fonte HTTPS do legado, fingir vigente, duplicar auth, inventar metadado, ativar host/SQL para testar ou aceitar candidate como autoridade. O novo ramo documental deve manter autorização única pelos helpers do core; qualquer necessidade de mudar o comportamento das ferramentas existentes exige revisar o plano antes de codar. Não utilizar envelopes fictícios como atalhos de segurança.

## Validação e entrega

Testes locais com PDF/doubles comprovam composição e limites; não são homologação Auth/RLS/Storage/UX. Revisão independente do delta obrigatória antes de integração no host. Não ativar endpoint, ambiente, provedor ou custos. O resultado comercial permanece leitura da versão selecionada, sem parecer jurídico ou garantia de edital vigente.
