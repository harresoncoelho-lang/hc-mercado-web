# Bootstrap específico — candidato para revisão

**Estado: preparado, não aplicado.** Único alvo: `licitaplena-homologacao`, projeto `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`. A coordenação deve conferir a aba/conexão real; um rótulo dentro do SQL não prova a identidade do projeto.

| Arquivo | SHA-256 |
|---|---|
| `01-bootstrap-prekit-staging.sql` | `3756dd11fbeb27f32063b4e90dfe24b2bf3cb2bfe98325501ad76a4e9b8ce9a6` |
| `02-verificar-bootstrap-somente-leitura.sql` | `484eda86f662eeb0aa19f32d70da2375eb20c8e26bdfa35686fb00eabdb5e8f6` |
| `preparar-bootstrap-especifico.cjs` | `e4502b97b5f6ed7ffd9a745c72717363e90cfe1ae57ae9799e2a267aa7388102` |
| `verificar-bootstrap-artefato.cjs` | `b497e28db61bf1fa65375c8e73408e40eb2846e2512a6d3d102b594058a5add0` |

O preparador fixa os cinco inventários por SHA-256, o projeto/organização e PostgreSQL **17.11**. Não é um migrador genérico; só emite arquivos novos com `--emitir` e recusa sobrescrita. Não tem conexão, cliente SQL ou rede. A produção observada usa **17.6**: o ensaio será no mesmo major, com patch diferente, sem downgrade ou certificação automática de equivalência.

## Diferença sobre o destino vazio observado

- **19 tabelas novas em public:** 18 do recorte operacional e a dependência `dados_robo`. Esta última permanece vazia, assim como todas as demais. Sem configuração, histórico, boletim, cliente ou arquivo copiado.
- **22 funções públicas novas:** corpos da base operacional observada e os dois helpers de cadastro/permissão coletados separadamente. Somente `CREATE OR REPLACE FUNCTION` é convertido em `CREATE FUNCTION`, pois o destino deve estar vazio. O corpo é preservado.
- **33 policies novas:** as 31 do recorte anterior e duas da dependência. Quatro são policies da aplicação em `storage.objects`; nenhuma policy existente é apagada ou substituída.
- **Três triggers da aplicação:** status de cliente, limite de CNPJs e cadastro em `auth.users`. Não substitui triggers/funções gerenciados. As sete definições de triggers de Storage do destino devem permanecer iguais.
- Os grants diretos dos novos objetos públicos reproduzem os inventários da base anterior ao kit. Os defaults locais reduzidos continuam iguais; não há `ALTER DEFAULT PRIVILEGES`, alteração/criação de role ou schema, nem mudança de permissões das tabelas gerenciadas de Auth/Storage.
- `operacao_identificacao_empresa` e `operacao_kit_documentos` **não** são criadas. O arquivo aprovado do delta original permanece intacto. A variante explícita para o ensaio só pode ser selada depois do novo inventário pré-kit.

Os grants legados reproduzidos são abrangentes em alguns objetos. Sua presença aqui representa o estado inicial a ensaiar, não uma aprovação geral dessas permissões para um produto publicado. A prova deve incluir o delta de segurança já revisado e os testes de papéis/CNPJs antes de qualquer liberação.

## Guardas e preservação

O candidato usa transação única, `lock_timeout=2s`, `statement_timeout=30s` por comando e search_path local `pg_catalog,public`. Antes de criar objetos, trava as três tabelas gerenciadas relevantes no destino novo e exige: executor/banco `postgres`, versão `170011`, fingerprint vazio `785cf53d0d88df117eff15085f879018`, ausência de relações/funções em public e ausência de usuários, buckets e objetos. Qualquer diferença aborta; não remover uma guarda para prosseguir.

As tabelas e funções são criadas sob o proprietário `postgres`. A ACL dos objetos públicos novos é revogada/recomposta explicitamente a partir dos inventários; defaults globais não são alterados. O gate final compara colunas, constraints, índices, policies, triggers, ACLs de tabelas/funções, roles, memberships, schemas e defaults. Também confere corpos/atributos das funções, RLS e ausência de dados. Os componentes gerenciados esperados vêm do catálogo **do destino**, preservando suas diferenças de patch.

As verificações são inline no SQL, razão dos arquivos de aproximadamente 563 KB e 464 KB. O gate ocorre uma vez no bootstrap e é repetido intencionalmente no segundo arquivo independente. Dentro de cada gate há duplicação evitável: cada array esperado aparece duas vezes para a comparação bidirecional `@>`. Uma variável JSON esperada única pode reduzir esse volume sem mudar a prova; esta simplificação ainda não foi feita, e o hash acima permanece o candidato atual. Nenhuma tabela auxiliar ou função permanente de QA é criada. O segundo arquivo executa o mesmo gate em `BEGIN READ ONLY`; não cria ou altera objetos. O retorno esperado é `BOOTSTRAP_PREKIT_STAGING_OK`.

O checkpoint seguinte deve ocorrer antes de qualquer fixture: gate readonly aprovado, 19 tabelas públicas vazias, `auth.users`, `storage.buckets` e `storage.objects` vazios, e captura de um catálogo pré-kit novo usando a consulta original. Só esse catálogo posterior permite preparar a variante explícita do delta para staging; ele não autoriza trocar silenciosamente a guarda do arquivo de produção.

## Conferência realizada e limites

O teste de artefato foi escrito antes da geração e falhou com “Bootstrap específico ainda não preparado”. O preparador passou em `node --check`; somente geração de texto e leitura de JSON foram executadas. A primeira emissão parou antes de gravar por usar o nome incorreto de um campo do catálogo (`estado` em vez de `habilitado`); corrigido para a chave observada. O primeiro check do arquivo gerado reconheceu um INSERT **dentro** do corpo copiado de uma função como se fosse comando externo; a inspeção passou a distinguir blocos delimitados por dólar. Nenhuma dessas falhas executou SQL.

`bootstrap-verificacao-estatica.json` registra o resultado estático final aprovado e o hash do candidato. Essa inspeção por texto não é um parser SQL nem prova de execução PostgreSQL; a revisão independente e o ensaio real continuam necessários. Não foi executada a suíte global do produto porque não houve alteração de produto.

Não houve upload, custo, SQL remoto, Docker, serviço local, aplicação nativa, publicação, commit ou push nesta frente. Nenhum arquivo protegido ou fonte de produção foi alterado. O roteiro de restauração custom continua separado: estes arquivos não consomem o dump PGDMP nem comprovam recuperação.
