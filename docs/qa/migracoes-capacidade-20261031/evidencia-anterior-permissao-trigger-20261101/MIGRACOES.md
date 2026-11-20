# Preparação de migrações e permissões — 31/10/2026

## Estado

Pacote local preparado e testado; revisão independente pendente. Nenhuma escrita remota, migração, publicação, ativação ou alteração de autenticação foi executada por esta frente. Os artefatos desta pasta não autorizam aplicação em produção.

A coordenação executou `01-catalogo-readonly.sql` no projeto confirmado pelo navegador interno e exportou o resultado integral em CSV/JSON. O inventário de 31/10/2026 às 14:23:53 UTC registrou PostgreSQL 17.6, `read_only=on`, 21 relações, 27 funções e 31 policies no recorte. O SHA-256 do JSON é `cd708621a042125e408774128e7927c8cea3ebc9e16fcc30bd084f5f782d71aa`; o fingerprint interno do catálogo é `4550d262d2f09edec1efd68b4c699f67`. Não foi salvo script no serviço nem executada escrita de banco.

Essa coleta completa a comparação do recorte definido; não representa catálogo global do projeto ou inspeção de dados. A evidência administrativa anterior continua preservada em `../integracoes-producao-20261031/`.

## Diferenças comprovadas e pacote

`02-delta-operacional.sql` contém uma transação única e é derivado somente do inventário e das fontes homologadas. `gerar-delta-local.cjs` gera o arquivo local; não possui conexão de banco. `delta-manifesto.json` fixa hashes e alcance.

| Resultado da comparação | Tratamento preparado |
|---|---|
| Identificação e kit ausentes | Duas tabelas novas, suas policies, funções e triggers. |
| Helpers de escrita/validação e gates ausentes | Doze funções novas, diretamente na versão final homologada. |
| Quinze policies existentes ainda usam condições anteriores | `ALTER POLICY`/`RENAME` individual sobre os nomes exatos: 12 em tabelas operacionais e três de escrita no Storage. Dez policies de leitura são acrescentadas ao separar leitura/escrita. Nenhuma policy é apagada. |
| FKs de escopo e proteção de caminhos ausentes | Cinco FKs compostas, uma checagem de caminho e triggers de preservação/validação. As constraints específicas de identificação/kit também entram com as tabelas novas. |
| `bootstrap_operacao` e `eh_membro_operacao` concedem EXECUTE a PUBLIC/anon | Revogação desses dois grants, preservando corpos, donos e acesso autenticado/serviço. |
| `marca`, `modelo`, `valor_unitario_proposta`, `valor_unitario_homologado` já presentes e compatíveis | Nenhum DDL para esses campos; valores não são convertidos. |
| Checklist remoto e `vitoria_sem_detalhamento` já presentes | Preservados. A base antiga não é reaplicada. |

Os 20 corpos de funções operacionais comuns à base local e remota têm os mesmos tokens SQL, desconsiderando comentários/espaços e preservando literais. Os hashes brutos diferentes refletem formatação; o delta não substitui esses corpos. `comparacao-helpers-base.json` registra essa comparação lexical, que não é uma prova geral de equivalência semântica.

O SHA-256 atual do candidato é `7cbe38e48980e9d58f73f95d69e8f926950517d616fe6d00f92dfd091b5502bf`. O gate original do kit, SHA-256 `2c4023cb0cac4e9b5fa29afee68398a0b4e402663dee9cd9fa580e7ea19178cf`, está incluído intacto. Há verificações adicionais das policies finais, hashes de todos os corpos novos, RLS e triggers de invalidação antes do commit.

## Guardas, concorrência e retomada

O candidato exige o executor `postgres` e recompõe o mesmo catálogo para comparar o fingerprint remoto antes de qualquer DDL. Hora de coleta e versão estão fora do hash. A ordem das listas é fixada na consulta. A assinatura inclui ACLs, membros, defaults e dependências do recorte; uma alteração administrativa alheia ao módulo pode abortar conservadoramente. Não existe ajuste automático nem fallback para ignorar diferenças.

Antes da comparação, a transação solicita locks exclusivos nas tabelas afetadas, membros e `storage.objects`, com espera máxima de dois segundos por lock. Cada comando tem timeout de 30 segundos. Isso não promete uma transação de duração total de 30 segundos: uma futura aplicação precisa de janela curta acordada, sem outro operador alterando DDL. A leitura/escrita dessas relações pode aguardar durante a aplicação; esta preparação não mediu esse impacto em produção.

O preflight de integridade interno consulta apenas a existência de vínculos/caminhos inconsistentes e aborta com mensagem genérica, sem imprimir registros. Como produção não foi percorrida em busca desses dados, esse gate pode bloquear a aplicação futura. Não há limpeza automática.

