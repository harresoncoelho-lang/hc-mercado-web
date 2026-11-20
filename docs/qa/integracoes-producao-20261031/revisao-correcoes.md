# Revisão independente das correções

**Estado atual após PRE-EXECUCAO-4 e inspeção 04: liberado tecnicamente `runtime-02`, apenas para o smoke local das duas rotas, com o snapshot indicado na última seção e decisão final da coordenação. Nenhum runtime foi executado pelo revisor.** Os pareceres parciais abaixo preservam o histórico das falhas e correções; não substituem este estado atual.

## Parcial de 31/10/2026 — builder padrão

**Parecer: correção do builder aprovada neste escopo. Nenhum bloqueador novo. O runtime continua sem liberação.** Esta etapa revisa somente `scripts/montar_publico.js` e `scripts/montar_publico_dados.test.js`; os scripts de QA ainda em edição não foram reavaliados. A revisão original permanece em `revisao-pre-runtime.md`.

O builder passa a copiar somente cinco JSON de `data/`, por uma lista explícita exportada em `arquivosDeDados()`. Isso exclui `editais_vistos.json`, arquivos futuros com nomes não aprovados e subdiretórios privados. A construção mantém páginas, assets e `_headers`; não altera o histórico de origem nem o código de coleta/envio.

### Evidência e compatibilidade

- Inspecionei o diff real, o builder completo, os testes novos e os consumidores. `painel.html:3113` mantém CAPAG; `painel.html:5314,7933,8565` mantém os metadados de mercado/contratos. Os cinco nomes conservados são `capag-municipios.json`, `convenios.json`, `sistema_s_am.json`, `mercado_meta.json` e `contratos_meta.json`.
- Convênios e Sistema S já são lidos de `dados_robo` no painel (`painel.html:5203–5220`); a prévia da landing usa `convenios-publico.js`. Manter os snapshots desses dois JSON conserva o comportamento estático anterior. Não encontrei consumidor público do histórico por destinatário.
- O teste executa uma cópia real do builder em pasta temporária exclusiva, com dados fictícios. Confere os bytes dos cinco arquivos, exclusão de arquivo/subdiretório privado e de resíduo de publicação anterior, preservação da fonte e falha quando falta arquivo obrigatório. Não executa o builder sobre `publico/` do worktree.
- Repeti `node --test scripts/montar_publico.test.js scripts/montar_publico_dados.test.js scripts/capag.test.js`: **15/15 passaram**, sem rede. Os testes CAPAG usam arquivos locais e funções de rede substituídas.
- O diff de `data/editais_vistos.json`, dos cinco JSON, de `scripts/boletim_editais.py`, `scripts/coletar_convenios.js` e `scripts/coletar_sistema_s_am.js` permanece vazio. Não executei robôs ou envio de mensagens.

### Snapshot revisado

| Arquivo | SHA-256 |
|---|---|
| `scripts/montar_publico.js` | `e7cffcbee709fdb92f484d0acd0cbfd10179b0c102cdee5588f09372fa99df9f` |
| `scripts/montar_publico_dados.test.js` | `68838f82644190d2965402f0fb88e41bfd4b8583a7a66842cf9958fe2310e09a` |
| `data/editais_vistos.json`, fonte preservada | `9b96883dd3d56a0c5b09261c79bd0fe9dcf73d041a689a8d3ececd2f8ecd35af` |

### Limites da aprovação

Esta correção impede a inclusão automática de novos nomes em `data/`; não classifica conteúdo inserido futuramente dentro dos cinco arquivos aprovados. As rodadas antigas, que contêm o histórico, continuam evidências privadas e não se tornam publicáveis com esta alteração. A seleção do preparador QA e a nova rodada precisam passar por conferência própria.

O `netlify.toml` legado ainda usa `publish = "."` e não passa por este builder. Esta correção cobre a seleção do Cloudflare Pages; não corrige uma eventual publicação pela configuração Netlify. Não consultei nem infiro que esse ambiente legado esteja ativo.

