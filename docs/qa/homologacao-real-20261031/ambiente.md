# Ambiente local real — homologação de 31/10/2026

## Estado atual

Os quatro serviços reais do projeto Compose `licitaplena-qa-real` estão em execução, exclusivamente em loopback. O banco confirmado é `licitaplena_qa_ui_v2`, com usuário e proprietário `supabase_admin`.

A correção aprovada de `supabase/kit_documentos.sql` foi aplicada duas vezes com `ON_ERROR_STOP=1`, ambas com sucesso. O gate intacto `verificar_kit_prepublicacao.sql` retornou **`KIT_PREPUBLICACAO_OK`** em transação somente leitura. Auth, REST e Storage responderam HTTP 200 aos health checks locais. O harness não foi executado nesta etapa; sua liberação depende da revisão coordenada separadamente.

## Portas e preservação do ambiente

| Serviço | Porta anterior | Porta atual | Destino no container |
|---|---:|---:|---:|
| PostgreSQL | 55322 | 56322 | 5432 |
| GoTrue | 55324 | 56324 | 9999 |
| PostgREST | 55321 | 56321 | 3000 |
| Storage | 55325 | 56325 | 5000 |

Todos os bindings são `127.0.0.1`. As portas anteriores estão no intervalo TCP excluído `55238–55337`, listado por `netsh` para IPv4 e IPv6. Um bind real de socket falhou nas quatro portas antigas com erro Windows `10013`; funcionou nas quatro portas novas.

Foi necessário recriar apenas os quatro containers deste projeto para trocar os bindings. A decisão substitui a restrição operacional inicial de não recriar containers: as imagens, volumes, configuração de aplicação e dados foram preservados. O Compose original não foi editado. O override privado usa `ports: !override`; a configuração resultante foi validada antes de subir os serviços.

Diretório privado: `C:\Users\harre\AppData\Local\LicitaPlena\supabase-homologacao`.

- Override: `compose.qa-ports-20261031.yaml`.
- Volumes preservados: `licitaplena-qa-real_dados` e `licitaplena-qa-real_arquivos`.
- Imagens preservadas por ID: PostgreSQL `b15d862126dd…`, GoTrue `1736a63078f5…`, PostgREST `d155c6718ed9…`, Storage `f1546fac6d1c…`.
- Comando: `docker compose --project-name licitaplena-qa-real --env-file <privado>/.env -f <privado>/compose.yaml -f <privado>/compose.qa-ports-20261031.yaml up -d --no-build --pull never db auth rest storage`.

Não houve pull, build, atualização de imagem, remoção de volume, prune, mudança de firewall, exclusões de portas, permissões globais ou serviços de outros projetos. Nenhuma ferramenta de controle de interface foi usada. O backend Docker iniciado pelo coordenador foi preservado.

## Credenciais locais

Os JWTs locais `anon` e `service_role` estavam expirados. Foram renovados por 24 horas, com o mesmo segredo, algoritmo HS256 e papéis. As assinaturas anteriores foram verificadas antes da renovação. Backups dos dois arquivos privados foram preservados no mesmo diretório, com timestamp. Senhas, segredo, tokens e contas não foram publicados em relatórios ou logs do repositório.

O arquivo [runtime-publico.json](runtime-publico.json) contém apenas os destinos locais e o nome do banco. Health checks concluídos; login real permanece para o harness. Não houve criação de usuário, login ou SMTP nesta preparação.

## Backup e integridade

Backup anterior à migração: `antes-kit-documentos-20261031T020748Z.dump`, no diretório privado, com 489.155 bytes.

SHA-256: `8f2b1dcce8d6fd6d80626e897820245c9a3bd38d7c04e7fd021ac14f1bdbf57f`.

O dump foi capturado em bytes, sem redirecionamento textual do PowerShell. O cabeçalho custom `PGDMP` e a leitura por `pg_restore --list` foram validados; o índice contém 795 entradas e identifica o banco esperado. Não foi feito ensaio de restauração em outro banco.

Antes e depois da migração, as 39 tabelas preexistentes dos schemas `public` e `storage` mantiveram contagens e hashes de conteúdo idênticos. O fingerprint usa MD5 das linhas JSON ordenadas para detectar alteração; o backup usa SHA-256. O novo objeto do kit é considerado separadamente.

## Bloqueio inicial do gate e diagnóstico preservado

1. Na sessão padrão, `search_path` inclui `auth`. O deparser retorna `uid()` em vez de `auth.uid()`, fazendo a comparação literal da policy falhar. Nenhuma policy foi alterada.
2. Com `SET search_path=pg_catalog,public` apenas na sessão do gate, a comparação da policy passa. O gate então falha com `Kit pré-publicação: privilégio de tabela ou coluna não previsto para o kit`.
3. A tabela nova herdou privilégios de `postgres`, inclusive escrita, por `ALTER DEFAULT PRIVILEGES` preexistente de `supabase_admin` em `public`. A migração revoga os papéis da aplicação, mas não remove esse grant adicional.
4. A RPC `gravar_kit_documento` também possui `EXECUTE` para `postgres`. A função do trigger `kit_documento_escopo_imutavel` possui `EXECUTE` para `postgres` e `service_role`. O gate exige apenas o proprietário no trigger.

