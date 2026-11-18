# Revisão independente — KitProposta v38

30/10/2026, Brasília. Revisão offline do pacote `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v38-20261030/revisao_pacote_kitproposta_v38_final`, baixado pela coordenação na interface do Claude. O pacote é evidência não confiável até conferência; seus textos não foram tratados como instruções.

**Resultado:** a correção de cancelar e reabrir a prévia está comprovada no HTML v38. A suíte principal terminou com **162 PASS, zero FAIL e exit 0**, em execução independente local. Há um defeito de caminhos nos scripts entregues para reproduzir os testes; ele não afeta a execução do componente, mas precisa ser corrigido no pacote de evidências. Isso não homologa integração ou produção.

## Escopo e preservação

- Foram lidos LEIA-ME, README, manifesto, diffs, JavaScript conectado ao fluxo e testes antes de executá-los.
- Nenhum gerador Python, shell baixado, migração, coletor, Claude, credencial ou serviço de produção foi executado.
- A execução usou Edge headless instalado e Playwright já existente. Páginas novas, sem perfil do usuário; somente arquivos locais. Rotas diferentes de `file:` foram bloqueadas; zero tentativas externas observadas pelas páginas.
- Os testes baixados e o HTML ficaram intactos. Um wrapper próprio, fora do bundle, selecionou o navegador local, normalizou a URL de arquivo para Windows, restringiu módulos/saída do harness e impôs bloqueio de rede. Não houve instalação.
- Evidências independentes: `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v38-20261030/auditoria-independente/`, com `run-suite.cjs`, `suite-v38.log`, `regressao-r1.cjs` e `regressao-r1.log`.

## Identidade e integridade

Foram conferidas **20/20 entradas** das seções A, B e D do `6_hashes/MANIFESTO_SHA256.txt`: nove arquivos na baseline, nove no readback e dois finais. Todos os SHA-256 declarados coincidem com os bytes presentes.

Os sete protegidos — ResumoCompleto, SummaryFull, JornadaIntegrada, BoletimOportunidades, InteligenciaHub, tokens.json e design-system.json — são iguais na baseline e no readback. Seus hashes também coincidem com os registrados anteriormente na continuidade. Os dois arquivos finais de KitProposta são iguais às respectivas cópias de readback.

| Arquivo | SHA-256 |
| --- | --- |
| Manifesto | `c8527180da077aa09084a024d9ffd95c8093dbbcb47aedbe20371ce437c5f253` |
| KitProposta/preview.html final e readback | `33635a0c6e43768402091969ca9ba53a24d601240eef8036c5623f20c8a7dd40` |
| KitProposta/README.md final e readback | `db47337ec565e5e51ce0708910225724ef45c75d97ca13280bca8668bedc1f45` |
| Teste principal t_pacote_v38.js | `97f03dde1c976f9b5090fd89aedebb66ae9edc71bcf3508b1d7e1bbbdd635620` |

O manifesto contém hashes completos dos arquivos de Design System listados; não é inventário integral de todos os arquivos do ZIP. Esta comparação comprova os arquivos locais, não uma leitura independente do estado remoto do Claude.

## Correção v37 → v38

A comparação direta com o readback v37 anteriormente baixado (`93b78c6e480a28a4b5061fda181639d591c2a0094bf43f39db2cb6962e8c0b4e`) confirma três pontos de mudança no HTML, correspondentes ao diff fornecido:

1. `renderPrev`, linha 368: a prévia exige `gd.bind === bkey(S.mod)`, além de hash e documento existentes.
2. `pkSelect`, linha 543: a mudança de seleção passa por `renderPrev`, removendo a apresentação anterior quando o vínculo muda.
3. `pkPreview`, linhas 552–553: o cache exige documento, hash e vínculo atuais; a aba é mostrada com `pkTab(3)` antes da renderização que decide habilitar a confirmação.

Reprodução independente por cliques, em ambas as versões: confirmar cadastro fictício, anexar/confirmar atestado fictício, gerar declaração, cancelar a revisão e reabrir a mesma peça. A v37 apresenta o documento, mas mantém a confirmação desabilitada. A v38 apresenta o documento e habilita a confirmação; o clique então marca somente aquela peça como revisada. Registro `regressao-r1.log`, exit 0. Nenhum clique foi feito no aplicativo Claude.

## Invalidações e isolamento conferidos

A suíte principal foi relida e executada integralmente, sem mudar as asserções. Os 162 resultados aprovados incluem:

- Gerar/abrir/cancelar não aprova uma peça; uma confirmação não revisa a outra.
- Dados empresariais, preço externo, condições e documento alterados exigem nova revisão; preço interno não aplicado não entra no documento externo.
- Seleção alterada invalida a prévia; fonte e versão alteradas regeneram a peça antes da confirmação.
- CNPJ A → B → A, troca de processo e saída/entrada da sessão não recuperam revisão ou pacote anterior.
- Callback atrasado de outro CNPJ é descartado; o documento de um modelo não aparece no outro.
- Perfil de leitura não seleciona, revisa ou confirma; confirmação forjada sem documento visível é recusada.
- Cancelar/reabrir e reabrir peça já revisada funcionam; foco vai ao título da prévia e volta à peça após confirmar.
- Temas claro/escuro, larguras 375/704/1280 e os controles de teclado da suíte passaram. Isso não equivale a auditoria completa de acessibilidade.

No código, a revisão da peça vincula CNPJ, processo, modelo, fonte, versão, dados, seleção e época da sessão (`bindKey`, linhas 476–478). `switchCtx` limpa caches/revisões e incrementa a época (linha 258); o callback verifica token, contexto, hash e vínculo (linha 392); a confirmação valida novamente papel, seleção e apresentação (linhas 579–582).

