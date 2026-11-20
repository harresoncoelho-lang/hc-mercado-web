# Validação independente — KitProposta build v39 / catálogo declarado 40

Data local: 30/10/2026. Resultado: integridade aprovada; suítes fornecidas passam; aceitação funcional com ressalvas por quatro achados reproduzidos. Nenhum arquivo do produto/DS foi alterado.

## Escopo e origem

Entrega lida em `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v39-20261030/revisao_pecas_salvas_kitproposta_v39`.
Comparação independente com o readback anterior real em `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v38-evidencias-corrigidas-20261030/revisao_pacote_kitproposta_v38_evidencias_corrigidas/7_readback_final/project`.

LEIA-ME, manifesto, comparação protegida, ambos os diffs, t_docs.js, t_pacote.js, run_tests.sh, README e caminhos relevantes do código final foram lidos antes de executar a entrega. O número de catálogo 40 é declarado pelo pacote; não houve consulta independente ao catálogo ao vivo. Não há grafo Graphify nessa extração; não foi criado grafo, índice nem subagente nesta validação limitada.

## Integridade

- 80/80 entradas do MANIFESTO_SHA256.txt conferem; nenhum arquivo listado ausente e nenhum extra além do próprio manifesto.
- 9/9 arquivos da baseline v38 coincidem byte a byte com o readback anterior real.
- Os sete protegidos finais coincidem com baseline e readback anterior: ResumoCompleto, SummaryFull, JornadaIntegrada, BoletimOportunidades, InteligenciaHub, tokens.json e design-system.json.
- Somente preview.html e README.md do KitProposta diferem entre os nove arquivos finais e a baseline.
- A árvore original completa, incluindo o manifesto, foi novamente verificada ao final: 81/81 arquivos preservados, sem adições/remoções.

Provas: `hash-verification.json`, `original-tree-before.json`, `original-tree-after-verification.json`.

## Execução isolada

Node v24.22.0; Edge headless 156.0.4314.50; Playwright já instalado em `C:/Users/harre/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`.

Nenhuma instalação. Nenhum acesso à UI, perfil ou navegador do usuário. Perfis temporários isolados. Nenhuma produção, PNCP, CNPJ Proprio ou integração externa. Rede do conteúdo bloqueada por interceptação (somente file/data/blob permitidos), service workers bloqueados e proxy do navegador apontado para 127.0.0.1:9, com recursos de rede de fundo desativados. Auditoria das execuções registrou zero pedidos externos e zero pageerrors. Isso não é captura de tráfego do sistema operacional.

Os scripts originais foram copiados intactos para `original-tests`. Nas cópias de `adapted-tests`, apenas o import do Playwright foi trocado pelo launcher isolado e a montagem da URL file foi adaptada com pathToFileURL. O CSS do harness foi copiado byte a byte. Os dois patches de adaptação estão na raiz desta evidência. O wrapper Bash foi lido, mas não executado no Windows: `run-suite.ps1` chama a mesma suíte e registra stdout e exit code. Não há alteração de asserções nos testes fornecidos.

Comandos reproduzíveis nesta pasta:

```powershell
.\run-suite.ps1 docs
.\run-suite.ps1 negative
.\run-suite.ps1 pacote
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node .\adapted-tests\independent-checks.js
```

| Execução | Resultado observado | Código |
|---|---|---:|
| t_docs.js | 41 PASS, 0 FAIL | 0 |
| t_docs.js, NEG_CONTROL=1 | 41 PASS, depois FAIL NEG controle deliberado | 1 esperado |
| t_pacote.js | 162 PASS, 0 FAIL | 0 |
| Casos independentes | 1 PASS, 8 FAIL, agrupados nos quatro achados abaixo | 1 |

No controle negativo, o script original imprime SUMMARY antes de acrescentar o FAIL deliberado. Portanto o SUMMARY ainda mostra fail=0; a linha FAIL posterior e o código 1 são a prova negativa. Um consumidor que olhe somente SUMMARY perderia a falha.

Provas: `logs/docs.txt`, `logs/negative.txt`, `logs/pacote.txt`, os respectivos `*-result.json`, `logs/independent.txt`, `extra/independent-results.json`, `network-summary.json`.

## Achados

### F1 — P2: gravação tardia aceita após retorno ao mesmo contexto ou reentrada de sessão

Local: `3_gerador/pk_logic.js:148` e `:153`; código entregue em `2_final_v39/project/components/KitProposta/preview.html:613` e `:618`. A época do contexto já é incrementada em `preview.html:258`, mas não integra a operação de salvamento.

Reprodução por ações reais: clicar Salvar e, antes do callback de 500 ms, (a) mudar empresa A→B→A, (b) mudar processo P1→P2→P1, ou (c) Sair da sessão→Entrar. Nos três casos, a resposta antiga cria uma peça e mostra “Salvo como versão 1”. As transições duraram respectivamente 21, 21 e 55 ms nesta execução. A peça em edição chega a continuar “Ainda não salvo”, pois o callback mantém referência ao estado antigo enquanto o estado atual foi recriado.

