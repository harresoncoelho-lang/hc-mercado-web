# Integrações operacionais — contrato da demonstração no Design System

Referência: 01/11/2026. Texto para orientar uma composição privada no Design System existente. Não autoriza implementação no produto, integração externa, publicação ou migração.

## Objetivo e limites

Acrescentar uma composição `IntegracoesOperacionais`, com abas **Conexões IA**, **Cadastro ComprasGOV**, **Robô de lances** e **Monitoramento**. Reutilizar marca azul, tokens, componentes, claro/escuro e navegação recolhível existentes. Preservar Resumo, Boletim, autenticação, e-mails e todas as prévias anteriores. A entrada adicional no catálogo e a documentação desta composição são as únicas mudanças de apresentação necessárias.

Exibir permanentemente **“Demonstração — dados fictícios, sem integração real”**. Conexões, permissões, processamento e recibos são simulados. Não abrir portais, chamar APIs, usar credenciais, instalar conectores, enviar mensagens, acionar SMTP ou mudar modelos/autenticação/cobrança. Estado apenas local à demonstração, com botão para reiniciar os cenários.

O robô é requisito explícito solicitado para o produto; não descrevê-lo como mera opção futura. Esta composição demonstra o comportamento esperado, sem comprovar que a integração existe ou que o produto está pronto. Na documentação da composição, indicar “requisito solicitado; integração real pendente de comprovação”. Não reescrever o histórico do plano comercial.

## Contexto e autorização

Usar duas empresas fictícias, cada uma com um processo próprio. Identificar seus CNPJs como DEMO, usando números inválidos para representação real, por exemplo `00.000.000/0000-00` e `00.000.000/0000-01`. Manter dados, decisões e histórico separados. Permitir carregar massas fictícias de **50, 51, 98, 99, 200, 300, 400 e 1.000 itens**, além do cenário de limite técnico + 1 definido abaixo. O segundo processo permite demonstrar a troca de escopo. **98 é apenas a massa inicial; 1.000 é cenário obrigatório, não limite máximo do produto.**

Empresa, CNPJ, processo e versão permanecem visíveis em cada ação relevante e na confirmação. Trocar CNPJ/processo, alterar dados ou expirar a autorização invalida as autorizações afetadas. Voltar ao contexto anterior não reinicia execuções. Separar revisão, autorização e início da simulação. Uma autorização da aba IA não autoriza cadastro nem lances.

## Conexões IA

Mostrar cartões ChatGPT e Claude, explicitamente demonstrativos. Permitir simular seleção de CNPJ/processo, leitura autorizada, escrita restrita para preparar rascunhos no LP, prazo da autorização e revogação. Apresentar o resumo dos acessos antes de confirmar.

Estados mínimos: desconectado, autorizado, expirado e revogado. Uma tentativa sem acesso deve mostrar o bloqueio correspondente. Revogar impede novas ações simuladas. Não incluir permissão de enviar oferta, dar lance ou enviar resposta ao portal. Não representar a assinatura ChatGPT/Claude como crédito de API nem declarar MCP/OAuth implementado. Histórico registra somente eventos fictícios desta demonstração.

## Cadastro ComprasGOV

Fluxo: selecionar itens → preparar → revisar diferenças → autorizar versão → executar simulação → conciliar resultado. O resumo das diferenças mostra situação anterior fictícia, alteração proposta, itens selecionados, valor total e eventuais pendências. A autorização identifica expressamente CNPJ, processo, versão e efeito simulado.

“Preparado no LicitaPlena”, “cadastro simulado” e “envio final” são conceitos distintos. Não presumir que o portal oferece rascunho sem efeito externo. Deixar o envio final fora da execução desta demonstração, identificado como operação separada, cuja integração e autorização ainda precisam ser definidas.

Todos os itens da massa escolhida devem existir e aparecer por paginação ou busca; não usar apenas um contador decorativo. Contadores mutuamente exclusivos — não selecionado/não ofertado, pendente, em simulação, confirmado na simulação, falha e resultado incerto — devem somar o total carregado, inclusive 1.000. A seleção informa claramente seu alcance entre páginas. Apresentar totais de itens e grupos separadamente, sem contar um grupo e seus componentes duas vezes.

Disponibilizar cenário determinístico de falha parcial e timeout com resultado incerto. Incerto não equivale a falha nem autoriza repetir. **Reconciliar simulação** resolve o estado consultando a resposta fictícia; só então a retomada manual pode tratar itens elegíveis, sem duplicar os confirmados. Exemplo exclusivo da massa de 98: 70 confirmados, 10 falhas, 3 incertos e 15 pendentes. Nas demais massas, usar distribuição coerente com o total. Distinguir rejeição conhecida de ausência de confirmação.

Desabilitar comandos duplicados durante a transição. Editar seleção, valores ou contexto invalida a autorização e exige nova revisão. As massas demonstram o desenho da interação; não comprovam capacidade do produto, não eliminam o limite atual de 50 itens do gerador documental e não definem limite comercial ou limite do ComprasGOV.

### Planilha, fila e páginas do portal simulado

Demonstrar a carga de uma planilha fictícia, sua validação e associação aos itens da contratação. A fila de ofertas selecionadas deve atravessar várias páginas simuladas: localizar os itens corretos, preencher, confirmar o resultado e avançar até cobrir a fila. Planilha, tabela do LP, lote interno de processamento e página do portal são estruturas independentes, com tamanhos e ordenações diferentes. Não transformar a linha 51 da planilha automaticamente no primeiro item de uma suposta segunda página do portal.

