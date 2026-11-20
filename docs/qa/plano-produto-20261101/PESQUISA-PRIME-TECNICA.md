# Licitante Prime — evidência técnica pública e implicações para o LicitaPlena

Data da consulta: 01/11/2026. Pesquisa pública, sem autenticação, instalação, compra, conexão de conta ou operação em pregão. Esta entrega documenta pesquisa; não comprova implementação nem autoriza operação real, produção ou custos. O usuário já autorizou o avanço necessário do produto. Não altera o plano principal; migração permanece suspensa.

## O que a fonte oficial permite afirmar

As informações abaixo são declarações do fornecedor; não equivalem a testes independentes.

| Recurso | Declaração pública | Limite da evidência |
| --- | --- | --- |
| ChatGPT e Claude | Busca, detalhes/itens, favoritos e Kanban; permite favoritar. Login e revogação; acesso limitado à conta. Exclui lances e envio de propostas pela IA. | Não foram localizados publicamente endpoint MCP, esquema de ferramentas, scopes OAuth ou documentação de autorização. |
| Robô de Lances/Express | Compras.gov.br; pregão e dispensa, itens/grupos, piso configurado, simulação e operação simultânea. Aplicativo Windows 64 bits e extensão Chrome, com computador ligado. Não contorna CAPTCHA; lance final aberto/fechado fica com o usuário. | A ficha é conjunta: não demonstra equivalência integral entre Windows e Express. |
| Cadastro automático | Preenchimento de itens no ComprasGOV/Comprasnet, dependente da compatibilidade do processo. | Não explica protocolo, campos cobertos, recuperação de falha nem prova de submissão. |

