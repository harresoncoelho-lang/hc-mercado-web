# Homologação do Design System nativo do Claude — atualização 30/10/2026

## Atualização vigente: revisão documental v38

O mesmo catálogo privado chegou à v38. O principal conferiu na interface nativa a declaração integral antes da revisão; cancelar mantém pendência, reabrir permite confirmar e a proposta continua pendente. Revisão independente executou 162/162 asserções com rede bloqueada e comprovou o defeito na v37 e a correção na v38. Foram conferidos 20/20 hashes, com sete protegidos preservados. Os dois caminhos dos scripts foram corrigidos no ZIP de evidências e conferidos: produto/teste principal idênticos, nenhuma evidência antiga removida e 63/63 hashes do inventário válidos. Sem publicação do SaaS ou mudança de resumo/e-mail/robô.

Relatório atual: [retomada-design-ai-studio-20261030.md](retomada-design-ai-studio-20261030.md). Parecer independente: [revisao-kitproposta-v38-20261030.md](revisao-kitproposta-v38-20261030.md). O código local básico por CNPJ passou em novos testes com fixtures; continua separado do protótipo TXT. Após o aceite explícito, os três testes fictícios de leitura no AI Studio foram executados: textual, escaneado e dois CNPJs. Conteúdo/ausências preservados e CNPJs separados, porém nomes dos arquivos vieram genéricos. Avaliação em [resultados/RELATORIO.md](ai-studio-leitura-20261030/resultados/RELATORIO.md). Nenhuma integração automática ou publicação foi realizada. As seções seguintes preservam o histórico de outras rodadas.

## Retomada: teclado e contraste, versão 32

No mesmo catálogo privado, o Claude salvou a revisão 32 dos dois componentes `PerfilDocumentos` e `KitProposta`. Cinco ações no gerador específico foram corrigidas: anexar/substituir documento, trocar modelo por radio, gerar prévia enquanto pendente, aprovar e sair/reentrar na sessão demonstrativa. A atualização da interface agora preserva ou encaminha o foco para a próxima ação correspondente. Gerar prévia mantém o botão focalizável e ignora acionamentos repetidos enquanto há geração pendente. Nenhuma funcionalidade documental nova foi acrescentada.

**Conferência direta do principal no aplicativo nativo:** em `KitProposta`, sair da sessão demonstrativa e pressionar Enter acionou “Entrar novamente”; o foco voltou visivelmente para “Sair da sessão”. Tab e seta direita levaram à aba Documentos com contorno de foco. Tab selecionou “Substituir (simulado)”; Enter mostrou a validade sugerida e manteve o foco em “Confirmar validade sugerida”; outro Enter confirmou 28/02/2027 e devolveu o foco para Substituir. Em Modelos e proposta, Tab focalizou Declaração e seta para baixo selecionou Proposta de preços com foco visível, exibindo os itens da Empresa Exemplo. Tudo com fixtures, sem upload, autenticação real ou envio. Esta passagem direta foi no tema claro e no painel nativo estreito; não é inspeção de todas as combinações.

**Evidência relatada pelo Claude, separada da passagem direta:** teclado 60/60 nas duas composições em 375/704/1280; formação 104 verificações; layout 190; regressões de cadastro, A→B→A, processo, invalidação, leitor e sessão aprovadas. O TXT efetivamente lido no teste tem 803 bytes, CNPJ fictício 00.000.000/0001-00, preços R$ 330,00 e R$ 150,00, totais R$ 165.000,00 e R$ 30.000,00, sem custos/frete/acréscimo internos. O teste não comprova download pelo visualizador nativo em sandbox e não é DOCX.

