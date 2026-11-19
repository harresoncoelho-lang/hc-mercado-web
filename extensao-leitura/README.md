# Adaptador de leitura — protótipo isolado

Preparado em código, **não instalado, publicado nem homologado no navegador real**. O canal de leitura tem integração local com UI/handler do kit, desativada por padrão. Não cadastra propostas nem envia lances. A integração reutiliza esses módulos existentes; não altera resumo, e-mail ou robô de boletins.

## Fluxo

O popup recebe o contexto esperado (CNPJ, UASG, número, ano e identificador da compra). Somente ao clicar em **Conferir leitura** solicita acesso temporário à aba atual, coleta os identificadores visíveis e compara esperado com observado. O resultado é uma amostra pontual; não representa conexão contínua, sessão autenticada certificada ou autorização para escrever.

O CNPJ é reconhecido pelo rótulo explícito `CNPJ do fornecedor:` ou pela estrutura específica do cabeçalho observada em 02/11: `DIV#usuarioAtual > DIV[role="tab"] > SPAN > SPAN.ml-1.text-nowrap`, com folha de identificação e estrutura verificadas. CPF, nome, CNPJ do órgão, valor digitado no popup e identificador da URL não substituem essa evidência. Ausência, ocultação ou ambiguidade impedem confirmação. A adaptação possui testes com DOM fictício; instalação e homologação da extensão real continuam pendentes.

## Limites e proteção

- Apenas URL HTTPS exata do cadastro de propostas do Compras.gov.br; validação antes e depois da coleta.
- Manifesto fonte: apenas `activeTab` e `scripting`, sem worker ou conexões externas habilitadas. Desde a 0.2.0 há também `optional_host_permissions` só para as origens de produção do LicitaPlena, concedidas só quando o usuário usa o modo "Gravar pregão" (ver abaixo). O pacote QA opt-in adiciona worker e uma origem/caminho explícitos; não adiciona permissões, rede, cookies ou armazenamento. O nonce fica no receptor/worker e retorna somente à página que iniciou a tentativa, nunca ao popup.
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

## Modo "Gravar pregão no LicitaPlena" (19/11/2026)

Decisão do dono: nada pago (sem Integra Compras) e **nunca contornar captcha**. A parte que só existe atrás de captcha é lida pela extensão no navegador do próprio usuário, com um clique dele. Contrato do endpoint e da leitura: `docs/pregao-gravado.md`.

Páginas suportadas (somente leitura):
- Compras.gov novo, página pública `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=<id>` (lista de itens) e `/item/{n}?compra=<id>` (propostas do item). O navegador do usuário resolve o hCaptcha invisível como em qualquer visita.
- ComprasNet antigo, ata completa `comprasnet.gov.br/livre/pregao/AtaEletronico.asp?...`, depois que o usuário digita o captcha de imagem. Essa ata é aceita também em **http** porque o próprio site antigo não tem https; risco: numa rede hostil a página pode ser alterada no caminho. A gravação vinda de http fica marcada como "fonte sem HTTPS" (`fonte_sem_https`). O Compras.gov novo só é lido em https.

Botão do popup (seção "Gravar pregão no LicitaPlena"):
1. **Ler esta página e gravar** — lê o HTML que a página já montou (`pregao-leitor.mjs`, `lerPaginaPregao`): por item, participantes (CNPJ, nome, UF, ME/EPP, situação), valores ofertado/negociado/proposta/total, quantidade, **marca/fabricante e modelo** de cada proposta aberta e o **chat** de cada fornecedor aberto (data/hora, texto, tipo e motivo; recusa, desclassificação e inabilitação aparecem destacadas). Na ata antiga lê também lances (inclusive os excluídos) e "Troca de Mensagens". O que não está aberto na tela volta como "não lido" e o popup lista os passos para o próprio usuário clicar, por exemplo `Abra o item 1 → fornecedor CHIKUT ... (26153737000138) → Chat e Proposta` ou `Abra o item 6 ("Visualizar propostas") → em cada fornecedor, Chat e Proposta`; depois ele clica de novo e a gravação mescla com a anterior.

