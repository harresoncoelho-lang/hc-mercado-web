# Capacidade Cloudflare: evidência atual e medição local concluída

31/10/2026, com fechamento da evidência em 01/11/2026. A inspeção inicial foi seguida por uma execução local serial do harness revisado, concluída antes da pausa. A retomada somente leu e conciliou os arquivos existentes; não repetiu runtime nem carga. Fontes públicas reconferidas via Context7 e navegador de pesquisa em 01/11. Nenhum upload/deploy, migração, pedido à produção, SMTP ou PNCP foi executado nesta frente. Produto, CI, plano, credenciais e configuração remota permanecem intactos.

## Conclusão atual

**O tamanho do pacote não é um bloqueio comprovado no plano Free atual. Os sete perfis locais concluídos sinalizam risco de CPU; a capacidade remota do novo módulo continua sem aprovação.** A documentação de limites, atualizada em 29/10/2026 e reconferida em 01/11, informa 64 MiB sem compressão e nenhum limite comprimido. A antiga comparação com 3 MiB gzip não deve ser usada para afirmar inviabilidade. O bundle completo final possui 7,724646 MiB sem compressão, reconferidos por leitura local. A decisão sobre minificação não é urgente por tamanho; ela não resolve por si só o custo de parsing ou exportação.

| Recurso | Limite público atual Free | Situação/prova disponível |
|---|---:|---|
| CPU por HTTP | 10 ms | Sete perfis locais com 11,021–70,558 ms ativos amostrados; não equivalem à CPU remota. |
| Inicialização global | 1 s | Smoke carregou localmente; tempo de CPU de startup remoto não medido. |
| Requisições | 100.000/dia, reinício 00:00 UTC | Limite de conta; não converter em número de clientes sem consumo medido. |
| Script | 64 MiB sem compressão | Bundle 8.099.878 bytes; gzip 2.798.537 é informação auxiliar. |
| Memória | 128 MB | Funcionamento local não comprova pico remoto dentro da cota. |
| Subrequests | 50 por invocação | De seis a dez chamadas de fixture por ação perfilada; não é contagem da plataforma remota. |
| Conexões de saída simultâneas | 6 | Sem teste de concorrência ou carga real nesta etapa. |

