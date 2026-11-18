# Documentos e propostas — mapa de integração do runtime

> **Estado final desta etapa:** `RUNTIME-CLOUDFLARE.md` registra o smoke completo aprovado na rodada 04/runtime-03, com 14 verificações e 20 protegidos preservados. O conteúdo abaixo documenta a investigação inicial e suas revisões; a contenção vigente usa auxiliares QA sem passthrough, com ASSETS de recusa literal.

> **Adendo após a implementação/revisão de 31/10:** este mapa é diagnóstico inicial histórico. Já ocorreram três compilações locais isoladas, descritas em `PRE-EXECUCAO-2.md`; nenhum Worker foi executado. A recomendação inicial de usar `outboundService` callback diretamente foi refutada por `revisao-pre-runtime.md`: o interceptor/callback do Miniflare permite TCP passthrough ao serviço padrão internet. A contenção revisada proposta usa auxiliar exclusivo QA com saída TCP deny-all e auditoria da configuração antes de permitir subprocesso. Também foi identificado que `editais_vistos.json` é histórico privado por destinatário; não integra a seleção da rodada 03. Os hashes iniciais dos inputs tinham base incorreta, agora corrigida para `functions/`. Pacotes 01/02 ficam privados e não publicáveis; evidências anteriores preservadas.

31/10/2026 UTC. Investigação de código e ferramentas instaladas. Nenhum build, CLI Wrangler, serviço, Docker, navegador ou chamada privada foi executado por este especialista. A superfície pública de produção é uma auditoria separada.

## Conclusão

A ligação entre UI, rotas e handlers já existe no worktree. A pendência imediata é comprovar o bundle no runtime Cloudflare e preparar a ativação coordenada das migrações, políticas, segredo e chave de habilitação. Não há motivo observado para trocar de hospedagem, modelo ou autenticação, ou parametrizar apenas parte da origem Supabase.

O sucesso da homologação anterior prova PostgreSQL/Auth/REST/Storage reais com handlers Node. Ela não executou o Worker compilado no workerd. Portanto, compilação e smoke do bundle fecham uma lacuna distinta, sem repetir o banco real.

## Mapa de dependências

| Camada | Arquivo e ligação | Requisito de integração |
|---|---|---|
| Cadastro | `operacao.html` carrega `empresa-identificacao-ui.js`, `operacao-identificacao.js` e CSS; o adaptador de UI chama `POST /api/empresa-identificacao`. | Sessão Supabase existente; empresa autorizada; assets incluídos no artefato. |
| Kit | `processos.html` monta `kit-documentos-ui.js` no dossiê e fornece `session.access_token`. A UI chama `POST /api/kit-documentos`. | Mesma sessão, empresa e processo; nenhuma autenticação paralela. |
| Pages Functions | `functions/api/[nome].js` importa estaticamente ambos os handlers e os inclui na allowlist. Usa `_adaptador_cloudflare.js` para Request/Response e bytes DOCX. | Compilar a rota completa, conservar as outras entradas e os headers. |
| Netlify | `netlify.toml` redireciona `/api/*` para `/.netlify/functions/:splat`; handlers CommonJS já seguem esse contrato. | Não adicionar serviço/proxy nem mudar a hospedagem só para o kit. |
| Identificação | `empresa-identificacao.js` e `kit-documentos.js` usam `_empresa_identificacao_contexto.js`. | Auth real, cliente aprovado, RPC `identificacao_empresa_habilitada()` verdadeira, RLS da empresa/identificação/documentos e Storage privado. |
| Persistência | Só `kit-documentos.js` importa `_kit_documentos_persistencia.js`. A gravação usa RPC `gravar_kit_documento` com credencial de serviço; leitura usa token do usuário. | Migração do kit, grant restrito à RPC, segredo de servidor e preservação de CAS/versão. |
| Exportação | `_kit_documentos.js` usa `montarDocx` de `gerar-checklist.js`, `adm-zip` e `node:crypto`. | Verificar DOCX binário depois de passar pelo adaptador real, sem editar o gerador compartilhado com outros fluxos. |
| Leitura do PDF | `empresa-identificacao.js` chama `_empresa_documentos.js`, que usa `pdf-parse/lib/pdf-parse.js`. | Smoke com PDF fictício no Worker; o pacote possui `require` dependente de versão, ainda sem comprovação de bundle/runtime nesta análise. |
| Artefato público | `scripts/montar_publico.js` inclui arquivos servidos da raiz, inclusive os novos JS/CSS; copia `data/` e `_headers`. | O script apaga/recria `publico/`. Não executá-lo sobre a pasta existente só para inspecionar; preparar saída nova e isolada, com manifesto e hashes. |

## Configuração que precisa ser conferida no provedor

