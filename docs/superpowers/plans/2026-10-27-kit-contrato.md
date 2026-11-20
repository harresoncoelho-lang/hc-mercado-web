# Contrato do primeiro kit de documentos

Decisões de implementação para o fluxo aprovado. Não substitui a revisão dos modelos e das exigências de cada edital. Primeira entrega: declaração com texto informado e preenchimento de dados da empresa + proposta de materiais individualizados, geradas por processo/CNPJ. Não haverá assinatura, envio ou protocolo automático.

## Interface HTTP

POST `/api/kit-documentos`, com a sessão atual. Só gestor/operador aprovado dentro do próprio escopo. Serviço desabilitado se a identificação empresarial local não estiver habilitada ou o gate de segurança não passar. Não adicionar credenciais nem provedor de IA.

Toda ação leva `empresaId` e `processoId` UUID. Servidor busca os registros sob JWT/RLS e confere explicitamente organização, CNPJ e processo em todas as relações; nunca usa dados de empresa ou preços enviados pelo navegador como fonte verdadeira.

- `acao: 'consultar'` retorna `{empresa:{id,razaoSocial,cnpj},processo:{id,numero,orgao},identificacao:{status},itens:[{id,tipo,identificador,descricao,quantidade,valorUnitario,marca,modelo}],requisitos:[string],pendencias:[string]}`. Dados de identificação incompletos aparecem como pendência. Não devolver conteúdo de PDFs.
- `acao: 'preparar'` recebe também `tipo: 'declaracao'|'proposta'`. Para declaração: `declaracao:{titulo,texto,fonte}`. Para proposta: `proposta:{itemIds:[uuid],unidades:{uuid:string},validade,prazoEntrega,pagamento}`. Retorna `{previa:{texto,fontes:[string]},revisaoHash}`. Erros de preenchimento retornam 422 com `{erro,pendencias:[string]}`.
- `acao: 'exportar'` repete os mesmos campos, mais `revisado:true` e `revisaoHash`. Revalida sessão, escopo, identificação/provas e itens no servidor, recompõe a prévia e compara hash. Retorna JSON `{arquivoBase64,nome,mime}` com DOCX editável. O hash identifica conteúdo, não prova identidade de quem revisou. Mudança de conteúdo/versão desde a prévia retorna 409.
- Demais erros: 401 sessão, 403 papel/acesso, 404 registro indisponível, 503 ambiente ou serviço indisponível. Não expor mensagens internas/segredos.

## Declaração

Texto de modelo informado pelo usuário, com variáveis opcionais explícitas: `{{razao_social}}`, `{{cnpj}}`, `{{endereco}}`, `{{representante}}`, `{{cargo}}`, `{{numero_edital}}`, `{{orgao}}`. Substituir somente essas variáveis com dados verificados; recusar variáveis desconhecidas. Não criar declaração de regularidade, habilitação, ME/EPP ou ausência de impedimento automaticamente. Prévia deve mostrar integralmente o texto resultante. Campo fonte é referência informada pelo usuário (opcional), nunca classificada como fonte verificada. Título e texto obrigatórios; texto até 20000 caracteres. Sem salvar modelos nesta fatia.

## Proposta

De 1 a 50 itens individuais (`tipo=item`) do processo autorizado, IDs sem duplicatas. Lote agregado fica pendente até detalhamento. Descrição, quantidade, marca/modelo e preço unitário vêm dos itens persistidos. Não inferir unitário de total antigo nem usar estimativa oficial como preço ofertado. Unidade é campo manual obrigatório por item, informado claramente na UI; não alterar cadastro de itens silenciosamente. Validade, prazo de entrega e pagamento são condições informadas pelo usuário, obrigatórias e sem valores padrão. Quantidade >0, até 3 casas; unitário >0, até 2 casas. Zero fica bloqueado nesta primeira versão.

Calcular com inteiros/BigInt: quantidade em milésimos × preço em centavos, arredondar metade para cima por item e somar centavos. Recusar valores não finitos, negativos, ambíguos, excessivos ou com precisão não suportada. Respeitar numeric(15,2)/(15,3). Não exigir marca/modelo quando não houver exigência registrada; mostrar ausência para revisão. Incluir identificação confirmada, órgão/edital, itens, totais e condições no arquivo.

## Revisão e interface

No dossiê do processo, seção “Documentos e propostas” aberta, com CNPJ e processo visíveis. Seleção de tipo, requisitos já registrados com aviso de conferência, pendências, campos, “Preparar prévia”, prévia integral, checkbox “Conferi os dados e o conteúdo para este edital” e “Baixar DOCX”. Revisão desmarca ao alterar qualquer campo/seleção, trocar empresa/processo, recarregar ou fechar. Respostas antigas não afetam tela ou download, inclusive A→B→A. Nenhum modal de resumo é alterado.

Usar estilo azul claro/escuro existente, labels, estado ocupado, erros em aria-live, foco e teclado. Não tornar obrigatória abertura do resumo. Orientar pendências para cadastro de identificação e itens existentes. Sem rascunho persistente, logo ou timbrado nesta primeira fatia; esses entram depois do fluxo validado.

## Concorrência e exportação

Hash canônico inclui usuário, IDs, perfil/versão, dados da empresa, processo, itens ordenados, campos manuais e texto final. Consulta e exportação revalidam proveniência, inclusive hashes de arquivos conforme implementação de identificação existente. Não alegar snapshot transacional de todos os serviços: o documento representa os dados lidos na exportação; alterações posteriores exigem nova geração. Não alterar o documento exportado automaticamente.

Reutilizar DOCX atual via uma exportação pública mínima de `montarDocx` (sem depender de `__test`) e título opcional com padrão preservado, ou helper equivalente já existente. Não copiar o pacote OOXML inteiro nem refatorar o resumo. Testar equivalência do checklist/minuta legado.

## Demonstração local

Preparar cenário fictício explícito com dois CNPJs e processos distintos, ambiente local sem rede externa, usando os componentes reais. Mostrar preparação e download; teste backend usa fronteiras simuladas e SQL separado. A demonstração não representa dados reais nem comprova implantação. A homologação remota permanece etapa posterior.
