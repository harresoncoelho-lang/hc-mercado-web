# Revisão independente da variante do delta — staging

01/11/2026. Revisão de arquivos e metadados preservados, sem SQL, rede, navegador, serviço local ou runtime do produto. O único arquivo escrito nesta frente é este parecer.

**Especificação: aprovada para ensaio no projeto de homologação confirmado. Qualidade: sem bloqueio estático concreto identificado no pacote abaixo.** A aprovação é restrita aos hashes listados e ao projeto `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`. Não declara execução bem-sucedida, produção pronta, recuperação comprovada ou custo autorizado.

## Identidade e limites da variante

| Artefato | SHA-256 recalculado |
|---|---|
| `03-delta-operacional-staging.sql` | `97f75e28b60169fc20e0805756403e0d058c6fbd4ccdd5347148a9c6685ecf37` |
| `04-ensaiar-delta-com-rollback-staging.sql` | `8c0d0a10f7c6509d95ed15ea60600a6339993f009332cc505d308db7d1ccbbde` |
| `05-verificar-prekit-somente-leitura.sql` | `c7b55e2a625938207bc595feec3b0c9e4b91c269aee84ff00914bb179588523a` |
| `06-verificar-posdelta-somente-leitura.sql` | `0563e79f9854207b36dfdc9fb77ddd592aa2f84ddd47ee5d96f60d775698165c` |
| Delta original preservado | `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94` |
| Catálogo pré-kit real | `5c607e56e58e7aa7b67d16baee150f26ff05e2b599809645777a12f6af51b9ad` |

Removido o cabeçalho explícito e revertida a única comparação de fingerprint, `03` é exatamente igual ao original. A guarda passa de `4550d262d2f09edec1efd68b4c699f67` para `8abc338413ff0c60770d3aea1c3413d1`. Não há alteração de corpo de função, DDL, ACL, policy, lock, timeout ou gate. É uma variante de ambiente documentada, não execução byte a byte do original.

O catálogo de referência registra PostgreSQL 17.11 e `read_only=on`, 21 relações e 27 funções dentro do recorte original. Esse recorte inclui 18 tabelas públicas e três relações gerenciadas; a dependência pública `dados_robo` existe fora desse recorte e é verificada explicitamente pelos ensaios. O MD5 detecta divergência do catálogo e não prova o project_ref. A confirmação independente da URL/conexão do destino continua obrigatória antes de enviar SQL, inclusive antes dos locks.

## Ordem de DDL e dependências

A ordem das FKs foi conferida expressamente, considerando a falha de ordenação já corrigida no bootstrap:

- As chaves compostas `operacao_empresas(id,organizacao_id)` e `operacao_processos(id,organizacao_id)` já aparecem no catálogo pré-kit como índices UNIQUE btree válidos, prontos e não parciais. Sustentam a identificação e as cinco constraints incrementais de escopo.
- O índice UNIQUE `operacao_processos_id_empresa_org_idx` é criado antes de `operacao_kit_documentos`, que referencia suas três colunas. A ordem não repete o defeito da v2 do bootstrap.
- A tabela de identificação antecede as funções que retornam seu tipo composto; a tabela de kit antecede sua RPC e seu trigger. As funções de permissão novas precedem as policies que as utilizam. Os alvos dos triggers já existem.
- A leitura sequencial das 25 etapas de alteração/renomeação de policies confirma que cada nome está disponível na baseline ou resulta de uma renomeação anterior. Não se presume uma policy com nome inexistente.
- Os 12 corpos novos foram extraídos do texto e seus MD5, normalizados apenas quanto a CR, coincidem com os hashes exigidos pelo gate final. A comparação exata com o original também preserva assinaturas, linguagem, retorno, SECURITY DEFINER e search_path.

## Permissões, dados e serviços gerenciados

O delta mantém RLS nas duas tabelas novas, separa leitura de escrita e verifica vínculos de organização, CNPJ e processo. As novas referências compostas também restringem operações feitas por backend com bypass de RLS. As funções internas dos quatro triggers têm ACL somente do proprietário; os gates recusam concessão residual ou EXECUTE efetivo aos papéis de aplicação.