Associar cada oferta por chave estável de contexto e objeto: CNPJ, portal, contratação, identificador do item e, quando aplicável, grupo. **Nunca usar índice da linha, posição visual ou número da página como identidade.** Mostrar conflito, duplicidade ou item sem correspondência; não adivinhar a associação nem preencher o próximo campo disponível.

Itens não ofertados ficam explicitamente excluídos e não bloqueiam a fila restante. Para grupos, demonstrar seleção/revisão da composição completa e pendência quando faltar componente exigido pelo cenário; não presumir que qualquer grupo aceita oferta parcial. Distinguir os itens existentes no portal dos itens efetivamente selecionados na planilha.

Registrar intenção antes de simular a escrita; marcar checkpoint de item concluído somente após confirmação da gravação e conferência dos valores. Clique, avanço de página e resposta visual genérica não bastam. Manter item incerto na fila de conciliação. Retomar pelo conjunto de IDs confirmados e pendentes, nunca pela última linha ou apenas pela última página visitada.

Incluir guardas demonstráveis: página repetida sem progresso; fim antecipado com itens selecionados ainda não localizados; mudança de ordenação/filtro; item mudando de página; sessão expirada no meio da operação; timeout após possível gravação. Mudança de ordenação exige relocalizar por ID; mudança de escopo/filtro que impede cobertura pausa e pede correção. Nenhuma dessas situações pode concluir o lote silenciosamente. A retomada exige contexto e autorização válidos, conciliação dos incertos e preservação dos confirmados, sem duplicação.

### Matriz de escala a demonstrar

Validar a simulação com 50/51, 98/99, 200, 300, 400 e 1.000 itens, cruzando fronteiras de páginas com tamanhos diferentes dos lotes internos. Incluir seleção parcial e grupos, mudança de ordem/filtro, falha no último item de uma página, repetição de página, fim antecipado, expiração e retomada. Mostrar progresso por itens confirmados e fila restante; não usar só “página X de Y”.

“Limite + 1” significa exercitar a fronteira de um limite técnico específico, identificado e parametrizado no teste, como tamanho de um lote interno. Se não houver limite real comprovado, nomeá-lo como limite fictício do cenário. Não inferir máximo total de 50, 98 ou 1.000; limites por chamada/página devem permitir divisão controlada da fila quando essa for a regra validada. Registrar cada cenário como previsto, demonstrado ou pendente, sem afirmar teste real do portal.

## Robô de lances

Demonstrar somente **menor preço**, com política por item: preço mínimo privado, decremento em reais, precisão/arredondamento, validade e condição de parada. Nomear essas regras como regras do cenário fictício, sem atribuí-las ao ComprasGOV real. Usar cálculo decimal determinístico; nenhum lance pode ultrapassar o piso autorizado ou repetir uma oferta inválida.

Revisar e autorizar a versão da política antes de iniciar. Depois, o comando **Simular próximo evento** pode produzir lances dentro da política, sem pedir nova aprovação a cada lance. Exibir referência recebida, cálculo, valor proposto e confirmação simulada. Se não houver valor válido, parar aquele item e explicar o motivo.

Oferecer pausa por item e pausa geral. Alterar limite, estratégia, CNPJ ou processo revoga a autorização aplicável. Pausa impede novas emissões, mas não deve apresentar um comando já em trânsito como cancelado; ele permanece aguardando confirmação/conciliação.

Incluir estados demonstráveis de sessão expirada, autorização expirada, desconexão, resultado incerto e executor ocupado. Nenhuma reconexão retoma automaticamente. Bloquear duplo início na mesma demonstração e informar que concorrência entre sessões/operadores ainda não foi implementada nem comprovada. A interface não deve sugerir monitoramento real em segundo plano.

## Monitoramento

Exibir mensagens fictícias com processo/CNPJ, fonte identificada como simulada, autor, horário da mensagem, horário da captura e última atualização. Mostrar conectado na simulação, interrompido, período sem cobertura e recuperação posterior, com deduplicação demonstrada.

Separar mensagem, alerta e reconhecimento. **Reconhecer alerta** registra ciência local; não responde ao pregoeiro, não comprova cumprimento de prazo e não elimina a mensagem original. Um prazo identificado por IA aparece como sugestão a conferir. Responder/enviar ao portal não integra este protótipo. Nenhum alerta real ou e-mail será emitido.

## Critérios de revisão da composição

- Navegação por teclado, foco perceptível, rótulos claros e estados compreensíveis sem depender apenas de cor; legibilidade em tela estreita e claro/escuro.
- Troca entre os dois CNPJs sem mistura de dados; autorizações antigas não habilitam ações no novo contexto.
- Fluxos demonstráveis de sucesso, revisão alterada, autorização revogada/expirada, falha parcial, resultado incerto, conciliação e pausa.
- Contagem consistente em todas as massas, incluindo 1.000 e limite técnico + 1; valores e eventos reproduzíveis ao reiniciar a demonstração.
- Fila atravessa páginas simuladas e retoma por IDs/checkpoints confirmados; repetição, fim antecipado, ordenação/filtro e expiração não causam perda, duplicação ou falsa conclusão.
- Preservação visual e funcional das composições anteriores. Prévia nova identificada como demonstração privada, sem alegação de homologação do produto ou integração real.

Base factual: `LACUNAS-PRIME-LICITAPLENA.md`, neste diretório. O conector externo, a execução de ofertas, o motor de lances e a ingestão de chats não foram localizados no produto examinado. Esta especificação fecha o comportamento da demonstração; a implementação real depende da integração comprovada e de autorização própria.
