# Pedido ao Claude — apresentação integrada do LicitaPlena

**Executar somente após o término e salvamento da recuperação de `IntegracoesOperacionais`.** Não editar o mesmo componente em paralelo nem restaurar uma versão antiga. Este pedido fecha a experiência visual navegável no **mesmo Design System privado** `https://claude.ai/artifact/6Th8mgnv1z1aoYAvCixrGc`; não cria outro site, outro catálogo ou outra identidade.

O usuário precisa ver como o produto inteiro vai funcionar e parecer. A entrega é uma jornada integrada de alta qualidade, com comportamento demonstrável, não uma coleção adicional de cards ou uma atualização apenas de README. Continuará sendo uma demonstração privada: não publicar produto, conectar serviços reais ou afirmar que a integração comercial está pronta.

## Inspeção inicial e reaproveitamento obrigatório

Inventariar as versões atuais de `LandingSaaS`, `AuthLogin`, `AppShell`, `JornadaIntegrada`, `PerfilDocumentos`, `KitProposta`, `ResumoCompleto`/`SummaryFull`, `BoletimOportunidades` e `IntegracoesOperacionais`. Os nomes acima já foram observados; usar o componente canônico atual de cada função, não recriar porque o nome ou caminho mudou.

Partir de `JornadaIntegrada`/`AppShell` existentes para o contêiner e navegação. Montar ou encaminhar os **mesmos módulos** com o mecanismo suportado pelo catálogo, preservando suas correções e estados. Não copiar o HTML inteiro de cada módulo para criar uma segunda versão independente. Se o mecanismo atual exigir um adaptador de contexto/navegação, mantê-lo mínimo, com contrato explícito de fixture; não permitir que mensagens de iframe/documento representem autorização real.

Antes de alterar, registrar hashes dos módulos preservados. Mudanças permitidas: contêiner/jornada, landing e composição de apresentação de planos/onboarding que faltarem, somente o necessário para navegação e acabamento. Não reescrever o conteúdo/comportamento dos módulos protegidos para facilitar a integração. Não alterar resumo, e-mail, robô de boletins, tokens da marca, modelo/autenticação do Claude ou compartilhamento.

## Percurso a entregar

**Landing → planos Empresa/Assessoria → entrada demonstrativa → onboarding → Hoje → processo do CNPJ → resumo integral → documentos → revisão integral → proposta → integrações operacionais → retorno ao processo.**

O percurso deve ter continuidade de contexto, inclusive ao voltar, e não abrir sempre o mesmo exemplo desconectado do CNPJ selecionado. Usar duas empresas e processos fictícios claramente identificados. Mostrar a diferença entre comprador Empresa e organização Assessoria sem confundir cargo de analista, papel de acesso e plano.

### Landing e planos

- Reutilizar marca azul e direção visual aprovada. Apresentar a dor concreta: identificar oportunidades adequadas, preparar documentos/propostas com menos retrabalho e manter decisões e pendências por CNPJ.
- Mostrar uma prévia realista da jornada e três blocos funcionais: entender a oportunidade; preparar a participação; acompanhar a operação. Não anunciar cobertura nacional completa, sucesso garantido, ganho percentual, robô/conector já homologados ou segurança absoluta.
- Separar **Para sua empresa** e **Para assessorias**. Empresa atende equipe interna de um CNPJ; Assessoria acrescenta carteira, responsáveis, solicitações ao cliente e prestação de contas. Esses recursos adicionais ainda incompletos devem ser marcados como previstos, não apresentados como operacionais.
- Planos de referência: Empresa R$149/mês, 1 CNPJ e 2 operadores; Assessoria R$299/mês, 3 CNPJs e 3 operadores; expansão Equipe R$599/mês, 10 CNPJs e 8 operadores. **Hipóteses para validação, sem preços/franquias aprovados.** Não inventar descontos anuais, períodos grátis ou benefícios ilimitados.
- Botão principal leva a **Explorar demonstração**, não compra ou pagamento. Checkout indisponível nesta demonstração. Não simular pagamento aprovado nem ativar assinatura. Caso apareça seleção de oferta, nomear “Perfil da demonstração”, com escolha reversível.
- Incluir conteúdo de ajuda/onboarding essencial à primeira preparação; não fabricar artigos completos, avaliações, número de clientes ou depoimentos.

