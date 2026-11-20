# Revisão independente do ensaio SQL de RLS por CNPJ

01/11/2026. O candidato cria uma fixture fictícia transitória, exercita leitura/gravação por papéis SQL e termina em ROLLBACK, seguido de reconferência do catálogo e do vazio. Esta revisão leu o candidato, manifesto, catálogo pós-delta, corpos/constraints/policies observados e evidências da migração. **Não executou SQL nem alterou o candidato.**

**Veredito: aprovado para uma execução integral no staging identificado, sem defeito bloqueante encontrado.** A aprovação depende de conferir o destino na UI/conexão antes do primeiro LOCK e interromper na primeira falha, sem reduzir guardas, grants ou locks. Não é prova de execução, JWT, login ou jornada HTTP.

## Identidade e guardas

- `07-ensaiar-rls-cnpj-com-rollback.sql`: SHA-256 recalculado `8363e05287cc2ff78778f30977099f205e52d96889cffae26eb3a6f389d76379`.
- Catálogo observado `catalogo-posdelta-staging.json`: SHA-256 `7d81af6a57cd1b7a6f57ab33f6f25c984443c472edeb0a4e8ed7c3ae869b0cf7`; fingerprint `830899ecee2a58d23beec619b4963fed`, PostgreSQL 17.11.
- Alvo operacional: projeto `luguscapasskcsficckf`, organização `vhmjospwgiryrnrndkpd`; usuário e banco SQL `postgres`.

O SQL exige usuário/banco `postgres`, versão `170011`, catálogo exato, 21 tabelas públicas vazias, zero usuários Auth, zero objetos Storage e um único bucket privado com o ID esperado. Os dois blocos de guarda são textualmente idênticos. A CTE de inventário coincide integralmente com a consulta de referência, presente duas vezes. O fingerprint verifica esse recorte de catálogo; não identifica sozinho o project_ref, nem cobre corpos auxiliares fora do recorte, como `admin_tem_permissao`.

O nome do projeto está no cabeçalho/manifesto, não numa verificação SQL de identidade de projeto. Portanto, a confirmação externa do destino é indispensável **antes** do LOCK inicial, inclusive porque os locks são anteriores à guarda de catálogo. Não executar em produção só para observar uma recusa de fingerprint.

## LOCK no PostgreSQL gerenciado

