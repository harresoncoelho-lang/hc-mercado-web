# Migração executada no ambiente isolado

**A variante do delta foi aplicada com sucesso no staging e os gates posteriores passaram.** A comparação offline das evidências remotas aprovou **626 verificações**. O ensaio adicional de SQL/RLS por CNPJ foi depois executado com **15 blocos de casos e rollback confirmado**, conforme seção final. Essas conclusões não comprovam login, JWT, jornada HTTP ou restauração de backup.

Destino: `licitaplena-homologacao`, projeto `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, PostgreSQL **17.11**. A coordenação executou os SQLs pela UI. Esta frente somente preparou artefatos e comparou os resultados já preservados; não executou banco, serviço local ou upload. Produção, resumo, e-mail e robô ficaram fora desse ensaio.

## Evidências executadas

| Etapa | Resultado observado |
|---|---|
| Bootstrap v3 e gate readonly | `BOOTSTRAP_PREKIT_STAGING_OK`; estado pré-kit capturado |
| Bucket criado depois do bootstrap | `operacao-documentos`, privado, zero objetos; `file_size_limit=null`, `allowed_mime_types=null` |
| Preflight antes do delta | `PREKIT_STAGING_CONFIRMADO`, fingerprint `8abc338413ff0c60770d3aea1c3413d1` |
| Original 1619… sem alterações | Rejeitado exatamente por `Catálogo divergente`, antes do payload |
| ROLLBACK após rejeição + preflight | Mesmo fingerprint e fixture vazia |
| Variante integral em ensaio com ROLLBACK final | Retorno final `PREKIT_STAGING_CONFIRMADO`, mesmo fingerprint; gates estavam no script executado sem erro |
| Aplicação da variante 97f75e28… | `KIT_PREPUBLICACAO_OK` |
| Conferência readonly após aplicação | `DELTA_STAGING_GATES_OK` e matrizes de privilégios |
| Catálogo pós-delta | `830899ecee2a58d23beec619b4963fed`, 23 relações/39 funções no recorte, read_only=on |

O editor mostrou somente a última consulta do ensaio com rollback. A evidência não apresenta separadamente cada SELECT intermediário; registra execução integral sem erro e o estado pré-kit reconfirmado depois do rollback. A aplicação posterior tem seu próprio retorno do gate do kit e a conferência readonly independente.

## Preservação verificada

O comparador confirmou **479 objetos anteriores integralmente iguais** nas seções de colunas, índices, funções, relações, triggers e constraints. Os corpos e atributos de mais dois helpers — `bootstrap_operacao()` e `eh_membro_operacao(uuid)` — também permaneceram iguais; somente quatro permissões EXECUTE de PUBLIC/anon foram retiradas, conforme o delta. ACLs das relações anteriores, schemas, roles, memberships e defaults permaneceram iguais.

As policies operacionais posteriores coincidem exatamente com o array esperado no gate original. As policies preexistentes fora desse recorte operacional permaneceram iguais. Foram acrescentadas duas policies para identificação e kit, com os gates correspondentes aprovados.

Os acréscimos observados foram duas tabelas, 24 colunas, quatro índices, 12 funções, sete triggers e 20 constraints. Os nomes completos estão na evidência JSON, sem registros de cliente.

**Preservação de dados nesta etapa significa preservação de uma fixture vazia:** as 19 tabelas públicas anteriores continuaram vazias; as duas novas também ficaram vazias. Permaneceram zero usuários Auth e zero arquivos/objetos Storage. O único bucket privado e sua configuração permaneceram iguais. Nenhum conteúdo de produção foi importado, e não houve tentativa de alegar preservação de registros reais de clientes.

O catálogo original não inclui os metadados de `dados_robo` e `admin_tem_permissao`; a comparação não amplia essa cobertura. O vazio de `dados_robo` foi checado explicitamente nos gates pré/pós. A assinatura e corpo do trigger de cadastro incluído no recorte permaneceram iguais.

## Privilégios efetivos observados

Foram conferidas **54 combinações de tabela/papel/operação** e **18 combinações de função/papel**, usando os resultados reais de `has_table_privilege` e `has_function_privilege`.

| Objeto | anon | authenticated | service_role |
|---|---|---|---|
| Identificação da empresa | Sem permissões | SELECT | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER e MAINTAIN |
| Kit de documentos/propostas | Sem permissões | SELECT | SELECT |
| RPC de confirmar identificação | Sem EXECUTE | Sem EXECUTE | EXECUTE |
| RPC de gravar kit | Sem EXECUTE | Sem EXECUTE | EXECUTE |
| Quatro funções internas de trigger | Sem EXECUTE | Sem EXECUTE | Sem EXECUTE |

Não há SELECT WITH GRANT OPTION nos papéis da aplicação. Os privilégios amplos de service_role sobre identificação correspondem ao delta aprovado; não se estendem ao kit. Esses resultados não significam que authenticated possa ler todas as empresas: a quantidade de linhas visíveis depende de RLS e será testada com fixtures na etapa seguinte.

## Integridade e reprodutibilidade

| Artefato | SHA-256 |
|---|---|
| Catálogo pré-kit | `5c607e56e58e7aa7b67d16baee150f26ff05e2b599809645777a12f6af51b9ad` |
| Catálogo pós-delta | `7d81af6a57cd1b7a6f57ab33f6f25c984443c472edeb0a4e8ed7c3ae869b0cf7` |
| Matriz real de privilégios | `baa5519cc6c0337551634597c339774045e48d9d4a101af2add3fb2a66cfb9fb` |
| `comparar-pre-posdelta-staging.cjs` | `587a3dd10e9d1b6f159dfb20e51533070065d7785a2484a0ee688a5078230c1c` |
| `comparacao-pre-posdelta-staging.json` | `9bb4b1168305045bba69e38f7fe626958f9e3fc0609767a8cefe05b57bf5d777` |

O JSON de comparação inclui hashes das demais entradas, lista dos objetos preservados e acréscimos. O original conserva SHA-256 `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94`; somente a variante declarada usou o fingerprint do staging. O comparador não reexecuta SQL e recusa sobrescrita da evidência. Uma primeira execução parou por erro de digitação no próprio comparador antes de escrever o resultado; corrigido, a execução terminou com 626 verificações aprovadas.

## Histórico: candidato mínimo de RLS por CNPJ

Há testes reaproveitáveis, sem necessidade de criar outra suíte: `docs/qa/homologar-kit-real-local.cjs`, matriz em torno das linhas 79–105, e `docs/qa/migracoes-capacidade-20261031/testar-delta-local.cjs`, uso de papéis/claims em torno das linhas 174–191.

A adaptação mínima seria um SQL único com BEGIN/ROLLBACK: quatro identidades fictícias, duas organizações, CNPJs A/B na mesma organização, seus processos e documentos/peças sintéticos. Exercer a matriz existente: gestor vê A+B; operador/leitor restritos veem somente A; outra organização e usuário pendente não veem peças; escrita direta no kit e chamada das RPCs por authenticated são negadas; service_role chama a RPC com usuário autorizado, e cruzamento empresa/processo é recusado.

Para satisfazer as FKs, seriam necessárias linhas transitórias em `auth.users`, inseridas com colunas explícitas conforme o esquema gerenciado observado, sem senha, login ou envio de e-mail. O trigger real de cadastro criaria `clientes`; o teste deve usá-lo, sem desabilitar triggers ou recriar funções. `SET LOCAL ROLE` e claims locais exercitariam SQL/RLS real, mas **não emitiriam JWT nem testariam o serviço Auth**. Tudo deve ser revertido, com captura posterior comprovando o fingerprint pós-delta atual e a fixture vazia. Um erro exige ROLLBACK explícito e preservação da evidência.

No fechamento inicial desta entrega, esse SQL estava apenas identificado como candidato, ainda não preparado nem executado. A evolução seguinte está registrada abaixo. O harness HTTP existente depende de Auth/API/Docker/servidor local e não foi iniciado na máquina para simular essa prova.

## Execução adicional: SQL/RLS por CNPJ validado

Em **01/11/2026 às 19:07:06.709882 UTC**, a coordenação executou integralmente `07-ensaiar-rls-cnpj-com-rollback.sql`, SHA-256 **`8363e05287cc2ff78778f30977099f205e52d96889cffae26eb3a6f389d76379`**, no staging. A evidência registra editor e hash conferidos, sem erro de SQL, e retorno **`RLS_CNPJ_SQL_ROLLBACK_OK`**.

Os 15 blocos verificaram a matriz de documentos/peças A/B, outra organização, leitor e cliente pendente; gravação autorizada pela RPC e negativas de papel, CNPJ e processo; bloqueio de DML direto e RPCs privadas; ausência de efeitos das tentativas rejeitadas. As identidades foram inteiramente fictícias, inseridas sem senha/token/login e usando o trigger real de cadastro. Não houve envio de e-mail.

Depois do ROLLBACK, foram confirmados **21 tabelas públicas vazias, zero usuários Auth, zero objetos Storage, papel `postgres` e o mesmo fingerprint pós-delta `830899ecee2a58d23beec619b4963fed`**. A evidência é `rls-cnpj-execucao.json`, SHA-256 `43ea2b873a0c3d793545e8143bc3698cd395db582a9718eaea5ee9525d1ba256`; a captura `rls-cnpj-sucesso.jpg` tem SHA-256 `65c7c3a68ddd65aeb6a11987355749fb4d26ca4ad4a74a5bc8ab63726e862ac4`. O roteiro e seus limites estão em `ENSAIO-RLS-CNPJ.md`.

O editor exibiu somente a consulta final; os casos intermediários foram asserções que abortariam a execução integral em qualquer falha. Os 15 blocos são uma prova adicional, não devem ser somados aos 626 checks como se fossem a mesma unidade.

O isolamento comportamental **SQL/RLS desta matriz** está validado. Continuam separados: login/JWT e autorização HTTP; documentos com bytes, cálculo/revisão/exportação da proposta completa; restauração real do PGDMP e arquivos; medição de capacidade. Claims locais não substituem o serviço Auth, e rollback não substitui restore.
