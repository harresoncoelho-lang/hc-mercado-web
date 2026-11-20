# Correção restrita do ASSETS e inspeção concluída

> **Estado final posterior:** runtime-02 encontrou a falha real do parser; após diagnóstico, revisão e correção restrita ao leitor empresarial, a rodada 04/runtime-03 aprovou os 14 checks. Ver `RUNTIME-CLOUDFLARE.md`. Este documento mantém o contexto da aprovação anterior.

`runtime-01` foi executado uma vez após liberação. Falhou na inicialização do workerd porque o parser de rede recusou `deny: [public, private]`. Nenhuma API foi chamada: zero checks, zero saídas de fixture. Workerd PID 7748 encerrou com código 1; consulta real posterior não encontrou workerd ativo. Os 20 protegidos permaneceram íntegros. Logs, resultado, configuração e processos estão preservados na rodada 03.

A correção fica só no QA: ASSETS aponta a um Worker mínimo `assets-deny`, sem flags de passthrough, sem binding às fixtures e com resposta literal 599 para qualquer URL/método. Seu outbound aponta à própria barreira. O auxiliar de Auth/REST/Storage não mudou. Foram removidas as regras de rede recusadas pelo binário; não há alteração em produto, flags, bundle, pacote estático ou dependências.

Nove selfchecks do harness passaram, incluindo schema Miniflare 5, recusa de ASSETS independentemente da URL, código adicional proibido, flags de passthrough proibidas, DNS/UDP/TCP externos bloqueados e cleanup com dispose pendente.

`inspecao-04` foi executada com autorização apenas para captura pré-spawn. Configuração serializada auditada; interrupção intencional `CONFIGURACAO_INSPECIONADA_SEM_WORKERD`; **nenhum filho iniciado**. Caminhos de produto, auxiliar e ASSETS terminam em auxiliares literais sem passthrough. Evidência em `rodada-03-revisada/inspecao-04/`, incluindo `config-off.json.auditoria.json`; stdout/stderr próprios na raiz da rodada.

Hash do harness para revisão: `09ec248f77fb2040b46c961ba7ed1a63ffcbc7ba312dcf4842279fcada9c12b3`.

Próximo comando, somente após liberação do runtime pela coordenação:

```powershell
node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-03-revisada --execucao runtime-02
```

Ainda não há sucesso funcional do Worker. Auth/banco/Storage deste smoke são fixtures fictícias, complementares à homologação real anterior. Publicação, SMTP, produção, resumo, e-mail, robôs, autenticação e modelos continuam intocados.
