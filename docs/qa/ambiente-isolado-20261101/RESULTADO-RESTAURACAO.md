# Restauração fictícia executada e validada

**Resultado: restauração lógica V4 aprovada no recorte documentado.** Em 01/11/2026, o dump fictício foi restaurado em PostgreSQL 17.11 remoto e efêmero; os sete critérios finais passaram. Esta prova não é restauração de produção nem homologação completa da aplicação.

Run privado [41343013570](https://github.com/harresoncoelho-lang/licitaplena-homologacao/actions/runs/41343013570), commit `35a5ef02de288a017fd7d66a84ecf66e057228ed`, concluído com `success`. O job terminou às **19:42:06 UTC**. O relatório registra `restored_and_compared_for_documented_scope`, fase `complete`, `restore_completed=true` e `container_removed=true`.

## Origem e ambiente

- Origem exclusivamente fictícia: `antes-correcao-acl-20261031T022043Z.dump`, 505.274 bytes, SHA-256 `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c`. É o snapshot de teste **anterior à correção de ACL**, não o banco produtivo e não o catálogo pré-kit da migração.
- Baseline derivada do snapshot preservado: SHA-256 `43b87aceb61497dd9f1f28ac8538d7d4e93752f8415c60ea47f3100dca0485e0`. O inventário anterior confirmou origem e ferramentas 17.11, com 812 entradas selecionadas no TOC.
- Destino: banco vazio `licitaplena_restore` em container efêmero do runner privado; imagem Supabase Postgres 17.11.0.004 fixada no digest `e85bc10ac5b141223b289e1e8dc8d448cf3df92501917149db0366b9c5aaf053`. É separado do projeto Supabase de staging e de produção.
- Rede do container `none`, nenhuma porta, input somente leitura e áreas graváveis efêmeras; entrada padrão da imagem substituída por inicialização vazia. Não houve serviços Auth/Storage HTTP, SMTP, publicação do site ou serviço local na máquina do usuário.
- Roles e memberships foram preparadas a partir da baseline sem senhas. O `pg_restore` completo usou `--exit-on-error --single-transaction`, conservando ownership e ACL; sem `--no-owner`, `--no-acl`, `--clean`, lista filtrada ou correção posterior do conteúdo restaurado.

## Conferência independente das evidências

A revisão final releu somente os artefatos preservados: **25 arquivos/tamanhos/SHA-256 conferem**, sem repetir serviço, SQL, job ou testes já aprovados. Os comparadores foram conciliados novamente com a baseline e os dois schemas reais, com estes resultados:

| Critério | Evidência validada |
|---|---|
| Esquema | 744 seções em origem e destino; zero diferenças após a normalização restrita aprovada |
| Dados com baseline | 40 tabelas: 30 public e dez Storage, com mesmas contagens e hashes de todas as linhas |
| Roles | 29 roles, atributos e configurações exatamente iguais, por nome |
| Memberships | 21 relações, incluindo grantor e opções ADMIN/INHERIT/SET, iguais |
| Default ACLs | 12 registros por owner/schema/tipo, com permissões e grantors iguais |
| Kit histórico | Owner, RLS, configurações e ACLs anteriores à correção iguais |
| Sessão authenticator | `sql-08.txt` retorna exatamente `authenticator`; as duas bibliotecas também carregaram individualmente no preflight |

A comparação de esquema conserva corpos SQL, owners, grants, policies, comentários e funções. Somente a ordem das seções, delimitadores aleatórios do cliente e concessões DEFAULT ACL estritamente reconhecidas e independentes são normalizadas. REVOKE, SQL desconhecido, grant option ou contexto misturado continuam literais; o catálogo de default ACL permanece uma comparação independente. A configuração de lista do authenticator foi corrigida no executor, sem alterar a baseline. Os detalhes e as regressões estão em [REVISAO-RESTAURACAO-SQL.md](REVISAO-RESTAURACAO-SQL.md).

## Durações e integridade

O runner mediu **19,078 segundos**; a chamada de `pg_restore` mediu **0,267 segundo**; o intervalo do job nos metadados foi **26 segundos**. São medidas distintas de um ensaio pequeno. Nenhuma é RTO de produção, benchmark de clientes ou promessa de recuperação do SaaS.

| Evidência preservada | SHA-256 |
|---|---|
| `restauracao-run-41343013570/restauracao-ficticia-41343013570/report.json` | `f0aec8ba94bd833cad8bb62bc1c6343ed0dbd3c3c40ae0269ea10574755d3858` |
| `restauracao-run-41343013570.json` | `f7f38fde4d0774da14237e2f05caaa5014424c933745e8bcfab3c3d3df3d5b0e` |
| `restauracao-run-41343013570.log` | `eaab584a8651001132250d059eab040ca240087ef289ce7140dee2f84e511904` |
| Captura final `restauracao-v4-concluida.jpg` | `89a2f5258d37c30eeb3e3fbc38e936b6e6d54cb128ad5a1ff3b8602ed19c8011` |
| Executor V4 `restore.py` | `fd0caa76421b27e25402cc1d4be34419faaf2a5ce30972b335398957b602e10e` |

A captura `restauracao-v4-sucesso.jpg` é intermediária: o cabeçalho ainda exibia execução em andamento. A conclusão usa os metadados finais e `restauracao-v4-concluida.jpg`. As falhas e evidências V1–V3 permanecem históricas; não foram convertidas retroativamente em sucesso. Os hashes individuais dos schemas, resultados e demais arquivos estão no `report.json`.

O log final preserva o aviso de que as Actions fixadas para Node.js 20 foram executadas pelo GitHub em Node.js 24, além de avisos de depreciação de `punycode`/`url.parse()` durante o upload do artefato. As três notices SQL de memberships preexistentes de `pg_monitor` também foram preservadas; a comparação final de memberships passou. Esses avisos não foram filtrados nem tratados como falha da restauração. Nenhuma dependência foi atualizada para encerrar este ensaio.

## Limites e pendências

1. Os dados das **27 tabelas Auth** presentes no dump não têm baseline completa de contagens/hashes. O restore integral não apresentou erro, mas não certificamos a igualdade desses dados. O **valor/estado de `auth.refresh_tokens_id_seq` não foi comparado**; apenas sua definição entra no esquema. Senhas de roles não foram copiadas.
2. Há um bucket e **cinco registros `storage.objects`** recuperados e comparados como metadados. Seus bytes não acompanham o dump e **não foram restaurados**. São diferentes dos dois arquivos de produção cuja cópia local foi auditada anteriormente.
3. A sessão SQL do authenticator não comprova JWT, login, PostgREST, Storage HTTP ou o fluxo de documentos/propostas pela aplicação. O teste RLS no staging é outra evidência, também sem JWT/HTTP.
4. A ACL anterior à correção foi recuperada fielmente para provar recuperação histórica. Isso não autoriza expor esse banco nem promover essa ACL à produção.
5. Os backups físicos produtivos foram apenas listados no provedor. Não foram baixados/restaurados aqui. A cópia externa, recuperação conjunta de banco/arquivos, configuração completa do cluster, collation original, configurações Auth e RPO/RTO produtivos continuam sem prova.

**Conclusão permitida:** o dump fictício selecionado pode ser restaurado com ownership/ACL e comparações aprovadas no escopo acima. A etapa de restauração fictícia está concluída; a recuperação comercial de produção continua separada.