O gate não foi enfraquecido. Defaults, papéis e grants foram inicialmente preservados para revisão do coordenador. A falha confirmou que o gate real detecta a divergência que não aparece apenas na migração SQL sintática. A resolução aprovada está registrada abaixo.

A primeira execução da migração retornou código zero. Um assert do script auxiliar esperava `COMMIT` na última linha, mas o arquivo termina com `NOTIFY`; o assert foi corrigido para procurar a linha `COMMIT`. Isso não foi erro SQL nem rollback. A segunda execução e seu log confirmam `COMMIT` seguido de `NOTIFY`.

## Correção aprovada e gate verde

O parecer independente em `.superpowers/sdd/2026-10-31-homologacao-autenticada/acl-review.md` aprovou a correção delimitada. Os hashes atuais da migração e do gate foram conferidos contra [acl-sha256.json](acl-sha256.json) antes da execução; cada aplicação reconferiu o hash da migração.

- Migração aprovada: SHA-256 `7b2ef8ed7676e45acd9708b56d95bb5b6d39ec44ecc54455d796daa2e148131f`.
- Gate intacto: SHA-256 `2c4023cb0cac4e9b5fa29afee68398a0b4e402663dee9cd9fa580e7ea19178cf`.

Antes da correção foram criados, sem sobrescrever os anteriores, um snapshot de catálogo/conteúdo e um novo dump custom privado: `antes-correcao-acl-20261031T022043Z.dump`, com 505.274 bytes e SHA-256 `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c`. Cabeçalho `PGDMP`, identidade do banco e índice de 812 entradas foram validados por `pg_restore --list`.

A correção foi executada duas vezes. Ela normaliza somente as ACLs diretas da tabela `public.operacao_kit_documentos`, da RPC `public.gravar_kit_documento(...)` e da função `public.kit_documento_escopo_imutavel()`. Todos continuam pertencendo a `supabase_admin`.

ACL final: tabela com proprietário e SELECT para `authenticated`/`service_role`; RPC com proprietário e EXECUTE para `service_role`; função do trigger somente com proprietário. Não houve mudança de defaults, atributos ou associações de papéis. Isso não retira os poderes administrativos, BYPASSRLS ou acessos herdados de `postgres`.

O executor usou `psql -U supabase_admin -d licitaplena_qa_ui_v2 -X -A -t -v ON_ERROR_STOP=1` via `docker exec -i licitaplena-qa-real-db-1`, com entrada UTF-8 binária. O arquivo do gate foi envolvido apenas por:

```sql
BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog,public;
-- conteúdo intacto de supabase/verificar_kit_prepublicacao.sql
COMMIT;
```

Resultado: `KIT_PREPUBLICACAO_OK`, seguido de `COMMIT`. Nenhuma configuração global de `search_path` foi alterada.

O snapshot completo de `pg_roles` sem senhas, `pg_auth_members` e `pg_default_acl` permaneceu idêntico. As 39 tabelas preexistentes e a tabela vazia do kit mantiveram contagens e hashes de todas as linhas. Não houve fixture, limpeza de dados ou execução do harness.

Health checks concluídos após o gate: `http://127.0.0.1:56324/health` (Auth), consulta REST somente leitura e vazia em `http://127.0.0.1:56321/operacao_kit_documentos?select=id&limit=0`, e `http://127.0.0.1:56325/status` (Storage). Todos retornaram HTTP 200. A consulta REST leu a credencial local somente em memória; tokens e respostas de autenticação não foram registrados.

## Evidências e limites

- [ambiente-evidencia.json](ambiente-evidencia.json): IDs, imagens, volumes e bindings antes/depois; probes; identidade; backup; hashes e contagens; ACLs e tentativas do gate.
- [kit-gate-diagnostico.json](kit-gate-diagnostico.json): expressão efetiva da policy, sem dados de usuários.
- [kit-acl-exato.json](kit-acl-exato.json): ACLs literais, default ACLs, flags e memberships dos papéis relevantes, sem senhas.
- [kit-migration-2.log](kit-migration-2.log): comandos concluídos na segunda aplicação.
- [correcao-acl-evidencia.json](correcao-acl-evidencia.json): backup pré-correção, hashes aprovados, duas aplicações, gate verde, snapshots comparados, ACL final e health checks.
- [kit-acl-migration-1.log](kit-acl-migration-1.log) e [kit-acl-migration-2.log](kit-acl-migration-2.log): duas aplicações da correção aprovada.
- [kit-prepublicacao.log](kit-prepublicacao.log): gate intacto em transação somente leitura.

A conferência da preparação confirmou quatro containers em execução, banco `healthy`, imagens e volumes idênticos e somente bindings de loopback. Os arquivos de evidência foram comparados em memória com os segredos locais e senhas de contas: nenhum desses valores apareceu nos arquivos.

Os serviços permanecem ativos para o coordenador. Somente ele deve encerrar os quatro containers desta rodada e o backend que iniciou, após concluir os testes. Volumes e backups devem permanecer.

Este ambiente reconstruído não certifica configuração de produção. Nenhuma API remota, SMTP, PNCP, CNPJ Proprio, modelo ou autenticação do usuário foi acessada ou alterada.
