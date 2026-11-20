# Documentos e propostas por CNPJ — homologação autenticada

Data: 31/10/2026 UTC (30/10 no horário de Brasília). Ambiente exclusivamente local, com dados fictícios.

## Resultado verificado

A rodada-02 concluiu com `aprovado: true`, 13 grupos de cenários, nenhum erro de execução ou limpeza e baseline preservada. Quatro desses grupos exercitaram a interface com SDK e autenticação reais, sem erros JavaScript ou requisições externas. A revisão independente final aprovou os cenários locais, sem achados abertos; os serviços de teste foram encerrados.

Foram usados PostgreSQL 17, GoTrue, PostgREST 16 e Supabase Storage instalados anteriormente. Os serviços ficaram em `127.0.0.1`, com navegador headless isolado. O servidor de QA executou os handlers locais e direcionou exclusivamente as chamadas Supabase para esses serviços reais; persistência, autorização e respostas de sucesso não foram simuladas.

| Percurso | Prova observada |
|---|---|
| Autenticação e autorização | Tokens emitidos pelo GoTrue; bloqueios para anônimo, conta pendente, leitor, outra organização e combinação indevida de empresa/processo. RLS, RPC e escrita direta também exercitadas. |
| Cadastro por CNPJ | Empresa indicada na URL prevalece sobre preferência anterior; confirmação persiste após recarga; acesso e retorno ao processo conservam o rascunho. |
| Peças persistidas | Salvar, listar e reabrir após novo login; troca A→B→A sem mistura; repetição idempotente; edição gera versão nova. |
| Edição concorrente | Duas gravações concorrentes produzem um sucesso e um conflito 409; interface conserva o rascunho e exige reabrir explicitamente a versão vencedora. |
| Revisão antes da exportação | Prévia integral e confirmação explícita; revisão vinculada a usuário, versão e conteúdo. Editar dados ou abrir cadastro invalida a autorização anterior de exportar. |
| Origem documental | Arquivo privado real no Storage; leitor não sobrescreve. Alterar a fonte bloqueia a exportação. Restaurar os bytes mantém a pendência até reconfirmação explícita pelo endpoint real. |
| Declarações e propostas | Oito DOCX gerados por API/interface, com CNPJ correto, conteúdo integral e itens selecionados. Item válido disponível mas não selecionado permanece ausente do arquivo. Totais decimais de R$ 3,71 e R$ 7,04 conferidos. |
| Interface | Cadastro e kit exercitados em 375 e 1280 px, com capturas locais. Sem uso do perfil do navegador do usuário ou controle do desktop. |

## Correção necessária no banco de teste

O ambiente Supabase real revelou permissões diretas herdadas dos defaults que a fixture anterior não reproduzia. A migração `supabase/kit_documentos.sql` foi corrigida para normalizar somente a tabela do kit, sua RPC de gravação e a função do trigger. Donos, dados preexistentes, papéis, associações e defaults globais foram preservados. Os poderes administrativos de papéis privilegiados não são removidos por essa correção.

A correção recebeu revisão independente, passou em 195 verificações SQL/PGlite e foi aplicada duas vezes no banco de teste. O gate intacto, executado com `ON_ERROR_STOP`, transação somente leitura e `search_path` local canônico, retornou `KIT_PREPUBLICACAO_OK`. A reaplicação preservou os dados e comprovou idempotência neste ambiente.

## Verificação e preservação

- `npm run verify`: exit 0; 820 testes, 816 aprovados, quatro skips preexistentes; lint sem erros, com 58 avisos preexistentes. O SQL/PGlite é separado desse total.
- SQL/PGlite: 195 verificações, incluindo 62 configurações indevidas rejeitadas e revertidas na fixture. Testes de propagação de erro e recuperação do harness também passaram offline.
- Rodada real final: 13 grupos, oito DOCX, quatro grupos de interface; nenhum erro JavaScript, destino externo ou erro de limpeza.
- Protegidos: 20/20 hashes iguais à baseline, incluindo resumo, e-mail, robô de boletins e arquivos de autenticação.
- Limpeza da rodada-02: todos os dados fictícios próprios removidos; contagens e hashes das 33 tabelas do recorte de runtime iguais antes/depois. O recorte inclui tabelas regulares de `public`, `auth.users`, `storage.objects` e `storage.buckets`. Logs de auditoria fictícios do Auth podem permanecer; não foram apagados registros de auditoria preexistentes.
- Na preparação do ambiente, uma comparação distinta conferiu 39 tabelas preexistentes e, após a correção, também a tabela vazia do kit. O runtime exclui oito tabelas internas do Storage (`buckets_analytics`, `buckets_vectors`, `iceberg_namespaces`, `iceberg_tables`, `migrations`, `s3_multipart_uploads`, `s3_multipart_uploads_parts`, `vector_indexes`) e inclui `auth.users` e a tabela nova do kit: 39 − 8 + 2 = 33. Esses recortes não devem ser somados nem tratados como a mesma prova.
- Dois backups custom privados foram preservados. Cabeçalho, SHA-256 e índice foram conferidos; restauração completa não foi ensaiada.

