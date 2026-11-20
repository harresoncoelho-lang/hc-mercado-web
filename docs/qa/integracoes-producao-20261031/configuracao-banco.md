# Configuração e banco — preparação das integrações

Data: 31/10/2026 UTC. Auditoria do código local e de metadados administrativos permitidos. Nenhuma alteração remota, SQL remoto, publicação, envio, coleta ou execução de função do módulo.

## Conclusão

O módulo foi homologado com serviços reais locais. Após login manual do usuário no navegador interno, a coordenação confirmou o projeto Pages `licitaplena`, seus domínios, build, deployment de produção e nomes das dez variáveis visíveis. A limitação anterior do contexto do Wrangler foi superada para esses metadados pela leitura do IAB, sem trocar a autenticação do CLI. A sessão existente do Supabase também permitiu identificar o projeto correto, a base operacional e o bucket privado. As tabelas e RPCs novas de identificação/kit não foram encontradas nas buscas administrativas. O preview foi inspecionado: usa todas as branches diferentes de produção, a tabela de variáveis está vazia e a tela informa acesso público por padrão. Colunas, constraints, grants, helpers completos, valores/validade dos secrets e isolamento efetivo do ambiente ainda precisam de comprovação.

O trabalho necessário é comparar o catálogo do Supabase esperado com os pré-requisitos abaixo e preparar apenas os deltas necessários. Reaplicar todos os SQLs antigos em sequência seria inadequado: alguns recriam helpers e políticas mais amplas que as versões de segurança posteriores. A produção possui deploy automático em `main`; preparar localmente não autoriza push, merge ou qualquer acionamento desse fluxo.

## Auditoria administrativa inicial pelo CLI

Foi usado o Wrangler **4.151.1 já instalado**, sem instalação ou download. O arquivo `wrangler.toml` do repositório declara um projeto Pages, saída `publico`, data de compatibilidade e `nodejs_compat`; isso é configuração local, não prova do nome real do projeto remoto.

O inventário inicial encontrou `config/default.toml` no diretório nativo do Wrangler. Seu conteúdo não foi aberto. A implementação instalada de `loginOrRefreshIfRequired` foi lida: quando o ambiente é CI/não interativo, falta ou expiração irrecuperável de credencial encerra com falha em vez de iniciar login pelo navegador.

As chamadas reutilizaram a autenticação nativa, em subprocesso sem janela, com `CI=1`, métricas desativadas somente no subprocesso e `VOLTA_HOME` preservado conforme as instruções do usuário. Stdout/stderr foram capturados em memória e reduzidos aos campos necessários. Nenhum token, e-mail ou valor de secret foi registrado pelo roteiro. Os logs nativos do Wrangler não foram inspecionados; o CLI pode manter seu cache normal de metadados.

| Leitura | Resultado |
|---|---|
| `wrangler whoami --json` | Exit 0; autenticação OAuth existente, uma conta e escopos de leitura da conta/Pages disponíveis. Nenhum novo login ou troca manual de autenticação. |
| `wrangler pages project list --json` | Um projeto retornado; nenhum nome/domínio associado ao LicitaPlena. Não foi investigado código ou dados do projeto distinto. |
| `wrangler pages secret list --project-name licitaplena --env production` | Exit 1, projeto não encontrado nesse contexto. Nenhuma listagem de secrets de produção foi obtida. |