A RPC de gravação do kit permanece restrita ao proprietário e `service_role`; `authenticated` recebe SELECT na tabela e não escrita direta. O gate verifica ACL direta, acesso efetivo, policy integral, owner, assinatura, configuração e trigger. A RPC recebe a identidade do usuário pelo backend e revalida vínculo/estado; isto depende de posterior prova do transporte autenticado real, não autoriza expor `service_role` no navegador.

Os scripts não recriam Auth/Storage, não trocam seus proprietários nem alteram roles ou default privileges. Acrescentam triggers e alteram as policies de Storage da aplicação na mesma transação, conforme o original. Não há carga de registros de negócio, fixtures, SMTP, cron, IA externa ou configuração do robô nestes ensaios. Os INSERT/UPDATE nos corpos de funções são definições para uso futuro, não carga executada pela migração. A notificação de recarga do PostgREST é transacional; no ensaio de rollback ela não é consolidada.

`bucket-criado.json` registra o bucket privado e vazio `operacao-documentos`, configurado pela coordenação via UI. O limite observado é o padrão apresentado como 50 MB e MIME types livres. Os scripts exigem bucket privado, mas não mudam nem certificam política final de uploads. Essa configuração não substitui validação de conteúdo, isolamento de Storage e capacidade nos testes posteriores.

O original e os 20 arquivos protegidos continuam nos hashes esperados. Nenhum resumo, e-mail, robô, autenticação do produto ou arquivo de modelo foi alterado nesta revisão.

## Ensaios e sequência segura

1. **`05`, pré-kit:** transação readonly com a guarda do catálogo staging, executor/banco `postgres`, versão `170011`, exatamente 19 tabelas públicas e verificação de que estão vazias; sem usuários em Auth ou objetos no Storage; exatamente um bucket, privado, com o ID esperado. Deve passar antes da tentativa e voltar a passar depois de qualquer rollback.
2. **Recusa do original:** conforme o plano, o original preservado deve recusar o fingerprint staging. Isso não deve ser contornado. O resultado é negativo esperado, seguido de rollback explícito e nova conferência `05`; não é motivo para trocar a guarda original.
3. **`04`, ensaio transacional:** é exatamente o cabeçalho próprio mais `03` com o COMMIT final substituído por ROLLBACK, seguido de `05` em transação readonly nova. Executa os mesmos gates antes da reversão e confere a baseline depois. Não há commit intermediário do delta. Se qualquer comando falhar, a coordenação deve interromper, efetuar rollback e diagnosticar, sem interpretar resultados parciais como aprovação.
4. **`03`, tentativa persistente:** somente depois da rodada anterior validada e da reconferência do alvo/baseline. Mantém uma transação, lock_timeout de 2 segundos e statement_timeout de 30 segundos por comando; repetição após commit deve ser recusada pelo fingerprint. Não é um timeout total de execução.
5. **`06`, pós-delta:** os dois gates originais estão integralmente preservados em uma transação readonly. Acrescenta a verificação de 21 tabelas públicas vazias, Auth/Storage sem usuários/arquivos e bucket privado único, além de emitir privilégios de tabela e execução das funções relevantes. O relatório de privilégios inclui MAINTAIN e grant option; emitir esses dados não equivale a ter exercitado todos os papéis via HTTP.

## Verificação executada nesta revisão

`node --check` passou para o preparador e o verificador. `verificar-delta-staging-artefato.cjs` passou, conferindo os quatro hashes, o original intacto, a troca única de fingerprint, a composição exata do rollback e os gates originais. Houve ainda comparação independente dos metadados de chaves, da sequência de policies, dos 12 hashes de funções e dos arquivos protegidos. O preparador não foi executado e nenhum script de banco foi enviado por esta frente.

Não foram encontrados achados que exijam alterar esse pacote antes do ensaio controlado. Permanecem sem comprovação por esta revisão: sintaxe/execução real no PostgreSQL hospedado, event triggers e permissões administrativas especiais do Supabase, preservação após rollback remoto, acesso com JWT, concorrência, CNPJs com dados, exportação de documentos, restauração e capacidade. A execução deve produzir essas evidências separadamente. Se a plataforma divergir dos gates, interromper e revisar a evidência; não enfraquecer permissões ou controles para obter aprovação.
