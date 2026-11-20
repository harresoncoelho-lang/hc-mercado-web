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

## Modo "Acompanhar chat" (19/11/2026)

Alerta quando o pregoeiro escreve, no pregão que o usuário **já tem aberto**. Decisões do dono: nada pago e nunca contornar captcha.

Fluxo: popup → "Acompanhar chat" (CNPJ e nome da empresa, som, gravar) → **Acompanhar este pregão**. O popup injeta `vigiarChat` (`acompanhar-chat.mjs`) na aba ativa; o script observa o DOM com `MutationObserver` (debounce de 300 ms), lê `.mensagens-texto`/`.mensagens-data` (seletores da página pública mapeada em 19/11) e avisa o service worker (`acompanhar-worker.mjs`) por `chrome.runtime.sendMessage`, que mostra a notificação e o badge. Um clique do usuário inicia; **Parar de acompanhar** encerra.

Regras:
- Alerta só para mensagem **nova** (aparecida depois do clique) e que não seja de participante. As que já estavam na tela são marcadas como vistas. Mensagem cuja hora no portal é mais de 30 min anterior ao agora, ao aparecer, é tratada como histórico aberto pelo usuário e não alerta (custo: computador dormindo por mais de 30 min perde o alerta daquela mensagem). Hora do portal lida como UTC-3.
- Destaque (notificação "IMPORTANTE", fica na tela até o clique, badge vermelho): cita o CNPJ (14 dígitos, com ou sem pontuação) ou o nome informado; ou contém convocação, anexo, prazo, recusa, desclassific-, inabilit-, diligência, habilitação, suspens-/suspend- (suspensão) ou aceit- (aceite/aceito/aceita). Com som ligado, mensagem importante também dá um bipe na própria aba (Web Audio), independente do som de notificação do sistema. Trecho de até 200 caracteres ao redor do primeiro termo, com a hora; CPF mascarado.
- Não duplica: chave = hora + texto; novo clique na mesma compra preserva o já visto.
- Para e avisa "Parei de acompanhar" quando: a rota sai da compra/página suportada (checada a cada 3 s, o Angular troca rota sem recarregar), a página mostra "sessão expirada/encerrada". Trocar de item dentro da mesma compra continua.
- **Reconexão (0.4.0):** `pagehide` manda `parou/recarregou`. Se o usuário aceitou a permissão opcional do portal (pedida no clique "Acompanhar"), o worker guarda a aba em `chrome.storage.session`, mostra "…" no ícone e, quando a aba termina de carregar (`tabs.onUpdated` complete), injeta `vigiarChat` de novo com `chave` (só a MESMA compra) e `desde` (mensagens desde a queda alertam já na 1ª leitura). Voltou sem chat na tela: aviso "não vejo o chat". Outra página, página de erro, sem permissão, aba fechada ou mais de 5 recargas em 10 min: "Parei de acompanhar".
- O script **não** faz requisição (nem `fetch`/XHR/WebSocket/beacon), não recarrega, não navega, não clica, não toca em captcha; os testes armadilham essas APIs e checam o código-fonte.
- Gravar no LicitaPlena é opcional (caixa desmarcada por padrão; pede a permissão de site do LicitaPlena no clique). Ao alertar, o worker (no máx. 1 vez a cada 30 s por aba) lê a página com o mesmo `lerPaginaPregao` e envia com `enviarNaPagina` pela aba logada do LicitaPlena para `/api/pregao-gravado`: mesma regra de CPF, aprovação e confiança do modo "Gravar pregão". Na sala de disputa (página não suportada pelo leitor) avisa que não gravou; o alerta segue.

Permissões (manifesto 0.4.0): `activeTab` + `scripting`: acesso temporário só à aba onde o usuário clicou e injeção do vigia; `notifications`: única forma de mostrar o aviso fora da aba; `storage` (sem aviso na instalação): só `chrome.storage.session` para a reconexão (some ao fechar o navegador); opcional `https://cnetmobile.estaleiro.serpro.gov.br/*`: pedida no clique "Acompanhar", só para reinjetar o vigia depois que a página recarrega (activeTab se perde na recarga); recusar não impede acompanhar. O worker só reage a mensagens do próprio script da extensão (checa `sender.id` e aba) e não tem rede. Sem `tabs`, `alarms`, `host_permissions`, `<all_urls>` nem 127.0.0.1 (este só no pacote QA e na cópia do teste no Edge).