CPU contabiliza execução, excluindo espera de rede; wall time inclui espera. A tolerância eventual descrita pela plataforma não deve ser tratada como capacidade reservada. [Limites oficiais Workers](https://developers.cloudflare.com/workers/platform/limits/).

Pages Free: 500 builds/mês, um build simultâneo, timeout de 20 minutos, 20.000 arquivos e 25 MiB por arquivo. O pacote contém 44 estáticos somando 4.641.806 bytes; maior arquivo é `data/capag-municipios.json`, 2.026.840 bytes. [Limites Pages](https://developers.cloudflare.com/pages/platform/limits/).

Requisições que invocam Pages Functions usam a franquia Workers. Estáticos que não invocam Functions são gratuitos e ilimitados. O artefato tem `include: ["/api/*"]`, `exclude: []` em `routes.json`; a configuração final de publicação deve preservar essa seleção. [Preço Functions](https://developers.cloudflare.com/pages/functions/pricing/).

## Produção observada pela coordenação, não pelo QA

A coordenação leu a conta correta no navegador interno: Workers Free, build `npm run build:cloudflare`, saída `publico`, publicação automática da branch `main`, data `2025-09-01` e `nodejs_compat`. Isso explica por que preparar arquivos ou comandos não autoriza fazer push.

Últimas 24 horas mostradas na UI: 12 sucessos, zero erros, oito subrequests. Os valores transcritos de CPU foram `973`, `1,896`, `7,599`, `7,599` nos quantis 50/75/99/99,9; a escala visual foi identificada como `ms`. Duração mostrou `.002`/`.002`/`.094` nos quantis 50/75/99. **A unidade e a formatação desses números não estão conciliadas. Não dividi por mil nem os usei para aprovar o limite de CPU.** Além disso, a amostra pequena é do código antigo e não contém o módulo novo.

A documentação explica quantis e amostragem, mas não resolve a unidade exata da tela observada. É necessária uma evidência com unidade explícita na própria série ou exportação oficial antes de qualquer conclusão numérica. [Métricas Functions](https://developers.cloudflare.com/pages/functions/metrics/), [métricas Workers](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).

## Baseline local reutilizada

- Artefato: `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-04-leitor-pdf/worker/index.js`.
- SHA-256 reconferido: `dab78768da8bab84401ed92051cd8dc462e2838df97f3263f9e098a444ba925d`.
- Relato completo: `../integracoes-producao-20261031/RUNTIME-CLOUDFLARE.md`.
- Smoke anterior: 14 verificações, PDF empresarial real dentro do bundle, duas peças DOCX, 239 chamadas a fixtures e zero saída desconhecida. Auth/REST/Storage simulados; não prova SQL/RLS remoto.
- Os 20 arquivos protegidos preservaram hashes. A suíte já concluída pela coordenação teve 843 testes, 839 aprovados, quatro skips, zero falhas. Não foi repetida aqui.

Ferramentas reconferidas por manifests, sem iniciar CLIs: Wrangler 4.151.1, Miniflare 5.20261012.1-beta, workerd 1.20261012.1, esbuild 0.28.2. Cache: `C:/Users/harre/AppData/Local/npm-cache/_npx/827da23dfd673aa2/node_modules`. Não foi instalada ou atualizada dependência.

## Perfil local revisado e executado em 31/10

Arquivo `perf-worker.cjs`, SHA-256 `5c96959284c1d6f5b9d7853c72b22b3a7bd28468e6da00b01f5724b13eb3e147`. Teste `perf-worker.test.cjs`, SHA-256 `0d7816c56b48bc3b26c4ee567115f941964eb91660a0f6cac747e5a583f8f989`. São as identidades aprovadas em [REVISAO-CAPACIDADE.md](REVISAO-CAPACIDADE.md), reconferidas em 01/11. `node --check` e self-check do agregador/URL/CLI estrita passaram na revisão, sem iniciar Miniflare ou subprocessos. Não foram repetidos na retomada, pois os arquivos permanecem idênticos.

O script exige o hash do harness já aprovado `09ec248f77fb2040b46c961ba7ed1a63ffcbc7ba312dcf4842279fcada9c12b3`. Reutiliza suas opções de Worker, fixtures, isolamento host, auditoria pré-spawn e encerramento de filhos; não copia nem altera handlers. A única adição ao runtime é inspector local em porta efêmera. Antes de cada spawn confirma código integral do produto (aceitando apenas o comentário sourceURL exato adicionado pelo Miniflare), data/flags e os caminhos de saída contidos. ASSETS continua uma recusa literal, não uma rota para internet.

Sequência limitada, serial, com fixture fictícia de um PDF curto:

1. Consulta de identidade por CNPJ.
2. Primeira leitura do PDF e duas repetições; todas precisam retornar sugestões e quatro evidências. Fallback manual reprova.
3. Confirmação de identidade e salvamento da proposta na fixture, sem perfil desses preparativos.
4. Prévia de proposta com total R$ 3,71 e exclusão do item não selecionado.
5. Revisão explícita; duas exportações com validação ZIP/XML.

Cada medição arquiva `.cpuprofile`, wall time, deltas amostrados, GC, ociosidade e chamadas de fixture. O intervalo pedido ao profiler é 1.000 microssegundos. Perfil sem amostras retorna `ativoAmostradoMs: null`, não uma falsa medição de zero. A soma dos deltas excluindo `(idle)` segue a abordagem do Wrangler instalado; permanece estimativa com overhead do inspector, dependente do computador e do agendamento do SO. [Schema oficial CDP Profiler](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json).

O PDF curto não representa o pior caso de 2 MiB/oito páginas, PDFs com fontes/imagens complexas nem grandes propostas. Sete perfis não geram p95/p99 confiáveis. Os valores locais observados são um sinal de risco; valores baixos também não certificariam a cota Free. Não haverá teste de carga enquanto o usuário utiliza a máquina.

O [inventário sanitizado da cópia de Storage](backup-storage-inventario-20261101.json) informa dois PDFs de 80.003 e 7.596.002 bytes, sem leitura de conteúdo. O segundo excede 2 MiB; nenhum deles foi usado neste perfil. A presença no Storage não torna o documento candidato à extração empresarial, nem o tamanho menor comprova número de páginas ou compatibilidade. Recusa ou preenchimento manual por limite preserva o comportamento pretendido. O requisito de sugestões acima vale para a fixture curta válida; não exige extrair documentos fora dos limites. Esta tarefa não aumentou limites nem alterou o leitor.

A inspeção histórica `perf-inspecao-01 --inspecionar` encerrou antes do spawn com `CONFIGURACAO_INSPECIONADA_SEM_WORKERD` e zero filhos. Após a revisão, a coordenação executou `perf-runtime-01` no worktree, com `VOLTA_HOME` local correto. As duas rodadas criaram pastas inéditas dentro de `rodada-04-leitor-pdf`. Não reutilizar os nomes nem sobrescrever evidências. A execução concluída não deve ser repetida nesta retomada.

## Adendo de 01/11: resultado final e estado do ambiente

A execução terminou em `2026-10-31T14:34:28.751Z` (11:34:28 em São Paulo). `resultado.json` contém `erro: null`, sete medidas e 85 chamadas às fixtures: 57 nas ações perfiladas e 28 nos preparativos. As sete validações funcionais passaram, incluindo sugestões com quatro evidências/hash do PDF, prévia com R$ 3,71 sem o item não selecionado e duas exportações com validação ZIP/XML. As 85 chamadas são de serviços simulados no fluxo completo; não representam 85 subrequests de uma única invocação.

| Ação | Wall time (ms) | Ativo amostrado local (ms) | Amostras | Chamadas de fixture |
|---|---:|---:|---:|---:|
| Consulta | 42,093 | 19,926 | 4 | 6 |
| Primeira extração PDF | 72,723 | 70,558 | 45 | 7 |
| Segunda extração PDF | 13,415 | 11,875 | 4 | 7 |
| Terceira extração PDF | 11,815 | 11,021 | 5 | 7 |
| Prévia de proposta | 14,054 | 12,478 | 4 | 10 |
| Primeira exportação DOCX | 26,657 | 13,603 | 12 | 10 |
| Segunda exportação DOCX | 12,909 | 12,555 | 4 | 10 |

Valores arredondados a três casas; os JSON preservam os valores originais. A primeira extração registrou 1,619 ms amostrados em GC; as demais, zero amostras de GC. Isso não prova ausência de coleta fora das amostras. Há apenas quatro a 45 amostras por perfil, com overhead do inspector e interferência do agendamento do computador. A janela do profiler inclui mais tempo que a chamada medida — na consulta, 211,898 ms de janela para 42,093 ms de wall time da chamada. Portanto a coluna ativa não é uma cronometragem isolada do handler, CPU faturada ou medição remota. Todos os valores ativos estimados ficaram acima de 10 ms: isso justifica manter o gate de CPU aberto, sem declarar que todas as requisições remotas excederão a cota. [Definição e limite oficial de CPU](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

`prontidao.json` registra **652,681 ms de wall time para `mf.ready`**. Inclui processos, sockets e auxiliares; a coleta dos perfis começou depois. Esse número não comprova o limite de 1 s de CPU de inicialização do Worker.

A evidência de encerramento está completa: `perf-runtime-01-exec.json` contém exit 0; stdout confirma sete medidas e filhos encerrados; stderr está vazio. O único filho `workerd.exe`, PID 36624, foi registrado encerrado com `signal: SIGKILL` e `exitCode: null`; esse estado do filho não é o exit 0 do processo principal. As consultas reais de processos antes e depois retornaram `[]`. Não há destinos negados nem bloqueios do host. Os 20 arquivos protegidos e o bundle conservaram os hashes; a retomada reconferiu os hashes atuais dos 20 arquivos e as identidades do harness, teste e bundle.

A coordenação também informou zero `workerd` ao retomar em 01/11. Esta conferência não iniciou workerd, inspector, Docker, navegador ou aplicativo nativo, nem instalou ferramentas. O estado remoto continua sendo a observação administrativa de 31/10 acima; esta retomada não reinspecionou a conta nem validou isolamento do preview. Não houve alteração de plano/billing, autenticação, modelos, produto, pipeline, resumo, e-mail ou robô.

Fontes locais preservadas em `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-04-leitor-pdf/`:

- `perf-runtime-01/`: `inicio.json`, `resultado.json`, `prontidao.json`, `config.json.auditoria.json`, sete `.cpuprofile` e respectivos JSON.
- Ao lado da pasta: `perf-runtime-01-exec.json`, `perf-runtime-01.stdout.log`, `perf-runtime-01.stderr.log`, `perf-runtime-01-processos-antes.json` e `perf-runtime-01-processos-depois.json`.
- SHA-256 de `resultado.json`: `e7075d42460fab4c49ef3a6cae17b8262d70dd47b3ce362b77fc371881a078d3`; de `perf-runtime-01-exec.json`: `a93dd1b209e007c0c8f0f956d2e2c102aff6efb770d414cd798aab98704ca5d6`.

A conferência offline de 01/11 recalculou os deltas dos sete `.cpuprofile`, conciliou cada JSON individual com o resultado agregado e verificou hashes, exit, stdout/stderr e capturas de processos. Todos passaram, sem executar o produto. Não houve nova carga, coleta de memória ou teste de concorrência.

## Startup: ferramenta disponível e limite do que podemos afirmar

O comando oficial `wrangler check startup` gera perfil local, não uma medição do hardware Cloudflare. O Wrangler instalado implementa análise com import dinâmico, inspector e Miniflare em `wrangler-dist/cli.js` por volta de 173988–174110. Essa implementação não reutiliza a contenção outbound aprovada neste projeto. Por isso **não executaremos esse comando diretamente**, nem `deploy --dry-run` como atalho não revisado. [Documentação check startup](https://developers.cloudflare.com/workers/wrangler/commands/workers/#startup).

O QA concluído mediu requisições após `mf.ready`; registrou a duração da prontidão apenas como wall time de toda a inicialização local, incluindo processos, sockets e auxiliares. Não renomeia essa duração como startup de CPU. Nenhum wrapper foi introduzido. A prova de `startup_time_ms` remoto e de limites por execução fica para uma futura validação em ambiente isolado explicitamente autorizada; exige upload de uma versão e não cabe nesta etapa sem publicação.

## Minificação: preparação concreta, sem mudar pipeline

Estado atual: `package.json` executa apenas `node scripts/montar_publico.js`. Esse builder seleciona estáticos e não compila Functions. O CLI instalado oferece `pages functions build --minify` (padrão local false). Não encontramos prova de que o CI gerenciado aplique o mesmo `--minify`. O limite de tamanho atual permite manter managed Functions enquanto essa decisão é fechada; não há necessidade de migrar o produto só para caber numa antiga cota gzip.

Caso seja necessário publicar exatamente o bundle minificado homologado, o caminho mínimo a revisar é **empacotar a saída completa já gerada**, preservando o router e todos os handlers. Nenhum handler deve ser eliminado para reduzir tamanho.

```text
<pasta_nova_do_artefato>/
  [44 estáticos aprovados, mesma estrutura]
  _worker.js       <- cópia byte a byte de worker/index.js
  _routes.json     <- cópia de routes.json, include /api/*
```

Advanced mode usa `_worker.js` na saída e ignora `/functions`; é uma mudança de mecanismo de publicação, portanto precisa revisão de roteamento, assets e rollback. O Worker gerado já contém o router e fallback ASSETS; preservá-lo integralmente evita criar outro dispatcher. [Advanced mode oficial](https://developers.cloudflare.com/pages/functions/advanced-mode/).

Contrato do preparador futuro, sem execução nesta etapa:

1. Pasta nova, fora de `publico/`, sem remoção recursiva. Reutilizar `arquivosDaRaiz()` e `arquivosDeDados()`. Falhar se aparecer arquivo extra, credencial, bruto PNCP ou evidência privada. `data/editais_vistos.json` jamais entra no artefato.
2. Compilar todas as Functions com a CLI fixada/revisada; mesmo lockfile, data e flag. Comando já provado localmente: `pages functions build <repo>/functions --outdir <nova>/worker --build-output-directory <nova>/static --output-routes-path <nova>/routes.json --metafile <nova>/metafile.json --compatibility-date 2025-09-01 --compatibility-flags nodejs_compat --minify`.
3. Validar hashes, inventário, brutos/tamanhos dos inputs, ausência de segredos, módulos auxiliares e mapa de rotas. O pacote final atual tem um único JS; se a saída futura trouxer módulos adicionais, falhar e revisar, não copiá-los de maneira incompleta.
4. Copiar `index.js` como `_worker.js` e `routes.json` como `_routes.json` sem transformação. Manter manifestos/metafile/logs fora da pasta publicável.
5. Homologar rotas das duas funções e estáticos numa fixture de ASSETS dedicada, sem rede; o smoke atual usa ASSETS-negado e **não prova o atendimento de arquivos públicos nem a semântica completa do advanced mode**. Confirmar headers/redirects e a exclusão da história privada sem invocar resumo/e-mail/robô.
6. Só depois revisar uma alteração mínima do comando de CI e fixação da CLI no ambiente de build. Nenhuma mudança em package.json, lockfile, branch, flags, GitHub ou Cloudflare foi aplicada agora. O caminho absoluto do cache desta máquina não é configuração portável de CI.

A publicação futura precisa apontar à mesma saída validada. Fazer uma compilação minificada paralela e deixar o Pages recompilar `/functions` separadamente não garante que o runtime servido seja o testado. Rollback deve conservar o deployment anterior e o estado original da configuração, sem desativar autenticação ou gates.

## Critérios para avançar

| Estado | Critério |
|---|---|
| Comprovado localmente | Bundle abaixo do tamanho atual, inventário público, funcionamento das duas rotas com fixtures, proteção dos 20 arquivos. |
| Concluído localmente | Sete perfis de PDF/proposta com validação funcional, 85 chamadas de fixture, encerramento auditado e conciliação offline em 01/11. |
| Pendente | CPU/pico de memória/startup em ambiente remoto representativo; comprovação do isolamento do preview; conciliação das unidades da métrica atual; decisão managed Functions/artefato explícito; homologação de ASSETS se adotar advanced mode. |
| Fora deste diagnóstico | Aplicar SQL, backup real, alterar plano, limites ou billing. Essas ações pertencem às outras frentes e não foram inferidas a partir de baixo tráfego. |

O próximo gate mínimo de capacidade é uma validação serial remota, somente quando existir destino isolado comprovado e autorização específica para upload/execução. Antes dela, definir o artefato exato e confirmar separação de bindings, dados e credenciais de produção. O ensaio deve registrar CPU por invocação com unidade explícita, resultado/erro e inicialização da versão; distinguir primeira execução e repetições; e cobrir documentos dentro dos limites de tamanho/páginas antes de ampliar o conjunto. A leitura de metadados do ambiente e a preparação desse gate não autorizam habilitar serviços, mudar plano ou executar o teste. Nenhuma dessas ações foi realizada neste adendo.

Sem carga representativa não há número honesto de clientes simultâneos suportados. O gate serial também não certificará concorrência ou p95/p99. Se a leitura/exportação exceder consistentemente o orçamento numa validação futura, registrar a ação e seu custo antes de propor Workers Paid ou processamento separado. Não ativar plano nem mudar arquitetura automaticamente para fazer o teste passar.
