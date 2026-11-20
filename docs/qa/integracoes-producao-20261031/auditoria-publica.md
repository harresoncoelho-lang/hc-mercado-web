# Produção: observação pública antes das integrações

Consulta em 31/10/2026, aproximadamente 02:48–02:49 UTC. Escopo: sete GETs públicos sem cookies, sessão ou Authorization, mais DNS público. Nenhum POST, SQL remoto, login, escrita em produção, publicação, browser ou chamada a resumo, e-mail, IA ou robôs.

## Conclusão

O site responde publicamente atrás de Cloudflare, mas o incremento de documentos e propostas homologado localmente **não está disponível nas rotas e assets consultados**. Isso é compatível com a decisão de não publicar. Não permite concluir que tabelas, políticas ou segredos estejam ausentes no backend.

| Recurso consultado | Evidência | Interpretação limitada |
|---|---|---|
| `https://licitaplena.com.br/` | HTTP 200, `text/html`, 22.220 bytes | Landing disponível. |
| `https://licitaplena.com.br/operacao` | HTTP 200, `text/html`, 31.380 bytes | Página estática disponível; corpo sem os novos scripts de identificação/kit. Não executamos a aplicação ou login. |
| `https://licitaplena.com.br/processos` | HTTP 200, `text/html`, 54.847 bytes | Página estática disponível; corpo sem os novos scripts do kit. |
| `https://licitaplena.com.br/api/kit-documentos` | HTTP 404, `application/json`, objeto com chave `erro` | A rota consultada não entrega o handler local esperado. Não é HTML da landing disfarçado de sucesso. |
| `https://licitaplena.com.br/api/empresa-identificacao` | Mesmo HTTP 404 JSON e hash da rota anterior | A identificação também não está exposta nessa rota consultada. |
| `https://licitaplena.com.br/kit-documentos-ui.js` | HTTP 200, porém `text/html`; mesmo tamanho e SHA-256 da landing | É fallback HTML, não JavaScript servido. HTTP 200 isolado não comprova implantação. |
| `https://licitaplena.com.br/operacao-identificacao.js` | Mesmo fallback HTML | O arquivo de integração não está disponível como JavaScript nessa URL. |

O SHA-256 da landing e dos dois fallbacks é `27bb3686804ef575a2cdb9c50d70d69579159b68a833ff2db5507000881bc48e`. Os fallbacks retornaram `Cache-Control: max-age=14400` e `CF-Cache-Status: MISS`. Depois de uma publicação autorizada, a verificação precisa conferir MIME e conteúdo dos assets, inclusive a possibilidade de cache do fallback; nenhum cache foi purgado nesta etapa.

## Plataforma e cabeçalhos

- DNS NS: `ram.ns.cloudflare.com` e `zariyah.ns.cloudflare.com`. A/AAAA retornaram endereços da rede Cloudflare; todas as respostas HTTP tinham `Server: cloudflare` e `CF-Ray`.
- Isso comprova a borda/proxy Cloudflare, não identifica por si só a conta, o projeto Pages, o commit publicado ou o origin atrás do proxy.
- O arquivo local `wrangler.toml` aponta Cloudflare Pages, projeto `licitaplena`, saída `publico`, `nodejs_compat` e data de compatibilidade `2025-09-01`. São intenções da configuração local, ainda sem comparação autenticada ao painel do provedor.
- Nas páginas HTML observamos HSTS, CSP, `X-Frame-Options: DENY` e `X-Content-Type-Options: nosniff`. Nos dois 404 JSON esses cabeçalhos não estavam presentes. Esse recorte não é uma auditoria completa dos cabeçalhos de Functions nem da segurança do site.

## O que precisa ser preparado ou comprovado

| Item | Estado comprovado | Próxima prova necessária, antes de liberar produção |
|---|---|---|
| Pacote estático e rotas do módulo | Código local contém rotas e arquivos; URLs públicas ainda não entregam o incremento | Preparar artefato isolado, conferir referências/MIME e compilar Functions sem publicar. Não executar o build atual na árvore compartilhada sem proteger `publico`, pois o script o recria. |
| Ambiente de execução | Local usa handlers CommonJS com adaptador Pages | Provar compatibilidade no runtime alvo e a entrega de DOCX binário, sem alterar handlers protegidos. O Node usado na homologação não substitui essa prova. |
| Projeto publicado e ambiente | Nome local conhecido, estado real da conta não consultado | Comparar projeto/domínio/ambiente, versão publicada e configurações efetivas com leitura autenticada do provedor, sem mudar valores. |
| Configuração Supabase | Adaptadores locais apontam projeto fixo; não foi feita chamada ao Supabase de produção nesta auditoria | Conferir destino de Auth, REST, Storage e RPCs sem misturar ambientes. Qualquer configuração de homologação precisa permanecer separada do projeto atual. |
| Segredos e chave de serviço | Valores e inventário do provedor não consultados | Confirmar presença e escopo apenas no servidor; não expor valores em relatório, pacote estático ou navegador. Não há evidência para afirmar que estão ausentes. |
| Feature flag | Handlers locais exigem `IDENTIFICACAO_EMPRESA_LOCAL=1` depois da checagem de método | Verificar configuração remota em leitura. GET 404 não informa o valor da flag e não justifica ativá-la agora. |
| Schema, RLS, RPC e Storage privado | Homologação local aprovada; nenhum SQL ou dado remoto consultado | Conferir gates e pré-requisitos no ambiente remoto autorizado antes de aplicar migração. Não presumir que o schema reconstruído é igual ao de produção. |
| Backup e retorno à versão anterior | Backups locais com índice/hash validados; restauração não ensaiada | Identificar backup remoto, ensaio de restauração e versão anterior para rollback; preparar sequência sem executá-la nesta etapa. |
| Aprovação comercial | Não é comprovada por esta auditoria | Planos, cobrança, suporte e demais lacunas continuam na matriz de prontidão; este módulo isolado não torna o SaaS inteiro pronto para venda. |

## Evidências e limites

- `producao-publica-evidencias.json`: UTC, URL, status, MIME, cabeçalhos selecionados, tamanho, hash e presença de marcadores. Corpos das páginas não foram persistidos.
- `dns-publico.json`: registros DNS consultados.
- Fontes locais lidas: `CLAUDE.md`, `wrangler.toml`, `functions/api/[nome].js`, `scripts/montar_publico.js`, handlers de identificação/kit e relatórios de homologação/prontidão.
- Não foram lidos segredos, dados de clientes, painel autenticado do provedor ou configuração remota do Supabase. Não houve tentativa de contornar autenticação. Nenhum arquivo de produto foi alterado por esta auditoria.

Esta observação descreve o momento da coleta e pode ficar desatualizada após uma implantação. A conclusão correta é “incremento não observado nessas rotas públicas”, não “banco inexistente”, “integração quebrada” ou “produção pronta”.
