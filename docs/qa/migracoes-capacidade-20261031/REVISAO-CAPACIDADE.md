# Revisão independente do harness de capacidade

31/10/2026. Revisão de segurança e operação dos arquivos novos `perf-worker.cjs` e `perf-worker.test.cjs`, considerados integralmente como diff. O escopo desta revisão é o harness local; não inclui os arquivos SQL desta pasta.

**Parecer: sem bloqueador técnico restante para uma execução serial dos sete perfis previstos, exclusivamente nas rotas `empresa-identificacao` e `kit-documentos`, com as fixtures e o bundle congelados.** A execução fica sob coordenação da tarefa principal. Esta revisão não executou workerd, não mediu CPU e não autoriza publicação ou acesso à produção.

## Identidade revisada

| Artefato | SHA-256 conferido após a inspeção |
|---|---|
| `perf-worker.cjs` | `5c96959284c1d6f5b9d7853c72b22b3a7bd28468e6da00b01f5724b13eb3e147` |
| `perf-worker.test.cjs` | `0d7816c56b48bc3b26c4ee567115f941964eb91660a0f6cac747e5a583f8f989` |
| Harness reutilizado `../integracoes-producao-20261031/testar-worker.cjs` | `09ec248f77fb2040b46c961ba7ed1a63ffcbc7ba312dcf4842279fcada9c12b3` |
| Bundle `rodada-04-leitor-pdf/worker/index.js` | `dab78768da8bab84401ed92051cd8dc462e2838df97f3263f9e098a444ba925d` |

O hash do harness é exigido antes de importá-lo; o bundle é conferido antes da configuração e novamente ao encerrar. Antes de cada spawn, o código serializado do produto deve ser integralmente igual ao bundle, aceitando apenas o comentário `sourceURL` exato do Miniflare. Nenhum handler, flag de compatibilidade, dependência instalada ou arquivo protegido foi alterado nesta revisão.

## Achado corrigido

**P1 — CLI permitia iniciar runtime após erro de digitação na flag de inspeção.** A versão inicial comparava apenas `process.argv[3] === '--inspecionar'`; uma flag desconhecida era interpretada como execução normal. A versão revisada valida quantidade de argumentos, nome da execução e a única flag permitida antes de chamar `executar()`. Ausência, caminho relativo, flag desconhecida, erro de digitação, argumentos extras e flag duplicada têm testes negativos. O bloqueador foi encerrado na identidade acima.

`node --check` e `node docs/qa/migracoes-capacidade-20261031/perf-worker.test.cjs` passaram nesta revisão, sem Miniflare nem subprocessos nos self-checks. Os testes também cobrem agregação de deltas, ausência de amostras, amostra desconhecida, deltas incompletos/negativos e URL externa ou sem porta explícita.

## Inspeção pré-spawn executada

Foi executado somente:

```powershell
$env:VOLTA_HOME='C:/Users/harre/AppData/Local/Volta'
node docs/qa/migracoes-capacidade-20261031/perf-worker.cjs perf-inspecao-01 --inspecionar
```

Evidência nova, sem sobrescrever rodadas anteriores:

`C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-04-leitor-pdf/perf-inspecao-01/`

O arquivo `comando-revisao.json` preserva comando, saída, código de saída e consultas reais dos processos antes/depois. Resultado às `2026-10-31T14:33:08.129Z`: exit 1 intencional, mensagem `CONFIGURACAO_INSPECIONADA_SEM_WORKERD`, `filhos: []`, `medidas: []`, zero chamadas de fixture, zero destinos negados e zero bloqueios de host. Ambas as consultas de `workerd.exe` retornaram lista vazia. Os 20 hashes protegidos foram reconferidos separadamente após a inspeção.

A segurança da inspeção foi conferida no código, antes de executá-la: `serializeConfig()` grava o JSON antes de `Runtime.updateConfig()` chamar `child_process.spawn`; o guard chama a auditoria e a interrupção antes de `originalSpawn`. O stack preservado em `resultado.json` confirma essa interrupção. A inspeção verifica a configuração efetiva gerada pelo Miniflare; não é execução das APIs.

## Rede e preservação do produto

Conferência independente de `config.json`, além de `config.json.auditoria.json`:

- O produto conserva `nodejs_compat`, a data revisada e o bundle integral. Sua saída segue `outbound:0` até `core:user:fixture-router`.
- O auxiliar de fixtures tem flags vazias e somente o binding `FIXTURES`. O código literal recusa HTTP `CONNECT` e encaminha os demais pedidos ao callback fechado de fixtures. TCP bruto para nesse auxiliar sem `connect_pass_through`; a saída própria também retorna à mesma barreira.
- `ASSETS` aponta a `core:user:assets-deny`, com flags e bindings vazios. O código literal apenas retorna HTTP 599, sem acesso às fixtures. A saída própria retorna à mesma barreira.
- O serviço interno `internet` continua presente no runtime. A contenção depende dos caminhos de saída e dos auxiliares verificados; não é uma afirmação de firewall do sistema operacional. O serviço gerado do callback tem passthrough, mas não é alcançável por TCP bruto através do auxiliar anterior.
- O host mantém o guard já revisado: conexão somente a loopback, DNS externo e UDP bloqueados, spawn limitado a workerd e condicionado à auditoria. Não há invocação de CLI de nuvem, instalação, SMTP ou endpoint real de Auth/REST/Storage.
- O único acréscimo é `inspectorPort: 0`. Na fonte instalada do Miniflare, a construção de `runtimeInspectorAddress` usa literalmente `127.0.0.1`; `getInspectorURL()` retorna esse endereço. Esse socket é configurado nos argumentos do processo, não no JSON dos serviços. O cliente também exige loopback, protocolo local e porta explícita antes de abrir o WebSocket.

As referências locais utilizadas foram `miniflare/dist/src/index.js`, funções `serializeConfig`, `Runtime.updateConfig`, construção de `runtimeInspectorAddress` e `getInspectorURL`, no cache já revisado `C:/Users/harre/AppData/Local/npm-cache/_npx/827da23dfd673aa2/node_modules`. Não foi necessário consultar serviços externos.

## Encerramento e falhas

O inspector tem prazo de 5 s para abrir e para cada comando; o encerramento usa `terminate()` e aguarda no máximo 3 s, rejeitando os comandos pendentes. O `finally` tenta separadamente fechar o inspector, descartar Miniflare e encerrar os filhos próprios. `dispose()` tem prazo de 5 s, seguido de encerramento forçado quando necessário. O watchdog independente de 120 s encerra os filhos próprios e sai com falha; não depende da resolução de `dispose()`.

Erro de profiler, resposta inválida, falha funcional, tentativa de saída, alteração de bundle/protegidos ou falha de encerramento permanece em `resultado.json` e produz saída não zero. Um perfil individual pode ter sido salvo antes da validação funcional; ele só deve ser interpretado junto ao resultado agregado. A confirmação dos filhos fechados deve ser acompanhada da consulta real dos processos após a futura execução, como já previsto em `CAPACIDADE.md`.

## Qualidade e limites das medidas

Os sete perfis cobrem consulta, primeira extração PDF, duas repetições, prévia e duas exportações. A extração precisa retornar sugestões, quatro evidências e o hash do PDF; fallback manual não passa. Prévia e DOCX têm verificações do total e do conteúdo selecionado. Operações preparatórias continuam limitadas às mesmas duas rotas e às fixtures em memória.

O agregador converte microssegundos em milissegundos e separa ociosidade e GC. Ausência de amostras produz `ativoAmostradoMs: null`. O tempo de prontidão é identificado como wall time; a medição começa após `ready`, portanto não mede CPU de inicialização. A soma dos deltas não ociosos é uma estimativa local sujeita ao overhead do profiler e ao agendamento do host, não CPU faturada Cloudflare.

O PDF curto, as propostas pequenas e sete perfis seriais não comprovam pior caso, memória máxima, concorrência, p95/p99, capacidade de clientes, limites remotos nem viabilidade do plano Free. O tamanho comprimido também não prova implantação ou CPU. Esses limites estão descritos no script e no relatório de capacidade; nenhuma conclusão de aprovação remota decorre deste parecer.

**Condições do parecer:** manter os hashes acima, usar destino novo (por exemplo `perf-runtime-01`), preservar a sequência limitada e guardar resultado agregado, perfis, stdout/stderr/exit e consulta posterior de processos. Qualquer falha exige diagnóstico antes de repetir. Os arquivos SQL e a futura mudança de empacotamento/publicação continuam fora desta liberação.