O primeiro relatório do Claude apontou baixo contraste usando um `tokens.json` local desatualizado. O principal conferiu na tabela nativa Colors os valores de `border-strong`: **Claro #7A879B; Escuro #7786A0**. O Claude então releu os tokens ao vivo do mesmo catálogo e refez somente o harness: 32 pares medidos, zero falhas; bordas com relações 3,64:1 e 4,95:1 sobre as superfícies testadas. O falso alerta e a pergunta de decisão foram retirados. Nenhuma mudança de paleta global foi necessária. As medições são cálculo/harness com tokens ao vivo, não extração de estilos computados do aplicativo nativo.

**Preservação e versionamento:** o Claude confirmou hashes ao vivo iguais à sua baseline para `ResumoCompleto`, `SummaryFull`, `JornadaIntegrada`, `BoletimOportunidades` e `InteligenciaHub`; `ds2/lib.py` local também igual. Os dois previews salvos foram relidos e comparados byte a byte. Contudo, tokens e `design-system.json` ao vivo já diferem das cópias locais antigas; não havia baseline ao vivo anterior à tarefa que permita datar essa diferença. Não afirmar igualdade desses dois arquivos com a baseline local. A operação retornou versão 32; a leitura anterior correspondia ao conteúdo v30, mas o Claude não conseguiu identificar a revisão intermediária 31. Nenhuma versão foi restaurada e nenhum compartilhamento foi ampliado.