Não houve build no worktree, runtime, publicação, acesso remoto, UI, Docker ou alteração de fontes nesta revisão. Os achados de isolamento/encerramento e integridade do manifesto de fontes da revisão original permanecem pendentes até a reavaliação do código e hashes de `PRE-EXECUCAO-2`.

## Re-review de PRE-EXECUCAO-2 — inspeção interrompida antes do runtime

**Parecer: runtime ainda bloqueado por incompatibilidade do harness com o schema do Miniflare instalado.** A inspeção permitida terminou com exit 1 antes de gerar a configuração e antes de criar workerd. A topologia de isolamento proposta ainda não foi comprovada na configuração efetiva.

### Bloqueador concreto

**[P1] `workers[]` usa opções do formato antigo em Miniflare 5.** Em `testar-worker.cjs`, `iniciar()` passa `name`, `modules`, `scriptPath`, `compatibilityDate`, `bindings`, `outboundService` e `serviceBindings` diretamente em cada entrada de `workers`. O construtor 5.20261012.1-beta rejeita essas chaves e exige `workers[0].config` e `workers[1].config`. Resultado observado:

```text
Unexpected options passed to `new Miniflare()` constructor:
Unrecognized keys ... at workers[0] / workers[1]
Invalid input: expected object, received undefined
at workers[0].config / workers[1].config
```

Correção mínima: adaptar as duas entradas ao schema real `config`/opções de desenvolvimento da versão instalada, preservando bundle, flags do produto, fixtures e rede negada. Repetir a inspeção em destino novo, sem apagar `preflight-config/` da rodada 03. Não executar runtime enquanto não houver configuração serializada auditável e liberação da coordenação.

### Evidência da inspeção segura

Antes de executar, confirmei no código instalado que a serialização ocorre antes de `Runtime.updateConfig()` e que o único spawn de workerd nesse caminho passa por `child_process.spawn`. No guard, `antesDeSpawn()` lança a interrupção de inspeção antes da chamada a `originalSpawn`. Um selfcheck adicional com o spawn original substituído por sentinela confirmou zero chamadas a ele; não criou subprocessos.

Executei somente:

```powershell
node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-03-revisada --inspecionar
```

A evidência nova está em `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-03-revisada/preflight-config/resultado.json`: `ok:false`, zero checks, `filhos:[]`, `chamadas:[]`, `hostBloqueados:[]`, 20 protegidos. `config-off.json` não foi criado; `runtime/` continua ausente. O erro foi a validação do construtor, não a interrupção intencional de uma configuração já auditada.

### Correções conferidas neste snapshot

- Os 14 selfchecks atuais passaram. Acrescentei apenas execução efêmera de dois checks independentes, sem arquivo de teste novo: interrupção antes do spawn e encerramento aguardando evento `exit` tardio de um filho fictício. Ambos passaram.
- O watchdog agora chama a guarda de filhos independentemente de `dispose()`. `encerrarInstancia()` limita a espera; `encerrarFilhos()` aguarda `exit` depois do kill. DNS e UDP do host foram adicionados aos bloqueios. Isso resolve o defeito de controle de encerramento identificado na revisão original; o comportamento com processo real permanece por verificar no smoke autorizado.
- A rodada 03 contém exatamente 44 estáticos reais, iguais à lista do manifesto, sem `editais_vistos.json`. Todos os hashes coincidem com o manifesto e com as fontes atuais. O achado de seleção pública está corrigido para esta rodada.
- O manifesto de fontes tem 429 arquivos reais, 14 builtins, dois polyfills virtuais e uma rota temporária. Recalculei os 429 hashes contra a base `functions/`: zero divergências. A captura posterior ao build está declarada; resolve a base incorreta sem atribuir hashes retroativos às rodadas anteriores.
- O bundle continua com SHA-256 `6a7d20c866cc4ae8179ca1de41d5035c2033e29db97b062b0c8be5880bbb3a5d`, igual à rodada 02. O isolamento proposto usa auxiliar QA e rede negada; falta a configuração efetivamente aceita pelo Miniflare para encerrar o achado de TCP.

