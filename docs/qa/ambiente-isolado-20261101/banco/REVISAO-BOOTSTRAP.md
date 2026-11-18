# Revisão independente do bootstrap de homologação

01/11/2026. Revisão estática; nenhum SQL, banco, navegador, rede ou runtime do produto foi executado por esta frente. O único arquivo criado nesta revisão é este relatório.

**Situação mais recente:** a v2 falhou na execução real e não está pronta. O rollback e o catálogo vazio preservado estão documentados. A v3 corrige a ordem dos índices e foi reavaliada estaticamente para nova tentativa controlada no projeto confirmado. SHA-256 da v3: `caca8c3d324e256a88bb1735662178dee35bb02822c62cc3459aca78a41d2272`. Os pareceres anteriores permanecem abaixo como histórico; a conclusão vigente é a seção da v3 no final. Isto não é declaração de execução bem-sucedida, validação de produção ou autorização de custo.

## Candidato examinado

O pacote reconstrói a base operacional vazia anterior ao kit, exclusivamente no projeto de homologação `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, PostgreSQL 17.11. Cria 19 tabelas públicas, 22 funções, 33 policies e três triggers da aplicação. Não é restauração de produção nem prova de jornada autenticada.

| Artefato | SHA-256 conferido |
|---|---|
| `01-bootstrap-prekit-staging.sql` | `3756dd11fbeb27f32063b4e90dfe24b2bf3cb2bfe98325501ad76a4e9b8ce9a6` |
| `02-verificar-bootstrap-somente-leitura.sql` | `484eda86f662eeb0aa19f32d70da2375eb20c8e26bdfa35686fb00eabdb5e8f6` |
| Delta original preservado | `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94` |

**Veredito de especificação: não aprovado neste hash.** O escopo e a preservação estão alinhados, mas o gate de políticas impede concluir o bootstrap válido.

**Veredito de qualidade: corrigir o achado 1 antes de aplicar.** A estrutura transacional e os controles de preservação são adequados ao ensaio vazio. Falta corrigir a seleção do gate e acrescentar regressão estática correspondente.

## Achado obrigatório

1. **O gate nunca observa as duas policies de `dados_robo` e sempre aborta.**

   Local: `preparar-bootstrap-especifico.cjs:58–60`; materializado em `01-bootstrap-prekit-staging.sql:2059` e `02-verificar-bootstrap-somente-leitura.sql:53`.

   O preparador adiciona `dados_robo` ao seletor de relações, mas mantém o seletor de `pg_policies` como `tablename in ('clientes','admins')`, além do prefixo `operacao_`. Os comandos criam duas policies em `dados_robo`, e o array esperado inclui ambas, totalizando 33. A consulta posterior só pode observar 31. Portanto o caso normal de criação correta chega a `Bootstrap divergente: policies`; a transação é abortada e não pode receber aprovação de execução.

   Correção mínima: incluir `dados_robo` também no seletor de políticas da consulta posterior, preservando a consulta da guarda inicial e o fingerprint vazio. Regenerar os dois arquivos e o manifesto em uma revisão explicitamente identificada. Testar estaticamente que o seletor posterior cobre as tabelas de todas as policies esperadas, incluindo `dados_robo`; a mera presença do nome em qualquer lugar do SQL não detecta este defeito. Repetir a revisão sobre o novo hash. Não remover a comparação de quantidade nem as duas policies para contornar o erro.

   A falha é fechada: sem intervenção para contornar o erro, o `COMMIT` não consolida as alterações. Isso reduz o risco de estado parcial, mas não torna o candidato funcional.

## Evidência e verificações

- Os cinco inventários de entrada correspondem aos SHA-256 fixados no preparador e no manifesto. Todos registram `read_only=on`. O destino registra public vazio e PostgreSQL 17.11; a origem operacional observada é 17.6. A diferença de patch está explícita.
- A guarda vem antes de `CREATE TABLE`. Exige executor e banco `postgres`, versão `170011`, catálogo vazio MD5 `785cf53d0d88df117eff15085f879018`, ausência de relações/funções públicas e ausência de usuários, buckets e objetos. O MD5 detecta divergência desse inventário; não autentica o projeto. A coordenação deve manter a confirmação independente da URL/conexão do projeto autorizado.
- Há uma única transação, locks das três tabelas gerenciadas pertinentes, timeout de lock de 2 segundos, timeout de comando de 30 segundos e busca local por `pg_catalog,public`. Os locks antecedem o guard; a identidade da conexão deve ser conferida antes de enviar o script, inclusive em uma base que seria recusada depois.
- As 19 tabelas ficam sob `postgres`, com RLS habilitada conforme a origem. Tipos e defaults usados são nativos e nenhuma coluna exige sequência, identity ou coluna gerada fora do pacote. Todas as referências de chaves estrangeiras estão nas tabelas criadas ou em `auth.users`.
- Os 22 textos de definição de função estão preservados em relação às fontes, exceto a troca deliberada de `CREATE OR REPLACE FUNCTION` por `CREATE FUNCTION`. A ordem cria as funções SQL usadas pelas demais antes de policies e triggers. Os helpers reais de permissão e cadastro foram incluídos; não há substitutos inventados.
- O cadastro consulta `dados_robo`, que permanece vazia. A ausência de `config_admin` leva à condição de aprovação automática não verdadeira; nenhuma configuração do robô, histórico ou registro de cliente é copiado.
- Revogações e grants recompõem explicitamente as ACLs dos objetos públicos novos. Não há mudança de roles, schemas, default privileges, ACLs das tabelas gerenciadas ou corpos de funções gerenciadas. São adicionados quatro policies da aplicação em Storage e um trigger de cadastro em Auth; não há substituição das definições existentes.
- O gate posterior compara colunas, constraints, índices, policies, triggers, grants, papéis, memberships, schemas e defaults; compara também RLS, proprietários, atributos/corpos de funções e ausência de dados. Os objetos gerenciados esperados vêm do destino, preservando a versão da plataforma. A seção de dependências do catálogo é usada na guarda inicial, mas não é uma comparação posterior integral de todo o banco.
- Não foram encontrados comandos externos de carga de dados, reset, exclusão, alteração de defaults/roles ou criação de extensões. A inspeção dos corpos não identificou URLs, envio externo ou credenciais embutidas. A busca por padrões de segredo foi negativa; não substitui uma auditoria de toda a organização.
- Os 20 arquivos protegidos correspondem à baseline. O delta original mantém seu hash. Nenhum desses arquivos foi alterado nesta revisão.
- `node --check` passou para o preparador e o verificador. O verificador estático existente passou, demonstrando também sua lacuna: ele não verifica a abrangência do filtro de políticas. Foi executado apenas como conferência de texto, sem conexão ou SQL.

## Limites para a próxima rodada

Os grants legados abrangentes são uma reprodução intencional do estado anterior ao kit. Esta revisão não os aprova como configuração de um SaaS publicado; o delta revisado e os testes de papéis/CNPJs continuam necessários. Não adicionar usuários, fixtures, arquivos nem disponibilizar a aplicação antes das verificações posteriores previstas.

A autorização de homologação é restrita ao projeto novo confirmado. A produção `lsqjamqvmrcyrvowndiu`, o Radar SICAF, serviços locais do usuário, SMTP, resumo, e-mail e robô ficam fora do ensaio.

Não foram verificados por execução: aceitação da DDL no PostgreSQL hospedado, permissões administrativas especiais da plataforma sobre Storage, comportamento de event triggers gerenciados, rollback real, emissão de JWT, login, REST, Storage, restauração do dump e capacidade. O ensaio controlado, após correção e novo parecer, deve registrar cada uma das provas efetivamente obtidas sem atribuir à revisão estática resultado de runtime.

O volume do SQL decorre dos catálogos esperados repetidos nas comparações bidirecionais. Uma redução para uma variável esperada única pode preservar a prova, mas exige novo hash e comparação explícita. Não é necessário ampliar o escopo de produto para resolver o achado.

## Reavaliação da v2

**Parecer histórico, superado pela falha real descrita abaixo:** especificação e qualidade haviam sido aprovadas estaticamente para o bootstrap vazio. O achado 1 foi corrigido, mas a revisão não identificou a dependência de índices UNIQUE independentes antes das FKs. A v2 não deve ser reaplicada.

| Artefato vigente | SHA-256 conferido |
|---|---|
| `01-bootstrap-prekit-staging-v2.sql` | `0ca77f649ad34d1a383c268f7c34e97bdb0a4782a373681eaa9ae3b6762f3ceb` |
| `02-verificar-bootstrap-somente-leitura-v2.sql` | `944a711c18e0c8cb1ced227a83a1c6fc80ae6d635b2fe5eb0928ee9041888480` |

A reavaliação não executou o gerador nem SQL. Leu os dois candidatos preservados, parseou os JSONs esperados e comparou o texto SQL estaticamente. Resultados independentes:

- O prefixo inteiro anterior ao gate é idêntico byte a byte entre v1 e v2: guardas iniciais, locks, timeouts, DDL, funções, ACLs, policies e triggers não mudaram.
- O gate posterior agora inclui `dados_robo` no seletor de `pg_policies`, cobrindo as duas policies que já eram criadas e esperadas.
- Os 13 arrays esperados são exatamente os mesmos da v1: 272 colunas, 92 constraints, 64 índices, 33 policies, 10 triggers, 664 ACLs de relações, 90 ACLs de funções, 12 defaults, 30 papéis, 24 memberships, três schemas, 22 relações e 28 funções. As contagens incluem objetos gerenciados preservados.
- Depois de substituir as duas cópias de cada literal JSON da v1 pela referência à variável correspondente e corrigir o filtro de políticas, o gate resultante é exatamente igual ao da v2, removida apenas a nova declaração dessa variável. As comparações de quantidade e de inclusão nas duas direções permanecem intactas.
- O gate do arquivo somente leitura da v2 é exatamente o mesmo do bootstrap. O primeiro conserva `BEGIN READ ONLY`; o segundo conserva transação única e recusa a execução sobre public ocupado. Nenhum gate foi retirado para passar.
- O SQL caiu de 563.406 para 337.992 bytes; a redução é só de literais repetidos. Não acrescenta objeto permanente de QA nem dependência de runtime.
- O teste estático ampliado passa, confirma especificamente o filtro de `dados_robo`, as duas policies, todos os arrays anteriores e a comparação inversa. `node --check` também passou para preparador e verificador atualizados.

As condições previstas na aprovação histórica eram: reconferir a conexão `luguscapasskcsficckf`, parar em erro, preservar evidência, exigir gate somente leitura e novo catálogo pré-kit antes de fixtures ou da variante do delta. A v2 efetivamente falhou e essa aprovação não permanece válida para nova tentativa.

## Falha real da v2 e revisão da v3

O registro `bootstrap-v2-execucao-falha.json` informa, em 01/11/2026 às 18:32:49 UTC, `ERROR 42830: there is no unique constraint matching given keys for referenced table "operacao_processos"`, no hash exato da v2. A coordenação realizou rollback e forneceu `catalogo-apos-rollback-v2.json`. A comparação estática desta revisão confirmou que o catálogo posterior é integralmente igual ao catálogo vazio anterior, incluindo o MD5 `785cf53d0d88df117eff15085f879018`, com `read_only=on`. Não houve execução de SQL por esta frente.

2. **A v2 criava FKs compostas antes dos índices UNIQUE que as sustentam.** As referências a `(id, organizacao_id)` em `operacao_processos` e `operacao_empresas` precisam dos índices independentes `operacao_processos_id_org_idx` e `operacao_empresas_id_org_idx`. Ter apenas a PK de `id` não satisfaz essas referências compostas. A revisão anterior conferiu a existência das tabelas referenciadas, mas não a disponibilidade dessas chaves no ponto de criação da FK; foi uma lacuna real da revisão.

A v3 move os 13 comandos de índices independentes para depois das constraints PK/UNIQUE/CHECK e antes de qualquer FK. O restante permanece exatamente igual. O novo ensaio não usa a v2, não remove FKs e não enfraquece o gate para evitar a falha.

| Artefato vigente | SHA-256 conferido |
|---|---|
| `01-bootstrap-prekit-staging-v3.sql` | `caca8c3d324e256a88bb1735662178dee35bb02822c62cc3459aca78a41d2272` |
| `02-verificar-bootstrap-somente-leitura-v3.sql` | `944a711c18e0c8cb1ced227a83a1c6fc80ae6d635b2fe5eb0928ee9041888480` |

**Especificação da v3: aprovada estaticamente para nova tentativa do bootstrap vazio. Qualidade da v3: aprovada para esse ensaio, sem declarar funcionamento remoto comprovado.** O achado 2 está corrigido neste texto. A aprovação exige continuar no destino confirmado e parar em qualquer divergência; não permite ignorar controles da plataforma.

Verificações adicionais desta rodada:

- Removidos apenas os 13 comandos de índices independentes de ambos os textos, v2 e v3 ficam idênticos byte a byte. Os 13 comandos também são iguais entre si e mantêm a ordem relativa. Portanto a alteração é exclusivamente de posição; definições, guardas, proprietários, grants, policies, funções, triggers e checks finais não mudaram.
- Uma leitura independente da DDL em sequência conferiu as 29 FKs emitidas: cada tabela pública e cada chave única de suporte já está disponível antes da referência; a PK de `auth.users` já consta do catálogo gerenciado. Os pares de colunas de origem/destino existem e seus tipos coincidem. As seis referências compostas dependentes dos dois índices agora chegam depois de sua criação.
- Os dois índices compostos usados são UNIQUE, btree, válidos, prontos e não parciais. O índice parcial de origem externa não foi usado como provedor de FK. As constraints PK/UNIQUE de suporte não são diferíveis.
- A regressão `verificar-ordem-bootstrap.cjs` foi lida e executada somente como inspeção de texto: a v2 falha com código 1 e seis referências prematuras; a v3 passa com código 0, 29 FKs e zero falhas. Ela recusa colunas/índices complexos fora do formato explicitamente suportado, em vez de presumir equivalência.
- `verificar-bootstrap-artefato.cjs` passa para v3, incluindo a igualdade do conjunto de comandos e do gate. `node --check` passa para os scripts revisados. O arquivo de verificação readonly permanece byte a byte igual ao da v2.

O fato de a v2 ter sido recusada antes das policies não valida permissões administrativas especiais do Supabase, event triggers ou as fases posteriores. A nova tentativa controlada ainda deve demonstrar essas etapas e depois executar o gate somente leitura. Não alterar dono de objetos gerenciados, conceder permissões adicionais nem contornar um erro de plataforma para obter aprovação. A produção e os arquivos protegidos continuam fora do escopo.