## Interrupção preservada para auditoria

A rodada-01 foi interrompida por uma falha do harness: ele tentou preparar um documento cuja identificação permanecia corretamente invalidada após alteração do arquivo de origem. Uma promessa de espera rejeitou antes de receber tratamento e impediu a limpeza normal.

O produto manteve sua proteção. O harness passou a provar o bloqueio, reconfirmar a fixture pelo endpoint real, tratar imediatamente ambas as promessas e registrar UUIDs próprios em diário sem credenciais. A recuperação dirigida da rodada-01 passou por revisão e correção de retomada antes de executar. Os IDs próprios foram removidos e a baseline completa preservada. Seus logs, falha e artefatos continuam em `rodada-01`; a rodada-02 usa evidências novas.

O início do Docker chegou a abrir uma janela inesperada; ela foi encerrada e o incidente comunicado. Os testes foram executados depois com somente o backend instalado, sem frontend. Não foram instaladas dependências, baixadas imagens ou alteradas preferências, permissões de rede, cliente, modelo ou autenticação do usuário.

## Evidências principais

- `rodada-02/homologacao-kit-real-local.json`, `harness.stdout.log` e `harness.stderr.log`: resultado do percurso completo.
- `rodada-02/ui-real.json`, `kit-real-1280.png`, `kit-real-375.png` e `ui-conflito-real.png`: interface e rede observadas.
- `rodada-02/baseline-dados.json`, `final-dados.json` e `fixtures.jsonl`: integridade e propriedade dos dados fictícios.
- `ambiente.md`, `correcao-acl-evidencia.json` e `kit-prepublicacao.log`: migração, backups, permissões e gate real.
- `acl-green.log`, `verify-final.log`, `fontes-final.json` e `protegidos-final.json`: testes e integridade das fontes.
- `rodada-01/DIAGNOSTICO.md` e relatórios de recuperação: falha anterior e limpeza comprovada.
- `.superpowers/sdd/2026-10-31-homologacao-autenticada/`: plano de continuidade e pareceres independentes; pasta local ignorada pelo Git.

## Limites e próxima etapa

Este resultado aprova os cenários observados do módulo no ambiente local reconstruído. Não certifica a configuração remota, capacidade de produção ou o SaaS inteiro. As credenciais, políticas, adapters com URL fixa e compatibilidade do runtime de Functions ainda precisam ser conferidos no ambiente de implantação autorizado.

Auth foi exercitado por emissão de tokens e uso do SDK; não houve ensaio de cadastro comercial, recuperação de senha ou entrega SMTP. Os DOCX foram verificados pela estrutura e pelo texto extraído, não pela renderização no Word. Não foram acionados IA externa, PNCP, CNPJ Proprio, resumo, e-mail ou robô de boletins em produção.

Planos, cobrança, timbrado/modelos adicionais, operação comercial e ensaio de restauração continuam no mapa de prontidão do produto. Nada foi publicado ou liberado para produção por esta homologação.

## Fechamento

**Etapa concluída e aprovada para o escopo local verificado.** Parecer: `.superpowers/sdd/2026-10-31-homologacao-autenticada/final-review.md`. A revisão conferiu os hashes aprovados, 22 artefatos da rodada, baseline 33/33 e protegidos 20/20.

O servidor HTTP próprio foi encerrado depois dos testes. Os quatro containers terminaram com exit 0; os volumes permaneceram. Sem outros containers ativos, o backend Docker iniciado pela coordenação foi encerrado com exit 0. A conferência final encontrou zero processos QA/backend e zero listeners nas cinco portas utilizadas. O exit 1 da sessão do servidor corresponde à parada explícita pela coordenação após a execução aprovada, não a uma falha da homologação.

`encerramento.json` registra a conferência e os hashes novamente verificados dos dois backups. Não houve publicação, importação em produção ou ativação de integrações externas.