**Sem modo automático** (decisão de 19/11, risco jurídico: o captcha existe para impedir consulta automatizada): a extensão não clica, não expande fornecedores e não navega item a item. `abrirDetalhesItem` continua em `pregao-leitor.mjs` atrás de `MODO_AUTOMATICO = false`, sem botão que a chame. **Não habilitar sem parecer jurídico.**

O que a extensão **não** faz: não chama as APIs do portal por conta própria, não lê nem reaproveita o token do hCaptcha, não resolve desafio, não roda em segundo plano, não envia proposta ou lance.

Envio: a extensão procura uma aba aberta do LicitaPlena (`licitaplena.com.br`, `www.`, `licitaplena.pages.dev`; o pacote QA acrescenta `http://127.0.0.1/*` do ambiente de teste) e executa nela `enviarNaPagina`, que pega a sessão Supabase que a própria página guarda (`sb-*-auth-token`) e faz `POST /api/pregao-gravado` na mesma origem. O token não sai daquela aba nem passa pelo popup; o CSP do popup continua `connect-src 'none'`. Sem aba logada, o popup pede para abrir o LicitaPlena.

Confiança: o que a extensão grava é "lido por usuário, não verificado" até 2 organizações lerem o mesmo valor; uma leitura nunca sobrescreve a de outro (ver `docs/pregao-gravado.md`). Só cliente com cadastro aprovado grava.

Privacidade: CPF nunca é gravado. Participante sem CNPJ vira `pf:<n>` com nome "Pessoa física"; CPF em texto livre (com ou sem pontuação, espaço ou "/") é mascarado na extensão e de novo no servidor, e os CHECKs do banco recusam CPF. Nome de MEI entra só porque é a razão social pública do CNPJ.

Permissões: além de `activeTab` + `scripting`, o manifesto declara `optional_host_permissions` só para o LicitaPlena de produção (enviar). O Chrome pede a autorização no primeiro clique; nada é concedido na instalação. `http://127.0.0.1/*` (site do ambiente de teste) entra só no pacote gerado por `scripts/empacotar-extensao-leitura-qa.mjs`.

O cartão "Licitação anterior" tem o bloco "Ver tudo do pregão (você resolve o captcha)": abre a página oficial (ata `AtaEletronico.asp?co_no_uasg=&uasg=&numprp=&codigoModalidade=5&Seq=1` ou "Acompanhar contratação"), mostra os 3 passos e o botão Atualizar. O passo a passo de instalação está publicado em `extensao.html`.

### Carregar em modo desenvolvedor (não publicado)

1. Chrome → `chrome://extensions` → ligue **Modo do desenvolvedor**.
2. **Carregar sem compactação** → escolha a pasta `extensao-leitura/` do repositório.
3. Fixe o ícone. Abra o LicitaPlena logado numa aba de produção. Para testar contra `PORTA_TESTE=8793 node ambiente-teste/servidor.cjs` (`http://127.0.0.1:8793`, banco de `ambiente-teste/subir.cjs`), carregue o pacote QA (com `127.0.0.1`), ou acrescente `http://127.0.0.1/*` à cópia local do manifesto — nunca ao manifesto fonte.
4. Em outra aba, abra o pregão no Compras.gov, clique no ícone → "Gravar pregão no LicitaPlena". Aceite a permissão de site quando o Chrome pedir.
5. Para atualizar depois de mudar o código: botão de recarregar no card da extensão em `chrome://extensions`.

Não foi instalada no navegador do usuário nem homologada em navegador real; a leitura do Compras.gov foi conferida contra o DOM real capturado em 19/11 (fixture), a da ata antiga só contra fixture sintética (a ata real exige o captcha de imagem).

### Testes

```powershell
node --test extensao-leitura/pregao-leitor.test.mjs netlify/functions/__tests__/pregao-gravado.test.js
node docs/qa/integracao-20261118/testar-dezembro.cjs   # inclui supabase/pregoes_gravados.sql + testar_pregoes_gravados.sql
```

Fixtures em `fixtures/`: `comprasgov-item-19302805900082025-1.html` e `comprasgov-lista-19302805900082025.html` (recortes reais da página pública, só pessoas jurídicas) e `comprasnet-ata-sintetica.html` (estrutura modelada, empresas e CPF fictícios).

