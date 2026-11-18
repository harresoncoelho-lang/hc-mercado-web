# Adaptador de leitura — protótipo isolado

Preparado em código, **não instalado, publicado nem homologado no navegador real**. O canal de leitura tem integração local com UI/handler do kit, desativada por padrão. Não cadastra propostas nem envia lances. A integração reutiliza esses módulos existentes; não altera resumo, e-mail ou robô de boletins.

## Fluxo

O popup recebe o contexto esperado (CNPJ, UASG, número, ano e identificador da compra). Somente ao clicar em **Conferir leitura** solicita acesso temporário à aba atual, coleta os identificadores visíveis e compara esperado com observado. O resultado é uma amostra pontual; não representa conexão contínua, sessão autenticada certificada ou autorização para escrever.

O CNPJ é reconhecido pelo rótulo explícito `CNPJ do fornecedor:` ou pela estrutura específica do cabeçalho observada em 02/11: `DIV#usuarioAtual > DIV[role="tab"] > SPAN > SPAN.ml-1.text-nowrap`, com folha de identificação e estrutura verificadas. CPF, nome, CNPJ do órgão, valor digitado no popup e identificador da URL não substituem essa evidência. Ausência, ocultação ou ambiguidade impedem confirmação. A adaptação possui testes com DOM fictício; instalação e homologação da extensão real continuam pendentes.

## Limites e proteção

- Apenas URL HTTPS exata do cadastro de propostas do Compras.gov.br; validação antes e depois da coleta.
- Manifesto fonte: apenas `activeTab` e `scripting`, sem worker ou conexões externas habilitadas. O pacote QA opt-in adiciona worker e uma origem/caminho explícitos; não adiciona permissões, rede, cookies ou armazenamento. O nonce fica no receptor/worker e retorna somente à página que iniciou a tentativa, nunca ao popup.
- O script não recebe os dados esperados. Retorna identificadores padronizados, aviso genérico de sessão/CAPTCHA e, quando a estrutura permite, até dez itens públicos da página observada: ID, descrição limitada a 2.000 caracteres, quantidade solicitada e unidade. Não retorna nomes da conta, CPF, endereços privados ou texto integral da página.
- Identidade ausente, ambígua ou divergente, URL alterada, sessão expirada, coleta incompleta e mudança de aba invalidam a conferência.
- Identificadores precisam ser visíveis, inclusive quanto à opacidade ancestral. Sem `Element.checkVisibility`, a coleta é incompleta.
- A coleta é limitada a 5.000 elementos e 20 evidências por categoria. Os CNPJs suportados nesta etapa são numéricos, com dígitos verificadores; outro formato não confirma.
- O DOM não é prova criptográfica da identidade. O protótipo não verifica sessão no servidor nem substitui futura validação autenticada por CNPJ no SaaS.
- Paginação de itens, leitura de preços/marca/modelo, cadastro, robô de lances e reconexão não fazem parte desta entrega.

O popup apresenta a lista parcial somente após conferência do contexto. Grupo e exigências permanecem desconhecidos. A lista não é ligada ao motor de cadastro, não certifica catálogo completo e não prova que a navegação terminou: o portal pode manter itens antigos durante CAPTCHA. Alterar contexto ou realizar nova leitura substitui o resultado anterior. As quebras de linha são preservadas no status acessível existente.

## Verificação local