O código instalado imprime `project.domains` integralmente, sem filtrar domínios customizados. A API descreve esse campo como domínios customizados associados ao projeto. A lista observada não apresentou `licitaplena.com.br`; isso fundamenta **alvo não identificado no contexto atual**, sem afirmar que a conta é globalmente incorreta. [Contrato público de Projects](https://developers.cloudflare.com/api/typescript/resources/pages/subresources/projects/).

Evidências sanitizadas: `wrangler-identidade-sanitizada.json`, `wrangler-projeto-sanitizado.json` e `wrangler-vinculo-dominio.json`. Nenhum alvo excluído pelo usuário foi acessado. A auditoria administrativa foi encerrada nesse limite; não houve tentativa de outro OAuth, troca de conta ou descoberta de credenciais.

Na etapa do CLI, a próxima evidência era identificar o projeto vinculado ao domínio e ler somente metadados de configuração. Isso foi realizado depois pela coordenação no IAB, conforme a seção seguinte. O endpoint oficial de domínios não foi executado pelo roteiro. [Listagem de custom domains](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/list/).

## Atualização: produção observada no navegador interno

Em 31/10/2026 UTC, após login manual do usuário, a coordenação (`/root`) navegou pela configuração do Cloudflare no IAB e informou o resultado abaixo. Este adendo registra essa observação; o autor do runbook não repetiu a navegação. Os três JSONs do Wrangler continuam como fotografia histórica e não foram reescritos para representar a sessão do navegador.

| Metadado observado | Valor ou estado mostrado |
|---|---|
| Projeto | Pages `licitaplena`, na conta do LicitaPlena. |
| Domínios | `licitaplena.com.br`, `www.licitaplena.com.br`, `licitaplena.pages.dev`. |
| Repositório | `harresoncoelho-lang/hc-mercado-web`. |
| Branch de produção | `main`. |
| Deploys automáticos de produção | `Enabled`; caminhos observados: `*`. |
| Build | `npm run build:cloudflare`; saída `publico`; diretório raiz vazio. |
| Sistema de build | `Version 3`; cache `Disabled`. |
| Compatibilidade runtime | Data `2025-09-01`; flag `nodejs_compat`. |
| Plano observado em Workers Plans | `Free` marcado como `Current plan`; tela informa 100.000 requests/dia e 10 ms de CPU/request. Essa observação não atribui automaticamente esses limites a todo tráfego estático do site. |
| Outras opções exibidas | Placement `Default`; modo `Fail open`. Foram apenas lidas; essa indicação não comprova o comportamento da autenticação/RLS do módulo. |
| Último deployment de produção informado | `c18c02e5-ba7b-4f1c-8e55-81eb78b8fa4b`. |
| Commit associado | `e007249baa13fe863fae4b3b9e783001814282f7`, identificado na tela pelo texto `PNCP29/10/2026 17:32`. Não foi inferido fuso horário para esse texto. |

Os nomes das dez variáveis visíveis no ambiente de produção são: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, `DEFESA_IA_GRATUITA_CONFIRMADA`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODELOS`, `SUPABASE_SERVICE_ROLE_KEY`, `TRANSPARENCIA_TOKEN` e `ZEPTOMAIL_TOKEN`.

`IDENTIFICACAO_EMPRESA_LOCAL` **não apareceu nessa listagem de produção**. A observação identifica uma pendência de configuração, não autorização para adicionar ou ativar a variável. O nome `SUPABASE_SERVICE_ROLE_KEY` está presente; nenhum botão `Value` foi aberto, e seu valor, validade, permissões e correspondência com o Supabase esperado não foram verificados. Nenhum nome de variável de IA implica alteração de modelo, uso de API ou habilitação de cobrança.

A navegação não alterou configuração, deployment, variável, domínio ou plano; `Upgrade` não foi acionado e não há autorização de billing. A configuração de preview foi conferida em leitura, conforme o adendo abaixo. Como produção acompanha `main` automaticamente, push/merge com mudanças dentro de `*` pode publicar; nenhuma dessas ações faz parte desta preparação.

A coordenação informou duas medidas de comparação do build completo: **3.418.954 bytes gzip no padrão, aproximadamente 3,26 MiB**, e **2.798.266 bytes gzip com minificação, aproximadamente 2,67 MiB**. Os defaults do CLI observado não aplicam essa minificação; o comportamento do build gerenciado ainda não foi comprovado. A opção precisa ser uma etapa explícita do pipeline futuro antes de se tratar o tamanho minificado como o artefato que será enviado. Essas medidas não certificam o pacote final nem seu orçamento de CPU. Nenhuma alteração de plano ou publicação foi feita para testá-lo.

### Preview observado no IAB

Fonte: `cloudflare-iab-preview.json`, registrado pela coordenação. O ambiente exibe `All non-production branches`, o mesmo comando `npm run build:cloudflare`, saída `publico`, compatibilidade `2025-09-01` e flag `nodejs_compat`. A tabela de variáveis não contém nomes: aparece a orientação `Configure API tokens and other runtime variables / Import .env`. A área de acesso informa que previews são públicos por padrão e apresenta `Restrict previews`; nenhuma restrição ou configuração foi alterada.

Isso não configura automaticamente uma homologação isolada. A autenticação e os adaptadores atuais apontam para o Supabase de produção; preencher variáveis, por si só, não muda essa identidade. O preview atual não deve ser usado para inserir dados fictícios ou testar escrita contra produção. Também pode haver publicação automática de uma branch diferente de `main`, portanto fazer push em outra branch não é uma alternativa autorizada durante esta preparação sem publicação. Não foi criado, publicado ou testado nenhum preview, e a aba foi devolvida à configuração de produção sem salvar alterações.

## Atualização: estrutura do Supabase observada no IAB

Fonte: `supabase-iab-estrutura.json`, salvo pela coordenação após navegação somente de leitura, em sessão existente do navegador interno. O projeto exibido é `LICITAPLENA`, referência `lsqjamqvmrcyrvowndiu`, correspondente ao código; branch `main / PRODUCTION`, status `Healthy`, organização com plano `PRO`. Esse estado operacional não comprova as configurações de segurança do módulo.

| Área | Observação registrada | Limite da conclusão |
|---|---|---|
| Histórico e backup | Overview mostra última migration `fila_dossies` e último backup `a day ago`. | A tela não é inventário autoritativo de todas as alterações manuais nem prova restauração, conteúdo completo ou backup dos bytes do Storage. |
| Tabelas existentes | Foram observadas `operacao_empresas`, `operacao_documentos`, `operacao_processos`, `operacao_itens_resultado`, `operacao_membros`, `operacao_convites_empresa` e `operacao_limites_cnpj`. | Nomes presentes não comprovam colunas, tipos, FKs, RLS, grants ou compatibilidade completa. |
| Tabelas novas | Em Tables, buscas `operacao_kit` e `operacao_identificacao` retornaram ausência de resultados; `operacao_kit_documentos` e `operacao_identificacao_empresa` não foram encontradas. | Evidência administrativa de que as tabelas esperadas não estão instaladas no schema consultado; não substitui um catálogo completo de dependências. |
| Funções novas | Em Functions, buscas `identificacao` e `gravar_kit_documento` retornaram ausência de resultados. | As RPCs novas esperadas não foram encontradas; nenhuma chamada foi feita para tentar executá-las. |
| Helpers existentes | Funções de acesso, convite e cota apareceram, incluindo `acesso_arquivo_operacao`, `eh_membro_operacao` e `eh_owner_admin_operacao`. | Corpos, donos, assinaturas completas, ACLs e privilégios transitivos não foram revisados. |
| Bucket | `operacao-documentos` existe; `Public bucket` desligado, limite exibido `Unset (50 MB)` e tipos `Any`. | Bucket privado confirmado pela configuração. A privacidade efetiva também depende das policies e dos helpers. |
| Policies do bucket | Quatro policies para UPDATE, INSERT, DELETE e SELECT, todas exibindo papel `public`. INSERT e UPDATE usam condição do bucket combinada com `acesso_arquivo_operacao(name)`. | Papel `public` não significa arquivo público nem comprova acesso anônimo. O predicado e seus helpers são determinantes. |
| Outras policies de Storage | As áreas de outras policies de objects e de buckets exibiram `No policies created yet`. | Observação da UI; não é resultado de uma consulta SQL integral ao catálogo. |

Há uma diferença concreta em relação à versão local homologada: as policies de escrita esperadas em `seguranca_operacao.sql` usam o papel `authenticated` e `escrita_arquivo_operacao(name)`, enquanto INSERT/UPDATE observados no remoto usam `public` e `acesso_arquivo_operacao(name)`. Isso exige comparar a configuração e os corpos dos helpers antes de preparar o delta de segurança. Não é prova, isoladamente, de exposição de dados; tampouco permite considerar o endurecimento de escrita já instalado.

O limite de PDF imposto pela API do módulo não deve ser confundido com o limite atual do bucket compartilhado. Qualquer mudança de MIME/tamanho do bucket exige avaliar os demais usos da Central Operacional; não reduzir permissões ou limites globais apenas para fazer o teste do kit passar.

Os modais de configuração foram fechados com `Cancel` e os de policies com `Close`. Nenhum SQL foi executado; não foram abertas linhas de clientes, pastas/arquivos de conteúdo, nem revelados secrets. Nenhuma migração ou configuração foi salva.

## Delta incremental a preparar após completar o catálogo

1. Usar a base operacional já existente como ponto de partida. Inventariar suas colunas, tipos, constraints, roles/grants e helpers sem reaplicar `operacao_licitacoes.sql`, acompanhamento ou isolamento por empresa por mera precaução.
2. Comparar as policies de escrita e helpers observados com a versão homologada. Preparar somente o delta necessário de `seguranca_operacao.sql`, avaliando todos os consumidores do bucket e mantendo a ordem das dependências. Não aplicar policies antigas como etapa intermediária de uma base já evoluída.
3. Confirmar em catálogo a ausência das novas estruturas e revisar a aplicação de `identificacao_empresa.sql`, do delta de segurança e de `kit_documentos.sql` na ordem adequada. Incluir somente extensões de colunas realmente ausentes. As buscas na UI não tornam todo o DDL pronto para executar.
4. Ensaiar esse delta sobre uma representação isolada da configuração remota antes de aplicação autorizada. Só depois executar os gates e o fluxo autenticado no ambiente correspondente; a homologação anterior do schema reconstruído não substitui esse ensaio de atualização.
5. Preservar o módulo desabilitado e o deployment atual até concluir os controles. A flag ausente e as tabelas/RPCs novas não encontradas são pendências distintas; adicionar somente a flag não completa a integração.

A revisão do pacote identificou também `data/editais_vistos.json` com histórico de destinatários. Os pacotes privados anteriores permanecem preservados e não publicáveis. No fechamento pela coordenação, a seleção pública foi corrigida, o histórico ficou fora da rodada 04 e o arquivo original/robô permaneceram intactos. O isolamento do teste foi revisto e o Worker completo passou em 14 verificações, incluindo PDF e duas exportações, com Auth/REST/Storage fictícios. Resultado final: `RUNTIME-CLOUDFLARE.md`. Esse achado do pacote não constitui evidência de que o histórico já esteja publicado em produção.

## Configuração consumida pelo módulo

| Nome | Uso e condição necessária | Estado remoto |
|---|---|---|
| `IDENTIFICACAO_EMPRESA_LOCAL` | Chave de habilitação já existente, compartilhada pelos handlers de identificação e kit. Sem habilitação explícita, ambos fecham o acesso. Preparar não significa habilitar. | Não apareceu entre as dez variáveis visíveis de produção no IAB. Não foi adicionada nem ativada. |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret exclusivamente no servidor para confirmar a identificação e gravar/revisar a peça pela RPC. Nunca deve integrar arquivos públicos ou o navegador. | Nome presente na listagem de produção. Valor, validade, permissões e vínculo ao projeto não comprovados. |

O código atual não torna `SUPABASE_URL` e `SUPABASE_ANON_KEY` parâmetros configuráveis desses handlers: origem e chave pública são fixas nos adaptadores e na autenticação compartilhada. Elas precisam continuar apontando para a mesma instância. Parametrizar somente dois adaptadores sem tratar autenticação e frontend criaria uma integração inconsistente. Nenhuma alteração desses valores foi feita nesta auditoria.

Não é necessário adicionar provedor de IA, API paga, billing ou secret de e-mail para este percurso de confirmação, preparação e DOCX. Os secrets já usados pelo resumo, e-mail e robôs ficam fora desta mudança. Seus nomes no comentário do Wrangler não comprovam presença remota nem justificam lê-los ou alterá-los.

Em Pages, o adaptador existente copia bindings de texto de `context.env` para `process.env`. Não há, no módulo atual, consumo de KV, R2, Durable Object ou fila Cloudflare. O estado durável e os arquivos privados dependem de Supabase. Nenhum binding novo foi criado.

## Dependências SQL e ordem lógica

Esta é a ordem das dependências **para uma base que ainda não as possui**, não um script para reaplicar indiscriminadamente em produção. O catálogo remoto deve determinar o subconjunto necessário; um nome existente também não garante definição correta.

| Ordem | Arquivo/pré-requisito | Responsabilidade e dependência |
|---|---|---|
| 0 | Auth, roles nativos, `public.clientes`, `public.admins` | Preservar schema existente. São usados `auth.users`, `auth.uid()`, status de cliente aprovado e papel administrativo owner. A base reconstruída de QA não substitui a definição real dessas tabelas. |
| 1 | `supabase/operacao_licitacoes.sql` | Organizações, membros, empresas, documentos, processos e bucket privado `operacao-documentos`. Define helpers e políticas iniciais que as etapas posteriores restringem. |
| 2 | `supabase/operacao_acompanhamento.sql` | Itens/resultados, anexos, contratos e demais dependências do acompanhamento; requer a base operacional. |
| 3 | `supabase/limite_cnpjs_operacao.sql` | Cota técnica, identificação do owner e helpers utilizados pelo isolamento por empresa. Requer base operacional e schema administrativo compatível. Não implementa, por si só, planos comerciais. |
| 4 | `supabase/acesso_empresa_convites.sql` | Membro restrito a uma empresa, índices/FKs compostos, helpers de acesso e políticas por empresa/processo/arquivo. Seu cabeçalho exige as três etapas anteriores. Não envia convites ao aplicar SQL. |
| 5 | `supabase/identificacao_empresa.sql` | Identificação confirmada e proveniência por CNPJ; invalidação por alteração de cadastro/documento/arquivo, RPC privada e gate de prontidão. Exige isolamento por empresa e bucket já privado. |
| 6 | `supabase/seguranca_operacao.sql` | Restrições de escrita por papel/empresa, integridade de escopo, RPC de confirmação e versão mais estrita do gate da identificação. Deve vir depois de isolamento e identificação. |
| 7 | `supabase/kit_documentos.sql` | Peças persistidas, versão, confirmação por usuário e RPC com controle de concorrência. Requer identificação e segurança operacional. A versão homologada normaliza ACLs diretas somente dos três objetos do kit. |
| 8 | `supabase/verificar_kit_prepublicacao.sql` | Gate somente de catálogos para tabela, policy, grants, RPC e trigger do kit. Não instala nem corrige objetos. |

Antes da proposta funcionar, `operacao_itens_resultado` também precisa de `valor_unitario_proposta` (`operacao_itens_valores_unitarios.sql`) e `marca`/`modelo` (`operacao_itens_marca_modelo.sql`). Aplicam-se após o acompanhamento e antes do percurso do kit. Quantidade e valores precisam manter os tipos decimais do schema; o handler solicita projeções `numeric::text` para não perder precisão no transporte.

`operacao_checklist_edital.sql` e `operacao_kanban_sync.sql` pertencem a recursos da interface mais ampla. Devem ser inventariados quando se publicar essa interface, mas não reaplicados apenas para habilitar a persistência do kit. A coluna `documentos_exigidos`, lida pelo kit, já pertence à base operacional.

**Risco de reexecução de bases antigas:** `operacao_licitacoes.sql` redefine `eh_membro_operacao`, `bootstrap_operacao` e policies iniciais. Executá-lo depois das migrações de segurança pode restaurar comportamento antigo ou abrir permissões durante uma sequência parcialmente aplicada. Ter `IF NOT EXISTS` não torna uma cadeia inteira neutra para uma base já evoluída. Nenhuma migração foi executada remotamente.

## Preflight de produção a preparar, somente leitura

1. Projeto de hospedagem, domínios, referência do Supabase e configuração declarada do preview identificados no IAB. Falta conferir o vínculo efetivo do secret de serviço e demonstrar isolamento de um destino de homologação. Registrar nomes/IDs não secretos e hashes das fontes aprovadas; não coletar valores de secrets. A tabela de variáveis de preview vazia não substitui isolamento, pois o código atual aponta para a produção. Nenhum push em branch de produção ou preview está autorizado nesta preparação.
2. No banco certo, inventariar apenas catálogos: versão, proprietário, colunas/tipos, constraints/FKs, RLS, políticas completas, ACLs diretas e de coluna, papéis e associações, grants de funções, `SECURITY DEFINER`, `search_path` e triggers. Comparar definições, não apenas nomes.
3. Bucket privado confirmado na UI; completar a conferência de `storage.objects`, namespace `organização/empresa/arquivo`, helpers, invalidação da identificação e RPCs privadas. Comparar o delta de escrita já identificado. Considerar todas as policies existentes: a prontidão atual da identificação rejeita políticas adicionais nas tabelas protegidas e em `storage.objects`, inclusive policies de outros buckets. Não removê-las para forçar o gate; diagnosticar a convivência primeiro.
4. Executar o gate do kit intacto com interrupção no primeiro erro, dentro de `BEGIN READ ONLY` e `SET LOCAL search_path=pg_catalog,public`, concluindo em `COMMIT`. O marcador final isolado não basta; erro intermediário ou ausência da transação concluída bloqueiam a liberação. Essa execução ainda não ocorreu no ambiente remoto.
5. O gate `identificacao_empresa_habilitada()` depende também de `auth.uid()`. Chamá-lo sem sessão legítima pode retornar falso mesmo com catálogo correto. A análise administrativa dos catálogos e o ensaio com JWT real em homologação são provas distintas; não falsificar sessão nem inferir configuração a partir de uma chamada anônima.
6. Conferir origem/CSP/CORS e configuração Auth vigente em leitura. Os hosts atuais do produto já constam na allowlist local. Um preview com hostname diferente não está automaticamente autorizado; não usar `*` nem alterar `_auth.js` nesta preparação para fazê-lo passar.

O gate do kit não certifica todos os corpos de helpers transitivos, outras views/RPCs, ACLs de identificação ou privilégios administrativos globais. A homologação local fornece um padrão de comparação, não uma certificação remota.

## Implantação e reversão futuras — não executadas

Somente após a autorização de publicação e confirmação do alvo: preservar o deployment conhecido, exportar o catálogo de segurança, obter backup verificável do banco e dos arquivos privados, ensaiar restauração em destino separado e aplicar os deltas revistos com tratamento de erro. Manter a habilitação do módulo fechada até concluir gates e teste autenticado no ambiente isolado correspondente. Não habilitar preview contra produção para escrever dados fictícios.

O backup de banco contém metadados dos objetos, não os bytes do Storage. Recuperação completa exige proteção separada dos arquivos e sua associação com os registros. Os dumps locais já validados não representam backup de produção. [Limites do backup Supabase](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/backups.mdx).

Se a implantação futura falhar, suspender o novo módulo e retornar ao deployment anterior preservando peças, revisões e arquivos novos. Não usar `DROP TABLE`, limpeza geral, reset de Auth ou reaplicação de policies antigas como rollback. Uma reversão de DDL/grants exige diff específico da alteração aplicada e avaliação dos dados já criados. Resumo, e-mail e boletins permanecem fora dessa operação.

## Pendências classificadas

| Pendência | Estado |
|---|---|
| Projeto remoto vinculado ao domínio no contexto administrativo autorizado | Confirmado pela coordenação no IAB após login manual do usuário; a sessão do CLI permaneceu inalterada. |
| Feature flag do módulo | Não apareceu na listagem de produção; preparação permanece sem habilitar ou publicar. |
| Secret de serviço e demais bindings do ambiente alvo | Dez nomes observados em produção; service key presente pelo nome. Valores, validade e vínculo ao Supabase não verificados. Preview exibe tabela de variáveis vazia; outros tipos de bindings não foram comprovados. |
| Preview e homologação isolada | Configuração lida: todas as branches diferentes de produção, mesmo build/compatibilidade, acesso informado como público por padrão e tabela de variáveis vazia. Código ainda aponta para o Supabase de produção. Nenhum preview publicado/testado; configuração atual não comprova isolamento. |
| Schema, policies, gates e bucket reais de produção | Base e bucket privado observados no IAB; tabelas/RPCs novas não encontradas. Policies de escrita observadas diferem do alvo homologado. Colunas, constraints, grants, helpers completos e gates ainda dependem de preflight de catálogos. |
| Build/runtime das Functions e recursos estáticos | Configuração remota observada e Worker completo validado localmente em 14 checks com fixtures, após correção restrita do leitor empresarial. Pacote final rodada-04-leitor-pdf; deploy automático permanece sem acionamento. |
| Plano e capacidade do runtime | Workers Free observado, com 100.000 requests/dia e 10 ms de CPU/request na tela. Pacote final: 2.798.537 bytes gzip local. Pipeline explícito de minificação, CPU/inicialização e adequação remota ainda pendentes; sem autorização de upgrade ou billing. |
| Conteúdo e isolamento do pacote | Candidato final tem 44 estáticos e exclui histórico privado. Guardas revisadas; smoke concluído somente com fixtures, sem saídas não declaradas e com processos encerrados. Nenhuma publicação. |
| Backup/restauração de banco e bytes do Storage | Supabase mostra backup `a day ago`; restauração completa e cobertura dos bytes do Storage não comprovadas. |
| Identidade/autenticação do usuário, credenciais e modelos | CLI preservado, sem novo OAuth. O usuário fez login manual no IAB; nenhuma credencial, modelo ou configuração de autenticação foi alterada pela auditoria. |

Esta auditoria de configuração produziu somente este relatório e três evidências administrativas sanitizadas. Nenhuma fonte do produto, SQL, configuração remota, usuário ou arquivo de produção foi alterado por esta frente de trabalho.