Limitações honestas:
- Precisa da aba aberta e do computador ligado; fechar a aba, suspender o computador, ou o navegador "dormir" a aba interrompe o aviso sem nenhum alarme. Fechar o navegador não avisa nada.
- Se o portal cair com a mesma URL (tela de erro sem sair da rota) e não mostrar "sessão expirada/encerrada", o script não percebe: sem mensagens, sem alerta e sem "parei". Se navegar para outra URL, avisa.
- Mensagem que chegou e saiu da tela durante a recarga não é vista (só o que a página mostra depois de recarregar). Mensagens do mesmo minuto da queda podem alertar duas vezes (preferimos repetir a perder).
- **A sala de disputa do fornecedor logado não foi mapeada**: aceito o prefixo `/comprasnet-web/seguro/fornecedor/`, mas os seletores do chat são os da página pública. Se a sala usar outras classes, nada é detectado. Precisa de um teste real (1 pregão) para confirmar seletores e a classe que distingue mensagem de participante.
- Só chat visível/aberto na tela é lido (na pública, o chat de cada fornecedor só existe depois de aberto pelo usuário).
- Som: o da notificação do sistema (`silent` quando desmarcado), sujeito ao "Não perturbe"; o bipe da aba depende de o usuário já ter clicado na página (regra de autoplay).
- Carregada no Edge real (Playwright) contra a fixture servida no endereço do portal: notificação, badge, reconexão e "parei" conferidos. **Nunca rodou na sala de disputa real.**

Testes: `node --test extensao-leitura/acompanhar-chat.test.mjs` (21 casos: detecção, destaques, sem duplicar, parada, reconexão, sem rede, worker, manifesto). Ícone da notificação: `icone.png`.

## Sala de disputa (robô de lances) — só interface

`sala-disputa.mjs` documenta o contrato do futuro leitor da sala de disputa (melhor valor, meu valor, situação, etapa, tempo restante por item) e devolve sempre `{ ok: false }` com "não implementado — precisa da sala real". Não está ligado ao popup nem ao worker, não pede permissão nova e não clica, preenche ou navega. O robô de lances do LicitaPlena é **assistido**: sugere o lance na tela do processo e a pessoa envia no portal. Pesquisa e pendências: `_historico/robo-lances-20261120.md` (pasta do projeto, fora do repositório).

## Modo diagnóstico (0.4.0)

Quando um fluxo não reconhece a página do portal, o popup mostra a seção **Página não reconhecida** com **Enviar diagnóstico** (só com clique do usuário). Gatilhos: gravar → `sem_dados`/`pagina_nao_suportada` numa página do portal (captcha não conta); preencher → `sem_itens`, alerta `campos_ausentes` ou `mascara`; acompanhar → `pagina_nao_suportada` no portal ou vigia iniciado com **0 mensagens** na tela (sala de disputa com seletor diferente).

- `diagnostico.mjs` / `estruturaPagina` (injetada, autocontida): recusa qualquer host fora de `cnetmobile.estaleiro.serpro.gov.br`/`comprasnet.gov.br`. Guarda até 4000 elementos: tag, profundidade, id, classes (sem as geradas `ng-*`/`_ng*`), atributos de uma allowlist (`data-test`, `role`, `type`, `name`, `for`, `aria-label`, `placeholder`, `title`, `maxlength`, `formcontrolname`), host do `iframe`, caminho do `a` (sem query), `preenchido: true/false` dos campos (**nunca o valor**) e texto só de `label/legend/th/button/caption/summary/dt` (60 caracteres; `option` nunca, pode ter razão social). Toda sequência de 5+ dígitos vira `#` (CPF, CNPJ, telefone). Conta os seletores de que o fluxo depende (`seletores`), o que já aponta qual sumiu.
- Envio pela aba logada do LicitaPlena (`enviarDiagnosticoNaPagina`) para `POST /api/extensao-diagnostico` (`netlify/functions/extensao-diagnostico.js`): login + cadastro aprovado, 20/dia, refaz a allowlist de chaves, mascara de novo com `_cpf.js` e recusa se ainda sobrar algo com cara de CPF. Tabela `extensao_diagnosticos` (`supabase/extensao_diagnosticos.sql`, só service_role, CHECK anti-CPF; **rodar no SQL Editor de produção antes de publicar**). A equipe lê pelo SQL Editor.

