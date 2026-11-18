# Revisão focal — SQL e comparação da restauração

01/11/2026. **Sem bloqueante encontrado para o ensaio fictício de escopo declarado.** Revisão estática independente; nenhum Docker, SQL, servidor ou job executado. Contenção, workflow e uploader são objeto da revisão separada.

## Candidato e evidências

- `executor/restauracao/restore.py`: SHA256 inicial revisado `fdcba16657de03b7189866c47cd7398d22ae4bd9a04a0e10c9eec979a985321b`. A revisão não autoriza implicitamente alterações posteriores; o ajuste paralelo de logs/timeout deve ter seu hash final conferido pela coordenação.
- `baseline.json`: `43b87aceb61497dd9f1f28ac8538d7d4e93752f8415c60ea47f3100dca0485e0`.
- `test_restore.py`: SHA256 inicial `86b0d42e33c2a12c2b6c3ac07ce1e465dee833517ef67dc02b5371f9612359dd`; conteúdo lido, testes não executados nesta revisão.
- Snapshot autorizado `antes-correcao-acl-20261031T022043Z.json`: hash confirmado `f7a111357f7db4af3e849c8ffdba69e6e63ef409cee98c403e2ff70b87b95419`. TOC e esquema já extraídos no inventário `41339162377` usados como evidência; nenhum outro backup lido.

## Resultado da análise

Comparação offline independente com o snapshot: **29 roles/configs, 21 memberships, 12 default ACLs e 40 tabelas sem divergências**. Tradução de OIDs usa nomes reais e namespaces do TOC; ACL do kit é exatamente a do snapshot. Atributos, grantor e opções ADMIN/INHERIT/SET não são descartados. `supabase_admin` continua superuser e `postgres` continua NOSUPERUSER. Configurações de `search_path`, inclusive a barra original, são preservadas; as bibliotecas exigidas pelo authenticator não são substituídas por stubs.

`pg_restore --exit-on-error --single-transaction` restaura o arquivo completo em banco vazio, preservando ownership e ACL. Não usa `--no-owner`, `--no-acl`, `--clean` ou lista filtrada. A transação cobre a restauração do banco; a criação prévia de roles/banco ocorre separadamente. Falha não permite concluir sucesso; não há repetição automática.

O comparador de esquema conserva identidade, owner e corpo SQL das seções, incluindo privilégios, RLS, comentários e funções; retira apenas ordem entre seções e delimitadores aleatórios do cliente. As 40 tabelas com baseline têm contagem e hash de todas as linhas, incluindo multiplicidade. Roles, memberships e default ACLs são comparados integralmente após normalizar ordem/OIDs. Não foi identificada incompatibilidade estática evidente com o dump/cliente 17.11. Eventual diferença de execução deve ser diagnosticada, sem ampliar normalizações para forçar sucesso.

## Limites da conclusão

O dump é anterior à correção de ACL: recuperar essa ACL histórica não a torna segura para publicação. Os testes Python leem exemplos sintéticos e guardas; não comprovam execução PostgreSQL.

Os dados das 27 tabelas Auth não têm baseline completa. O TOC contém também `auth.refresh_tokens_id_seq` e seu `SEQUENCE SET`: a restauração tenta aplicá-los, mas **o valor/estado dessa sequência não é comparado** pelo esquema ou pelos hashes das 40 tabelas. Recomenda-se explicitar esse limite no relatório final; não há motivo para transformar o ensaio em certificação integral de Auth.

Não são comprovados login/JWT/HTTP, senhas de roles, bytes dos cinco objetos Storage, collation/configuração completa do cluster nem RPO/RTO de produção. A sessão local do authenticator comprova apenas conexão e carregamento das bibliotecas. Esses limites permitem o ensaio restrito; impedem alegar que o SaaS inteiro ou sua recuperação comercial já estão homologados.

## Adendo — diagnóstico independente da execução V3