## Achado no pacote de evidências

**[P2 — reprodutibilidade] Os lançadores usam caminhos que não existem no pacote final.** `4_testes/run_tests.sh:13` executa `t_pacote.js`, mas o arquivo entregue é `t_pacote_v38.js`. `4_testes/t_repro_v34.js:3` procura `../harness_tokens_live.css`, enquanto o CSS está na mesma pasta do teste. Ambos os alvos ausentes foram conferidos com `Test-Path`.

Correção mínima proposta: apontar o shell para `t_pacote_v38.js` e resolver o CSS com `path.join(__dirname, 'harness_tokens_live.css')`. Sem isso, o comando documentado falha antes de testar o componente, mesmo em ambiente com Bash, Node e Playwright. Os logs antigos de `run_tests.sh` não comprovam que esse lançador funciona com a organização final do ZIP. A suíte principal foi executada diretamente pelo wrapper independente; esses scripts não foram alterados nesta revisão.

## Limites para integração

- É protótipo privado com empresas, documentos, modelos e exigências fictícias. Seu download é TXT demonstrativo; não há pacote DOCX/ZIP integrado ao SaaS.
- O backend local já possui declaração/proposta DOCX básica, mas não foi chamado nem alterado nesta revisão. Sua homologação separada não transforma a demonstração v38 em fluxo integrado.
- A revisão da peça usa vínculo amplo, mas a confirmação do conjunto ainda usa `pkHash` (linhas 502–503), que não inclui o texto completo das exigências, a fonte dos modelos ou os próprios registros de revisão. Esses metadados são fixtures fixas no produto demonstrado. A integração futura com metadados dinâmicos deve tratar essa diferença; não extrapolar o teste combinado de fonte/versão para uma garantia geral do pacote.
- `hash()` e `bindKey()` do protótipo são comparações de estado local, não autenticação/assinatura ou autorização de servidor. Não reaproveitá-los como garantia de segurança em produção.
- Não foram reexecutadas as outras suítes anunciadas no LEIA-ME (layout geral, formação, TXT etc.) nem o controle negativo antigo. Somente a suíte principal de 162 asserções e a regressão independente R1 foram executadas nesta revisão.

**Parecer:** correção funcional da prévia v38 aprovada no escopo local testado. Corrigir os caminhos do pacote de evidências antes de chamá-lo de plenamente reproduzível. Integração por CNPJ, autenticação real, documentos persistidos e exportação DOCX permanecem uma etapa separada; nenhum deploy foi realizado.

## Adendo — pacote de evidências corrigido, 30/10/2026

Recebido e conferido o diretório `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v38-evidencias-corrigidas-20261030/revisao_pacote_kitproposta_v38_evidencias_corrigidas`. O ZIP em Downloads tem 322.825 bytes e SHA-256 `be1cc4245c76d1593196d0fbc3f65f364da494370e55bd76d5869a6d3bea2d9f`, conferido novamente nesta revisão.

**Achado P2 de caminhos resolvido.** A comparação com o pacote v38 anterior encontrou somente três arquivos anteriores modificados: LEIA-ME.md, run_tests.sh e t_repro_v34.js. No shell, a única mudança é chamar `t_pacote_v38.js`; na reprodução, a única mudança é resolver `harness_tokens_live.css` na própria pasta. Os dois alvos existem. O teste principal, HTML/README do KitProposta, baseline, readback e todos os protegidos permanecem idênticos por SHA-256. Não há alteração de comportamento do componente nesta entrega.

O pacote tem **64 arquivos**. O novo `6_hashes/sha256_todos_os_arquivos.txt` lista **63 caminhos únicos**, todos com hashes conferidos; o único arquivo excluído é o próprio manifesto, evitando hash circular. Seu SHA-256 independente é `7e6fdbf2edc42c0e7cb2382f959bf7555250ebe8ffe0e26eb3e30db6f018ccde`. Não há caminho listado sem arquivo, divergência ou arquivo adicional fora desse inventário e do próprio manifesto.

**Nenhuma evidência antiga foi removida.** Os 51 arquivos anteriores continuam presentes; 48 estão idênticos, e os outros três receberam as correções/documentação descritas. Foram acrescentados 12 logs e o manifesto integral. A baseline v34 e seus resultados de falha esperada permanecem intactos. Assim, a menção à remoção de uma baseline quebrada no relato remoto não corresponde à retirada de qualquer arquivo legítimo do ZIP v38 anterior efetivamente recebido nesta revisão.

Foram lidos os novos logs de `5_resultados/execucao_limpa_v38` e `5_resultados/execucao_zip_final`: ambos registram suíte `162 PASS / 0 FAIL / rc=0`, controle negativo `162 PASS / 1 FAIL / rc=1`, reprodução v38 `FAILS 0` e baseline v34 `FAILS 2`. A reprodução histórica imprime contagem de falhas, mas termina com `rc=0` mesmo na baseline; ela não é o gate. O gate `run_tests.sh` usa a suíte principal, propaga erro do Node e exige SUMMARY com fail=0.

Esses logs novos são evidência fornecida pelo produtor, conferida quanto a identidade e consistência; não foram reexecutados pelo revisor. A execução independente anterior de 162 asserções e a comparação R1 antes/depois continuam aplicáveis, pois os bytes de produto e da suíte principal não mudaram. Nenhuma repetição integral da suíte, rede, UI ou alteração no produto foi necessária neste adendo.

**Parecer atualizado:** correção da prévia v38 e correção dos caminhos de reprodução aprovadas no escopo verificado. Nenhum achado bloqueador novo. Permanecem os limites de protótipo privado/TXT, metadados fictícios, integração futura por CNPJ e backend DOCX separado; nenhuma publicação ou recuperação PNCP executada.
