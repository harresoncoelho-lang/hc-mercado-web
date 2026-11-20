# Leitor empresarial: diagnóstico e correção restrita para revisão

> **Encerramento:** o patch recebeu revisão e foi compilado na rodada 04. `runtime-03` concluiu 14 verificações, incluindo PDF com quatro evidências e dois DOCX. Ver `RUNTIME-CLOUDFLARE.md`. As falhas e o diagnóstico abaixo foram preservados; não houve alteração posterior de código para maquiar a leitura.

## Falha observada

`rodada-03-revisada/runtime-02` executou o Worker completo. Sete verificações anteriores passaram; o PDF fictício legível em Node retornou modo manual no Worker. O teste falhou e não contou esse fallback como extração aprovada. Foram 35 chamadas exclusivamente às fixtures, nenhuma saída não declarada. Os dois filhos workerd encerraram; a consulta real posterior encontrou zero workerd ativo. Os 20 arquivos protegidos permaneceram com hashes iguais. O percurso de kit não chegou a ser executado nessa rodada.

## Causa localizada offline

O bundle preservado da rodada 01 mostra o default PDF.js 1.10.100 recebendo o wrapper de **node-ensure/browser.js**, porque esse pacote declara o mapeamento de `index.js` para browser.js. Na linha 54695 do bundle, PDF.js atribui o wrapper a `__require.ensure`; nas linhas 5969–5970, o wrapper chama `__require.ensure.apply(...)`. A invocação seguinte, linha 54706, recursa na própria função. Não é ausência do glob de versões: as quatro versões estão incluídas no bundle, linhas 252174–252186.

`diagnosticar-pdf.cjs` extraiu a função correspondente do bundle preservado e reproduziu offline `RangeError: Maximum call stack size exceeded`. O controle com `node-ensure/index.js` chamou o callback normalmente. Resultado em `runtime-02/diagnostico-offline.json`. A exceção interna do Worker é ocultada pelo catch existente de `_empresa_documentos.js`; por isso o diagnóstico distingue a reprodução causal do trecho compilado da mensagem externa efetivamente observada.

## Alternativa já instalada

PDF.js 1.10.100 exporta `LoopbackPort`, `PDFWorker.fromPort(port)` e `WorkerMessageHandler.initializeFromPort(port)`. Seu `getDocument({data, worker})` aceita worker explícito e evita `_setupFakeWorker`/invocação de node-ensure. `LoopbackPort` é o transporte da própria biblioteca, sem protocolo criado pelo projeto nem dependência de MessageChannel nativo.

Experimentos Node isolados, com rede bloqueada, leram uma página e quatro campos fictícios tanto com MessageChannel quanto com LoopbackPort. A decisão usa LoopbackPort, a alternativa menor revisada independentemente. Evidência `runtime-02/experimento-loopback-node.json`; isto ainda não prova execução em Workers.

## Patch autorizado pela coordenação, aguardando review

- Novo `_empresa_pdf_leitor.js`: carrega os módulos fixos da versão já instalada **somente quando chamado**, usa porta/worker explícitos, limita extração a 2 MiB/oito páginas e acrescenta timeout cooperativo de dez segundos. Libera tarefa, worker e porta em finally, inclusive falha de leitura. O timer não preempta CPU síncrona nem comprova cumprimento do limite de CPU do plano remoto.
- `_empresa_documentos.js`: substitui somente as cinco linhas de chamada/renderização de pdf-parse pela chamada ao helper. Contrato de sugestões, evidências, avisos, fallback manual e limites de arquivo/páginas conservados.
- Teste novo `empresa-pdf-leitor.test.js`: loader fakeWorker deliberadamente indisponível, import sem carga antecipada, oito/nove páginas, limite de bytes, timeout com cleanup e PDF inválido.

Nenhum alias, globalThis, `require.ensure`, opção global `disableWorker`, pacote instalado, modelo, autenticação ou código do resumo foi alterado. A biblioteca PDF.js pode inicializar internamente `require.ensure` ao carregar, como já fazia no caminho anterior; não se afirma que a biblioteca inteira seja isenta de efeitos. O patch evita **invocar** o loader e preserva o momento de importação sob demanda.

Cópia exata anterior em `runtime-02/empresa-documentos-antes.js`, SHA-256 `13a0bcea28467cd37913c55ee493ff3ff8d503361454f044d6336e2c465d3b51`. `empresa-documentos.diff` compara essa cópia com a alteração, sem depender de Git HEAD. Nenhum trabalho anterior foi descartado.

## Verificação pré-build

Dois testes novos inicialmente falharam; depois do patch, 27 testes de documentos/identificação/kit passaram, executados com preloader de rede bloqueada. Houve apenas o aviso esperado do PDF inválido sintético. Protegidos 20/20. Ainda não se recompilou nem repetiu runtime após o patch.

| Arquivo | SHA-256 para revisão |
|---|---|
| `_empresa_documentos.js` | `d08f68ae5d60d84022c9d3239b127c0571fc345d308d1cb093d0ab6626c8c1db` |
| `_empresa_pdf_leitor.js` | `6b387ebf6b0e18bd87b2dcf502f24b1f60833a94eb5c86b38b67c344fc08885b` |
| `empresa-pdf-leitor.test.js` | `0151c87f3086900155297a1eb1397188d6cca51239f93a30b3007d29727ac7aa` |

Próxima etapa: revisão independente desse diff pequeno, nova compilação completa isolada, conferir configuração/hashes e só então nova autorização da coordenação para smoke completo. Não há publicação ou escrita em produção.
