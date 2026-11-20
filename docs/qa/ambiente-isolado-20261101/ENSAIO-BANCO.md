# Migração e recuperação em ambiente separado — preparação

01/11/2026. Análise estática do material existente; nenhum SQL, Docker, serviço, navegador, produção, upload ou restauração foi executado nesta frente. Nenhuma credencial ou conteúdo de documento foi aberto. **O destino ainda precisa ser identificado e validado; este roteiro não comprova ambiente criado.**

## Decisão mínima

Separar dois ensaios, cada um com banco vazio próprio e evidências novas:

1. **Migração:** reconstruir somente o estado operacional anterior ao kit, com dados fictícios e Auth/Storage reais. Ensaiar o delta e depois o fluxo por CNPJ.
2. **Recuperação:** restaurar o dump de homologação existente em outro destino vazio. Esse dump já contém identificação/kit; não serve como baseline do ensaio de criação dessas tabelas.

A coordenação informou ter localizado a organização Free `Licita Plena` (`vhmjospwgiryrnrndkpd`), sem projetos, distinta da organização Pro de produção (`hyxscgmivndnpqijsoav`). Essa informação veio da inspeção da coordenação; esta frente não operou o navegador. A gratuidade efetiva, quota e versão disponível precisam ser confirmadas antes de criar. Não usar o projeto de produção `lsqjamqvmrcyrvowndiu`, o Radar SICAF, nem os volumes locais existentes.

## O que já pode ser reaproveitado

| Artefato | Reuso e limite |
|---|---|
| `../migracoes-capacidade-20261031/02-delta-operacional.sql` | Candidato original preservado. SHA-256 `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94`. |
| `../migracoes-capacidade-20261031/01-catalogo-readonly.sql` | Inventário anterior/posterior em transação somente leitura. SHA-256 `7234ddc5a239aac1152ca70fa1322086b586465fef6f5406bec3a7d17f9d2ce3`. |
| `../homologar-kit-real-local.cjs` | Treze grupos de cenários reais, incluindo autorização, revisão, persistência, conflito e DOCX. SHA-256 `e08a73d1d73fb45796a38a043819069a9c50fa822903969aeacf8ea06e29dea1`. |
| `../servir-identificacao-local.cjs` | Páginas/handlers reais e contenção de APIs. SHA-256 `b2951f7a07556a4e45b5a38cf7ac06dcfd3ac08449b10cb3653924f0b4f1b8cb`. |
| `../homologacao-real-20261031/verificar-ui-real.cjs` | Prévia antes da revisão, A→B→A, nova sessão, versão, conflito, responsividade e exportação. SHA-256 `69c619edf125141977a7c2752e34206130e254872701b25b04250efa618295fb`. |
| Dump privado `antes-correcao-acl-20261031T022043Z.dump` | 505.274 bytes; SHA-256 já conferido `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c`; índice anterior de 812 entradas. Origem de teste, não backup de produção; nesta frente somente tamanho listado, sem leitura do conteúdo ou execução de pg_restore. |

Os hashes dos cinco arquivos de código/inventário acima foram recalculados nesta preparação e conferem. Não copiar a pasta privada inteira: contém credenciais, contas e outros artefatos fora do escopo. Os dois PDFs de clientes guardados no backup privado de produção não entram no primeiro ensaio fictício.

## Lacunas concretas antes de executar

**O harness real não é portável ainda.** Ele usa `docker exec` no container fixo `licitaplena-qa-real-db-1`, banco `licitaplena_qa_ui_v2`, papel `supabase_admin`, credenciais em caminho Windows e binds `127.0.0.1`. A UI carrega Playwright de caminho local e lança Edge. O servidor de QA também depende de três arquivos vendor locais. Não basta trocar uma URL por um projeto hospedado; isso eliminaria as provas de isolamento sem fornecer as equivalentes remotas.

A menor adaptação depende do executor escolhido. Em runner/VM remotos com containers, conservar os cenários e a origem loopback, parametrizando somente diretórios privados/evidências, executor SQL e navegador disponíveis. Em Supabase hospedado, manter o servidor de QA em um executor remoto privado e substituir somente o transporte de teste por destinos aprovados e fixos de Auth/REST/Storage; validar referência do projeto, HTTPS, identidade do banco e recusar redirects. Nunca fornecer URL arbitrária ao harness nem reutilizar credenciais de produção. Não alterar os handlers ou a autenticação do produto para acomodar o teste.

**O inventário operacional não é um bootstrap completo.** Ele cobre 21 relações e 27 funções, mas não contém a definição de `public.criar_cliente_no_cadastro()`; registra apenas seu hash. As policies de `clientes` também usam `public.admin_tem_permissao(text)`, que não está no recorte nem nos SQLs de `supabase/` encontrados. As variantes locais de trigger de cadastro não foram certificadas como equivalentes ao corpo remoto. Auth/Storage possuem funções gerenciadas cujos corpos não devem ser recriados por suposição.