Fonte: [site oficial, seções IA, robô, cadastro e FAQ](https://licitanteprime.com.br/). Não há base para chamar o robô de serviço autônomo em nuvem ou afirmar que a IA oferece lances.

## Ajuda, tutoriais e lojas encontrados

- [Ajuda do robô](https://licitanteprime.com.br/ajuda-robo-de-lances/): lista instalação no computador, instalação de extensão Chrome, planilha, participação, pregões simultâneos e Express. A página é evidência de documentação destinada ao usuário, não de ensaio funcional realizado por nós.
- A página oficial de ajuda fornece thumbnails cujos IDs identificam os vídeos: Windows `lWQnD5B5n1U`, extensão `AdE4rDhMIgA`, Express `R7Q6HlNCKkI`. O tutorial de IA é ligado diretamente pelo site em [YouTube: conexão ChatGPT/Claude](https://www.youtube.com/watch?v=Xa85HQDnnlU). A ferramenta web não carregou os vídeos por limitação de acesso; seus passos não foram assistidos nesta pesquisa. A inspeção visual pela coordenação é uma frente separada.
- [Ajuda do localizador](https://licitanteprime.com.br/ajuda-localizador-de-editais/): oito tutoriais listados, incluindo documentos, propostas, declarações, CRM e subusuários. A lista reforça que há fluxos de operação distintos, mas não expõe os contratos de API.
- [Ficha oficial no Google Play](https://play.google.com/store/apps/details?hl=en-US&id=com.painellocalizadordeeditaiscombr.myapp): produto Licitante Prime, desenvolvedor associado ao responsável identificado no site e link de suporte para o domínio oficial. Essa ficha comprova uma distribuição Android anunciada; não comprova robô Android nem equivalência com o Express.
- Não localizei ficha verificável do Express na Chrome Web Store, link público de instalador assinado ou documentação pública de integração. Um resultado chamado “Assistente de Licitações” pertence a outro desenvolvedor; foi descartado. Ausência na pesquisa não prova inexistência ou falta de publicação.

Complemento da coordenação, recebido durante a pesquisa: no tutorial oficial `Xa85HQDnnlU`, a inspeção por quadros mostrou o resultado Licitante Prime na loja de plugins ChatGPT (0:59), narração de autorização (1:09), tabela de oportunidades no ChatGPT (2:38), oportunidades no Claude (3:57) e pedido de relatório de licitações ganhas por empresa, com status de uso da integração Licitante Prime no Claude (5:17). Classificação: demonstração do fornecedor observada, sem reprodução independente. Nenhum endpoint MCP ou scope OAuth foi identificado nesses quadros. O diretório disponível nesta sessão não retornou o produto na pesquisa feita pela coordenação; esse resultado não é um inventário exaustivo dos diretórios comerciais.

## O que permanece desconhecido

Não há evidência pública suficiente, nesta coleta, para confirmar MCP versus outra implementação, versão do protocolo, OAuth/PKCE utilizado, duração de tokens, isolamento real entre empresas, limites de chamadas, plano exigido nos assistentes, retenção dos dados enviados a IA, manifesto/permissões da extensão, atualização/assinatura do executável e resposta a interrupções do navegador. Não foram sondados endpoints de autenticação nem rotas presumidas.

A [política de privacidade](https://licitanteprime.com.br/politica-de-privacidade/) trata documentos, sessões, hospedagem, registros de atividade e acesso administrativo por necessidade operacional. Não detalha a integração com ChatGPT/Claude ou a custódia de tokens. Também atribui ao usuário a conferência das informações e ressalva indisponibilidade de portais e de alertas. Isso delimita a documentação pública; não demonstra, por si só, vulnerabilidade ou descumprimento.

## Arquitetura recomendada para o LicitaPlena — proposta própria

### 1. Conector de consulta e organização

Um servidor MCP remoto é uma opção concreta, independente de qual tecnologia o concorrente emprega. O Claude documenta conectores remotos e personalizados em [seu guia oficial](https://support.claude.com/pt/articles/11176164-use-conectores-para-estender-os-recursos-do-claude). A publicação em diretórios e compatibilidade de cada cliente precisam de validação própria; construir o servidor não assegura aprovação automática nos catálogos.

O primeiro conjunto deveria consultar oportunidades, documentos autorizados, tarefas e situação dos processos. As ferramentas recebem identificadores estruturados, mas o servidor verifica usuário, organização, vínculo ao CNPJ e permissão em cada chamada. O modelo não decide a autorização. Respostas devem indicar fonte, data, versão e ausência de informação.

Como evolução, favoritar e criar tarefa podem ser escritas pequenas, confirmadas, idempotentes e auditadas. Enviar proposta, lançar preço, assinar documento e aceitar declaração jurídica ficam fora desse conector inicial. Isso mantém as decisões comerciais verificáveis e reduz o alcance de uma instrução maliciosa embutida em edital.

Para autorização remota, a [especificação MCP consultada pelo Context7](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx) exige validação de tokens destinados ao próprio recurso. As [considerações de segurança](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/security-considerations.mdx) requerem PKCE e proíbem repasse indiscriminado de tokens. Nossa proposta deve acrescentar revogação, escopos mínimos e trilha por CNPJ; nenhum segredo do banco ou sessão de portal deve chegar ao modelo.

Conectar um assistente do cliente e executar IA dentro do SaaS são mecanismos comerciais distintos. É necessário medir chamadas, armazenamento e suporte antes de incluir recursos ilimitados em planos. Esta pesquisa não autoriza cobrança de API nem contratação.

### 2. Preparar a proposta antes de automatizar o portal

A base útil é uma revisão imutável da proposta: empresa, processo, itens e grupos, unidades, quantidades, marca/modelo, valores, arredondamento e documentos conferidos. A tela mostra o documento real antes da aprovação. Uma aprovação referencia essa versão; qualquer alteração posterior exige nova revisão.

Um adaptador por portal deve preencher os dados aprovados na sessão do próprio usuário. Um modo assistido de preenchimento e conferência serve à validação do adaptador; não encerra sozinho o requisito de cadastro automático solicitado. Preparação no LP, gravação e envio final são ações distintas somente quando o portal realmente oferecer essa separação. Se cadastrar já produzir efeito definitivo, a revisão e a autorização devem anteceder essa gravação, com identificação visível do CNPJ/processo e comprovante. Declarações sobre condições da empresa não podem ser marcadas por inferência da IA.

Cada item deve registrar resultado, erro e comparação entre valor esperado e lido de volta. Em queda de conexão, o estado é “resultado não confirmado”; consultar o portal antes de reenviar. Uma execução parcialmente concluída não pode ser repetida integralmente sem reconciliação. Um vídeo de muitos itens preenchidos não mede taxa de erro, cobertura de variações ou segurança da retomada.

### 3. Robô como executor determinístico separado

O robô de lances é requisito explícito atual do produto. Sua entrega depende de comprovar o canal e implementar regras autorizadas de preço ou desconto, com aritmética decimal, limites por item/grupo, modalidade identificada, bloqueio de estado antigo e parada imediata. A autorização prévia da estratégia pode permitir lances automáticos dentro desses limites; não se exige confirmação humana em cada lance. Mudança de estratégia, limites, empresa ou contratação exige nova autorização. IA pode explicar ou ajudar a preparar parâmetros; não deve ser responsável pelo cálculo e decisão em tempo real de cada lance.

Uma extensão deve restringir permissões aos portais necessários e validar mensagens de páginas. A [documentação Chrome sobre mensagens](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) considera content scripts uma fronteira menos confiável. A [documentação de service workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers) explica que o processo pode terminar e encerrar temporizadores: uma extensão Manifest V3 não pode depender apenas de memória global e um timer para garantir operação contínua.

Antes de uso real: simulação, falha de sessão, suspensão do computador, mudança de página, duas abas concorrentes, mudança de CNPJ, item encerrado, decremento inválido, empate e reinício precisam ter comportamento definido. A solução deve parar em ambiguidade, preservar evidências e devolver controle ao usuário. Regras vigentes do portal e do processo precisam ser verificadas antes de disponibilizar automação; um anúncio de concorrente não autoriza a integração.

## Alternativa oficial a investigar para monitoramento

O Serpro [anunciou o Integra Compras em 12/06/2026](https://www7.serpro.gov.br/menu/noticias/noticias-2026/integra-compras), descrevendo APIs de Chat de Mensagens e Chat de Diligências e previsão de oferta comercial ao fim daquele mês. É um caminho a avaliar para monitoramento, com menos dependência da estrutura visual do portal. A pesquisa não confirmou contratação disponível, documentação comercial vigente, preços ou cotas. O anúncio não estabelece API para enviar propostas ou lances. Nenhum cadastro ou contratação foi iniciado.

Consulta adicional de preços: o acesso público à [Loja Serpro](https://loja.serpro.gov.br/) retornou HTTP 403 nesta ferramenta. A [Central de Serviços oficial](https://www.serpro.gov.br/menu/suporte/css?searchTableUnico=08006468600) lista o produto Integra Compras, mas não fornece a tabela comercial no resultado consultado. Não se adotou preço de terceiros nem se tentou contornar o bloqueio. Disponibilidade, documentação e custo continuam pendentes de consulta oficial acessível.

## Dependências de entrega dos requisitos atuais

Conector ChatGPT/Claude, cadastro automático de ofertas, robô de lances e monitoramento de chats fazem parte do escopo solicitado. As dependências abaixo organizam sua implementação e comprovação; não retiram nem postergam arbitrariamente nenhum desses requisitos.

1. A jornada CNPJ → documentos → proposta visível → revisão → pacote aprovado fornece os dados e versões necessários ao cadastro externo. Medir tempo, retrabalho e erros por pacote.
2. O conector precisa validar isolamento entre CNPJs, revogação e resistência a instruções vindas dos documentos antes de expor ações. Começar por consulta delimita o primeiro contrato verificável, sem substituir o restante da integração.
3. O cadastro automático exige identificar o canal, campos e efeitos reais de um portal; validar com massa fictícia e revisão humana os campos corretos e a retomada após falha. Um ensaio de preenchimento não comprova automação integral nem cobertura de outros portais.
4. Monitoramento e robô são frentes atuais separadas, que podem avançar em paralelo onde não houver dependência. Monitorar exige mensagens identificadas, cobertura e retomada; lançar exige estado confiável, autoridade por CNPJ, política autorizada, exclusividade de executor e conciliação. A documentação pública não permite estimar esforço ou confiabilidade por comparação visual apenas.

Conferência de coerência com `LACUNAS-PRIME-LICITAPLENA.md`: recursos existentes de IA interna, prévia documental, histórico de ocorrências e custo agregado são reaproveitáveis, mas não demonstram conector externo, cadastro de ofertas, ingestão de chat ou motor de lances. Aprovar um documento não autoriza uma operação no portal; registrar um clique não comprova gravação; APIs de consulta não comprovam API transacional. A escolha de canal permanece dependente de evidência, sem supor MCP nativo no concorrente.

O valor defensável é concluir a participação com menos trabalho e evidência de cada decisão. Conector, extensão e IA são meios para isso; não substituem dados corretos, autorização por empresa, revisão documental e acompanhamento do resultado. Resumo do edital, e-mail e robô de boletins existentes permanecem fora das mudanças propostas nesta pesquisa.
