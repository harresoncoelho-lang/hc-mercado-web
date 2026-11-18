# Integrações solicitadas após o estudo Licitante Prime — diagnóstico local

**Referência: 01/11/2026. Leitura do código e das evidências do LicitaPlena; sem execução externa.**

O usuário tornou explícitos os requisitos de integração com ChatGPT/Claude, cadastro automático de ofertas no ComprasGOV/Comprasnet, robô de lances e monitoramento de chats. O robô deixa de ser tratado como opção arbitrariamente posterior. Sua entrega depende de comprovar um canal de integração e o funcionamento com autorização por CNPJ. Este documento não modifica o plano anterior nem atribui ao Licitante Prime funcionalidades que não foram verificadas pelo estudo externo da coordenação.

Migração e publicação continuam suspensas. Não foram iniciados serviços, testes, coleta, autenticação externa, custos ou operações de portal. Não foram lidos arquivos de credenciais nem acessado CNPJ Proprio. `graphify-out/graph.json` continua ausente; a investigação usou `rg` e leitura direta, sem criar grafo.

## 1. Resultado factual

| Requisito | Reaproveitável no LicitaPlena | Lacuna encontrada |
|---|---|---|
| Conector externo ChatGPT/Claude | Endpoints de documentos, identificação, decisões e consultas; validação de sessão; escopo organização/CNPJ/processo; revisão por conteúdo e usuário | Não localizado servidor MCP, catálogo de ferramentas para clientes externos, autorização delegada ou contrato de ações externas. Provedores internos de IA não são esse conector. |
| Cadastro de ofertas em lote | Itens, quantidades, preços, marca/modelo, identificação confirmada, prévia, versões e revisão | Não localizado executor autenticado do portal, mapeamento dos campos de oferta, lote de execução, autorização específica ou confirmação de gravação externa. |
| Robô de lances | Processo, prazo de sessão, itens/resultados e memória de custo/preço mínimo; estados demonstrativos no Design System | Não localizado motor de disputa, política por item/lote, leitura de eventos ao vivo, executor de lance, pausa operacional ou conciliação de comandos. |
| Monitoramento de chats | Histórico de ocorrências com categoria `chat`, processo/CNPJ e registro manual; infraestrutura separada de lembretes | Não localizada ingestão de mensagens do portal, cursor de acompanhamento, detecção de lacunas, alertas de chat ou retomada da sessão monitorada. |

“Não localizado” refere-se ao código de produto examinado, principalmente `functions/`, `netlify/functions/`, `supabase/` e módulos de acompanhamento. Não é afirmação sobre ferramentas instaladas no computador, plugins do agente ou capacidades externas ainda não demonstradas.

## 2. Evidências que delimitam o reaproveitamento

- **Rotas atuais:** `functions/api/[nome].js:36` enumera funções de IA, consultas públicas, decisão, identificação e kit. Não há rota de operação de portal ou conector externo nessa lista.
- **IA interna:** `netlify/functions/_ia_provedores.js:48` envia mensagens a provedor configurado e retorna texto; a linha 63 rejeita respostas com `tool_calls`/`function_call`. Esse fluxo não implementa execução de ferramentas por ChatGPT/Claude.
- **Sessão:** `netlify/functions/_auth.js:44` valida token de usuário do LicitaPlena. Isso não concede, por si só, permissão para representar uma empresa no portal de compras.
- **Escopo e revisão:** `netlify/functions/kit-documentos.js:7` confere membro, papel, empresa e processo. As linhas 79–83 exigem prévia/revisão atual para exportação. A lista de ações, na linha 53, não contém envio ao portal.
- **Dados da oferta:** `netlify/functions/_kit_documentos.js:29` monta proposta com itens persistidos e cálculo decimal. O escopo atual é de 1–50 itens; lote agregado precisa ser detalhado e a unidade é manual. `supabase/operacao_acompanhamento.sql:23` fornece identificação de item/lote e valores de acompanhamento.
- **ComprasGOV atual:** `netlify/functions/comprasgov-marca.js:1` declara consulta de marca em fonte pública, sem área autenticada. `scripts/coletar_comprasgov_resultados.js:1` e `:123` coletam resultados homologados, não transmitem ofertas ou lances. `scripts/coletar_comprasnet_legado.js:45` consulta histórico em dados abertos.
- **Piso e estágio:** `processos.html:76` calcula preço mínimo agregado a partir de custos informados; não é política de lance por item. Na linha 265, “Proposta enviada” pode resultar de atualização manual de estágio, sem comprovante externo.
- **Chat atual:** `supabase/operacao_acompanhamento.sql:42` cria ocorrências com categoria `chat`, texto, data e fonte. `operacao-acompanhamento-ui.js:140` grava o formulário manual. Não há identidade externa/cursor de mensagem nesse esquema.
- **Permissões:** `supabase/seguranca_operacao.sql:10` diferencia escrita por papel e empresa. Essa base deve permanecer; a integração precisa acrescentar autoridade de execução, sem transformar leitura em permissão de operação externa.