Após erro antes do commit, interromper o executor e usar `ROLLBACK`; reconferir catálogo antes de repetir. Após um commit bem-sucedido, a repetição do mesmo pacote é recusada porque o estado inicial deixou de existir. Isso é idempotência por recusa segura: não reabre grants nem reinstala políticas. Estado parcial, objetos adicionais ou um fingerprint diferente exigem novo inventário e delta revisto. Não remover a guarda para forçar execução.

## Dependências e alcance

| Dependência | Fonte local | Conferência necessária |
|---|---|---|
| Auth e cadastro aprovado | `auth.users`, `auth.uid()`, `public.clientes`, `public.admins` existentes | Identidade, tipos e permissões; preservar implementação e dados existentes. |
| Organizações, membros, empresas, processos e documentos | `operacao_licitacoes.sql` | Base existente; não reaplicar helpers/policies iniciais. |
| Itens e acompanhamento | `operacao_acompanhamento.sql` | Tipos decimais, vínculos empresa/organização/processo e índices. |
| Cota e owner administrativo | `limite_cnpjs_operacao.sql` | Helpers transitivos e estrutura existente. |
| Isolamento por empresa | `acesso_empresa_convites.sql` | `empresa_id` no membro, FK composta e helpers de acesso. |
| Campos dos itens | `operacao_itens_valores_unitarios.sql`, `operacao_itens_marca_modelo.sql` | `valor_unitario_proposta numeric(15,2)`, `marca text`, `modelo text`; não converter totais existentes. |
| Identificação | `identificacao_empresa.sql` | Tabela, proveniência, invalidação por alteração do cadastro/documento/arquivo e RPC privada. |
| Segurança de escrita | `seguranca_operacao.sql` | Escrita só por gestor/operador no escopo; FKs/checagens/triggers; versão final do gate e da confirmação. |
| Kit | `kit_documentos.sql` | Tabela/RLS, revisão vinculada à versão, RPC concorrente e ACLs diretas limitadas. |
| Gate | `verificar_kit_prepublicacao.sql` | Executar intacto em transação somente leitura após instalação autorizada, com erro interrompendo o executor. |

Os leitores são o SDK com JWT em páginas operacionais e os handlers do módulo. Os escritores são a confirmação e a RPC do kit no backend; as operações preexistentes de empresa/processo/documento continuam condicionadas ao papel e ao CNPJ. A cadeia de segurança também alcança agenda, prazos, empenhos, itens, ocorrências, contratos, anexos e renovações. Não se deve corrigir apenas Storage e declarar essa cadeia segura.

## Inventário somente leitura

`01-catalogo-readonly.sql` usa `BEGIN READ ONLY`, timeout de 20 segundos e `search_path` local `pg_catalog,public`. Retorna uma linha JSON com definição e MD5 do recorte, além de hora, versão e confirmação de transação somente leitura. Não consulta registros de clientes, peças, objetos armazenados ou conteúdo de arquivos; não chama RPC do produto.

O recorte contém relações operacionais, cadastro/admin, `auth.users`, `storage.objects` e `storage.buckets`; colunas, defaults e ACLs de coluna; constraints; índices; policies; triggers; funções operacionais e funções chamadas por triggers; ACLs diretas efetivas; schemas/default ACLs; atributos e associações de papéis; dependências catalogadas. Corpos são retornados somente para a lista de funções operacionais, identificação e kit. Funções externas ao recorte chamadas por trigger aparecem por identidade/hash e exigem análise própria, se relevantes.

O MD5 detecta alteração do catálogo observado; não é prova criptográfica de integridade nem inventário global. PostgreSQL não registra todas as dependências contidas em corpos PL/pgSQL. Views/RPCs fora do recorte, políticas de outros schemas, configurações do serviço, integridade dos dados e bytes privados do Storage continuam fora dessa consulta. O arquivo exportado precisa conter o JSON integral; uma célula truncada ou capturas parciais não selam o delta.

## Condições para uma aplicação futura, ainda não autorizada

1. Concluir a revisão independente do candidato exato e seus testes.
2. Demonstrar isolamento do destino de homologação, vínculo válido das credenciais e recuperação de banco/Storage. Os previews atuais não comprovam isolamento.
3. Ensaiar o candidato no PostgreSQL 17.6/serviços reais de um destino separado, aproveitando os cenários autenticados já existentes. Confirmar limites de lock/duração com volume representativo.
4. Obter autorização explícita para a aplicação e o alvo; preservar backup recuperável e deployment anterior. Esta etapa não inclui essa autorização.
5. Reconferir o catálogo e o hash do SQL; qualquer diferença interrompe o processo. Usar executor com parada no primeiro erro. Manter habilitação fechada.
6. Depois do commit autorizado, capturar o catálogo posterior, executar o gate intacto em `BEGIN READ ONLY`/`search_path` canônico e o percurso autenticado. Uma chamada administrativa sem JWT não substitui `identificacao_empresa_habilitada()` na sessão real.