Hashes do snapshot desta inspeção: harness `5796672cb7116eabe471e7f6ef2c4bf2cb7b8e6a8ea8e56f430960b0df83af2a`; preparação `7996979164d1e1cb01dfe2268736a41f796994a09ac2d8daa7e6185285a9cff0`; bloqueador de build `986373a403817dd400eec0f7e967a574e30d090a82efe355d71a3da41a00b26b`. Nenhum runtime, build ou serviço remoto foi executado nesta re-review.

## Re-review de PRE-EXECUCAO-3 — configuração efetiva aprovada

**Parecer: sem bloqueadores restantes para o smoke exclusivamente de `empresa-identificacao` e `kit-documentos`, em pasta de execução nova da rodada 03 e com fixtures.** A coordenação ainda decide/executa o próximo passo. Esta liberação não autoriza publicação, integração remota ou expansão das rotas testadas.

O schema nativo `workers[].config`/`workers[].dev` passou no pacote instalado. A primeira captura (`inspecao-02`) foi preservada: gerou configuração, mas a auditoria recusou o comentário `sourceURL` acrescentado pelo Miniflare. A correção aceita somente o código literal original ou esse código com o sufixo exato do worktree; o teste rejeita código adicional. Os oito selfchecks do harness corrigido passaram. Preparação, bloqueador e bundle não mudaram nesta etapa.

Executei a nova inspeção autorizada:

```powershell
node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-03-revisada --execucao inspecao-03 --inspecionar
```

Ela terminou com exit 1 e a interrupção **esperada** `CONFIGURACAO_INSPECIONADA_SEM_WORKERD`, depois de capturar/auditar a configuração e antes de chamar o spawn original. `resultado.json` registra zero filhos, zero chamadas de fixture, zero bloqueios de saída do host e 20 protegidos. Não houve execução do Worker.

### Conferência independente da configuração serializada

Li a configuração real de `inspecao-03/config-off.json` e conferi os serviços/bindings, sem depender somente do resultado de `auditarConfig()`:

- TCP do produto segue `core:user:produto → outbound:0 → core:user:fixture-router`. O último Worker não tem `connect_pass_through` nem outra flag. Pela semântica do workerd já citada na revisão original, ele não encaminha conexões TCP recebidas.
- A saída global do auxiliar segue `outbound:1 → core:user:fixture-router`, alcançando a mesma barreira. O callback gerado pelo Miniflare ainda tem passagem TCP, mas somente o auxiliar acessa seu binding; o código literal desse auxiliar só chama `FIXTURES.fetch()` e recusa método HTTP `CONNECT`. Não oferece `connect()` ao produto.
- HTTP segue pelo auxiliar ao callback Node de fixtures. Esse callback valida origem, rota, método e token; retorna dados fictícios ou erro e não encaminha requisições à rede. Li também o interceptor instalado: suas chamadas `fetch()` usam o global outbound configurado. O cache está desativado, com serviço de resposta local sem busca externa.
- ASSETS aponta ao serviço `network` com `allow: []` e `deny: ["public", "private"]`. O produto não tem outros bindings de serviço; seus textos de configuração são o flag local e a credencial fictícia `QA_SERVICE`.
- O módulo serializado do produto é exatamente o conteúdo do bundle revisto acrescido do comentário `sourceURL` esperado. Permanecem `2025-09-01` e `nodejs_compat`. O auxiliar também coincide integralmente com o literal revisado e o sufixo permitido.