Antes de gerar o bootstrap, obter as definições/dependências faltantes por inventário administrativo somente leitura, ou extrair e revisar o esquema do dump em executor isolado. Não buscar linhas de clientes, senhas, Vault ou tokens. Não criar helpers fictícios para fazer o gate passar. A fixture PGlite é útil para teste unitário, mas não substitui esses objetos nem os serviços reais.

**A restauração integral não pode ser presumida em projeto Supabase novo.** O destino hospedado já contém schemas e objetos gerenciados de Auth/Storage; o dump da instalação local pode conflitar com esses objetos, seus donos e grants. Um restore filtrado só de `public` não prova restauração integral e pode deixar referências a usuários sem correspondência. Primeiro comparar o TOC, papéis e schemas com o destino. Se a prova integral não for possível sem alterar objetos gerenciados, usar um PostgreSQL/Supabase compatível em executor remoto separado, ou reportar explicitamente o subconjunto restaurado. Não recorrer a `--clean`, `--no-owner` ou `--no-acl` para ocultar incompatibilidades.

## Ensaio A: migração

1. Registrar destino, organização, versão real de PostgreSQL, localização do executor e limite de custo. Recusar o ID de produção e qualquer destino com dados anteriores. Confirmar ausência de SMTP, agendas, IA externa e automações habilitadas. Nenhuma conta real será criada.
2. Gerar um bootstrap específico para banco vazio a partir do esquema revisado. Criar somente a base operacional anterior ao kit, respeitando tipos, donos, RLS e grants; usar os serviços Auth/Storage do destino. Não executar a cadeia histórica indiscriminadamente. Comparar o resultado ao catálogo observado e registrar todas as diferenças de plataforma.
3. Criar fixtures próprias via Auth Admin com confirmação explícita e endereços `example.invalid`, sem envio de e-mail. Registrar seus IDs em diário privado. Conferir cadastro correspondente sem alterar autenticação do produto; qualquer função de cadastro ainda não certificada bloqueia essa fase.
4. Capturar catálogo, contagens e hashes das tabelas da fixture, arquivos e permissões antes da migração. Guardar baseline e backup do destino novo. Os hashes de dados são referências de teste, não registros reais.
5. Executar o candidato original em transação e confirmar sua recusa por catálogo divergente no destino novo, seguida de rollback e baseline intacta. **Não remover ou contornar a guarda.** O hash envolve ACLs/defaults/papéis e listas cuja ordenação usa OIDs; um projeto independente não precisa reproduzir o fingerprint de produção.
6. Somente após catálogo do destino: preparar uma variante de ensaio em arquivo novo, com fingerprint próprio, manifesto de origem/destino e diff revisado. A carga de DDL/DML, locks, timeouts e gates finais permanece idêntica ao candidato aprovado. Se for necessário mudar o corpo da migração, interromper e revisar como nova mudança. A variante não pode ser chamada de aplicação byte a byte do candidato de produção.
7. Aplicar a variante aprovada com parada no primeiro erro; capturar estado posterior, comparar dados e objetos e executar o gate intacto em transação somente leitura. Repetição deve ser recusada, preservando estado. Casos de rollback destrutivos do teste ficam em bases descartáveis novas, sem afetar o ambiente principal do ensaio.
8. Reutilizar a jornada autenticada completa: quatro papéis, dois CNPJs, outro tenant, revisão visível e explícita, invalidar após alterações, concorrência, versões, RPC, Storage e DOCX. A revisão deve corresponder ao conteúdo/versão mostrados antes da exportação. Exigir zero rede inesperada e zero alteração dos 20 protegidos.

## Ensaio B: restauração

1. Usar outro destino vazio, próprio para recuperação, sem sobrescrever o ensaio A. Conferir SHA-256 do dump antes e depois de transferir ao destino autorizado. Dados e credenciais locais não são enviados juntos por conveniência.
2. Executar `pg_restore --list` no executor remoto compatível; preservar TOC original. Revisar funções, triggers, extensões, donos e ACLs antes de executar o conteúdo. Arquivar uma lista derivada apenas se forem necessárias exclusões, descrevendo precisamente o que elas retiram da prova.
3. Bloquear saída de rede do executor/banco antes de carregar objetos; não confiar apenas em binds loopback ou no hostname de staging. Não restaurar configuração de SMTP, cron, webhook ou segredo de produção. Esse controle é requisito do ambiente, não mudança da plataforma vendida.
4. Restaurar com erro imediato, transação única quando compatível e preservação de ownership/ACL. Conferir catálogo, contagens/hashes e constraints contra a origem fictícia antes de aplicar qualquer correção posterior. O dump de 812 entradas antecede a correção de ACL do kit; sua restauração fiel pode reproduzir essa configuração antiga. Não maquiar a prova alterando-a antes da comparação.
5. Em fase separada, aplicar apenas correções revisadas necessárias ao funcionamento seguro desse destino de teste. Rodar o gate e cenários autenticados, sem chamar a recuperação de validação do delta de criação do kit.
6. Para Storage, gerar um documento fictício novo no ensaio A, salvar seus bytes e manifesto (caminho/ID/tamanho/hash), recuperar no destino B e provar download autorizado/negação entre CNPJs. Um dump de `storage.objects` não contém bytes. Os metadados antigos do dump não provam que seus cinco arquivos locais existentes sejam recuperáveis; itens sem bytes ficam como pendências, sem inventar substituições.
7. Registrar duração de cada fase e concluir somente o escopo demonstrado. A recuperação de fixture não certifica os backups físicos de produção, RPO/RTO comercial ou a recuperação dos PDFs reais.