A homologação existente de documentos e cadastro, em `docs/qa/homologacao-real-20261031/HOMOLOGACAO.md:7`, comprova esse módulo local. Ela não testou autenticação do ComprasGOV, cadastro de ofertas, lances, chats ou uso por um cliente MCP.

## 3. Conector externo de IA

É necessário separar dois produtos técnicos: **o LicitaPlena usar uma API de IA** e **o usuário operar o LicitaPlena a partir do ChatGPT/Claude**. O primeiro já possui componentes; o segundo exige um contrato próprio. Não pressupor que assinatura do aplicativo inclui chamadas de API, nem trocar o cliente, modelo, autenticação ou cobrança do usuário para criar essa integração.

Como proposta de arquitetura, um adaptador fino pode expor operações do domínio existente, com capacidades de leitura e escrita separadas. Exemplos de contratos a avaliar: consultar processo autorizado, listar pendências, preparar rascunho, apresentar plano de cadastro e consultar execução. Os nomes são propostas, não ferramentas implementadas.

Faltam autorização delegada com escopos/revogação, vínculo explícito à organização e CNPJ, limites de acesso a arquivos, registro das ações e validação de argumentos independente do modelo. Conteúdo do edital, documento ou chat é dado, não autorização para uma ferramenta agir. Nenhum segredo administrativo ou sessão do portal deve aparecer na conversa como argumento de ferramenta.

A IA pode preparar uma intenção; o servidor decide se aquela pessoa tem permissão e se a ação corresponde à versão revisada. Para operações externas, reutilizar a ideia de revisão vinculada ao conteúdo, mas criar autorização específica: confirmar DOCX atualmente não autoriza cadastrar oferta ou lançar.

## 4. Cadastro de ofertas em lote

O significado adotado aqui é cadastrar ofertas de itens/contratações no portal, não criar cadastro de fornecedor no SICAF ou conta governamental. O estudo externo deve confirmar esse significado e o caminho efetivamente suportado.

O lote precisa identificar CNPJ representado, portal, contratação, itens/lotes, unidade, quantidade, preço, marca/modelo e declarações exigidas. IDs do PNCP e dos dados abertos não devem ser presumidos iguais aos identificadores da interface transacional. A expansão além dos 50 itens atuais exige decisão e verificação próprias.

Separar **preparação no LP**, **gravação da oferta no portal** e **envio final**, quando o portal oferecer operações distintas. Se o cadastro já produzir efeito externo definitivo, deve ser apresentado e autorizado como tal; não inventar um “rascunho seguro” que o portal não tem.

Faltam leitura do estado atual, plano de alterações, revisão das divergências, execução por item, resultados parciais, comprovante e conciliação. Timeout após gravar exige consultar o portal antes de repetir. Reexecutar um lote não pode duplicar oferta nem sobrescrever mudança externa sem aviso. “Executado” deve significar estado confirmado, não clique disparado.

## 5. Robô de lances como requisito atual

