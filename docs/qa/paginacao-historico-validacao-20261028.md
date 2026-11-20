# Paginação e histórico — validação local de 28/10/2026

## Código validado; recuperação histórica em andamento

O coletor local ultrapassa 20 páginas de oportunidades e retoma os scans interrompidos. O enriquecimento de atas percorre todas as páginas de itens e todos os resultados necessários; nenhuma ata é concluída com contagem truncada ou IDs repetidos. Os limites de tempo continuam interrompendo uma rodada, preservando progresso para a próxima.

Cursores são associados à consulta, com validação da fonte e de identidades. Registros são persistidos antes dos blobs de progresso, e estes antes dos checkpoints. IDs volumosos ficam fora dos metadados versionados. Hashes e checkpoints incompatíveis impedem reutilização silenciosa; cursores legados sem evidência suficiente reiniciam a consulta.

Revisão independente identificou e encerrou dois achados: totais inconsistentes dos itens de uma ata e duplicação entre páginas de contratos/atas. O coletor aprovado tem SHA-256 `5ECAD3E65DDDFDFD4BC614D1C8439B80633BD25F98066BAA70166C762C7E782B`.

`npm run verify` executado novamente após congelamento e revisão da retomada adaptativa: **782 testes, 778 aprovados, quatro ignorados, zero falhas**, lint zero erros e **55 avisos de complexidade**. Não são todos novos nem todos preexistentes. Os 182 arquivos do gate foram conferidos; nenhuma correção automática de formato. Evidência: [verify-paginacao-historico-20261028.log](verify-paginacao-historico-20261028.log). `git diff --check` passou.

O utilitário histórico recebeu revisão independente de código e segurança: importação de certificados, catálogo em índice de páginas com hash, seleção explícita de IDs sob demanda, fronteira de caminho, cadência entre rodadas e orçamento mínimo. Os **30 testes direcionados** estão incluídos no gate global acima; sete asserts do encadeador também passaram. Hash do núcleo aprovado: `A69E1397CF9A1A95564E34B8B5793D2E9C98605DD2C4FCB53C6DCB0C43E4A5F0`. No catálogo de janela fixa, páginas antigas são preservadas e revalidadas; o prazo de seis horas vale para a última conferência. Compras parciais mantêm o bloqueio de seis horas. O encadeador só repete orçamento esgotado com progresso; outros erros interrompem.

## Dados e decisão do usuário

Oportunidades: **27 UFs, 698 páginas, 34.209 IDs únicos**, auditados sem duplicação nacional. [Certificado e relatório](recuperacao-14ufs-historico-20261028.md).

Histórico: a fonte declarou 588.331 atas no recorte de vigência 03/08–04/10/2026. O usuário escolheu expressamente **catálogo completo + detalhes das pendências e sob demanda**. A descoberta não deve colocar todas essas atas na fila de enriquecimento. A fila de detalhes contém as 464 referências originais, das quais cinco já foram recuperadas. O comando `--catalogo` prepara posteriormente somente os IDs escolhidos em pasta separada.

**O histórico não está concluído.** [Estado e procedimento](historico-pncp-20261028.md). Às 13h29 de Brasília a fonte mudou de 588.331 para 588.333 registros na página 102; a rotina parou após 101 páginas/50.500 identidades aceitas. As 102 respostas foram preservadas. Três releituras confirmaram os mesmos registros, ordem e conteúdo das páginas 1/101/102. A retomada adaptativa passou por testes e revisão: exige âncoras estáveis para crescimento, recusa redução/duplicatas/mudanças dos registros conferidos, e reconcilia o total de IDs ao fechar. A coleta retomou às 13h59 e avançou além da página 102; às 14h02 havia 105 páginas/52.500 IDs, total então declarado de 588.335. Encadeador local iniciado, aguardando a rodada ativa terminar antes de fazer nova chamada.

O aceite é **todas as páginas percorridas, sem duplicações observadas, contagens conciliadas e verificações de estabilidade**. A fonte não oferece snapshot transacional nem garante ordenação; substituições intermediárias durante a leitura podem escapar das âncoras. Não afirmar ausência de omissões ou inventário integral em um único instante.

O usuário autorizou acompanhamento nesta mesma conversa a cada 30 minutos, somente com aviso na conclusão ou problema. Heartbeat ativo `acompanhar-recupera-o-licitaplena`. Ele verifica processos e evidências locais e não autoriza publicação. Enquanto a rodada está ativa, um erro antigo no manifesto pode ainda refletir a execução anterior; conferir o PID, carimbo de revalidação e avanço antes de concluir que houve nova falha.

