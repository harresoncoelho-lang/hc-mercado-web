# Delta operacional — variante explícita do ambiente isolado

**Preparado e conferido estaticamente; sem execução por esta frente.** A coordenação deve revisar antes da aplicação. Alvo único `licitaplena-homologacao`, projeto `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, PostgreSQL **17.11**. Produção permanece fora da execução.

## Base observada e diferença executável

A coordenação executou o bootstrap v3 com sucesso e recebeu `BOOTSTRAP_PREKIT_STAGING_OK` também na verificação readonly após COMMIT. A nova captura `catalogo-prekit-staging.json` tem SHA-256 `5c607e56e58e7aa7b67d16baee150f26ff05e2b599809645777a12f6af51b9ad`, read_only=on, 21 relações/27 funções no recorte e fingerprint `8abc338413ff0c60770d3aea1c3413d1`. Esse recorte inclui 18 tabelas públicas e três gerenciadas; `dados_robo` é a 19ª tabela pública, verificada separadamente.

O arquivo original `docs/qa/migracoes-capacidade-20261031/02-delta-operacional.sql` conserva o SHA-256 **`1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94`**. A variante acrescenta um cabeçalho identificando o ambiente e altera somente esta condição:

```diff
- if md5(observado::text)<>'4550d262d2f09edec1efd68b4c699f67' then
+ if md5(observado::text)<>'8abc338413ff0c60770d3aea1c3413d1' then
```

Todo o restante permanece byte a byte: executor, timeout, locks, transação, DDL, funções, ACLs, policies, validações de vínculos, gate do kit, pós-estado e COMMIT. O teste remove o cabeçalho e reverte essa única troca para comprovar igualdade exata com o original. Isso é homologação de uma **variante de ambiente declarada**, não execução byte a byte do arquivo de produção nem licença para trocar guardas quando ocorrer erro.

## Artefatos e sequência

| Arquivo | SHA-256 |
|---|---|
| `03-delta-operacional-staging.sql` | `97f75e28b60169fc20e0805756403e0d058c6fbd4ccdd5347148a9c6685ecf37` |
| `04-ensaiar-delta-com-rollback-staging.sql` | `8c0d0a10f7c6509d95ed15ea60600a6339993f009332cc505d308db7d1ccbbde` |
| `05-verificar-prekit-somente-leitura.sql` | `c7b55e2a625938207bc595feec3b0c9e4b91c269aee84ff00914bb179588523a` |
| `06-verificar-posdelta-somente-leitura.sql` | `0563e79f9854207b36dfdc9fb77ddd592aa2f84ddd47ee5d96f60d775698165c` |

1. Conferir externamente projeto/organização da conexão. Conferir os hashes e o parecer independente. O SQL não prova por si só o project_ref.
2. Rodar **05**. Exige fingerprint pré-kit exato, executor/banco/versão esperados, 19 tabelas públicas vazias, nenhum usuário Auth/objeto Storage e apenas o bucket privado `operacao-documentos`. Retorna `PREKIT_STAGING_CONFIRMADO`, configuração real do bucket e vazios. Não impõe MIME ou limite de tamanho: são observados, não inventados.
3. Testar a rejeição usando o **arquivo original 1619… sem modificação**. O resultado exigido é `Catálogo divergente: abortado sem alteração. Capture novo inventário e revise o delta`, ocorrido antes de qualquer DDL. Interromper, executar `ROLLBACK;` explicitamente e rodar **05** novamente. Nenhum script remove/contorna a guarda. Se a mensagem diferir, diagnosticar antes de avançar.
4. Rodar **04**. Ele contém a variante integral e seus gates; troca somente o COMMIT final por ROLLBACK e acrescenta uma nova transação readonly com **05**. Exigir `KIT_PREPUBLICACAO_OK` durante o ensaio e `PREKIT_STAGING_CONFIRMADO` depois do rollback. Capturar resultados e novo catálogo para comprovar que o fingerprint permaneceu igual. Um erro exige ROLLBACK explícito e diagnóstico, sem retry automático.
5. Depois da prova e aprovação da revisão, a coordenação pode aplicar **03**, que contém o COMMIT normal. Preservar saída e horários. Não repetir depois do sucesso: a guarda deve rejeitar o novo estado.
6. Rodar **06**, antes de criar fixtures de usuários/documentos. Copia integralmente os gates do original e exige 21 tabelas públicas vazias, Auth/Storage sem usuários/arquivos e o bucket privado. Retorna `DELTA_STAGING_GATES_OK` e matrizes de privilégios efetivos: duas tabelas × três papéis × nove operações; seis funções × três papéis. Esses resultados são evidência real do banco, não valores presumidos a partir do SQL.
7. Capturar o catálogo pós-delta com a consulta original. Comparar objetos anteriores preservados, novos objetos esperados, ACLs alteradas deliberadamente e invariância de schemas/roles/defaults. Só então preparar os testes com identidades e dados fictícios para comportamento RLS por CNPJ.

O bucket foi criado pela coordenação pela UI **depois** da prova de bootstrap vazio. Foram informados public=OFF, quatro policies herdadas, limite mostrado pela UI como Unset/50 MB e MIME Any, sem arquivos. **05** captura os valores efetivamente guardados (`null` não equivale a limite numérico fixado). Não se deve executar o gate antigo que exige zero buckets depois desta preparação.

## Verificação e limites

`preparar-delta-staging.cjs` fixa por hash o original e o catálogo recém-coletado e recusa sobrescrita. Não possui conexão ou executor SQL. `verificar-delta-staging-artefato.cjs` foi criado antes: falhou por variante ausente e passou após geração. A primeira emissão abortou antes de escrever porque o catálogo registra `server_version` como `17.11`, não como o texto completo de `version()`; a validação agora exige exatamente o valor observado. `delta-staging-verificacao-estatica.json` registra a conferência final.

O teste prova payload/gates idênticos, troca única de fingerprint, rollback derivado sem diferenças ocultas e imutabilidade do original. Não interpreta SQL nem comprova a migração executada. Nenhum SQL, Docker, serviço local, upload ou custo foi gerado nesta frente.

Rollback transacional **não é restauração de backup**. Privilégios efetivos e gates **não comprovam login/JWT, rotas HTTP ou isolamento entre empresas com dados**. Essas provas continuam separadas. O ensaio de dump PGDMP exige executor remoto compatível; esse pacote não lê nem importa o dump.