## Modo "Preencher proposta" (assistido, 19/11/2026)

Pedido do dono: subir o lote (ou uma planilha) e a extensão preencher o cadastro de propostas. Na página `.../comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=<17 dígitos>` (usuário já logado, termo e declarações aceitos **por ele**), o botão **Preencher esta página** casa cada cartão (`div.cp-itens-card`, número em `app-identificacao-item`) com o lote e preenche, com setter nativo + eventos `input`/`change`/`blur` (o Angular exige), `input-quantidade-ofertada` (máx. 12), `input-valor-proposta` (máx. 18; formato `10,5000`, vírgula e 4 casas, sem milhar), `input-marca-fabricante` (marca e fabricante juntos como `Marca / Fabricante`, máx. 50) e `input-modelo-versao` (máx. 50).

**Nunca faz:** clicar Salvar, marcar o termo ou as declarações Sim/Não, resolver captcha, trocar de página, chamar a API do portal. O único clique é na seta `btn-expandir-proposta`, e só quando os campos ainda estão fechados (se continuam fechados, o item vai para "campos fechados" e o popup manda o usuário aceitar o termo). O usuário confere e salva cada item; depois vai à próxima página (o portal pede captcha).

Item não preenchido (e listado com motivo): valor abaixo do `preco_minimo` do usuário; valor acima do `valor-estimado-item` do portal (comparação exata em inteiros de 4 casas); valor inválido; marca/fabricante, modelo ou quantidade acima do limite (nunca corta em silêncio); campo de valor já com outro conteúdo; a máscara do portal reformatou o valor (relido após escrever). Item com `situacao-item` diferente de "Proposta não cadastrada" é só contado ("já no portal"). Também lista itens da página fora do lote e itens do lote que não estão na página.

Fontes do lote: (1) **Buscar lote no LicitaPlena** — `GET /api/proposta-lote?compra=<17 dígitos>[&processo=<uuid>]` (`netlify/functions/proposta-lote.js`, registrado em `functions/api/[nome].js`), logado e aprovado, só leitura com o token do usuário (RLS), cota 300/dia; acha o processo por UASG + número/ano da compra, devolve `{ok, processo, itens:[{item, quantidade, valorUnitario, marca, modelo, fabricante, valorMinimo}]}` só dos itens com valor, ou `{escolher:[...]}` se houver mais de um processo, ou `processo:null`. A extensão lê pela aba logada do LicitaPlena, como no modo Gravar (token não passa pelo popup). (2) **Planilha CSV** no padrão de `planilha-itens.js` (`;`, cabeçalho com `item` e `valor_unitario`, vírgula decimal, sem milhar).

Diário: `localStorage` do popup, por compra (`lp-preencher-diario:<compra>` e `lp-preencher-lote:<compra>`): item `preenchido` (nós preenchemos) ou `salvo` (a página já mostra a situação diferente de "não cadastrada"). O popup mostra "Já preenchidos: N de M" e, depois de o portal cair, basta reabrir a página e clicar de novo: itens já salvos são pulados, os demais são refeitos. Sem permissões novas (`activeTab`, `scripting`; host do LicitaPlena é opcional e pedido no clique); sem `MODO_AUTOMATICO`.

Arquivos: `preencher-proposta.mjs` (CSV, diário, funções injetadas, resumo), `preencher.mjs` (popup), fixture `fixtures/comprasgov-cadastro-propostas.html` (montada do mapa `_historico/mapa-cadastro-proposta-comprasgov-20261118.md`, não capturada do portal). Testes: `node --test extensao-leitura/preencher-proposta.test.mjs netlify/functions/__tests__/proposta-lote.test.js` (DOM mínimo próprio, sem navegador).

Não homologado no portal real. Suposições a confirmar com 1 item real: número do item é o primeiro `span` de `app-identificacao-item`; o formato `10,5000` é aceito pela máscara monetária (a releitura acusa se não); o Angular aceita o valor com esses eventos; abrir a seta mostra os campos sem outro gesto. Planilha: o seletor de arquivo pode fechar o popup em alguns Chromes (reabra: o lote lido fica guardado).