O robô exige um motor determinístico de execução, separado do texto produzido pela IA. Antes de iniciar, o usuário autoriza uma política por CNPJ, contratação e item/lote: critério de disputa, limites de preço/desconto, incremento/decremento, abrangência, validade e condições de parada. Regras efetivas dependem do portal e modalidade comprovados; não assumir apenas menor preço.

A autorização prévia pode permitir execução automática dentro desses limites; não se propõe exigir clique humano em cada lance. Alterar estratégia, limites, CNPJ ou contratação exige nova autorização. O custo/preço mínimo agregado existente pode informar o preparo, mas não deve ser convertido silenciosamente em limite autorizado de cada item.

Faltam estado confiável da sessão, exclusividade de executor, controle de concorrência, identificador de comando, confirmação do portal e histórico auditável. Duas abas ou operadores não podem disputar pelo mesmo CNPJ/item sem coordenação. Pausa global e por item precisam interromper novas emissões e tratar comandos já enviados.

Perda de conexão, sessão expirada ou resposta incerta deve aparecer como interrupção ou conciliação pendente. Reconectar não significa retomar automaticamente. O motor precisa reconciliar comandos sem confirmação antes de seguir. Esses comportamentos são critérios de entrega do requisito, não justificativa para removê-lo do produto.

## 6. Monitoramento de chats

Reaproveitar a apresentação cronológica do processo, mantendo distinção entre ocorrência manual e mensagem importada. A ingestão precisa identificar contratação/sessão, autor, mensagem, data da fonte e momento de captura. Também precisa impedir duplicação, retomar por cursor e indicar períodos sem cobertura.

“Conectado”, “atualizado até”, “interrompido” e “mensagens recuperadas após falha” são estados diferentes. Uma página aberta ou último registro recente não comprova monitoramento contínuo. Alertas devem apontar mensagem original, CNPJ, processo e prazo identificado, sem transformar uma classificação da IA em prazo confirmado.

Receber mensagem, alertar o responsável, preparar resposta e enviar resposta são capacidades separadas. Envio não decorre da autorização para monitorar. O código de lembretes existente não deve ser acionado ou alterado como efeito colateral deste estudo; canal, consentimento e confirmação de entrega dos alertas precisam de contrato próprio.

## 7. Fluxo comum de autorização e execução

**Preparar → revisar → autorizar execução → executar → conciliar → registrar resultado.**

Cada intenção deve carregar organização, CNPJ, pessoa, portal, contratação, objetos afetados, versão dos dados, ação permitida e validade. A autorização de leitura ou geração documental não basta para operar uma sessão externa. Conferir também o CNPJ efetivamente representado no portal, não somente o selecionado no LP.

Uma mudança invalida as autorizações afetadas. Revogação, perda de sessão e troca de empresa bloqueiam execução. Resultados ficam associados à intenção e à confirmação externa; falhas parciais permanecem visíveis. Hash de prévia é mecanismo de integridade, não substituto de autenticação ou poder de representação.

## 8. Decisões dependentes do estudo externo

Há dois caminhos a avaliar: API transacional/integrador comprovado; ou extensão/assistente no navegador autenticado do usuário, quando o canal permitido e sua estabilidade forem demonstrados. A escolha não está feita. APIs públicas de consulta não comprovam suporte a nenhuma dessas operações de escrita. Um preenchimento manual assistido pode ajudar o diagnóstico, mas não encerra o requisito de automação solicitado.

Antes de especificar implementação, a coordenação precisa confirmar: portal e módulo exatos; significado de cadastro versus envio; mecanismo real de integração ChatGPT/Claude; autenticação e representação por CNPJ; identificação de confirmação/erro; condições de sessão; acesso ao chat; limites e canal de operação permitido. Capturas de marketing não substituem essa prova.

O próximo incremento deve ser definido a partir dessa evidência, reaproveitando o domínio do LP e sem presumir que as quatro integrações já existem. Não foi escolhida tecnologia nova, contratado provedor, iniciado executor, alterado plano comercial ou retomada migração neste diagnóstico.

## 9. Adendo — escala e cadastro a partir de planilha

