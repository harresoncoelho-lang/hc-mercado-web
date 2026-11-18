# Preflight dos harnesses — kit persistente e cadastro reais

Estado: inspeção local concluída; execução de banco e serviços ainda não iniciada por este especialista. Aguardar a confirmação do coordenador sobre daemon, stack, backup, migração e tokens. Esta inspeção não aprova a homologação.

## Diagnóstico

O roteiro `docs/qa/homologar-kit-real-local.cjs` é a base mínima adequada. Ele cria fixtures próprias via Auth e PostgreSQL, usa handlers reais por HTTP, exercita PostgREST e Storage reais e remove seus usuários, organizações e arquivo ao terminar. Já cobre duas empresas da mesma organização, uma empresa externa, gestor, operador restrito a um CNPJ, leitor e cliente temporariamente pendente.

Porém, o roteiro só chama o caminho legado `consultar` / `preparar` / `exportar`. Não salva nenhuma linha em `operacao_kit_documentos` nem chama `listar`, `abrir` ou `confirmarRevisao`. A aprovação de 27/10/2026 não comprova o incremento persistente de 30–31/10.

O servidor `docs/qa/servir-identificacao-local.cjs` já atende as duas rotas necessárias e encaminha Auth, REST e Storage ao loopback. O interceptador de `fetch` também alcança a RPC do adaptador de persistência, cuja URL Supabase é fixa. A CSP, o bloqueio das demais APIs e os vendors locais já existem. Não há necessidade demonstrada de mudar produto ou esse servidor para executar o novo percurso.

## Cobertura existente e lacunas

| Critério | Evidência disponível no harness real | Complemento necessário |
|---|---|---|
| Serviços e isolamento | Banco esperado, quatro containers com portas `127.0.0.1`, Auth real e handlers | Coordenador confirmar versões, saúde, backup e aplicação controlada da migração; validar gate SQL em PostgreSQL real |
| A/B na mesma organização | Declarações distintas e DOCX sem nome da outra empresa | Salvar peças separadas, listar por empresa/processo, reabrir após recarga e tentativa cruzada por ID |
| Outra organização, operador restrito, leitor e pendente | Recusas em `consultar`, escrita de item e Storage | Recusas no endpoint persistente e leitura direta da tabela sob cada JWT; leitor pode ter SELECT da tabela no seu escopo, mas o endpoint do kit exige gestor/operador |
| Persistência e versão | Ausentes | `salvar` com `documentoId` UUID e `versaoEsperada: 0`; confirmar versão 1 no REST/SQL; repetição idempotente; edição para versão 2; dados/autoria/escopo preservados |
| Conflito entre abas | Ausente | Duas gravações concorrentes da mesma versão: exatamente uma 200, outra 409; reabrir conteúdo vencedor sem sobrescrita; UI conservar o rascunho perdedor |
| Revisão persistida | Revisão booleana e hash do fluxo legado | Preparar peça salva com ID/versão; confirmar com `revisado: true` e hash; conferir revisão na linha; exportação sem confirmação rejeitada; edição apaga revisão; outro usuário não herda aprovação |
| Hash e fontes | Hash falso, preço, identificação e arquivo substituído invalidam exportação legada | Repetir sobre peças salvas e revisão persistida; `abrir` deve devolver revisão não vigente após alteração de fonte |
| DOCX | Assinatura ZIP, texto Mammoth, empresa correta e total decimal | Exportar declaração e proposta salvas após revisão; registrar ID/versão/hash e verificar ausência da outra empresa no conteúdo |
| Cadastro na UI | Roteiro anterior usa SDK, Auth e tabelas simulados | Abrir `operacao.html` e `processos.html` reais com sessão de fixture real; confirmar identificação, recarregar, abrir atalho e voltar preservando rascunho e exigindo revisão nova |
| Permissões SQL | PGlite cobre RLS, grants, trigger e RPC | Gate somente leitura no PG real; negar INSERT/UPDATE/DELETE diretos e execução da RPC por usuários comuns; leitura entre empresas e organizações com JWT real |
| Limpeza | Remove arquivo, organizações e usuários da execução | Remover primeiro as peças persistidas próprias; conferir ausência dos IDs em todas as tabelas relevantes e preservar a baseline anterior |

## Alterações mínimas propostas

1. Ampliar `docs/qa/homologar-kit-real-local.cjs`, mantendo os casos legados. Reutilizar usuários, organizações, empresas, processos, itens e arquivo já criados. Adicionar os casos persistentes antes da limpeza e registrar as evidências novas em `docs/qa/homologacao-real-20261031/`, preservando o relatório e os DOCX antigos.
2. Criar um único módulo headless `docs/qa/homologacao-real-20261031/verificar-ui-real.cjs`, chamado pelo harness principal enquanto suas fixtures ainda existem. Receber os dados temporários em memória. Reutilizar seletores e assertions de `docs/qa/jornada-cadastro-20261031/t1-navegador.cjs` e `docs/qa/verificar-kit-documentos.cjs`, mas usar o servidor real em `http://127.0.0.1:8792`, o SDK local existente e Auth real. Não importar os servidores simulados, não substituir os retornos de sucesso por mocks e não persistir credenciais ou estado de sessão.
3. Ajustar a limpeza do harness antes de criar peças: o FK do kit para processo e os FKs de autoria para `auth.users` não têm `ON DELETE CASCADE`. Apagar somente os IDs de peças desta execução, conferindo também a organização da fixture. Depois executar a ordem atual de arquivo/organização/usuário. A limpeza deve registrar falhas sem abandonar as demais remoções, e `aprovado` só pode ser verdadeiro após todas as conferências.
4. Não editar `kit_documentos.sql`, `verificar_kit_prepublicacao.sql`, o endpoint, a UI ou a autenticação. Uma falha real deve ser capturada e comunicada ao coordenador antes de ampliar o escopo.