O catálogo registra `postgres` sem superuser, mas com BYPASSRLS e grants de UPDATE, DELETE, TRUNCATE e MAINTAIN em `auth.users`, `storage.objects` e `storage.buckets`. Nas tabelas públicas bloqueadas, é proprietário. Esses privilégios permitem ACCESS EXCLUSIVE sem exigir superuser no PostgreSQL 17. [Requisitos de LOCK](https://www.postgresql.org/docs/17/sql-lock.html).

O candidato não altera donos ou grants para obter o lock. `lock_timeout=2s` e `statement_timeout=30s` limitam espera/comandos; `idle_in_transaction_session_timeout=60s` limita ociosidade transacional. Não são um orçamento total do ensaio. Locks conflitantes ou restrições adicionais do serviço devem produzir falha e rollback explícito, sem contorno. ACCESS EXCLUSIVE impede acessos concorrentes às tabelas durante a fixture; por isso o ensaio é apropriado apenas para este staging vazio e reservado.

## Fixture e dependências conferidas

A ordem satisfaz as FKs observadas: quatro `auth.users` explícitos, clientes criados pelo trigger real, organizações, empresas, membros, processos, documentos e duas peças pela RPC. O único campo obrigatório de `auth.users` sem default é `id`, fornecido. Nenhuma senha/token, sessão Auth ou confirmação por e-mail é solicitada; os endereços são `example.invalid`.

`criar_cliente_no_cadastro()` observado consulta `dados_robo` e insere `clientes`; com a tabela vazia, o status resulta pendente. O ensaio exige exatamente quatro clientes pendentes antes de aprová-los como administrador. Não insere clientes em paralelo, não desabilita o trigger e não substitui funções.

As colunas obrigatórias das demais inserções estão preenchidas ou têm defaults observados. FKs compostas de empresa/organização e processo/empresa/organização são respeitadas. Os caminhos dos documentos correspondem aos IDs de organização/CNPJ. A restrição de papéis aceita gestor, operador e leitura; a cota padrão é três e a fixture cria duas empresas. Nenhum default das relações inseridas usa `nextval`/`setval`.

Foram lidos os corpos atingidos de proteção de status, cota, preservação de escopo, invalidação de identificação, acesso/escrita por empresa e gravação do kit. Não foram identificadas chamadas HTTP, SMTP, dblink, cron, notificações externas ou efeitos de negócio fora da transação nesses caminhos. A invalidação de identificação apenas atualiza linhas transacionais; a tabela está vazia. Não é criado arquivo físico no Storage.

## Matriz com RLS efetiva

O catálogo confirma RLS habilitada em documentos/kit, proprietário `postgres`, e `authenticated` sem superuser, BYPASSRLS ou associação que herde o proprietário. O script usa `SET LOCAL ROLE authenticated` fora de funções SECURITY DEFINER e confere `current_user`/`auth.uid()` nos contextos. Assim as consultas diretas são avaliadas como authenticated, mesmo com sessão originalmente administrativa. [SET ROLE](https://www.postgresql.org/docs/17/sql-set-role.html) e [RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

| Contexto | Comportamento exigido |
|---|---|
| Gestor A/B | IDs exatos dos documentos e peças de A+B |
| Operador restrito a A | Somente IDs de A; UPDATE A altera uma linha, UPDATE B altera zero; INSERT em B retorna 42501 |
| Leitor restrito a A | Somente IDs de A; UPDATE A altera zero linhas |
| Gestor de outra organização | Nenhum documento/peça de A ou B |
| Cliente pendente | Nenhuma peça do kit; RPC em seu nome retorna PT403 |
| Anônimo | SELECT do kit e execução das duas RPCs negados com 42501 |

As leituras comparam arrays completos de IDs, não somente ausência de erro. A gravação positiva em A confirma que o papel dispõe de permissão de tabela e que o teste negativo de B não passa apenas por uma falta geral de UPDATE.

Os casos sob `service_role` são prova distinta: esse papel tem BYPASSRLS e chama uma RPC SECURITY DEFINER que revalida usuário aprovado, papel, organização, empresa ativa e processo. Os negativos esperam precisamente PT403 para usuário/CNPJ/papel e PT404 para processo incompatível. A fixture positiva usa dados aceitos pela função observada; proposta vazia é rascunho permitido, sem cálculo ou revisão.

Os testes de DML direto no kit por service_role/authenticated são de **ACL**, não de RLS: ambos dispõem somente de SELECT na tabela. Os negativos exigem 42501; chamadas privadas por authenticated/anon também exigem 42501. Não há `WHEN OTHERS` que aceite qualquer erro. Se uma operação proibida retornar normalmente, o teste levanta P0001 e falha. A conferência administrativa final exige duas peças na versão 1 e preservação do documento B, evitando aprovar efeitos indevidos ocultos pelas policies.

## Rollback e evidência

Conferência textual independente: um BEGIN externo, um ROLLBACK externo, zero COMMIT, 15 blocos de casos correspondentes aos 15 nomes do manifesto, quatro identidades, nenhuma instrução DDL/GRANT/REVOKE/COPY/TRUNCATE e nenhum DML depois do rollback.

Os efeitos de inserção/atualização, inclusive os triggers, pertencem à mesma transação. Os subblocos que esperam erros usam exceções específicas; um erro esperado desfaz seu subbloco. O rollback externo remove a fixture inteira e restaura configurações locais. A guarda posterior reconfirma o mesmo catálogo, as 21 tabelas vazias, Auth/objetos Storage vazios e o bucket privado único. Essa segunda leitura não mantém os locks anteriores; qualquer atividade concorrente no staging após o rollback deve causar diagnóstico, não limpeza adicional.

A saída `RLS_CNPJ_SQL_ROLLBACK_OK` só deve ser aceita junto da execução integral sem erro e do hash do script enviado. `casos=15` é contagem declarada do roteiro, não um contador persistido por caso. Não executar somente a consulta final após uma falha para obter aprovação aparente. Se o cliente continuar processando comandos após erro, não usar esse modo; parar, efetuar ROLLBACK explícito e capturar a falha. Após erro de lock/SQL, não repetir automaticamente.

## Limites da conclusão

Este ensaio cobre RLS de leitura/escrita documental, ACL do kit e parte da autorização interna da RPC, usando claims SQL fictícias. Não comprova emissão/validação de JWT, Auth HTTP, CORS, revisão visual, confirmação válida de identificação, cálculo de propostas, exportação, arquivos Storage, concorrência de edição, clientes reais ou restauração de backup. O caso pendente é restrito ao kit; a policy documental observada não deve ser apresentada como bloqueada pelo status pendente.

Os locks e SQL reais do provedor permanecem sem execução por este revisor. A evidência de sucesso será produzida pela rodada autorizada da coordenação; o parecer preserva integralmente o candidato e os limites de isolamento.