Causa: o callback verifica apenas igualdade dos valores atuais e sessão ativa; não verifica a época da sessão/contexto capturada ao iniciar. `switchCtx()` também não invalida PD_TOK. O contrato do README diz que sair/trocar contexto descarta a resposta. Correção sugerida para o responsável pelo DS: vincular a gravação à época e invalidar o token nas transições, limpando o estado pendente de forma coerente.

Os D10/D11 fornecidos esperam 900 ms antes de voltar/reentrar. Por isso não exercitam esta janela. Casos independentes E1/E2/E3.

### F2 — P2: trocar modelo durante a gravação deixa Salvar travado

Local: `3_gerador/pk_logic.js:150-154`; código entregue em `preview.html:615-619`.

Reprodução: Salvar na declaração; abrir Modelos e proposta e selecionar Anexo II antes dos 500 ms; esperar 800 ms; voltar a Peças salvas. Lista continua vazia, mensagem continua “Gravando rascunho…” e Salvar rascunho/Novo documento permanecem desabilitados. O callback retorna por diferença de modelo antes de executar `kk.pdBusy=false`. O mesmo objeto de pacote continua sendo usado; não há recuperação sem outra troca de contexto ou reload.

Correção sugerida: finalizar o estado ocupado também ao descartar a resposta, sem aplicar a gravação ao contexto/modelo novo. Caso E5; imagem `extra/stuck-saving.png`.

### F3 — P2: foco pelo teclado alcança aba ativa fora da área visível

Local: `2_final_v39/project/components/KitProposta/preview.html:167` (focus seguido de click, sem garantir exposição integral); estilo `.tabs` com overflow horizontal no mesmo arquivo.

Reprodução independente confirma o achado manual da coordenação: iframe local com 630 px, foco na primeira aba e tecla End. Peças salvas fica selecionada e focada, mas o rótulo quase inteiro fica cortado. Posição da aba: x=606,27 a 702,41; a área visível da barra termina em x=618; scrollLeft permanece 0. Também reproduzido em viewport direto de 630 e 704 px. Em 375 px, o navegador desloca a barra e a aba fica visível, usando tolerância geométrica de 1 px para arredondamento.

Gravidade moderada/P2: prejudica identificação visual do foco e da aba selecionada durante navegação por teclado. O painel abre; não é indisponibilidade total nem prova de falha de acessibilidade completa. O teste D14 só verifica overflow da raiz, e D13 foca diretamente em botões; nenhum mede a área visível da aba. Correção sugerida: garantir a exposição integral da aba selecionada ao navegar pelo teclado, sem deslocar indevidamente a página.

Casos E6/E7. Evidência visual inspecionada: `extra/iframe-630-End.png`; também `extra/tab-end-630.png`.

### F4 — P2: callback de gravação não revalida perfil atual

Local: `3_gerador/pk_logic.js:147` e `:153`; código entregue em `preview.html:612` e `:618`.

Reprodução: iniciar Salvar como editor e selecionar Leitor nos 500 ms de espera. A peça é gravada e a interface mostra “Salvo · versão 1” com o perfil já Leitor. O guard de edição só roda antes do timeout; o callback revalida sessão/contexto/modelo, mas não o perfil.

Caso E4 (mudança de perfil em 9 ms). É uma lacuna do contrato demonstrativo “leitor não salva” durante operação pendente, não um achado de autorização do backend real. A operação começou autorizada; caso o produto deseje semântica de autorização apenas no início, essa exceção precisa ser definida. Para o comportamento conservador demonstrado pelos outros descartes, revalidar `pdDeny()` no commit é a opção coerente.

## Limites e notas de honestidade

A persistência validada é somente o repositório fictício em memória da página e TXT demonstrativo. Não foi validada persistência em servidor, arquivo real ou banco, DOCX, autenticação real, autorização de backend ou acessibilidade completa. A troca para Leitor é controle fictício do protótipo.

Não foram rodadas as demais suítes de regressão além de t_docs/t_pacote e dos casos independentes solicitados; não foi feito fullverify, commit ou edição de DS/backend. A confirmação de revisão, cancelamento/reabertura, falha de gravação, conflito e carregamento explícito da versão atual passaram nas suítes fornecidas. Os custos internos são excluídos pelo snapshot observado no código; D15 só verifica texto da lista, não é uma auditoria independente de todos os canais possíveis.

O harness independente teve duas correções antes da execução final: uma leitura inicial tentou acessar ctx, que é privado à closure; passou a usar somente DOM. O primeiro iframe em about:blank não pôde carregar file: e foi substituído por um wrapper HTML local. Esses erros do harness estão preservados em `logs/independent-initial-harness-error.txt` e `logs/independent-iframe-harness-error.txt`; não foram contados como defeitos do produto. A tolerância de visibilidade foi ajustada para 1 px, evitando falso positivo de arredondamento em 375 px. Nenhum teste fornecido foi alterado para mudar seu resultado.