## Condição de entrega

Entregar por rodada inédita: catálogo anterior/posterior, identidade da origem e destino, hash original/variante/dump, diff revisado, logs sanitizados, baseline/final, diário de fixtures, resultados autenticados e manifesto de arquivos. Nenhum relatório inclui senha, JWT, key, URL com credencial ou conteúdo de cliente.

Esta preparação deixa explícitos os próximos trabalhos, mas **não autoriza custo nem prova serviço executando**. A criação de projeto hospedado, transferência e execução dependem da coordenação confirmar destino, orçamento e a compatibilidade do executor. A máquina do usuário, os serviços de produção, o resumo, o e-mail e o robô permanecem fora da execução.

## Avanço informado pela coordenação

O usuário criou o projeto `licitaplena-homologacao`, referência `luguscapasskcsficckf`, na organização Free `vhmjospwgiryrnrndkpd`. A coordenação confirmou Healthy/NANO, sem GitHub, migrações ou backups carregados; Data API habilitada e exposição automática de novas tabelas desativada. Esta frente não operou essa criação nem verificou o navegador. Qualquer gravação deste ensaio deve se limitar a esse projeto novo, com fixtures.

Consultas preparadas, sem execução por esta frente:

- `inventario-auth-dependencias-somente-leitura.sql`: duas assinaturas explícitas, ACLs e identidades de dependências diretas. SHA-256 `1f22852d26369100165f05d8b6c36310bb0be0380de31c388cf20a91a5adbac3`.
- `banco/00-baseline-destino-somente-leitura.sql`: versão, identidade administrativa e recorte inicial de schemas/papéis. SHA-256 `ba90cd29fbeae501d8077990870a17c47d90ab9ca451d61845f5d4679e6f2a87`. Os IDs esperados são rótulos; não são prova SQL do project_ref. A conexão/aba real precisa ser confirmada separadamente.
- `banco/inventario-dados-robo-esquema-somente-leitura.sql`: estrutura da dependência do cadastro, sem consultar qualquer registro da tabela. SHA-256 `0c225c71ef88488a6d5fe07db7bbf0d154ebb9131deca4a85c0bdbab0d2387d9`.

O resultado `banco/helpers-producao.json` foi coletado pela coordenação em 01/11 às 18:11:39 UTC, com PostgreSQL 17.6 e read_only=on. Sua leitura nesta frente confirmou: o corpo de `criar_cliente_no_cadastro` conserva o hash observado em 31/10 e lê `public.dados_robo`; `admin_tem_permissao` depende de `public.admins` e `auth.jwt()`. Falta receber o esquema de `dados_robo` e os catálogos do destino antes de gerar o bootstrap. Nenhum histórico ou configuração real será copiado.

O SQL Editor permite ensaiar DDL, transações, rollback e autorização SQL com claims fictícias; isso não comprova emissão/validação de JWT pelo Auth ou jornada HTTP. Auth/Storage UI permitem preparar contas e arquivos fictícios, mas não substituem o harness da aplicação. O SQL Editor não executa um dump binário PGDMP: a restauração custom continua dependendo de executor compatível e destino adequado.

Os limites do catálogo foram reconferidos em documentação pública, sem enviar conteúdo privado: [dependências PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-depend.html) e [pg_get_functiondef](https://www.postgresql.org/docs/17/functions-info.html). Funções definidas como strings não registram em pg_depend todas as referências do corpo; a definição retornada é reconstruída, não o texto original de criação.

### Bootstrap preparado após receber os insumos

A coordenação entregou `baseline-destino.json`, `catalogo-destino-vazio.json` e `dados-robo-esquema-producao.json`. O destino está em PostgreSQL **17.11**, com public vazio; a produção observada está em **17.6**. Os gaps de inventário descritos acima foram atendidos para preparar o recorte. Não houve downgrade nem alteração dos serviços.

O pacote específico está em `banco/01-bootstrap-prekit-staging.sql`, com manifesto, verificação posterior e [diferenças documentadas](banco/BOOTSTRAP-DIFF.md). Cria somente o estado vazio anterior ao kit e preserva objetos gerenciados. O preparador e o teste estático executaram apenas leitura de JSON e geração/conferência de texto; nenhum SQL foi executado nesta frente. A revisão independente deve aprovar o hash antes da coordenação aplicar no projeto novo.
