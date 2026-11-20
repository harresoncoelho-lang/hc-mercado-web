# Opções Miniflare 5 corrigidas — inspeção antes do runtime

> **Atualização:** a rodada runtime-01 autorizada falhou antes das APIs porque workerd recusou a regra de rede de ASSETS. Correção mínima do QA e nova captura sem subprocesso estão em `PRE-EXECUCAO-4.md`. Evidências anteriores preservadas; sem homologação funcional concluída até este ponto.

31/10/2026. A inspeção da revisão anterior falhou no schema, antes de qualquer spawn. Evidência `rodada-03-revisada/preflight-config/resultado.json` preservada. Nenhum workerd foi executado.

`testar-worker.cjs` agora usa o schema nativo instalado: `workers[].config` com manifest/env e `workers[].dev` com outboundService. O teste chama `MiniflareOptionsSchema.parse` sem instanciar o runtime e passou. Os oito selfchecks do harness passaram; os sete testes da preparação permanecem válidos, sem alteração desde o GREEN anterior.

A versão 5 instalada não permite `network` em `dev.outboundService`. Não usamos opção inválida, downgrade ou patch interno. A contenção TCP fica no Worker auxiliar de QA **sem** `connect_pass_through`, sem quaisquer flags; ele recusa também HTTP com método CONNECT. Segundo a [definição oficial do workerd](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/compatibility-date.capnp), encaminhamento de conexões recebidas é opt-in experimental; o Worker intermediário sem essa flag bloqueia TCP bruto. A data e flags do produto continuam intactas.

O global outbound do produto aponta ao auxiliar, e o do auxiliar aponta a ele próprio. Assim ambos os caminhos TCP chegam à barreira do auxiliar, sem encaminhar ao serviço padrão internet. O código auxiliar é literal, verificado na configuração serializada, e só chama o callback de fixtures por binding. Esse callback nunca encaminha rede. ASSETS usa binding network deny-all, aceito pelo schema. Não se trata de configuração para produção.

Auditoria antes de spawn confere o código literal do auxiliar, flags vazias, a cadeia outbound, ASSETS deny-all e data/flags do produto. O próprio modo de inspeção impede o spawn mesmo após a auditoria passar. DNS/UDP/host externo e encerramento independente continuam protegidos. Nenhuma mudança no bundle/estáticos da rodada 03.

Hash atual do harness: `c0290d902735344ea08625c471cf47df7fc6c2c2274e54148009aeaf8ec9da47`.

Adendo: `inspecao-02` gerou configuração antes de spawn, mas a comparação literal recusou o comentário `sourceURL` acrescentado pelo Miniflare. A guarda agora aceita somente o literal original ou o mesmo literal acrescido do sufixo exato esperado para `<worktree>/index.js`; código adicional continua recusado em teste. Não há remoção genérica de comentários. Oito testes passaram. Evidência da inspeção anterior preservada; próxima captura deve usar `inspecao-03`.

Comando de inspeção proposto, saída nova e sem workerd:

```powershell
node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-03-revisada --execucao inspecao-03 --inspecionar
```

A inspeção encerra intencionalmente antes do subprocesso. Depois da revisão da configuração capturada, a coordenação precisa liberar separadamente o comando sem `--inspecionar`, com outro nome de execução novo. Auth, banco e Storage serão somente fixtures. Sem publicação, Docker, credenciais reais, SMTP, resumo ou robôs.