### Entrada e onboarding

- Reutilizar aparência de `AuthLogin`; a entrada é explicitamente fictícia, sem chamar autenticação real. Não solicitar senha pessoal ou credenciais governamentais. A ação deve dizer “Entrar na demonstração” ou equivalente inequívoco.
- Mostrar estados de login/recuperação somente com dados e mensagens de exemplo, sem enviar e-mail ou representar redefinição real de senha.
- Onboarding curto: perfil Empresa/Assessoria → empresa/CNPJ fictício → documentos e responsáveis demonstrativos → abrir primeira oportunidade. Permitir pular e voltar com checklist de pendências visível.
- Assessoria recebe carteira de dois CNPJs fictícios para provar a troca; isso não implementa o limite comercial de três nem uma autorização real. Empresa começa no seu contexto e não vê a carteira de terceiros.

### Hoje, navegação e processo

- Hoje deve priorizar ações: documentos pendentes, revisão aguardada, sessão próxima e decisão do cliente. Evitar dashboard composto apenas por números grandes sem destino útil.
- Reutilizar `AppShell`, com sidebar recolhível, teclado, rótulos acessíveis e tooltips quando recolhida. **CNPJ/empresa e processo ativo permanecem visíveis**, incluindo no mobile e com sidebar recolhida.
- Navegar por oportunidade/processo/CNPJ usando IDs de fixture, nunca apenas nome visual. Troca de CNPJ conserva rascunhos separados e invalida revisão/autorizações afetadas; A→B→A não reaproveita autorização de A.
- Cada ação da página Hoje abre a seção/processo correto. Voltar retorna ao contexto anterior e ao estado coerente, sem perda silenciosa ou reinício de uma execução.
- Pendências ou rascunho não salvo geram tratamento explícito de navegação; não usar confirmação genérica para todo clique. Em carregamento ou erro, manter contexto legível.

### Resumo, documentos e proposta

- Montar o resumo existente sem mudar seu conteúdo ou adicionar campos. **As 18 seções devem abrir expandidas**; recolher é opcional. Não incluir “considerações da equipe”, caixas de anotação ou gate para ler o resumo.
- Resolver eventuais cortes no contêiner responsivo, sem editar o módulo de resumo protegido. Impressão/envio existentes não devem ser modificados nem acionados de verdade. Botão demonstrativo não pode afirmar e-mail enviado.
- Reutilizar `PerfilDocumentos` e `KitProposta`, com a revisão integral do documento antes de aprovação. Mostrar claramente versão, fontes, empresa e pendências. Editar dado relevante invalida a revisão.
- Proposta mostra itens selecionados, quantidade, unidade, marca/modelo, preço e total coerentes. Custos/margens privados não aparecem no documento externo. Não ampliar implicitamente o limite real de 50 itens do kit só porque o módulo operacional demonstra milhares.
- Transferência ao módulo operacional mantém contexto e mostra **“Preparação demonstrativa; autorização do portal não concedida”**. Se o contrato de transferência ainda não existir no componente, marcar a lacuna e entregar a passagem de fixture explicitamente, sem fingir ligação ao backend real.

### Integrações operacionais

- Reutilizar a versão salva mais recente de `IntegracoesOperacionais`, inclusive recuperação/conciliação corrigidas. Não reconstruir nem regressar seus testes.
- Conexão IA, cadastro e robô têm autorizações separadas. Não transformar revisão de documento em permissão de cadastro/lance. O estado demonstrativo nunca deve aparecer como conectado ao portal real.
- Botões devem executar somente o comportamento fictício declarado. Se uma ação real ainda não existir, usar estado claro de indisponibilidade e próxima etapa, sem sucesso fictício.