Evidências no ambiente do Claude: `scratchpad/reg_kbd/HASHES_E_RESULTADOS.md`, `scratchpad/t_kbd.js`, `reg_kbd/contrast_live/contrast.json`, `reg_kbd/txt_live/`, `scratchpad/verify_v32/`. O catálogo permanece [LicitaPlena](https://claude.ai/artifact/6Th8mgnv1z1aoYAvCixrGc), apenas do usuário. Limites: sem leitor de tela, sem varredura de Tab em todos os elementos, sem exportador DOCX novo, sem integração produtiva. A passagem nativa direta não repetiu aprovação/download nem o fluxo inteiro de ambos os componentes. Resumo, e-mail e robô da aplicação não foram editados nesta retomada.

**Histórico anterior: versão 30 do mesmo catálogo privado.** Documentos e propostas por CNPJ receberam identidade/timbrado e formação simples de preço nas versões 29–30. A v28 acrescentou o estado de consulta limitada em InteligenciaHub; a remoção dos campos de anotações por seção foi concluída na v26. Nenhuma dessas versões publica o SaaS. Os números antigos abaixo são históricos; as 27 UFs estão recuperadas localmente e o histórico de atas permanece incompleto, nos relatórios próprios.

## Documentos e propostas por CNPJ — versões 29 e 30

Alterados somente os fluxos existentes `PerfilDocumentos` e `KitProposta`, seus geradores, testes e documentação. Reutilizados os modelos, cadastro, documentos, fontes/versões e revisão. Mantidos o mesmo artefato privado, modelo e autenticação do Claude. Plano: `docs/superpowers/plans/2026-10-28-documentos-propostas-ds.md`.

- A prévia documental apresenta logo de exemplo ou timbrado somente com texto, cabeçalho e rodapé com identidade da empresa. Proposta mantém dados bancários e condições; declarações conservam seu conteúdo próprio.
- Custo-base, frete unitário, outros custos unitários e acréscimo sobre custo pertencem ao CNPJ, processo e item selecionados. Campos vazios permanecem pendentes; zero precisa ser informado explicitamente nas despesas. O percentual é acréscimo sobre custo, não margem sobre venda; não há cálculo tributário automático.
- A sugestão não substitui o preço manual. Somente “Aplicar preço sugerido” altera a oferta e invalida a aprovação anterior. Alterar custos internos sem aplicar não muda o documento externo. Custos e acréscimo não entram na proposta destinada ao cliente/órgão.
- A v29 apresentou corte dos campos na coluna nativa. Na v30, os blocos de custos saíram da área de rolagem horizontal da tabela e ganharam grade responsiva própria, identificada por lote/item. A tabela original conserva sua rolagem.

**Conferência direta do responsável no aplicativo nativo, v30:** no `KitProposta`, a oferta inicial de R$ 330,00 permaneceu intacta após informar custo de R$ 2,50, frete de R$ 0,50, outros custos de R$ 0,00 e acréscimo de 20%. A sugestão foi R$ 3,60. Depois do clique explícito em aplicar, o item passou a R$ 3,60 e o total, para 500 unidades, a R$ 1.800,00. A prévia exibiu logo, nome, CNPJ, endereço, banco fictício, representante, fonte/versão e rodapé da Empresa Exemplo; não exibiu custos internos. Segundo item e condições ainda pendentes impediram aprovação/download.

A troca para Comercial Modelo ME limpou a prévia anterior e mostrou ofertas pendentes e custos vazios da outra empresa. Claro e escuro foram inspecionados visualmente. Nas colunas nativas de aproximadamente 650 e 450 px, os quatro campos, mensagem longa e botão de aplicar ficaram visíveis, sem o corte encontrado na v29. Tabela e abas ainda usam rolagem horizontal própria. Não houve nova execução direta completa de A→B→A ou de todas as 18 seções do resumo nesta rodada.

**Testes relatados pelo Claude, distintos da conferência direta:** `t_formacao.js` passou 104 verificações, incluindo isolamento por CNPJ/processo, entradas inválidas, leitura/sessão, revisão, privacidade dos custos e correspondência entre preço aplicado e documento. Foi corrigida uma asserção inicialmente permissiva: a prévia mantém R$ 330,00 antes de aplicar; com sugestão de R$ 11,51 aplicada, mostra R$ 11,51/R$ 5.755,00 e deixa de mostrar a oferta antiga. `t_layout.js` passou 190 verificações nas duas composições, em 375/450/650/704/1280 px, incluindo limites geométricos de campos, mensagens e botões. Guardas de cadastro, fluxo, anotações, PNCP e busca passaram. O teste de cadastro passou a aguardar a geração já existente de 600 ms; a falha também ocorria na baseline v28, sem mudança no tempo do produto.

O Claude comparou os hashes de `ResumoCompleto`, `SummaryFull`, `JornadaIntegrada`, `BoletimOportunidades` e `InteligenciaHub`: permaneceram iguais aos da v28. Runtime e tokens não tinham hash anterior à v29; houve relato de que não foram editados, e igualdade entre os registros posteriores da v29 e v30. Não extrapolar essa evidência para uma prova byte a byte anterior à v29. Prévias e READMEs dos alvos foram relidos e comparados após salvar.

Evidências no ambiente do Claude: `scratchpad/formacao_run.txt`, `formacao_run2.txt`, `layout_run.txt`, `cad_run.txt`, `flow_run.txt`, `protect_before/hashes.txt`, `protect_before/runtime_tokens_after.txt`, `verify_v29/`, `verify_v29_readme/`, `bloco_375.png` e `bloco_650.png`.

**Limites:** dados e logos são fictícios; esta entrega é o Design System interativo, sem persistência remota, upload real ou ligação nova com o backend. O download TXT não foi acionado diretamente nesta rodada e não foi criado exportador DOCX no catálogo. Não houve percurso completo por teclado nem medição de contraste. O achado anterior de largura na JornadaIntegrada continua fora desta fatia. Resumo, e-mail e robô de boletins da aplicação não foram alterados; nenhum envio ou publicação foi realizado.

## Consulta limitada na busca — versão 28

No mesmo cadastro privado, a composição `InteligenciaHub` passou a oferecer a aba final “Busca de oportunidades”, com dados fictícios e três cenários: base salva dentro do limite, base salva no limite e busca ao vivo bem-sucedida com complemento da base salva limitado. O aviso reutiliza a apresentação discreta existente, sem alterar o resumo ou criar outro catálogo. A aba inicial continua sendo Diagnóstico de mercado.

**Conferência direta no aplicativo nativo:** o responsável abriu Configurações → Design systems → LicitaPlena (Apenas você), chegou à conversa vinculada ao mesmo artefato e operou a composição. No claro, o cenário dentro do limite não apresenta aviso; no limite aparece “Consulta à base salva limitada a 20 mil registros. Algumas oportunidades podem não aparecer.” O terceiro cenário explicita que a busca ao vivo respondeu e que a limitação é do complemento. A troca para PA filtrou os cartões e reiniciou a paginação; voltar ao cenário dentro do limite removeu o aviso anterior. No escuro, filtros, cartões e aviso foram conferidos visualmente. A prévia foi vista na coluna nativa estreita, de aproximadamente 450 px, sem corte dos controles testados; as abas possuem rolagem horizontal própria. Não houve medição de contraste nem percurso completo por teclado.

**Relato do Claude, não confundido com execução direta:** `t_busca.js` passou 47 verificações em Chromium local nas larguras 375/704/1280; `t_notes.js` e `t_pncp.js` passaram. Os guardas verificaram ausência de campos extras e 18 seções abertas nas composições protegidas. O Claude relatou mudança apenas em `ds2/more.py`, descrição no gerador, prévia/README de InteligenciaHub e README geral; não alterou BoletimOportunidades, ResumoCompleto, SummaryFull, JornadaIntegrada nem helper compartilhado. Relatou conflito de revisão do artefato, leitura e comparação da versão mais nova antes de salvar a v28; não ampliou compartilhamento. A revisão v26 abaixo permanece como prova direta anterior do resumo, não como nova execução integral na v28.

A correção funcional local correspondente passou por três revisões independentes e `npm run verify`: **788 testes, 784 aprovados, quatro ignorados, zero falhas**, lint zero erros/55 avisos. Esse resultado é do código local, não do backend publicado nem da demonstração. Ver `verify-cobertura-consulta-20261028.log` e `paginacao-historico-validacao-20261028.md`.

## Correção solicitada pelo usuário — versão 26

Removidos os rótulos e textareas "Consideração da sua equipe (salva nesta seção)" e a lógica de anotações por seção. Não foram transferidos ou renomeados. A referência continua sendo o resumo original, sem campos extras.

Verificação direta do responsável no editor nativo: `ResumoCompleto` possui 18 botões de seção "Recolher" ao abrir, zero campos editáveis com aquele rótulo e nenhum textarea de anotações. As seções 9 (itens), 10 (habilitação) e 11 (atestado), mostradas no pedido do usuário, foram conferidas visualmente sem as caixas. O catálogo continua "Apenas você". Nenhum arquivo do resumo publicado, envio de e-mail ou robô foi alterado.

`SummaryFull` também foi aberto diretamente: 18 seções "Recolher" e zero campos editáveis. Em `JornadaIntegrada`, o caminho Empresa → Oportunidade → Acompanhar → Abrir processo abriu o resumo com 18 seções expandidas e zero campos de consideração da equipe. Na janela nativa estreita, o passo Resumo da Jornada ainda cortou conteúdo à direita; esse achado de largura não foi corrigido pela remoção dos campos e não deve ser descrito como layout inteiramente validado.

Relato do Claude, separado da verificação direta: `t_notes.js` examinou as 61 prévias, além de `ResumoCompleto`, `SummaryFull` e `JornadaIntegrada` em Chromium; `t_pncp.js` passou. Gerador `ds2/others.py`, helper, prévia de ResumoCompleto e README foram corrigidos; a seção final original foi preservada. Impressão e envio demonstrativos não foram revalidados integralmente nesta correção; nenhum e-mail real foi enviado.

## Destino e escopo

O trabalho visual ocorre no [Design System nativo LicitaPlena](https://claude.ai/code/artifact/2c37c3c7-4bb3-474d-85e2-24267a3e1435), cujo [catálogo web](https://claude.ai/artifact/6Th8mgnv1z1aoYAvCixrGc) corresponde ao mesmo cadastro. Não foi criado outro Design System. Mantidos Direção A, azul original, temas claro/escuro e identidade existente.

Os exemplos do catálogo são fictícios. A prévia do Claude e a homologação técnica local são evidências distintas: a primeira valida apresentação/interações; a segunda exercita os handlers com autenticação, banco e arquivos reais locais. Nenhuma delas comprova que produção recebeu as correções.

## Verificação direta no catálogo — versão 20

O agente principal percorreu o fluxo dentro do editor nativo:

- Cadastro confirmado → modelo com fonte → preços em formato brasileiro → confirmação da adequação do atestado → prévia → revisão explícita → aprovação.
- Proposta: `330 × 500` e `250,25 × 200` produziram total de **R$ 215.050,00**.
- A adequação do atestado permaneceu obrigatória para concluir o fluxo.
- Trocar CNPJ de A para B e voltar a A descartou prévia e aprovação anteriores.
- Temas claro e escuro conferidos visualmente.
- O botão de baixar `.txt` confirmou uma solicitação na interface. **O arquivo baixado não foi confirmado**; não registrar exportação concluída a partir dessa mensagem.

## Verificação direta no catálogo — versão 21

- `ResumoCompleto` abriu com as 18 seções expandidas. A árvore de acessibilidade apresentou 18 botões “Recolher”. Fechar e reabrir a primeira seção funcionou.
- No papel de leitor, tentar “Confirmar validade” retornou “Acesso negado”; o documento continuou pendente.
- As ações empilhadas na largura de 704 px melhoraram a disposição dos controles.
- **Achado da versão 21:** após “Substituir”, a mensagem de retorno se sobrepôs às ações. Corrigido e retestado na versão 22, conforme registro abaixo.

## Reteste direto e encerramento visual de documentos — versão 22

A versão 22 foi confirmada pelo texto do editor nativo, no mesmo cadastro privado. O agente principal testou `KitProposta` na largura de 704 px:

- Em Documentos, “Substituir” na primeira certidão mostrou a mensagem azul abaixo de “Confirmar”/“Descartar”, sem sobreposição; o cartão envolveu todo o conteúdo.
- “Confirmar” alterou o documento para válido até **28/02/2027**.
- “Simular erro” apresentou o erro e a ação “Anexar de novo”, com mensagem abaixo dos controles e sem sobreposição.
- Alternar para escuro manteve o estado e a legibilidade. O tema claro também foi observado.

O Claude **relatou** 36 verificações em 375, 704 e 1280 px nas duas composições, além de um teste novo que reprovou 24 casos na versão 21 e passou na versão 22. Esse relato automatizado é distinto do reteste direto acima; não corresponde a inspeção nativa independente de todas as 36 combinações.

## Achado adicional no boletim e reteste final — versão 24

Na inspeção nativa anterior de `BoletimOportunidades` a 704 px, cabeçalho, controles e filtros ficaram cortados; o botão do menu não alterou seu rótulo ao recolher. A correção foi aplicada no mesmo catálogo privado e a versão 24 foi confirmada no editor.

Reteste direto do agente principal em `BoletimOportunidades`, a 704 px:

- Cabeçalho, filtros e controles couberam; a tabela apresentou rolagem própria visível e os cartões se ajustaram.
- Recolher mudou o rótulo para “Expandir”; expandir restaurou “Recolher”.
- A busca `PE346` filtrou para um único cartão; “Limpar” restaurou os resultados.
- Temas claro e escuro permaneceram legíveis.
- A abertura do resumo a partir do cartão **não foi confirmada**; não inferir esse resultado a partir do teste de busca.

Em `ResumoCompleto` v24, o controle “Cobertura parcial” abriu um seletor identificado como demonstração. O principal navegou também com a tecla de seta para cima e conferiu:

- Parcial com uma de duas UFs e três de cinco páginas.
- Um estado alegado completo com essas mesmas faltas continuou **PARCIAL**, com explicação.
- Completo com duas de duas UFs e cinco de cinco páginas afirmou conclusão **somente do recorte**.
- Falha, atualizando e desatualizada apresentaram o estado correspondente, fonte e data, sem conclusão indevida de cobertura.
- Após essas interações, a árvore acessível ainda apresentou 18 botões numerados “Recolher”, confirmando as seções abertas do resumo.

Os estados de dados PNCP foram tratados separadamente da leitura/OCR dos arquivos do edital. O critério de sete dias usado no exemplo é uma **fixture de demonstração**, não um SLA operacional validado. O Claude relatou testes desses estados nas duas composições e regressão da jornada; esse relato é separado da inspeção nativa direta descrita acima. Não houve instalação dessas mudanças no SaaS.

## Homologação técnica e documentos reais locais

Relatório detalhado: [HOMOLOGACAO-KIT-REAL.md](HOMOLOGACAO-KIT-REAL.md). Evidência estruturada: [homologacao-kit-real-local.json](homologacao-kit-real-local.json).

O fluxo passou com PostgreSQL, Auth, PostgREST e Storage reais, somente em loopback, usando empresas e documentos fictícios. Foram exercitados isolamento por organização/CNPJ, bloqueio de escrita de leitor, acesso de conta pendente, escopo do processo, proveniência, revisão explícita e invalidação após mudanças em preço, identificação ou arquivo. A limpeza dos dados criados pelo teste foi conferida.

O Microsoft Word **está instalado e foi utilizado**. O agente principal abriu a proposta Alfa e a declaração Alfa: sem alerta de reparação/formato, com texto legível e sem cortes observados. A proposta mostrou dois itens e total de **R$ 3,71**; a declaração mostrou os dados substituídos da empresa Alfa. Nenhum documento foi alterado ou salvo. O documento Beta e documentos longos não foram inspecionados visualmente.

O schema-base local é uma fixture reconstruída, não um clone autoritativo de produção. Os testes locais não certificam os dados legados, permissões ou configurações do banco remoto.

## Testes e revisão de código

O [log consolidado](verify-final-homologacao-20261028.log) de `npm run verify` registra **713 testes: 709 aprovados, 4 ignorados e zero falhas**. Lint: zero erros e 50 avisos preexistentes; 182 arquivos conferidos. Os quatro ignorados são o teste de timeout real de página e três cenários de volumes RAR.

A revisão independente também conferiu a recuperação local de oportunidades, contratos/atas, o timeout que cobre a leitura do corpo HTTP e a retenção por encerramento. Os achados corrigidos incluíram resposta vazia contraditória, integridade de arquivos na retomada concluída e identificação correta do limite de chamadas. Na retenção, editais publicados há muito tempo, ainda abertos ou com encerramento desconhecido, são preservados; a poda usa encerramento comprovadamente antigo, tanto em memória quanto na chamada REST.

Graphify: conferidas a regra de atualização AST em `CLAUDE.md` e a skill instalada. Neste worktree não existem `graphify-out/` nem `graphify-out/graph.json`; portanto, não havia grafo-base para atualização incremental. O executável e o Python isolados de Codex existem em `C:/Users/harre/Documents/Codex/Tools/graphify/.venv/Scripts/`. Não houve criação de grafo novo, instalação, download, extração semântica/LLM, alteração de autenticação ou inclusão dos dados recuperados no grafo. O checkout antigo não foi acessado para essa conferência.

## Cobertura dos dados — recuperação local concluída no recorte

A recuperação de oportunidades concluiu as **13/13 UFs solicitadas, 445 páginas e 21.944 IDs únicos**, sem UF pendente nesse recorte. Foram consultadas AL, BA, CE, DF, ES, GO, MG, PA, PB, PR, PE, RJ e RS no endpoint PNCP de propostas abertas, com `dataFinal=20271028`. PR encerrou com 3.410 registros/69 páginas; suas duas tentativas parciais foram preservadas e excluídas do consolidado. Referência operacional: [recuperacao-cobertura-local.md](recuperacao-cobertura-local.md).

Evidência final: `C:/Users/harre/AppData/Local/LicitaPlena/recuperacao-pncp-20261028-consolidado/conferencia.json`, consolidada em **28/10/2026 às 03:23:06 UTC**; a última conferência de PR ocorreu às 03:22:47 UTC. O inventário registra SHA-256 das 445 páginas aceitas, quatro manifestos e do consolidado. Nesta revisão, a soma das páginas e os totais foram conferidos no JSON, e o hash do arquivo `oportunidades-pncp-bruto.json` foi recalculado e confirmou o inventário: **44.324.922 bytes**.

Os registros observados têm publicação entre `2023-09-12T10:25:39` e `2026-10-28T00:00:11`, com encerramento entre `2026-10-27T23:59:00` e `2027-10-28T23:59:00`, conforme os campos retornados pela fonte. **4.507 foram publicados antes de 30/06/2026**; a correção da retenção impede descartá-los apenas por essa idade de publicação.

O resultado cobre propostas abertas retornadas para essas 13 UFs até a data final consultada. As outras 14 UFs não foram aferidas nesta rodada. O PNCP não oferece snapshot transacional; contagem, unicidade e reconferência da primeira página não provam imutabilidade entre requisições. Não houve importação no Supabase nem comprovação de sincronização produtiva.

A fatia de contratos/atas foi concluída e conferida, conforme [evidência estruturada](recuperacao-contratos-atas-evidencias.json) e [relatório específico](planejamento-recuperacao-contratos-atas.md):

| Conjunto | Resultado local confirmado |
|---|---|
| Contratos publicados de 24 a 27/10/2026 | **15.348 IDs únicos, 31/31 páginas**, contagem e primeira página conferidas |
| Atas selecionadas | **5/5**, vinculadas a quatro compras |
| Itens das compras | **59**, incluindo uma compra de 41 itens |
| Resultados retornados | 19 linhas em 17 itens; 42 itens sem resultado — 41 “Em andamento” e um “Fracassado”, segundo a fonte |
| Integridade e orçamento | 107 arquivos/26.588.535 bytes conferidos por hash; 110 chamadas, abaixo do teto de 350 |

Saída: `C:/Users/harre/AppData/Local/LicitaPlena/recuperacao-contratos-atas-20261028`. O manifesto registra `concluidaSelecao=true` e **459 atas históricas pendentes**, ligadas a 286 compras. A janela de descoberta histórica e 498 potenciais reparos de UF não foram certificados. O pacote não infere vínculo de cada vencedor a todas as atas da compra. Essas contagens não comprovam recuperação de todo o histórico ou solução do timeout do banco remoto.

Não confundir “páginas recuperadas localmente” com base produtiva sincronizada, nem a seleção de UFs/atas desta rodada com cobertura integral de todos os estados, períodos ou provedores.

## Preservação e limites

O diff dos fluxos protegidos permanece vazio nesta etapa: `painel.html`, `netlify/functions/enviar-resumo-edital.js`, `scripts/boletim_editais.py` e `.github/workflows/boletim-editais.yml`.

Não houve deploy do SaaS, importação de dados em produção, migração ou DELETE remoto, envio SMTP ou execução do robô de boletins. Os testes de interface não alteram o resumo/e-mail utilizados pelo usuário.

A sobreposição em Documentos foi encerrada na v22; os cortes e rótulos do boletim e os estados de cobertura foram retestados na v24. A revisão visual desta rodada e a recuperação local dos recortes declarados estão encerradas. O download `.txt` e a abertura do resumo por um cartão do boletim permanecem sem confirmação direta. Não houve passagem completa de teclado nem medição de contraste em todas as combinações desta rodada. Persistem as limitações de cobertura histórica, demais UFs e ambiente produtivo descritas acima.