O usuário explicitou que **98 itens não é limite**: exige contemplar planilhas com 200, 300, 400 e 1.000 itens, percorrendo páginas do ComprasGOV para preencher e avançar. **1.000 é cenário de validação solicitado, não máximo do produto.** Este adendo registra o requisito; não comprova teste, acesso ou execução no portal.

O limite de 50 observado em `netlify/functions/_kit_documentos.js:32` pertence ao gerador documental atual. Não foi identificada evidência de que esse seja limite do portal, da planilha ou do futuro executor. Superá-lo no produto e construir o executor são trabalhos distintos. A demonstração visual com massas maiores não modifica esse código nem comprova capacidade de produção.

Não foi localizada neste diagnóstico uma cadeia integrada de importação/validação e mapeamento da planilha, fila de ofertas, navegação transacional paginada, checkpoints de confirmação e retomada conciliada para cadastrar ofertas no portal. A associação precisa usar identidade estável por CNPJ, portal, contratação, item/grupo; **jamais índice da linha ou posição na página**. Paginação da planilha/LP, lote interno de execução e páginas do portal não têm tamanho, ordem ou fronteiras necessariamente iguais.

A fila deve distinguir itens selecionados, não ofertados, sem correspondência e grupos com composição pendente. Não ofertar um item não significa perdê-lo durante a navegação; exigência de completude de grupo precisa ser confirmada no canal real. Antes de escrever, registrar intenção; somente confirmação e leitura dos valores gravados promovem o item a checkpoint concluído. Comando de resultado incerto exige conciliação antes de repetir. Retomada usa IDs e estados confirmados, não a última linha percorrida.

Guardas necessárias: página repetida sem progresso; fim da paginação com ofertas selecionadas ainda não localizadas; alteração de ordem/filtro; item deslocado entre páginas; sessão ou autorização expirada; falha parcial; timeout depois de possível gravação. A fila deve pausar com causa visível, relocalizar por identidade e preservar resultados confirmados. Nenhuma reconexão, mudança de filtro ou clique em “próxima” equivale a confirmação de cobertura integral.

Matriz solicitada: **50, 51, 98, 99, 200, 300, 400, 1.000 e limite técnico + 1**, com páginas e lotes internos de tamanhos diferentes, seleção parcial, grupos, interrupção e retomada sem duplicação. “Limite + 1” deve nomear o limite específico testado; se usado apenas no protótipo, deve ser declarado fictício, sem atribuí-lo ao ComprasGOV. Cada resultado real dependerá de evidência da integração, e a capacidade/custo continuarão não validados até medição representativa.

A composição privada está especificada em `ESPECIFICACAO-INTEGRACOES-DS.md`. Os cenários são critérios a demonstrar, não testes já aprovados. Não houve nesta atualização execução de serviços, teste de portal, alteração de produto ou retomada da migração.

## 10. Adendo — precisão decimal e campos da oferta

O [Manual do Pregão Eletrônico para fornecedores, versão 1.1, dezembro de 2022](https://www.gov.br/compras/pt-br/acesso-a-informacao/manuais/manual-fase-externa/in-no-73-de-2022-manuais-do-criterio-menor-preco-ou-maior-desconto/Manual_Pregao_Eletronico_fornecedor_v1.1.pdf), página 23 (índice 22 do PDF), informa suporte a até quatro casas decimais e apresenta campos de valor unitário, total, marca, fabricante, modelo/versão e descrição. O estudo externo identificou o manual ainda vinculado no índice oficial; sua data e permanência no índice **não comprovam o comportamento da interface em 2026**.

O gerador documental atual usa duas casas para o preço unitário em `netlify/functions/_kit_documentos.js:16` e `:41`. Essa precisão precisa ser confrontada com o canal real antes de reaproveitar dados/cálculos para cadastro ou lances: **não arredondar silenciosamente de quatro para duas casas**. Definir e validar separadamente precisão, arredondamento e consistência de valor unitário, total e percentual de desconto, conforme campo e critério comprovados. Não converter a menção a quatro casas em regra universal. O robô demonstrativo pode manter um cenário de duas casas, identificado como regra fictícia local; ele não valida a precisão do portal nem a integração real.