## Acabamento visual premium

Usar os tokens e tipografia aprovados, espaços consistentes, hierarquia clara, tabelas legíveis, estados discretos e ações principais inequívocas. Evitar gradientes ornamentais, excesso de cards, ícones aleatórios, sombras exageradas ou texto de marketing genérico. O aspecto profissional vem de densidade adequada, consistência e clareza da operação.

Claro e escuro devem cobrir a jornada inteira; contraste e foco visível, sem significado apenas por cor. Tema não muda dados ou contexto. Layouts de 375, 704 e 1280 px precisam permitir concluir o percurso. Tabelas podem ter rolagem delimitada e identificada; página inteira não deve cortar conteúdo lateralmente. A sidebar recolhida não remove nomes acessíveis nem contexto do CNPJ.

Estados transversais: vazio, carregamento, erro recuperável, sem permissão demonstrativa, sessão demonstrativa expirada, CNPJ alterado e rascunho pendente. A interface não pode esconder erro sob um contador de sucesso.

## Matriz de aceites

| Caso | Percurso / ação | Resultado obrigatório |
|---|---|---|
| A — Empresa | Landing → plano de referência → entrada demo → onboarding → Hoje → processo A → resumo → documentos → proposta | Contexto A contínuo; resumo integral; documento integral antes de aprovação; nenhum pedido de credencial real, checkout ou chamada externa. |
| B — Assessoria | Selecionar Assessoria → carteira → processo A → processo B → retorno A | Dados, rascunhos e pendências separados; revisão/autorização antiga não reativada; ações da carteira abrem o cliente correto. |
| C — Operação | Proposta revisada demo → integrações → pausa/recuperação → voltar ao processo | Revisão não autoriza portal; contexto preservado; versão atual da recuperação mantida; sem iniciar automaticamente ao navegar/voltar. |
| Resumo protegido | Abrir de oportunidade, processo e retorno do kit | 18 seções expandidas inicialmente, zero campos de consideração; nenhuma alteração de conteúdo/hash. Contêiner não corta a direita. |
| Documento | Revisar integral → editar dado/empresa → tentar aprovar/exportar | Revisão invalidada, pendência visível; valores e custos privados separados; sem exportação real externa não autorizada. |
| Responsividade | Casos A/B em 375/704/1280, claro e escuro | Conteúdo legível e alcançável, foco/teclado, CNPJ sempre visível, sidebar recolhe/expande sem perda de contexto. |
| Erros | Vazio, carregamento, falha, permissão, expiração e rascunho | Causa e recuperação claras; nenhum sucesso falso ou reset silencioso. |
| Navegação | Links, voltar, atalhos, recarga conforme contrato existente | Destino e contexto corretos; ausência de link morto; recarga não herda autorização de execução. |
| Oferta | Planos e recursos exibidos | Preço rotulado hipótese; recurso previsto/demonstrativo separado do comprovado; sem checkout ativo ou promessa de escala. |
| Integridade | Comparar antes/depois | Módulos/tokens protegidos iguais; nenhum serviço real, envio, credencial, custo ou compartilhamento novo. |

## Entrega e comprovação

Entregar o percurso navegável no catálogo privado, com ponto de entrada claro para o proprietário ver **Empresa** e **Assessoria**, sem precisar localizar manualmente cada componente. Salvar, recarregar e testar a versão salva.

Fornecer versão, arquivos alterados, comparação de hashes dos preservados, testes efetivamente executados e capturas representativas: landing clara, landing escura, Hoje com sidebar recolhida, processo com resumo aberto, documento integral e carteira com CNPJ. Não criar imagens conceituais que não correspondam à prévia implementada.

Separar a conclusão da **apresentação integrada demonstrativa** da conclusão do **produto real**. Informar lacunas funcionais restantes com destino e causa. Não chamar “pronto para vender” apenas porque a navegação está bonita; ao mesmo tempo, não encerrar com mais uma especificação se a implementação da jornada puder ser concluída neste escopo.