O serviço genérico `internet` continua presente na infraestrutura interna do Miniflare; ele não é o destino das cadeias acima. A aprovação é do caminho do produto e das duas rotas deste harness, não uma afirmação de sandbox de rede do sistema operacional. Antes de cada spawn futuro, inclusive com o flag habilitado, o harness volta a auditar a configuração gerada.

### Snapshot liberado e evidência

- Harness: `c0290d902735344ea08625c471cf47df7fc6c2c2274e54148009aeaf8ec9da47`.
- Bundle: `6a7d20c866cc4ae8179ca1de41d5035c2033e29db97b062b0c8be5880bbb3a5d`.
- Configuração capturada em inspeção 03: `d58998387b623c879d4933000c9a2f65ad47a90285c5f88fb890ce31231e1cf1`.
- Evidência independente: `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-03-revisada/inspecao-03/revisao-independente.json`.

Mantêm-se os limites já documentados: Auth/REST/Storage fictícios, SQL/RLS/concorrência reais não avaliados, CPU/inicialização e execução do bundle ainda não comprovadas. Os quatro achados originais estão resolvidos para esta preparação local: seleção pública e fontes foram conferidas na etapa anterior, encerramento tem limite independente, e a configuração efetiva agora fecha a passagem TCP do produto. A execução real do smoke poderá revelar incompatibilidades funcionais; deve parar e preservar evidências caso falhe.

## Re-review pontual de PRE-EXECUCAO-4 — ASSETS isolado

**Parecer: correção aprovada para a tentativa `runtime-02`, sem bloqueador novo.** Escopo desta etapa: alteração de ASSETS no QA, comparação da configuração capturada e encerramento de `runtime-01`. Não executei runtime.

A tentativa `runtime-01`, executada pela coordenação após a liberação anterior, falhou antes das APIs: o parser nativo do workerd recusou `deny: ["public", "private"]`, embora o schema de opções Miniflare tivesse aceitado a configuração. Isso mostra o limite da inspeção anterior: ela verificou estrutura/isolamento proposto, mas não a aceitação pelo binário. Resultado preservado: zero checks, zero chamadas, PID 7748 com `encerrado:true` e exit 1, 20 protegidos. Minha consulta atual a processos confirmou zero workerd ativos e PID 7748 ausente.

Conferi o código atual e comparei `inspecao-04/config-off.json` à configuração da inspeção 03:

- ASSETS agora aponta a `core:user:assets-deny`. O módulo contém somente a resposta literal 599 para qualquer requisição, com o comentário `sourceURL` exato; `bindings: []` e `compatibilityFlags: []`.
- Sua saída segue `outbound:2 → core:user:assets-deny`. O destino não tem passagem TCP; a resposta HTTP não chama rede nem fixtures. Não há serviço network com a regra recusada pelo binário.
- O módulo completo do produto, o Worker `fixture-router` e os interceptores `outbound:0`/`outbound:1` são idênticos aos já revisados. A troca ficou no binding ASSETS e no novo auxiliar QA.
- A inspeção 04 registra a interrupção intencional anterior ao spawn e `filhos: []`. O runtime 02 ainda não existia durante esta revisão.
- Repeti os **nove selfchecks do harness: 9/9 passaram**, inclusive resposta ASSETS 599 sem acesso às fixtures e encerramento com `dispose()` pendente.

Snapshot liberado: harness `09ec248f77fb2040b46c961ba7ed1a63ffcbc7ba312dcf4842279fcada9c12b3`; configuração da inspeção 04 `412a1aae07a92798858dc4aee218fec69a04e4b8fd07c44a5588f2927bd07d6c`. Bundle e restrições das duas rotas permanecem os anteriores. Comando a cargo da coordenação:

```powershell
node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-03-revisada --execucao runtime-02
```

Ainda não existe sucesso funcional do bundle no workerd. Esta liberação permite a tentativa isolada; não certifica inicialização, PDFs, DOCX, SQL/RLS ou produção. Evidências anteriores foram preservadas e nenhum código de produto foi alterado nesta revisão.
