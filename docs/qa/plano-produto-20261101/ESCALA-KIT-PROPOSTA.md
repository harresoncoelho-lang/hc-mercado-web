# Escala do kit de propostas — diagnóstico offline

Data: 01/11/2026. Somente leitura do código; nenhum teste em produção, mudança de limite ou migração aplicada.

## Conclusão

O limite de 50 é imposto em três camadas e anunciado na UI. Aumentar só um número não resolve: carregamento dos itens não possui paginação nem prova de completude; tamanho do rascunho e prévia têm limites independentes. A extensão de 2.500 itens é outro produto/contrato e não prova capacidade deste gerador.

## Evidências exatas

| Arquivo | Achado |
|---|---|
| `kit-documentos-ui.js:40` | Informa seleção de 1–50. |
| `kit-documentos-ui.js:240` | Renderiza todos os itens com checkbox e unidade manual de uma vez; não há página virtualizada. |
| `netlify/functions/_kit_documentos.js:32` | Gerador exige 1–50 IDs. |
| `netlify/functions/_kit_documentos.js:36` | Faz find por ID dentro do laço: custo quadrático na seleção grande. |
| `netlify/functions/_kit_documentos.js:38` | Descrição até 10.000 caracteres por item; marca/modelo até 500 cada. |
| `netlify/functions/_kit_documentos.js:60` | Prévia integral limitada a 1.000.000 caracteres. |
| `netlify/functions/_kit_documentos.js:61` | Hash inclui itens, perfil, campos, usuário e prévia; preservar essa vinculação. |
| `netlify/functions/_kit_documentos_persistencia.js:21` | Rascunho também limita 50 IDs. |
| `supabase/kit_documentos.sql:69` | RPC SQL impõe 50; alterar JS sozinho continuaria falhando no banco. |
| `supabase/kit_documentos.sql:55` | JSON textual do rascunho limitado a 50.000 caracteres. |
| `supabase/kit_documentos.sql:106` | Revisão persistida limitada a 1.000.000 caracteres. |
| `netlify/functions/kit-documentos.js:51` | Body limitado a 50.000 unidades de string JS; não bytes UTF-8. |
| `netlify/functions/kit-documentos.js:14` | Busca todos os itens com order=id, sem limit/offset/cursor e sem total. Não detecta truncamento pelo serviço. |
| `netlify/functions/_empresa_identificacao_contexto.js:9` | rest devolve apenas JSON; cabeçalhos de total/faixa não chegam ao chamador. |
| `netlify/functions/kit-documentos.js:84` | DOCX inteiro convertido em base64 dentro de JSON; não é streaming. |

A prévia e DOCX ficam inteiros em memória, junto com serialização canônica/hash e base64 (aproximadamente 4/3 do binário). Mil descrições no máximo permitido excederiam 10 milhões de caracteres antes do restante: não cabem no contrato atual de prévia de 1 milhão. Rascunho de 1.000 UUIDs + mapa de unidades tampouco cabe garantidamente em 50 mil. Não medi memória/CPU da infraestrutura e não afirmo uma capacidade remota.

## Menor incremento seguro proposto

1. Não publicar aumento isolado. Preparar constante comum de quantidade e política de bytes/tamanho em código; espelhar limite explícito na RPC por migração nova, sem editar banco ativo. Meta inicial sugerida: 1.000 itens, sujeita a orçamento textual explicitamente apresentado antes da revisão. Não prometer quantidade ilimitada.
2. Separar listagem paginada para seleção (`limit` até 100, cursor por UUID, filtros obrigatórios organização/processo e pós-validação). Persistir seleções e unidades fora do DOM; mudar de página não apaga seleção. UI mostra selecionados, itens carregados e término comprovado. API deve devolver `hasMore`/`nextCursor`, obtendo limit+1; não inferir completude de resposta sem contrato.
3. Para salvar/preparar/exportar, buscar **somente IDs selecionados**, em lotes pequenos (ex.: 50 UUIDs por consulta para limitar URL), com os mesmos filtros em cada lote. Map por ID substitui find repetido. Conferir exatamente o conjunto solicitado, duplicatas e identidade; item ausente ou intruso falha fechado. Não aceitar preço/descrição enviados pelo navegador.
4. Preservar ordem canônica e hash integral, valores decimais como texto/BigInt, revisão de versão e comparação ao exportar. Leitura em lotes não é snapshot transacional: reconsulta na exportação detecta alteração observada, mas consistência atômica exigiria snapshot/versionamento persistido ou RPC apropriada. Não declarar atomicidade inexistente.
5. Aumentar orçamento do rascunho de forma calculada e consistente entre HTTP/JS/SQL, com bytes UTF-8 explícitos no transporte. Manter limite de prévia nesta primeira etapa e avisar quando a seleção exceder conteúdo suportado; isso remove o teto comercial de 50 para documentos usuais, não garante 1.000 descrições de tamanho máximo.
6. Para documentos acima do orçamento, proposta posterior: snapshot versionado e job de geração com arquivo privado, revisão integral paginada e hash do conjunto. Dividir automaticamente em vários documentos alteraria o resultado comercial e não deve acontecer silenciosamente. Streaming de coleta por si só não reduz o consumo do DOCX/base64 atual.

## Testes necessários antes de alterar limite

- `scripts/kit_documentos.test.js`: 51, 200 e 1.000 itens sintéticos, total BigInt, ordem/hash estáveis, item tardio alterado invalida revisão; abrir DOCX ZIP e conferir primeiro/último e contagem, escapes XML e quebras; orçamento textual próximo/acima do máximo.
- `scripts/kit_documentos_persistencia.test.js`: seleção grande, UUID duplicado com caixa distinta, unidades extras, limite textual/bytes, não perder selecionados.
- `netlify/functions/__tests__/kit-documentos.test.js`: lotes de leitura, resposta curta/duplicada/estranha, empresa/processo diferente no lote final, falha intermediária sem resultado parcial; novo hash após alteração de item; 409 permanece ao exportar revisão antiga.
- `scripts/kit_documentos_ui.test.js`: duas ou mais páginas, seleção/unidade preservada ao navegar e reabrir, item ausente explícito, revisão integral antes confirmação; nenhum envio ao Compras.gov.
- SQL: ensaio isolado da RPC com 51/1.000 e máximo+1, limites de payload, CAS/revisão e acesso entre CNPJs. Testes JS não validam a migração real.
- Benchmark local leve com fixtures representativas mede tempo, memória e tamanho DOCX/base64 antes de escolher limite final; carga concorrente de homologação é etapa separada.

Não é necessário tocar resumo, e-mail, boletins ou autenticação para implementar este incremento. O helper de identidade compartilhado pode permanecer intacto: o próprio kit pode usar seu `request` já disponível caso precise metadados, ou buscar lotes selecionados pelo `rest` existente. Nesta etapa nenhum código foi modificado.