## Empacotar para instalar (0.4.0)

`npm run empacotar:extensao` gera `dist/licitaplena-extensao-<versão>.zip` (`dist/` no .gitignore). `scripts/empacotar-extensao.mjs` confere o manifesto (MV3, versão X.Y.Z, permissões só da allowlist, sem `host_permissions`/`content_scripts`/`key`/127.0.0.1/curinga, CSP `connect-src 'none'`, `MODO_AUTOMATICO = false`) e junta só os arquivos alcançáveis a partir do manifesto (popup, worker, ícones e seus imports); arquivo faltando, import externo ou teste/fixture referenciado abortam. O pacote QA (`empacotar-extensao-leitura-qa.mjs`) usa a mesma descoberta. Passo a passo para leigo e roteiro do primeiro teste real: `extensao.html`.

## Teste com a extensão carregada no Edge

`PORTA_TESTE=8831 node ambiente-teste/servidor.cjs` e depois `SITE_TESTE=http://127.0.0.1:8831 node ambiente-teste/e2e-extensao.cjs`: copia o pacote para uma pasta temporária (acrescenta `host_permissions` do portal e do site local, só na cópia), abre o Edge com `--load-extension`, serve as fixtures no endereço real do portal por `context.route` (nada sai para o governo) e confere gravar, preencher (sem clicar Salvar), diagnóstico até o banco local (sem CPF) e acompanhar (notificação, badge, reconexão após recarregar, "parei" ao sair). 6/6 em 20/11/2026.

## Pontos frágeis conhecidos (revisão de 20/11/2026)

| Fluxo | Ponto frágil | Efeito se o portal mudar | Proteção hoje |
|---|---|---|---|
| Gravar (Compras.gov) | Tags Angular `app-*` (`app-dados-proposta-item-em-selecao-fornecedores`, `app-detalhes-proposta-item`, `app-mensagens-chat-lista`), `data-test` (`item`, `identificacao-participante`, `situacao-proposta`) e classes `cp-valor-item*`/`cp-texto-item-08` | `sem_dados` ou propostas sem valor/marca | `sem_dados` → diagnóstico |
| Gravar | Rótulos exatos ("valor ofertado (unitario)", "marca/fabricante", "modelo/versao") | campo `null` sem erro | **nenhuma** (silencioso; conferir no 1º teste) |
| Gravar | URL `?compra=` com 17 dígitos e caminho `acompanhamento-compra(/item/N)` | `pagina_nao_suportada` | diagnóstico |
| Gravar (ComprasNet) | Textos "Pregão Eletrônico Nº", "Item:", "Troca de Mensagens", "Eventos do Item", "Propostas", "valor unit" e colunas Porte/Quantidade | `sem_dados` ou item sem propostas | `sem_dados` → diagnóstico |
| Gravar | Página ainda carregando (Angular renderiza depois do `load`) | `sem_dados` | mensagem "espere carregar e clique de novo" |
| Preencher | `div.cp-itens-card`, `app-identificacao-item span` (nº do item), `data-test` dos 4 inputs, `situacao-item` "Proposta não cadastrada" | `sem_itens`, `campos_ausentes`, ou item tratado como "já cadastrado" se o texto da situação mudar | diagnóstico nos dois primeiros; o terceiro é **silencioso** |
| Preencher | Máscara monetária do valor (relê o campo) | alerta `mascara`, item não preenchido | diagnóstico |
| Preencher | Formulário abre só depois da seta (espera 1,5 s) | `camposFechados` em rede lenta | mensagem pede aceitar termo e clicar de novo |
| Preencher | O que o "Salvar" faz (API, mensagem, captcha) nunca foi visto | — | depende do teste real |
| Acompanhar | `.mensagens-texto`/`.mensagens-data` e classe `participante`/`fornecedor` (separa mensagem do licitante): **mapeados só na página pública** | 0 mensagens na sala de disputa; mensagens do próprio fornecedor podem alertar | aviso "0 mensagens" + diagnóstico |
| Acompanhar | Data "dd/mm/aaaa hh:mm" (Brasília) | sem data: alerta sem hora; janela de 30 min não se aplica | — |
| Acompanhar | Texto "sessão expirou/expirada/encerrada" | logout sem esse texto não para | "parei" se a rota mudar |
| Todos | Portal instável pede recarregar | vigia some; preencher perde o que não foi salvo | reconexão do vigia; diário do preencher |