## Preservação e limites

Na rodada original de paginação, os arquivos do painel, resumo/e-mail e robô não receberam alterações. Na continuidade, `painel.html` recebeu somente a correção funcional de busca descrita abaixo; não afirmar mais diff vazio para o arquivo inteiro. CSS e blocos do resumo/boletim foram comparados com o baseline e permanecem idênticos. `enviar-resumo-edital.js`, `boletim_editais.py` e workflow de boletins continuam sem diff. Nenhum SMTP, deploy, importação ou escrita em produção. O mesmo Design System privado está na v28, sem reintrodução dos campos extras removidos na v26.

A retenção configurada e o teto de 250 mil contratos continuam no coletor; percorrer todas as páginas não garante conservar todo o acervo de dois anos. Os possíveis 498 registros sem UF ainda não têm lista identificada. As evidências locais não comprovam correção de timeout ou sincronização do banco produtivo.

## Preparação da integração — conferência local adicional

Em 28/10, após o usuário pedir continuidade, a inspeção local identificou condições que precisam ser resolvidas antes de importar. Nenhuma importação ou transformação foi executada nesta conferência.

- `scripts/migrar_dados_supabase.js` recebe dados já normalizados e inicia `main()` ao ser carregado; não possui simulação. Não executar nem importar esse módulo para analisar os arquivos brutos.
- O arquivo certificado das 27 UFs contém `{ufConsulta, dado}`. Esse wrapper precisa passar pelo mapeamento já usado em `scripts/atualizar_dados.js`: preservar `numeroControlePNCP`, transformar objeto/órgão/município e datas, usando `ufConsulta`. Enviá-lo diretamente ao importador produziria chave fallback indefinida. Identidade ausente ou repetida precisa impedir a preparação, não virar chave fabricada.
- A cobertura usa `coberturaPorUf[uf].atualizadoEm/registrosColetados`; o certificado fornece os horários e totais por UF. Preservar a data observada, sem usar o horário da futura importação para fazer uma coleta antiga parecer recente. Metadados só podem confirmar persistência já concluída.
- Os contratos recuperados certificam apenas a consulta de 24–27/10. A futura importação não pode herdar a poda global nem declarar que o acervo inteiro de 730 dias foi recomposto. O importador usa upsert sem comparação temporal: sobrepor um JSON antigo a uma linha remota mais recente pode perder detalhes. Como o estado remoto não foi consultado, ainda não há plano de conflitos validado.
- O catálogo de atas é um índice observado e permanece separado da fila de detalhes. Resultados locais são vinculados aos itens da compra; não comprovam que cada fornecedor/valor foi registrado em cada ata dessa compra. Não copiar automaticamente esses resultados para `vencedores` de todas as atas nem somá-los como contratações independentes.
- O painel tem limites de consulta (20 mil oportunidades e amostras de até mil contratos/atas). A distinção entre amostra sinalizada e cobertura omitida está em análise; não confundir recuperação local, persistência remota e visibilidade na busca.

Próxima prova local possível: reutilizar o harness `vm` já existente em `scripts/atualizar_dados.test.js`, com persistência/poda substituídas por mocks, para validar identidade, campos e datas antes de decidir qualquer ajuste no importador. Não criar exportador paralelo nem alterar o coletor ativo apenas para facilitar essa conferência. O resumo e os envios continuam protegidos; publicação e escrita remota seguem fora da autorização atual.

## Correção da consulta de oportunidades — continuidade de 28/10

Confirmado que o limite de 20 mil do complemento salvo era silencioso, enquanto a consulta ao vivo do Radar permanecia independente. Corrigidos helper/cache e consumidores do Radar/diagnóstico: UF filtrada no servidor antes da paginação, cache escopado por UF e modo de recência, retorno `limiteAtingido` e aviso contextualizado. O atalho para resultados idênticos também atualiza o aviso quando apenas a cobertura muda. O teto continua; atingi-lo não prova que exista o registro 20.001.

O boletim mantém a recência padrão de três dias. Radar/diagnóstico desativam apenas essa recência interna, para não perder consultas antigas ao passar a UF. HTML, CSS e rotinas do resumo e bloco do boletim foram comparados byte a byte com o baseline. Evidência externa: `C:/Users/harre/AppData/Local/LicitaPlena/qa-cobertura-oportunidades-20261028/qa-final.json`. Somente 13 trechos de busca em `painel.html` e testes relacionados foram alterados. SHA do painel: `c8bba8972a8aa8960e7ee13456566da9852d5a51fe6b53c7b433aae4c6aa489b`; testes: `e4e4a4ce00b8f0c45fda35c021862620e1ce394e369ae69bdd947f3e995b4af9`.

