# Bundle Cloudflare e smoke local — revisão antes do runtime

> **Adendo após revisão independente:** este documento registra a preparação inicial, não aprovada para runtime. Ver `revisao-pre-runtime.md` e `PRE-EXECUCAO-2.md`. Callback `outboundService` direto não bloqueia o caminho TCP do subprocesso; o watchdog dependia de `dispose`; a base dos hashes de inputs estava errada; e `editais_vistos.json` é histórico privado por destinatário. Rodadas 01/02 ficam privadas e não são candidatas à publicação. “45 inputs iguais” comparava nomes, não hashes. Nenhuma execução do Worker ocorreu sob essas premissas. Logs/evidências antigos foram preservados.

31/10/2026. Compilação local concluída; **Miniflare ainda não executado**. Nenhum arquivo do produto foi alterado, nem produção, autenticação, modelos, resumo, e-mail ou robôs.

## Pacotes isolados

Pasta base: `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031`.

| Rodada | Opção | Worker bruto | Worker gzip | SHA-256 |
|---|---|---:|---:|---|
| `rodada-01` | Padrão do comando local, sem minificação | 17.035.908 B | 3.418.954 B | `f8af5b15a18103bdf71aecec9d250d58126c94a73e3bd99bbaa1a11fcdd4e485` |
| `rodada-02-minificada` | Opção oficial `--minify` | 8.099.146 B | 2.798.266 B | `6a7d20c866cc4ae8179ca1de41d5035c2033e29db97b062b0c8be5880bbb3a5d` |

Ambos compilam **todas** as Pages Functions existentes, com Wrangler 4.151.1 já instalado, `2025-09-01` e `nodejs_compat`, sem cortar imports. Rotas geradas incluem `/api/*`. Logs sem erros/avisos. O tamanho local não comprova sozinho limite de CPU, inicialização, transformação do CI ou comportamento remoto. O comando `pages functions build` instalado define `minify: false` por padrão; a segunda rodada passa a opção explicitamente. Nenhuma configuração global/CI foi alterada.

Cada pacote contém 39 estáticos de raiz e os seis JSON de `data/` previamente inventariados; a lista precisa coincidir exatamente com `arquivosDaRaiz()` e a lista de dados, ou a preparação para. Não chama `montarPublico()`, não remove `publico/`, não copia QA, .env, brutos PNCP ou diretórios de homologação. Scanner recusa padrões de credenciais administrativas conhecidos; não substitui classificação humana de dados. Os 20 hashes protegidos coincidiram antes/depois de cada compilação.

`rodada-02-minificada/fontes-build.json` registra hashes dos inputs reais encontrados no metafile; módulos virtuais/temporários sem arquivo persistente ficam identificados como tais. `manifesto-estaticos.json`, `manifesto-worker.json`, `comando-build.json`, `resultado-build.json`, `build.*.log`, `metafile.json` e `routes.json` permitem conferir o pacote. Nenhum pacote foi enviado ao Cloudflare.

## Harness congelado para revisão

Arquivos nesta pasta:

- `preparar-cloudflare.cjs`: `4ecca635f67ecd375e007814e334009e2b35c182ed272b814cb0bfa552d4ea22`.
- `bloquear-rede-build.cjs`: `b95f99369756e3cc29f3d84f04cf093dadaea5230ccec03e18437bcea81a91a80`.
- `testar-worker.cjs`: `8f474fe2773c07a992c89df33867c34728aea36a55d40f8a8a3c5875855f06a7`.

Dez selfchecks offline passaram: destino/seleção/segredos, bloqueio de rede no build, fixture de rotas/métodos/tokens, filtro de CNPJ, PDF sintético previamente legível pelo parser Node, e bloqueio de conexão host externa. `node --check` dos dois scripts passou. Houve RED inicial pela ausência de cada implementação, seguido de GREEN; não houve execução do Worker nesses selfchecks.

Smoke proposto usa Miniflare 5.20261012.1-beta e o **Worker compilado inteiro**, nunca handlers substitutos. `outboundService` retorna apenas fixtures explícitas de Auth, REST e Storage; origem, rota, método ou token não previsto retorna 599 e faz a validação final falhar. Nunca encaminha requisição para rede. Sockets Node são restritos a loopback; novos subprocessos ficam restritos ao binário `workerd`, ocultos, rastreados e encerrados via `dispose()` com guarda de encerramento dos filhos próprios. ASSETS não tem fallback de rede.

**Auth, banco e Storage neste smoke são fictícios.** Isto complementa a homologação anterior com Supabase real em teste; não valida novamente SQL, RLS, transações, Storage remoto ou produção.

Escopo: só chamadas a `empresa-identificacao` e `kit-documentos`. Asserções para 503 desabilitado, 401 sem sessão, 403 não aprovado/papel leitura, gate fechado, outro CNPJ, identidade, leitura de PDF (fallback manual não conta como sucesso), confirmação com CNPJ divergente, consulta de itens, duas peças salvas/reabertas, prévia antes da revisão, revisão obrigatória, cálculo decimal 3,71, item não selecionado ausente, DOCX ZIP válido e preço alterado invalidando revisão. Saída `runtime/` deve ser nova; sem reutilizar evidência. Produtos reais são verificados por hash antes/depois.

Após revisão da coordenação, comando proposto, executado no worktree:

```powershell
$env:VOLTA_HOME='C:/Users/harre/AppData/Local/Volta'
node docs/qa/integracoes-producao-20261031/testar-worker.cjs --rodada rodada-02-minificada
```

Reprodução da compilação exige **outro nome de rodada novo**:

```powershell
node docs/qa/integracoes-producao-20261031/preparar-cloudflare.cjs --rodada nova-rodada --compilar --minificar
```

Sem deploy, login, update, download, Docker, interface nativa, segredos reais ou acesso a CNPJ Proprio. Em falha, parar, conservar evidências e diagnosticar sem modificar código protegido ou repetir publicação.
