# Origem oficial e preparação operacional — diagnóstico de ligação

## Estado atual — 02/11/2026

A recomendação histórica de criar a importação rastreável PNCP foi atendida no código local: `netlify/functions/importar-item-pncp.js`, `supabase/importacao_item_pncp.sql`, ação integrada em `processos.html` e `scripts/importacao_pncp.test.js`. Não criar segunda importação. Isso não comprova, por si, migração aplicada, coleta real ou publicação em produção; cada estado precisa da evidência de homologação correspondente.

O kit também já possui `prepararOperacao` autenticado, revalidação de revisão e bloqueio explícito enquanto `carregarEvidenciaPortal` não tiver produtor confiável. Persistência PNCP não equivale a catálogo/mapeamento Compras.gov. O próximo bloqueio é o contrato DOM do cabeçalho real do fornecedor, CAPTCHA com itens antigos e, depois, canal autenticado/vínculo/catalogo do portal; veja `PLANO-PONTE-PROPOSTA-EXTENSAO.md`. Não inferir IDportal de número PNCP nem promover captura do cliente a evidência oficial.

## Diagnóstico histórico preservado — 01/11/2026


01/11/2026. Inspeção somente de arquivos, sem rede, produção ou alteração de código.

## Conclusão

Há consulta de itens PNCP e preenchimento assistido do cadastro interno. **Não há persistência comprovada de catálogo oficial versionado nem mapeamento confiável UUID interno → ID de item Compras.gov.** O número visível do item PNCP não prova identidade no Compras.gov. Acrescentar botão chamando `criarCadastro` com os dados atuais daria falsa impressão de integração pronta.

## O que existe de fato

- `processos.html:93–115`: extrai referência PNCP do link do processo usando `LicitaOperacaoEdital.idPncp`, consulta `/api/pncp-itens` página100 e mantém páginas em Maps do navegador. Isso não persiste origem/versionamento no banco.
- `processos.html:283–295`: “Registrar resultado” copia número, descrição (cortada em500) e quantidade para formulário editável. Não copia identificação canônica, hash ou versão da fonte; ainda não é importação autenticada de catálogo.
- `operacao-acompanhamento-ui.js:100–121`: salvarItem grava diretamente via cliente Supabase `identificador`, descrição, quantidade, preços ofertados, marca/modelo, `fonte_oficial` e atualizado_em. Identificador e URL são editáveis. Nenhum desses campos pode ser elevado a evidência oficial pelo servidor.
- `netlify/functions/pncp-itens.js`: proxy público consulta domínio fixo PNCP, mapeia `numeroItem` para `numero`, quantidades/unidade e demais características. Não devolve hash/origem/versionamento/completude certificada; paginação deduplica números e infere próxima pela quantidade100. Modo legado tem teto20 páginas e pode interromper em erro sem comprovar coleção completa. Não reutilizar sua resposta como certificado de catálogo completo.
- `supabase/operacao_acompanhamento.sql:5–6`: adiciona `sistema` e `uasg` ao processo, mas são textos do formulário. Schema de `operacao_processos` também tem `numero`, `url_origem` e atualizado_em; não há purchaseId canônico verificado nem vínculo portal versionado.
- `operacao_itens_resultado`: UUID interno, organização/processo, identificador textual, tipo item/lote, quantidade numeric(15,3), marca/modelo, unitário numeric(15,2), fonte_oficial textual e atualizado_em. Não possui grupo oficial, exigências por campo, fabricante separado, unidade oficial persistida, versão/hash de catálogo ou identificador de item Compras.gov.
- `operacao-assistida/proposta-para-lote.mjs`: já consome abertura real do kit, recalcula hash e exige `confiavel.vinculo`, `catalogo`, `mapeamento`. Esse é o ponto de chamada a reutilizar; seus argumentos confiáveis ainda não têm produtor real.
- `operacao-assistida/criar-cadastro.mjs`: compõe adaptador e motor, mantendo `writeAuthorized:false`; não é transporte de portal.
- `extensao-leitura/prevalidacao-lote.mjs`: exige catálogo com id, quantidade decimal textual, grupo explícito (null só quando comprovadamente individual) e campos exigidos. O PNCP mapeado atual não fornece esse contrato completo. Não inventar `grupo:null` ou `exigidos:[]` para fazê-lo passar.

## Menor próximo patch completo recomendado

**Primeiro fechar importação rastreável de itens PNCP no processo existente**, integrada à tela atual e à persistência; não outro núcleo puro. Em paralelo, preparação operacional deve continuar com estado “vínculo Compras.gov não verificado” até existir evidência própria do portal.