O run `41342288411` restaurou o dump, mas **não foi aprovado**. A avaliação estática anterior não demonstrava execução e não detectou a serialização incorreta de uma configuração de lista. Os 26 arquivos indicados em `report.json` tiveram hashes e tamanhos reconferidos offline, sem divergências.

A única divergência entre as 29 roles é `authenticator.rolconfig`: a origem tem `session_preload_libraries=supautils, safeupdate`; o destino contém `session_preload_libraries="supautils, safeupdate"`. O gerador emitiu o valor inteiro como um único item de lista. O erro de `sql-08.txt.stderr` confirma a tentativa de abrir um arquivo único chamado `supautils, safeupdate`. As duas bibliotecas tinham carregado individualmente no preflight. A correção deve preservar os dois itens e sua ordem, sem alterar a baseline ou ignorar a diferença de configuração.

O esquema contém 744 seções em ambas as versões. Exatamente seis diferem: DEFAULT ACL de FUNCTIONS/SEQUENCES/TABLES em `auth` e `public`. Todas as linhas são GRANT ALL positivos a destinatários distintos; só a ordem mudou. Os conjuntos **e as multiplicidades** das linhas são iguais. Não houve diferença nas 21 memberships nem nos 12 default ACLs do catálogo real. As 40 tabelas e ACL do kit também passaram no relatório da execução.

Uma correção do comparador pode ordenar apenas essas instruções independentes reconhecidas integralmente, conservando a identidade da seção e o texto completo de cada concessão. Não deve ordenar SQL arbitrário: REVOKE, mistura, sintaxe desconhecida ou corpo de função exigem comparação literal. A comparação separada do catálogo deve continuar exigindo owner, namespace, tipo, destinatário, privilégio, grant option e grantor. A aprovação do novo candidato depende de regressões que rejeitem perda ou adição de permissões, além de nova revisão; esta análise não altera o resultado falho da V3.

## Adendo — revisão focal V4

**Aprovado no escopo SQL/comparador para novo ensaio remoto**, sem afirmar que a V4 já executou PostgreSQL. Hashes conferidos:

- `restore.py`: `fd0caa76421b27e25402cc1d4be34419faaf2a5ce30972b335398957b602e10e`.
- `test_restore.py`: `ef4c905a0bdf9b72c644509b8ccba1a80688257a6b6bf369ecc6567002f214f9`.
- `README.md`: `f649a1803f882a3f083ce06805638711800c9068b7b761c879e7fb17bd126e6a` (UTF-8 legível).
- Baseline imutável: `43b87aceb61497dd9f1f28ac8538d7d4e93752f8415c60ea47f3100dca0485e0`.

A configuração agora gera `ALTER ROLE "authenticator" SET "session_preload_libraries" TO 'supautils', 'safeupdate';`, preservando itens e ordem. O comparador não mascara a falha antiga: o replay dos globals V3 continua detectando a divergência da role.

`canonical_default_acl` só normaliza uma seção DEFAULT ACL inteiramente composta pela sintaxe estreita de GRANT ALL, com owner/schema/tipo coincidentes com o cabeçalho e destinatários distintos. Mantém cada linha integral. REVOKE, SQL desconhecido, destinatário repetido, contexto misturado e WITH GRANT OPTION retornam ao corpo literal; demais seções permanecem literais. O comparador independente de catálogo continua preservando grantors e privilégios.

Nesta revisão foram executados **quatro testes Python focais, todos aprovados**, sem subprocesso PostgreSQL/Docker/job. Eles cobrem emissão da lista, as seis permutações observadas, perda/adição/mudança de permissão ou identidade, grant option e fallback literal. Replay independente dos dois schemas reais preservados: **744/744 seções iguais**, enquanto a configuração errada V3 ainda é rejeitada. A nova conexão authenticator permanece obrigatória na execução remota; Auth HTTP e os demais limites históricos continuam pendentes.