Não haverá reset de policies, reexecução de `operacao_licitacoes.sql` nem reaplicação indiscriminada da cadeia. Um catálogo não conferido bloqueia o pacote aplicável.

## Reversão e recuperação

Antes do `COMMIT`, qualquer erro deve abortar e ser seguido de `ROLLBACK`; o executor futuro precisa parar no primeiro erro. Depois do commit, a reversão operacional é manter a chave do módulo fechada e voltar ao deployment conhecido, conservando tabelas, versões, revisões e arquivos. Não há `DROP TABLE`, limpeza de dados ou retorno genérico a policies antigas.

Uma reversão de DDL/ACL após commit exigirá o catálogo anterior exato e análise dos dados gravados desde a alteração. Reabrir permissões antigas pode restaurar a falha de isolamento; portanto não será oferecido um downgrade automático.

O Supabase mostrou backup recente, mas isso não comprova restauração. Os dois dumps da homologação anterior são locais e não representam produção. A cobertura precisa incluir banco e bytes do Storage separadamente, com associação por caminho e prova de restauração em destino isolado. Nenhum desses dados foi exportado nesta preparação.

## Evidência reutilizada e validação desta etapa

Reutilizada a homologação real local descrita em `../homologacao-real-20261031/HOMOLOGACAO.md`: PostgreSQL, GoTrue, PostgREST e Storage reais em loopback, isolamento por CNPJ, persistência, concorrência, revisão, invalidação documental e DOCX. A prova local anterior não é certificação remota e seus serviços permaneceram encerrados.

O teste da consulta usa PGlite já instalado, com fixture em memória e sem rede. A consulta executou nos estados de ausência e alvo completo; detectou ACL de coluna, papel herdado e sobrecarga extras; seu hash permaneceu estável em duas leituras consecutivas. `verificacao-local.json` registra 13 verificações aprovadas. Os catálogos `catalogo-local-base.json` e `catalogo-local-alvo.json` são referências fictícias; seus donos/defaults administrativos não devem substituir os valores remotos.

`testar-delta-local.cjs` reconstrói as tabelas públicas, colunas, constraints, índices, corpos operacionais, ACLs e policies a partir do inventário real, preservando checklist e `vitoria_sem_detalhamento`. Usa dados fictícios. Auth/Storage são estruturas mínimas de compatibilidade, sem copiar serviços gerenciados, usuários ou bytes reais. PGlite usa PostgreSQL **18.6**, enquanto produção usa **17.6**. O teste substitui somente o fingerprint esperado na string SQL em memória; o arquivo candidato conserva o hash remoto. O arquivo original foi recusado pela guarda nesse ambiente diferente.

Resultado atual: **520 verificações aprovadas**, **488 objetos preexistentes comparados sem diferença** e hashes dos dados de **18 tabelas públicas preservados**. As duas funções com ACL intencionalmente reduzida têm todos os demais campos comparados e preservados separadamente. Defaults globais, atributos e associações de papéis permanecem iguais. A leitura do colaborador permanece; sua escrita é bloqueada; operador mantém escrita; readiness, confirmação por RPC e gravação do kit funcionaram na fixture.

Oito cenários negativos passaram: ambiente diferente, policy adicional, helper alterado, ACL adicional, instalação parcial, legado inconsistente, falha depois dos gates e segunda aplicação. Cada falha foi seguida de rollback e comparação de catálogo. A falha tardia demonstrou que nem tabelas/funcões novas nem alterações de policies permanecem após rollback. Evidências: `delta-testes-local.json` e `preservacao-delta-local.json`.

Duas falhas do harness durante sua preparação foram corrigidas antes do resultado final: índices únicos compostos precisaram ser recriados antes das FKs na réplica; a injeção da falha tardia precisou preservar `$$` na substituição JavaScript. Nenhuma delas ocorreu remotamente ou foi tratada como aprovação.

Não foram repetidos os ensaios autenticados, Docker ou a suíte de produto nesta frente. Policies administrativas e implementação de Auth ficaram preservadas fora do delta; sua presença no inventário não certifica o SaaS inteiro. Resumo, e-mail, robôs, autenticação, modelos e arquivos de produção não foram alterados. Nenhum cliente nativo, billing ou ferramenta foi instalado/reconfigurado.

Consulta pública de documentação via Context7: [funções administrativas do PostgreSQL](https://www.postgresql.org/docs/current/functions-info.html), para deparse de definições e expansão das ACLs. A consulta externa não incluiu conteúdo do projeto, dados ou segredos.
