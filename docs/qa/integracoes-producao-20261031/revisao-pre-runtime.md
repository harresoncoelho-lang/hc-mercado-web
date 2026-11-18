# Revisão independente antes do runtime

31/10/2026. Revisão do snapshot congelado em `PRE-EXECUCAO.md`, antes de qualquer execução de Miniflare. Carga considerada: uma execução local do smoke, com Auth, REST e Storage fictícios. Nenhum código do produto foi alterado por esta revisão.

**Parecer: não executar o harness congelado. Corrigir 1 e 4 antes do runtime; corrigir 2 e 3 antes de tratar o pacote como candidato publicável ou prova de integridade das fontes.** Nenhum achado autoriza publicação, alterações em produção ou mudança dos handlers protegidos.

## Achados

1. **[P1] TCP do workerd pode contornar a fixture de rede** — `testar-worker.cjs:63–68,85`.

   `outboundService: f.outbound` controla requisições HTTP, mas não fecha todo o tráfego do subprocesso. No Miniflare instalado, `dist/src/index.js:120943–120957` cria o serviço do callback com `connect_pass_through` e sem `globalOutbound` explícito; `121306–121326` aplica a mesma passagem ao interceptor anterior. O padrão de `globalOutbound` é `internet`. Assim, uma chamada TCP do bundle, por exemplo `cloudflare:sockets.connect()`, pode atravessar os dois serviços sem chamar a fixture. O patch de `net.Socket.prototype.connect` existe somente no processo Node e não intercepta o workerd nativo. A [definição oficial da flag](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/compatibility-date.capnp) confirma esse comportamento. Não fiz conexão nem executei essa prova no runtime.

   Correção mínima: colocar um Worker auxiliar exclusivo de QA entre o produto e o callback, sem passagem de CONNECT e com saída de rede negada explicitamente. Inspecionar/testar a configuração gerada antes de executar. Completar também a proteção do host contra DNS e UDP: o guard atual do runtime não altera `node:dns` nem `node:dgram`; o preloader do build bloqueia UDP, mas deixa DNS explícito disponível. Os selfchecks existentes cobrem TCP do host, não essa fronteira do workerd.

2. **[P1] A seleção estática inclui histórico por destinatário** — `preparar-cloudflare.cjs:11,57–68`.

   `data/editais_vistos.json` está em `DADOS` e foi copiado para `static/data` nas duas rodadas. O arquivo contém duas chaves de e-mail, incluindo uma conta real, associadas a histórico de editais. O scanner de credenciais não detecta essa classificação de dado. Coincidir com a lista do builder existente não torna o conteúdo adequado à publicação.

   Correção mínima: excluir esse histórico da seleção pública em uma rodada nova e documentar a exclusão deliberada. Preservar a fonte e as rodadas anteriores como evidência privada; não apagar histórico nem alterar o robô. Não houve vazamento remoto nesta tarefa: os pacotes permanecem locais. O bloqueio é à classificação/publicação desse pacote, não à leitura local de fixtures.

3. **[P2] O manifesto de fontes resolve caminhos na base errada** — `preparar-cloudflare.cjs:82–83`.

   O metafile contém caminhos relativos à pasta `functions`, como `../netlify/functions/kit-documentos.js` e `api/[nome].js`. Resolver contra a pasta da rodada marca fontes reais como `virtualOuTemporaria: true`. Na rodada minificada, 446 inputs foram registrados, apenas 33 com hash; os 45 JavaScript do produto e `knowledge-defesa.json` ficaram sem hash. A rodada 01 não contém `fontes-build.json`.

   Os dois metafiles têm os mesmos 45 nomes de JavaScript do produto e os mesmos tamanhos de entrada, mais o mesmo JSON. Isso não comprova conteúdo idêntico: alterações podem preservar tamanho. Correção mínima: usar a base efetiva do compilador, identificar os módulos realmente virtuais e recusar fonte real ausente. Uma captura corrigida posterior deve declarar sua data e não se apresentar como hash capturado durante os builds antigos. Preservar o manifesto original e limitar a conclusão de `comparacao-minificacao.md`.

4. **[P2] O encerramento de emergência depende do encerramento que deveria proteger** — `testar-worker.cjs:70,81,131–134`.

   O temporizador de 120 segundos apenas chama `dispose()`. O `finally` aguarda `dispose()` antes de chamar `encerrarFilhos()`. Se esse encerramento ficar pendente, a guarda de filhos nunca é alcançada e o limite não encerra a execução. No fallback de dois segundos, `child.kill()` resolve a espera imediatamente, antes do evento `exit`; um único `setImmediate` não garante a saída do processo.

   Correção mínima: watchdog independente que encerre somente os PIDs filhos registrados, mesmo com `dispose()` pendente; aguardar `exit` depois do kill com prazo explícito. Acrescentar selfcheck offline com `dispose()` pendente e saída tardia do filho. Não é necessário iniciar workerd para verificar essa lógica.

## Verificações concluídas

- Os hashes dos três scripts coincidiram com o snapshot congelado: preparação `4ecca635f67ecd375e007814e334009e2b35c182ed272b814cb0bfa552d4ea22`, bloqueador `b95f99369756e3cc29f3d84f04cf093dadaea5230ccec03e18437bcea81a91a80`, harness `8f474fe2773c07a992c89df33867c34728aea36a55d40f8a8a3c5875855f06a7`.
- Executei somente `node --test docs/qa/integracoes-producao-20261031/preparar-cloudflare.test.cjs docs/qa/integracoes-producao-20261031/testar-worker.test.cjs`: **10 testes passaram**. Não executam Miniflare, Wrangler, Docker ou serviços remotos.
- Os 45 estáticos de cada rodada coincidem com os respectivos hashes e com as fontes atuais. Os 20 arquivos protegidos coincidem com a baseline. O builder destrutivo `montarPublico()` não é chamado pela preparação.
- Recalculei bytes, gzip e SHA-256 dos dois bundles: coincidem com `PRE-EXECUCAO.md`. Nenhuma pasta `runtime` existia nas duas rodadas durante a conferência.
- O smoke usa o bundle inteiro e só despacha as duas rotas autorizadas. Asserções de PDF, revisão, cálculo decimal, seleção de itens e conteúdo DOCX correspondem ao fluxo real dos handlers lidos. ASSETS lança erro; não faz fallback externo. A fixture recusa origem, rota, método e token inesperados.

## Limites

Não executei runtime, build, UI nativa, deploy, SMTP, SQL remoto, robôs, IA externa ou CNPJ Proprio. Consultas externas desta revisão limitaram-se à documentação pública do workerd/Context7, sem conteúdo privado. A fixture aceita subconjunto de filtros REST e não valida `apikey`, SQL, RLS, transações, concorrência ou Storage real; essas limitações impedem usar o smoke como prova desses controles. O gzip local não comprova implantação, orçamento de CPU, inicialização ou transformação pelo CI. Correções posteriores aos hashes acima exigem nova revisão do trecho alterado.
