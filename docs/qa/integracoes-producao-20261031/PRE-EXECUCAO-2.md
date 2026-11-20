# Preparação revisada — antes de executar workerd

> **Atualização:** a inspeção desta versão falhou no schema Miniflare 5 antes de spawn. A forma de opções e a contenção foram corrigidas em `PRE-EXECUCAO-3.md`; a versão instalada não aceita network como global outbound. Evidência da falha preservada. A rodada 03 compilada continua intacta.

31/10/2026. Corrige os quatro achados de `revisao-pre-runtime.md`. **Nenhum Worker foi executado ainda.**

## Nova rodada preservada

`C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-03-revisada`.

- Compilação completa e minificada: 8.099.146 bytes brutos; 2.798.266 gzip; SHA-256 `6a7d20c866cc4ae8179ca1de41d5035c2033e29db97b062b0c8be5880bbb3a5d`, igual à rodada 02.
- 44 estáticos: 39 da raiz + cinco JSON públicos, consumindo `arquivosDeDados()` do builder corrigido pelo especialista. `editais_vistos.json` não está no pacote; apenas nome/classificação registrados, sem expor conteúdo. O arquivo original e robô não foram alterados. Rodadas anteriores ficam privadas e não publicáveis.
- `fontes-build.json`: base correta `functions/`; 429 arquivos reais com SHA-256 e tamanho igual ao metafile, 14 builtins, dois polyfills virtuais e uma rota temporária gerada. Input real ausente agora falha. Hashes capturados depois da compilação; não são apresentados como snapshot anterior. Os 20 protegidos coincidem antes/depois.
- 14 selfchecks offline passaram após RED dos novos critérios: origem de inputs, exclusão de histórico privado, caminho TCP com saída explícita e encerramento mesmo se `dispose()` ficar pendente. Guardas de build/host agora bloqueiam DNS e UDP além de sockets externos. O teste usa PDF sintético e não chama serviços reais.

## Configuração de contenção proposta

O bundle de produto mantém exatamente `2025-09-01` e `nodejs_compat`. O `outboundService` do produto aponta para **um Worker auxiliar apenas de QA**. Esse auxiliar só encaminha HTTP ao callback de fixtures; seu próprio `globalOutbound` aponta para rede com `allow: []`, `deny: [public, private]`. ASSETS também aponta para deny-all. Não é proxy do produto ou nova integração: não possui chave real, persistência, publicação ou uso fora do teste.

O caminho TCP do produto chega ao auxiliar e encontra a saída deny-all; não aponta diretamente para o callback que herdaria internet. A auditoria de configuração percorre a cadeia `globalOutbound` de ambos e de ASSETS, rejeita default/serviço internet/ciclos/destinos não declarados, e verifica data/flags do produto. Essa auditoria roda **antes** de o guard permitir `spawn` do workerd, usando o JSON emitido por `MINIFLARE_WORKERD_CONFIG_DEBUG` da versão instalada. O modo `--inspecionar` lança uma interrupção intencional depois de capturar/auditar a configuração, antes de iniciar qualquer workerd.

Host Node: TCP só loopback; resolução de localhost/IP local é sintética, demais DNS/UDP bloqueados. Subprocesso permitido somente workerd; todos os filhos próprios são rastreados. `dispose()` tem limite independente de cinco segundos e fallback de kill com espera pelo evento exit; watchdog global de 120 segundos encerra filhos próprios sem esperar `dispose`. Nenhuma regra de firewall, configuração do Windows, Docker ou processo alheio é alterado.

Auth, REST e Storage permanecem **fixtures declaradas**, não banco/autenticação reais. Esta prova complementa a homologação real anterior; não substitui SQL/RLS remotos. Rotas invocadas continuam somente `empresa-identificacao` e `kit-documentos`.

## Hashes para re-review

| Arquivo | SHA-256 |
|---|---|
| `testar-worker.cjs` | `5796672cb7116eabe471e7f6ef2c4bf2cb7b8e6a8ea8e56f430960b0df83af2a` |
| `preparar-cloudflare.cjs` | `7996979164d1e1cb01dfe2268736a41f796994a09ac2d8daa7e6185285a9cff0` |
| `bloquear-rede-build.cjs` | `986373a403817dd400eec0f7e967a574e30d090a82efe355d71a3da41a00b26b` |

Próximo passo sujeito à revisão: inspecionar a configuração serializada **sem iniciar workerd**, com `node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-03-revisada --inspecionar`. A interrupção intencional deixa evidências em `preflight-config/`. Só depois de avaliar essa configuração e obter liberação da coordenação executar o mesmo comando sem `--inspecionar`, com saída nova `runtime/`.

Limites não resolvidos por estes selfchecks: CPU/inicialização remotas, processamento real no Worker, política efetiva do CI, migrações/configuração de produção e transferência da integração homologada para produção. Sem deploy ou publicação.
