# Revisão independente do leitor PDF empresarial

31/10/2026. Escopo: `_empresa_pdf_leitor.js`, substituição mínima em `_empresa_documentos.js`, teste novo e APIs da versão PDF.js 1.10.100 já instalada. Revisão somente de leitura; nenhum build ou runtime foi executado pelo revisor.

**Parecer: sem bloqueadores para nova compilação completa isolada e posterior smoke das duas rotas, sob coordenação.** O resultado ainda precisa demonstrar leitura do PDF no workerd; testes Node não encerram essa prova. Não há autorização de publicação ou mudança em resumo, autenticação, modelos, dependências ou outros módulos protegidos.

## Correção e contrato

O helper cria uma `LoopbackPort(true)` exclusiva por leitura, associa `PDFWorker.fromPort(port)` e inicializa `WorkerMessageHandler` na mesma porta. `getDocument({data, worker})` recebe esse worker explícito. No código instalado, isso evita a construção automática de `PDFWorker` e `_setupFakeWorker`, caminho ligado à recursão observada no bundle anterior. A comunicação usa objetos e microtarefas da própria biblioteca; não cria thread nativa, socket ou protocolo novo.

O código continua aceitando somente extração de até 2 MiB e oito páginas. Documentos maiores que oito páginas retornam a contagem sem extrair suas páginas, permitindo o mesmo aviso manual do adaptador. A composição de texto conserva a regra de quebra por coordenada Y e espaço após cada item. Sugestões, evidências, avisos e fallback do adaptador permanecem iguais. A remoção da leitura de metadados não altera o contrato usado por esses consumidores.

Comparei o adaptador com o backup exato anterior, sem depender de Git HEAD: a alteração troca somente a chamada/renderização do parser pelo helper. Executei ambos sobre três PDFs fictícios locais: cartão, preview e upload final. As respostas completas foram idênticas, com modo `sugestoes` e quatro evidências em cada arquivo.

## Importação, efeitos e recursos

- As duas importações PDF.js ficam dentro de `lerPaginasPdf()`. Importar o helper não carrega `pdf-parse`, comprovado em processo Node separado. O patch não escreve em `globalThis`, `require.ensure`, `disableWorker`, aliases ou arquivos instalados.
- A própria biblioteca inicializa internamente `require.ensure` quando é carregada, como já fazia no caminho anterior. Não afirmo ausência total de efeitos internos. A correção evita a invocação do loader problemático e conserva o carregamento sob demanda. A inicialização automática de `pdf.worker.js` também depende de `self` ser um MessagePort e não estar em Node; o helper usa sua porta explicitamente. A confirmação no bundle/runtime continua necessária.
- Cada leitura tem sua porta e worker; não compartilha estado de documento entre empresas. `finally` limpa o timer, aguarda `tarefa.destroy()`, destrói o worker e termina a porta. Os `finally` aninhados preservam os dois últimos passos se a destruição anterior lançar/rejeitar.
- O prazo de dez segundos é cooperativo: não interrompe CPU síncrona e não é limite rígido de ponta a ponta, pois a finalização aguarda a biblioteca. O watchdog independente já revisado permanece responsável pelo limite do smoke. Isso não comprova orçamento de CPU remoto.

## PDFs inválidos, senha e avaliação dinâmica

O PDF inválido sintético retornou modo manual e encerrou a porta. Uma rejeição controlada equivalente a `PasswordException` também retornou modo manual, sem sugestões/evidências, e chamou a destruição da tarefa. A biblioteca instalada encaminha falhas de senha ao carregamento; o adaptador não trata rejeição como sucesso. Não foi usado um PDF real criptografado nesta revisão; essa verificação foi de rejeição simulada e leitura do código da biblioteca.

Inspecionei especificamente `isEvalSupported`, fontes e `new Function` na versão instalada. O percurso usado é `GetTextContent → extractTextContent → getTextContent`, que carrega fontes e converte caracteres em glifos/texto. Não chama o renderizador `FontFaceObject.getPathGenerator`; o carregamento dos programas Type3 fica no percurso de operator list/renderização. As chamadas de compilação dinâmica encontradas pertencem à renderização de glifos e às funções PostScript de cores/shading; não identifiquei chamada concreta a elas neste fluxo exclusivamente textual.

Também confirmei que simplesmente acrescentar `isEvalSupported:false` a `getDocument()` não seria uma proteção efetiva nesta versão: `_fetchDocument` lê esse valor de `getDefaultSetting`, em `pdf.js:3497`. Não recomendo uma opção inócua nem alteração global. Não há achado concreto de execução dinâmica introduzida pelo patch; isso não constitui auditoria universal do parser antigo ou autorização para acrescentar renderização posteriormente.

## Verificação e snapshot

Executei, com o preloader de rede bloqueada:

```powershell
node --require ./docs/qa/integracoes-producao-20261031/bloquear-rede-build.cjs --test netlify/functions/__tests__/empresa-documentos.test.js netlify/functions/__tests__/empresa-pdf-leitor.test.js
```

**10/10 testes passaram.** Cobrem loader indisponível, importação tardia, oito/nove páginas, limite de bytes, timeout com encerramento, arquivo inválido e contrato empresarial. A comparação adicional dos três PDFs e a rejeição simulada de senha também passaram. Os 20 protegidos coincidem com a baseline. Não repeti o gate geral informado pela coordenação.

| Arquivo | SHA-256 conferido |
|---|---|
| `_empresa_pdf_leitor.js` | `6b387ebf6b0e18bd87b2dcf502f24b1f60833a94eb5c86b38b67c344fc08885b` |
| `_empresa_documentos.js` | `d08f68ae5d60d84022c9d3239b127c0571fc345d308d1cb093d0ab6626c8c1db` |
| `empresa-pdf-leitor.test.js` | `0151c87f3086900155297a1eb1397188d6cca51239f93a30b3007d29727ac7aa` |
| Backup exato anterior do adaptador | `13a0bcea28467cd37913c55ee493ff3ff8d503361454f044d6336e2c465d3b51` |

Os hashes coincidem com o congelamento informado em `diagnostico-pdf-worker.md`. Próxima prova: bundle completo novo, manifesto e tamanho atualizados, configuração isolada preservada e smoke que exige `modo: sugestoes` antes de prosseguir ao kit. Fallback manual continua sendo falha nessa prova, nunca sucesso substituto.