RED: oito falhas esperadas; GREEN: 24/24 testes direcionados. Revisões independentes de código, segurança e contrato JavaScript aprovaram, sem P1/P2. Gate final: **788 testes, 784 aprovados, quatro ignorados, zero falhas**, lint zero erros/55 avisos e 182 arquivos. Log `verify-cobertura-consulta-20261028.log`. O Design System v28 representa os três cenários e foi conferido diretamente no aplicativo nativo; detalhes em `homologacao-design-system-claude.md`. Não foi feita consulta autenticada ao servidor real para esta correção, nem teste completo do painel publicado.

Contratos de até mil linhas são amostras normalmente sinalizadas; há consumidores que filtram município/órgão/segmento depois do corte ou descartam `truncado`. Atas têm filtros posteriores ao corte e falta de ordenação/indicador próprio de limite. Permanecem pendências documentadas, não corrigidas por esta fatia de oportunidades.

## Interrupção real do histórico — 28/10 às 14h39 de Brasília

O PNCP não respondeu à página 201 após quatro tentativas; última mensagem `fetch failed`. Coletor e encadeador encerraram sem locks, preservando **200 páginas e 100.000 IDs**. Todos os hashes das páginas aceitas foram conferidos. O log antigo não permite distinguir DNS/TLS/socket ou excluir HTTP 429 intermediário. Uma sonda posterior, às 15h07, fez somente uma tentativa da página 201 e expirou após 25.006 ms, antes de receber status HTTP, cabeçalhos ou corpo. As páginas 1/200 não foram sondadas; nenhuma condição para retomada foi presumida.

Evidências em `C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/sonda-201-1793210819019/relatorio.json` e `handoff-incidente-20261028.json`. O manifesto e o núcleo aprovado estão intactos. O usuário foi avisado nesta conversa, e o acompanhamento de 30 minutos continua ativo. Não declarar coleta ativa até verificar um novo processo e avanço real; não repetir avisos desse mesmo incidente sem mudança relevante.

## Investigação e nova parada — 28/10 às 16h29 de Brasília

A investigação diferencial confirmou DNS/TLS válidos e HTTP 200 nas três consultas, com uma resposta levando 47,434 segundos. Corrigido somente o prazo do catálogo no modo histórico local: 60 segundos, mantendo 25 segundos nas demais rotas/modos. Três regressões RED→GREEN, 33 testes focados, três revisões independentes e gate global aprovado: **791 testes, 787 aprovados, quatro ignorados, zero falhas; lint zero erros/55 avisos**. Log `verify-timeout-historico-20261028.log`. Core SHA `C5AF81CA893D0C6A2D5C8E8080B1C0AAABF6BA93732E5F3ADEFDECDCB686D8C1`. Guardas de conteúdo, cadência, fila e runner preservadas.

A rodada retomada avançou até **230 páginas e 115.000 IDs**, mas parou às **19:29:19 UTC**: a página 230 declarou total de 588.343 e a seguinte, 588.342. A guarda de queda impediu continuidade; runner encerrou sem abrir outra rodada. Processos encerrados, locks ausentes, 230 páginas conferidas sem duplicatas e 240 artefatos íntegros preservados em `historico-pncp-20261028/incidente-queda-1793216166583`. Não se trata de orçamento esgotado nem do erro de timeout anterior. O diagnóstico limitado posterior e a decisão operacional estão em `historico-pncp-20261028.md` e no handoff externo; não retomar nem ignorar a queda sem essa análise.

O catálogo observado e as 459 pendências continuam incompletos. Não houve importação ou escrita em produção. Em paralelo, o mesmo Design System privado chegou à v30 com timbrado e formação de preço por CNPJ; limites e testes em `homologacao-design-system-claude.md`.

**Atualização final às 19:42 UTC:** três releituras diagnósticas haviam mantido IDs/ordem/campos e total coerente de 588.345. Uma revisão independente autorizou retomar pelo código inalterado, com nova validação das âncoras antes da página 231. Essa validação encontrou “Registros da fronteira do catálogo mudaram.” O processo 35196 terminou após duas chamadas, sem aceitar novas páginas; runner não iniciado, processos/travas ausentes. Mantidos 230 páginas/115.000 IDs e 459 detalhes pendentes. Novos brutos e comparação local estão indicados no QA histórico/handoff. Não ignorar essa mudança nem repetir retomada apenas porque uma futura contagem pareça estável.