1. Criar migração local de origem vinculada ao item interno, com FK composta organização/processo/item: fonte (`pncp`), chave compraPNCP canônica, númeroItemPNCP, URL construída pelo servidor, hashSHA256 do registro bruto normalizado, hash/versão da observação, observado_em, estado (`vigente`/`alterado`/`indisponivel`). Guardar snapshot bruto necessário em armazenamento privado/versionado ou tabela apropriada com orçamento. Usuários podem ler sob RLS; gravação de proveniência somente por fluxo servidor que verifica fonte. Coluna fonte_oficial manual permanece separada.
2. Implementar ação autenticada de importar item no fluxo operacional: cliente envia apenas processoId e número do item como **seletores**. Servidor reutiliza sessão/autorização de organização/empresa/processo, deriva referência do vínculo confirmado, busca PNCP em origem fixa e confere identidade retornada. Nunca aceitar objeto de item, preço estimado como ofertado, URL arbitrária ou hash enviado pelo navegador como autoridade.
3. Persistir item interno + origem atomicamente por RPC idempotente (chave processo+PNCPcompra+PNCPitem). Não sobrescrever quantidade/descrição/oferta já revisadas silenciosamente: mudança oficial gera nova observação e pendência. Preservar preço ofertado/marca/modelo inseridos pelo operador. Após retificação, nova revisão documental obrigatória se conteúdo do kit mudar.
4. Em `processos.html`, trocar ação “Registrar resultado” de cópia solta por fluxo importação/confirmar e mostrar fonte/horário/estado. O item importado deve ficar disponível no kit existente por UUID, sem outra lista paralela. Cadastro manual continua manual e claramente identificado.
5. Adicionar preparação operacional autenticada à jornada da peça revisada, usando o contexto real do kit e `propostaParaLote`. Se origem, vínculo portal ou catálogo completo faltarem, devolver indisponibilidade específica e **nenhum lote executável**. Não expor um endpoint que aceite `confiavel` do browser. Só retornar lote quando servidor puder carregar mapeamento validado; nenhuma porta de escrita nesta etapa.

Isso entrega ganho real: fonte rastreável e importação integrada, em vez de simular ligação ao portal. Não conclui sozinho o Compras.gov.

## Campos mínimos específicos para a ligação Compras.gov posterior

Vínculo por processo/empresa/organização: portal, purchaseId, UASG, número, ano, CNPJ fornecedor; origem e momento de verificação, versão/hash da observação, estado de confirmação/revogação. Mapeamento: UUIDiteminterno + compraPortal + IDitemPortal + versão/hash catálogo, com unicidade dupla e FKs; não usar posição ou igualdade de descrição como identidade.

Catálogo observado: IDitemPortal, quantidade decimal exata, unidade, tipo/grupo e membros do grupo, campos exigidos, situação vigente, origem e evidência de completude por páginas. A leitura do portal/extensão é informação do cliente até um mecanismo autenticado verificável e sua política de confiança serem definidos; assinatura de hash local não prova fonte oficial. Se não houver API oficial server-side disponível, registrar captura como evidência observada e exigir confirmação humana de vínculo com limites explícitos, sem chamá-la de certificação independente. A autorização de preparar continua diferente de autorizar proposta/lance.

## Testes do patch integrado

- Handler com fetch PNCP falso e Auth/REST existentes simulados: selector não vira URL, crossCNPJ/processo negado antes fetch, itemresposta errado/duplicado/ausente negado, timeout/erro mantém itemanterior.
- RPC preparada e ensaio isolado: mesma origem importada duas vezes mantém UUID; alteração cria observação e não sobrescreve oferta; usuário não pode forjar status/hash; organização estrangeira recusada; transação aborta sem órfãos.
- UI real offline: importar pelo dossiê→item aparece no kit→preparar/revisar; fonte indisponível mostra pendência; campo manual não vira selo oficial.
- Preparação: proposta revisada mas apenas PNCP retorna `vinculo_portal_indisponivel`; nenhuma inferência de numeroItemPNCP para IDportal. Quando houver fixture confiável de portal, testa mapeamento trocado, versão antiga, grupo incompleto, fabricante ausente e precisão divergente usando adaptador existente.

## Decisões que não podem ser omitidas

`pncp-itens.js` serve outras telas: preservar seu contrato público e evitar alterar resumo/boletim. Extrair busca pública reutilizável somente se comportamento existente ficar intacto e testar consumidores; não usar rota pública como autoridade do objeto retornado pelo cliente. Endpoint de importação privado precisa política de cadência/budget/caches sem tráfego real nesta etapa. Aplicação de migração e fetchreal só após homologação autorizada; este diagnóstico não criou endpoints ou tabelas.