## Percurso HTTP mínimo

- Criar declaração A e declaração B salvas; repetir a criação idêntica de A com o mesmo ID/versão 0 e confirmar uma só linha. Repetição com conteúdo ou autor divergente deve produzir conflito.
- Listar A/B; tentar abrir A no contexto B, por outsider e pelo operador restrito ao outro contexto. Conferir o SELECT direto da tabela com os JWTs de gestor, operador, leitor, outsider, pendente e anon.
- Preparar A por ID/versão; exigir confirmação explícita; rejeitar hash adulterado; confirmar revisão e exportar DOCX. Novo usuário autorizado precisa da própria revisão.
- Reabrir A; editar para versão 2; confirmar apagamento dos campos de revisão. Executar corrida real de dois POSTs com a mesma versão esperada e conferir o conteúdo final.
- Salvar proposta com os itens decimais existentes; revisar e exportar total de R$ 3,71. Alterar preço pelo endpoint REST permitido; rejeitar exportação antiga; nova revisão deve produzir R$ 7,04.
- Confirmar identificação com a proveniência do PDF real já usado. Preparar e confirmar peça salva com essa fonte; substituir o arquivo por Storage como operador; exportação antiga deve falhar com 409 e reabertura não deve declarar revisão vigente.
- Negar escrita direta em `operacao_kit_documentos` por usuários comuns e `service_role`; negar chamada direta da RPC por `authenticated`/`anon`. O backend mantém a única escrita autorizada por RPC.

## Percurso headless mínimo

- Usar Edge headless já instalado, Playwright já disponível e contexto de navegador efêmero. Bloquear e contabilizar qualquer URL fora da origem local; registrar erros JavaScript e downloads fictícios.
- Autenticar no Auth local com o usuário criado nesta execução. O login pode usar a sessão recebida pelo SDK via `auth.setSession`, com tokens apenas em memória; não alterar o código de autenticação do produto.
- Abrir cadastro de B com A persistida na preferência local e confirmar que o parâmetro autorizado B prevalece. Confirmar os dados fictícios, recarregar e provar persistência.
- Abrir o processo A, escrever rascunho, usar o atalho de cadastro em nova aba, conferir `window.opener === null` e retornar ao processo autorizado. O rascunho original permanece; a aprovação cadastral não aprova a peça.
- Salvar declaração e proposta, recarregar, listar/reabrir, preparar prévia integral, confirmar e baixar DOCX. Abrir B não pode mostrar peças A; retornar a A exige nova revisão na UI.
- Abrir a mesma peça em duas páginas, salvar a primeira, tentar salvar a segunda e conferir 409 com rascunho preservado. Reabrir recupera a versão persistida vencedora.
- Validar ao menos desktop e 375 px com captura sem tokens. Reusar os cenários anteriores de clique/meio/menu apenas quando necessários para o comportamento novo; não repetir toda a suíte simulada sem motivo.

## Comandos e condições

Os comandos abaixo são o roteiro depois da confirmação do coordenador. Não foram executados neste preflight.

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node docs/qa/servir-identificacao-local.cjs
```

Em outro processo, após servidor e tokens locais válidos:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node docs/qa/revisar-identificacao-real-local.cjs
node docs/qa/homologar-kit-real-local.cjs
```

O coordenador deve aplicar a migração com `supabase_admin` e `ON_ERROR_STOP=1`, após backup. Para o gate somente leitura, uma execução via `docker exec -i` deve fornecer ao `psql` a sequência `BEGIN READ ONLY;`, conteúdo integral de `supabase/verificar_kit_prepublicacao.sql` e `ROLLBACK;`, também com `-X -v ON_ERROR_STOP=1`. Exigir exit 0 do processo inteiro e o marcador `KIT_PREPUBLICACAO_OK`; o marcador isolado não basta. Usar banco `licitaplena_qa_ui_v2` e container `licitaplena-qa-real-db-1`, se confirmados pelo preflight do coordenador.

## Verificado nesta inspeção

- Leitura dos arquivos solicitados e dos adaptadores/harnesses relacionados; nenhum arquivo privado de credenciais, `.env` ou contas foi aberto.
- `node --check docs/qa/homologar-kit-real-local.cjs`: exit 0.
- `node --check docs/qa/servir-identificacao-local.cjs`: exit 0.
- `node --check docs/qa/jornada-cadastro-20261031/t1-navegador.cjs`: exit 0.
- `mammoth`, `adm-zip` e o caminho do Playwright usado pelos harnesses estão presentes. Não foi feita instalação.
- O worktree não tem `graphify-out/graph.json`; não foi criado grafo para esta inspeção delimitada.
- O status Git já mostrava o servidor modificado e o harness/migração/gate não rastreados. Essas alterações existentes foram preservadas.

## Limites e risco remanescente

Nenhum contato com Docker, banco, HTTP, navegador, produção, SMTP, PNCP, CNPJ Próprio ou serviço externo ocorreu nesta inspeção. Tokens, migração, grants reais, disponibilidade do SDK/vendor e login permanecem sem validação de runtime. O gate SQL verifica configuração catalogada; não certifica corpos das funções ou helpers transitivos. A inspeção real de Auth/PostgREST/Storage e os novos testes de persistência continuam obrigatórios.