1. **Mesma origem Supabase:** `_auth.js`, `supabase-config.js`, `_empresa_identificacao_contexto.js`, `_kit_documentos_persistencia.js` e a RPC de confirmação em `empresa-identificacao.js` apontam para o mesmo projeto atual. Parametrizar somente contexto/persistência criaria a possibilidade de autenticar num projeto e operar em outro. A preparação deve comparar a consistência sem alterar esses arquivos protegidos. Uma migração de projeto é outro escopo.
2. **Habilitação:** os dois handlers recusam POST com 503 enquanto `IDENTIFICACAO_EMPRESA_LOCAL` não for exatamente `1`. Conservar o nome e o comportamento; habilitar futuramente somente depois dos gates e da autorização de implantação. GET retorna 405 antes dessa chave, portanto GET isolado não prova habilitação.
3. **Segredo:** `SUPABASE_SERVICE_ROLE_KEY` é necessário para confirmar a identificação e gravar/revisar peças. Seu valor não deve aparecer em artefatos, cliente, logs ou documentação. A existência/configuração do segredo em produção não pode ser inferida dos arquivos locais nem de uma resposta pública GET.
4. **Banco e Storage:** confirmar a cadeia já existente `operacao_licitacoes`, `operacao_acompanhamento`, itens/valores, `acesso_empresa_convites`, `identificacao_empresa`, `seguranca_operacao`, `kit_documentos`. Aplicação não foi executada e a ordem precisa considerar o estado real anterior. O bucket `operacao-documentos` deve permanecer privado; políticas de organização/empresa e triggers de invalidação são obrigatórios. Executar o gate já revisado com `ON_ERROR_STOP` e executor canônico quando houver autorização e acesso somente leitura apropriado.
5. **Compatibilidade:** `wrangler.toml` usa `2025-09-01` e `nodejs_compat`. A documentação oficial confirma que essa combinação permite `process.env` preenchido por bindings. A rota também copia bindings de texto antes do handler. Não mudar data, flags, env global ou rotas protegidas nesta integração.

Esses são requisitos, não afirmações de que a configuração remota esteja ausente. Sem ler o painel/API autorizado do provedor, migrações instaladas, secrets e plano/limites remotos permanecem não comprovados.

## Ferramentas instaladas e compilação proposta

### Inventário de `data/` para impedir cópia cega

Leitura de nomes/tamanhos com arquivos ocultos incluídos (`-Force`), sem ler o conteúdo dos JSON: seis arquivos, 3.015.216 bytes, nenhum subdiretório ou reparse point observado. Todos os seis estão rastreados no Git. Evidência completa: `inventario-data-completo.json`; o primeiro inventário sem `-Force`, `inventario-data.json`, produziu a mesma lista.

| Arquivo | Bytes |
|---|---:|
| `capag-municipios.json` | 2.026.840 |
| `convenios.json` | 945.107 |
| `sistema_s_am.json` | 29.243 |
| `editais_vistos.json` | 13.450 |
| `mercado_meta.json` | 375 |
| `contratos_meta.json` | 201 |

Não foram encontrados nomes de credenciais, brutos PNCP ou fixtures de homologação nesse inventário. Isso não certifica o conteúdo dos seis arquivos como público. `editais_vistos.json` é referenciado pelo robô como histórico legado; `convenios.json` e `sistema_s_am.json` aparecem como dados migrados para o banco. O painel ainda referencia CAPAG e os dois metadados. Não remover nem regravar esses arquivos ou o robô nesta preparação.

Na cópia isolada, usar lista explícita de arquivos aprovados e hashes, nunca `cp(data/)` automático. Um arquivo futuro, não rastreado, oculto ou fora da lista deve bloquear o pacote até revisão. Mesmo os rastreados requerem classificação antes de publicação; o smoke do kit pode usar fixtures estáticas isoladas sem carregar dados históricos. Não chamar `montarPublico()`, que apaga `publico/`; `arquivosDaRaiz()` é consulta sem efeito e pode alimentar o manifesto após conferência de cada entrada.

Inventário por leitura dos manifests, sem executar processos:

- Cache `C:/Users/harre/AppData/Local/npm-cache/_npx/827da23dfd673aa2/node_modules/`: Wrangler **4.151.1**, esbuild **0.28.2**, Miniflare **5.20261012.1-beta**, workerd **1.20261012.1**.
- Wrangler requer Node >=22. O projeto e a homologação anterior usaram Node 24. Não foi instalada dependência nem alterado pin do projeto.
- Não há Wrangler/esbuild na `.bin` do worktree ou no PATH inspecionado. Usar o executável JS já presente por caminho absoluto; não usar `npx`, que pode resolver/baixar outro pacote.

Proposta de comando, ainda não executado; substituir os dois caminhos de saída por uma pasta **nova**, conferida dentro do diretório QA. Usar `VOLTA_HOME` somente no processo, como instruído pelo usuário:

```powershell
node C:/Users/harre/AppData/Local/npm-cache/_npx/827da23dfd673aa2/node_modules/wrangler/bin/wrangler.js pages functions build C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um/functions --outdir <QA-NOVO>/worker --build-output-directory <QA-NOVO>/static --output-routes-path <QA-NOVO>/routes.json --metafile <QA-NOVO>/metafile.json --compatibility-date 2025-09-01 --compatibility-flags nodejs_compat
```

Os argumentos foram conferidos no código instalado `wrangler-dist/cli.js`, comando `pagesFunctionsBuildCommand`. `--outdir` evita o `--outfile` depreciado. Não combinar `--project-directory` com `--build-metadata-path`: nessa versão, essa dupla ativa `maybeReadPagesConfig`, cujo `pages_build_output_dir` poderia substituir o destino estático isolado pelo `publico/` do projeto. As opções de compatibilidade são passadas explicitamente iguais às originais.

No processo de compilação, `WRANGLER_SEND_METRICS=false` evita telemetria e `WRANGLER_HIDE_BANNER=true` evita o banner que dispara `updateCheck`; `WRANGLER_LOG_PATH` deve apontar para o QA novo e a sanitização deve permanecer ativa. Não chamar `login`, `deploy`, `pages deploy`, `secret put` ou `wrangler dev` remoto. O comando proposto compila, não publica; ainda deve ser executado sob contenção de rede da tarefa, sem credenciais do provedor no subprocesso.

## Smoke isolado proposto

Usar o Miniflare já instalado com a data/flag originais e o bundle compilado. Sua API documentada `outboundService` intercepta o `fetch()`/`connect()` do Worker. O callback deve responder somente fixtures exatas de Auth/REST/Storage e rejeitar qualquer URL/método não previsto; nunca encaminhar ao fetch real. `ASSETS` também deve ser um binding local controlado para testar fallback.

Casos mínimos:

- Importar/inicializar a rota completa sem abrir rotas de resumo/e-mail/robôs e medir tamanho de saída; a compilação não certifica os limites do plano remoto.
- GET dos dois handlers retorna 405 JSON; OPTIONS 204 sem corpo; chave de habilitação ausente retorna 503 sem saída externa; habilitada e sem sessão retorna 401 sem saída externa.
- Fixture Auth válida e cliente aprovado: consulta com empresa/processo próprios; refusas de outro escopo e perfil não pronto.
- Salvar/reabrir/revisar/exportar peça no contrato REST/RPC simulado, garantindo 409 preservado pelo adaptador. Não apresentar essa prova como novo teste de RLS real: o anterior já cobre o banco.
- Exportar DOCX com bytes ZIP, Content-Type/Disposition e conteúdo esperado. Ler PDF fictício pela mesma rota para detectar dependência de parser/bundle.
- Qualquer chamada inesperada falha o teste; relatório conta zero encaminhamentos externos. Encerrar workerd/Miniflare e preservar apenas evidências/artefato local.

## Menor alteração recomendada

Primeiro criar um roteiro QA de compilação/smoke e um runbook de implantação futura, sem mudar produto. Usar os testes existentes de adaptador, kit, persistência e cadastro para regressão. Só corrigir arquivos de produto se o bundle/smoke reproduzir um defeito concreto, com teste antes/depois e revisão independente.

Locais de teste existentes: `netlify/functions/__tests__/adaptador-cloudflare.test.js`, `kit-documentos.test.js`, `empresa-identificacao.test.js`, `empresa-documentos.test.js`; `scripts/kit_documentos*.test.js`, `operacao_identificacao.test.js` e `montar_publico.test.js`. O teste de manifesto atual confere assets JS mas sua expressão de referências não inclui CSS; uma asserção focal dos arquivos novos JS/CSS é preferível a alterar o build global.

Risco compartilhado: o kit reutiliza o gerador DOCX e a rota Pages importa endpoints protegidos estaticamente. Portanto, não refatorar o gerador, `_auth.js`, o adaptador global nem a estratégia de imports por conveniência. Comparar os 20 hashes protegidos antes/depois e as rotas já existentes no artefato. No código lido, downloads de identificação e confirmação não têm timeout explícito; é um risco preexistente, não um defeito de runtime reproduzido nesta investigação.

## Fontes consultadas

- Código local e relatórios da homologação real citados acima.
- [Cloudflare: process.env](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process), via Context7: bindings, datas e persistência por isolate.
- [Cloudflare: compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/), via Context7: preservar data/flags existentes.
- [Workers SDK / Pages Functions](https://github.com/cloudflare/workers-sdk/blob/main/packages/pages-functions/README.md), via Context7. A documentação atual também descreve migração para Workers; isso não foi adotado nem é necessário para este pedido.
- Código do Wrangler 4.151.1 e README do Miniflare instalados no cache acima, usados para confirmar flags e `outboundService` sem executar.

Não foram auditados configurações privadas de Cloudflare/Supabase/Netlify, capacidade/custo remoto, SMTP, cobrança, recuperação de senha, acesso comercial, IA ou coleta PNCP. Nenhum valor de segredo foi lido.