Sem dependências, servidor ou instalação:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node --test extensao-leitura/adapter.test.mjs extensao-leitura/collector.test.mjs extensao-leitura/popup.test.mjs
```

Os testes usam dados fictícios e o identificador público de compra como fixture. Simulam o DOM e as APIs Chrome; não comprovam funcionamento em sessão real. Incluem seleção de elementos, avisos segmentados, invisibilidade, mudança de aba e edição durante a leitura.

## Arquivos

`adapter.mjs`: núcleo puro de validação. `collector.mjs`: coleta autocontida para execução manual na aba. `popup.*` e `manifest.json`: casca MV3. `*.test.mjs`: testes unitários e simulações das APIs.

## Referências oficiais

- [Permissão temporária activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): pode persistir em navegação da mesma origem; por isso cada leitura revalida URL e contexto.
- [Scripting API](https://developer.chrome.com/docs/extensions/reference/scripting): função injetada autocontida, somente no frame principal.
- [Privacidade de extensões](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy): permissões mínimas e ação explícita do usuário.

## Pré-validação de lote para cadastro (incremento isolado)

`prevalidacao-lote.mjs` exporta `validarLote(catalogo, linhas)`. Não está conectado ao popup ou portal. Recebe registros já parseados; não importa CSV/XLSX nem interpreta locale.

Catálogo: `{ id, quantidade, grupo: null | string, exigidos: ['marca', 'modelo', 'fabricante'] }`, com apenas as exigências aplicáveis. Linha: `{ id, quantidade, unitario, marca?, modelo?, fabricante?, grupo? }`. IDs são strings inteiras positivas de até 18 dígitos. Quantidade e unitário são strings positivas com ponto decimal, até 18 dígitos inteiros e quatro casas, sem milhar/expoente. Esses são limites do contrato local, não limites homologados do Compras.gov.br.

A associação usa ID, não posição. Quantidade e grupo precisam concordar com catálogo. Grupos selecionados exigem todos seus itens. Qualquer erro rejeita o lote inteiro, sem retorno de itens parcialmente aceitos. A composição oficial do catálogo deve ser obtida e conferida antes de futura integração.

Multiplicação com BigInt conserva até oito casas no total (`totalExato`), sem arredondamento. Se um total de item não for representável com quatro casas, `requerRevisaoPrecisao` sinaliza revisão obrigatória; `writeAuthorized` permanece sempre falso. Quantidades fracionárias são aceitas no contrato matemático local, sem alegar que a interface real permita a mesma precisão.

`lotesRevisao` divide os IDs aprovados em blocos de dez para planejamento local. Não informa posição atual no portal nem executa navegação. Fixtures de 206, 1.001 e 2.500 itens comprovam o cálculo local sem teto de mil; não comprovam capacidade de portal, transmissão ou usuários concorrentes.

Teste adicional: `node --test extensao-leitura/prevalidacao-lote.test.mjs`.

## Observação de CAPTCHA — 02/11/2026

Na aba real do cadastro, avançar a paginação abriu um desafio hCaptcha enquanto os itens da página anterior permaneceram visíveis. Isso não confirma avanço de página. Nenhum termo foi aceito e nenhuma proposta foi enviada.

O coletor reconhece o iframe visível observado (`https://newassets.hcaptcha.com`, título `Desafio hCaptcha`) e bloqueia a conferência. Um iframe visível dessa origem sem identificação conhecida deixa a coleta incompleta. Um frame sem área visual é ignorado. `aria-hidden` sozinho não comprova invisibilidade: a decisão usa área e CSS, incluindo ancestrais. Não acessa o conteúdo interno nem resolve o desafio.

Regressões locais cobrem desafio visível com `aria-hidden=true`, frame passivo 0×0 com retângulo presente e frame ambíguo. Suite de coletor, adaptador, popup e pré-validação: 38/38. Esses testes não substituem instalação e homologação no navegador; outros hostnames/provedores permanecem não verificados. A identidade do fornecedor e o catálogo real ainda precisam de adaptação própria.

## Canal MV3 preparado para QA (não ativado)

`ponte-worker.mjs` mantém o receptor em memória e separa a porta externa do SaaS da porta interna do popup. `ponte-cliente.mjs` oferece chamadas assíncronas ao popup existente. Remetente interno exige ID da própria extensão, URL exata de popup e nome da porta; externo exige a origem/caminho configurados e nome de protocolo. Uma porta interna ativa por vez. Timeout, fechamento e término do worker invalidam a sessão; não existe restauração de nonce/tentativa em storage. Respostas atrasadas e métodos de tentativa anterior não podem cancelar a seguinte.

`scripts/empacotar-extensao-leitura-qa.mjs` aceita um JSON com `origem`, `caminho`, `extensionId`, `publicKey` e um destino absoluto novo. Origem HTTPS exata, sem credenciais/wildcards/query/hash; caminho HTML exato; chave pública SPKI base64 canônica e ID derivado correspondente são obrigatórios. Lê e valida antes de escrever e recusa sobrescrever destino. Copia somente arquivos necessários e gera manifesto/worker QA no destino. Não modifica o manifesto fonte, não instala, não publica e não habilita o gate do backend. Só testes com chave descartável e origem fictícia foram executados; não foi gerado pacote para uma conta real.

Ainda faltam configuração real revisada, autorização para instalação, composição do gate backend, aplicação das migrações no ambiente autorizado e homologação Chrome real. Os testes de runtime usam doubles, não provam entrega de eventos por um service worker real nem concorrência PostgreSQL entre sessões.

Fontes oficiais consultadas via Context7:
- [Mensagens e portas](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Ciclo de vida do worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Externally connectable](https://developer.chrome.com/docs/extensions/manifest/externally_connectable)
- [Chave pública e ID estável](https://developer.chrome.com/docs/extensions/reference/manifest/key)
