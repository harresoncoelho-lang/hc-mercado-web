# Revalidação independente dos quatro P2 — KitProposta build 40

Resultado: os quatro achados da revisão v39 estão resolvidos na reconstrução local cujo SHA-256 coincide exatamente com o hash v40 informado. A validação é estreita: não constitui auditoria integral da entrega ou do catálogo.

## Origem e reconstrução

Entrada: os quatro blocos observados diretamente na resposta do mesmo Claude e preservados em `blocos-claude-observados.json`: dois diffs (pk_logic.js e cadastro.py), teste novo e hashes declarados. O ZIP v40 não ficou disponível para download pelo IAB. Não foi usado navegador nativo nem método alternativo de obtenção; não se afirma validação de ZIP, manifesto ou “161/161” arquivos da v40.

A evidência extraída v39 permaneceu intocada. Cópia isolada em `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v40-20261030`, contendo `original-generator`, `patched-generator` e `project`.

Foram lidos `gen_kit.py`, `cadastro.py`, `extra.py`, diffs e teste novo antes da execução. O gerador completo não pode ser executado com esse material: faltam lib.py, demos.py, others.py e content.py; gen_kit também contém caminho Linux fixo para ler o marcador. Nenhuma dependência foi inventada ou instalada.

Método limitado e verificável: aplicação estrita dos sete hunks aos dois fontes copiados, com conferência de todos os contextos e contagens; obtenção de JS_LOGIC por AST literal, sem executar os imports Python; composição com PK_LOGIC conforme cadastro.build; substituição única do bloco completo e exato já existente no HTML v39. Todo o restante do HTML foi preservado. Mantiveram-se LF e a existência original da quebra terminal nos fontes; não houve tentativa de reformatar ou ajustar o resultado para chegar ao hash.

SHA-256 esperado e reconstruído, idênticos:

```text
c8f44a4de6c4dbb1b94854a050d21c15a8260dd92ff379579a942ab13744cb47
```

Isso permite testar os bytes correspondentes ao KitProposta informado, apesar de não reproduzir integralmente o gerador nem obter o ZIP. Provas: `reconstruction.json`, `reconstruct.py`, `preview.v39-v40.patch`, patches observados e `verification-final.json`.

Os outros oito arquivos da cópia project permaneceram iguais à v39: os sete protegidos e o README v39. Essa preservação se refere à cópia local reconstruída, não é readback independente dos demais arquivos no catálogo 41. Os 81 arquivos da extração original v39 foram novamente verificados e continuam intactos.

PerfilDocumentos não está disponível em bytes nos pacotes locais usados. O hash `51e465ec3cd16720c9188f68e3a4722dd535fbf3ac9db16d79dd4d245992ec77` permanece **somente declarado**; não foi afirmada comparação independente dele. Não foi regenerado PerfilDocumentos. A coordenação valida o catálogo ao vivo separadamente; esta revisão não acessou IAB, apps nem desktop.

## Resultado dos quatro achados

Locais abaixo referem-se a `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v40-20261030/project/components/KitProposta/preview.html`.

| Achado v39 | Correção observada | Prova independente | Resultado |
|---|---|---|---|
| F1: retorno rápido ao mesmo contexto/sessão aceita gravação antiga | Linhas 258 e 600–601: pdKill invalida operação e época, cancela timer; pdLive exige dono, época e contexto atuais | E1 A→B→A, E2 sair→entrar e E3 P1→P2→P1; lista continua vazia, sem falso sucesso | Resolvido |
| F2: troca de modelo mantém botão ocupado | Linhas 437, 600 e 653: troca cancela operação; ocupado deriva do objeto pdOp e é limpo somente pelo dono | E5: após troca, mensagem vazia e Salvar disponível; novo teste R5 verifica operação velha sem liberar operação nova | Resolvido |
| F3: aba focada fica cortada | Linhas 694–698: após navegação por teclado, corrige scrollLeft conforme limites da barra | E6 em 375/630/704 e E7 em iframe630; imagem inspecionada; End/Home claro/escuro no novo teste | Resolvido |
| F4: editor→leitor durante salvamento ainda comita | Linhas 436 e 601: mudança de perfil cancela; callback também exige editor | E4: lista vazia no perfil Leitor; R6/R7 também passam, inclusive volta rápida a Editor | Resolvido |

No iframe de 630 px, a aba Peças salvas passou de scrollLeft=0 para 84. Posição final x=522,265625 a 618,40625, com limite da barra em x=618. A diferença de 0,40625 px é arredondamento; o rótulo está integralmente legível. Mantida tolerância de 1 px do harness independente anterior, sem criar falso achado. Imagem: `extra/iframe-630-End.png`.

## Testes executados

| Suíte | Asserções | Código |
|---|---:|---:|
| Teste novo observado do Claude | 29 aprovadas, 0 falhas | 0 |
| Mesmo independent-checks anterior, somente URL de entrada trocada | 9 aprovadas, 0 falhas | 0 |
| t_docs.js v39 intacto nas asserções | 41 aprovadas, 0 falhas | 0 |
| t_pacote.js v39 intacto nas asserções | 162 aprovadas, 0 falhas | 0 |

A regressão docs/pacote se justifica porque a correção altera o ciclo de gravação e os handlers compartilhados de empresa, processo, sessão, perfil e modelo, usados também pela revisão/confirmacão do pacote. Não foram acrescentados novos objetivos nem rodadas outras suítes.

Controle negativo reutilizado da revisão v39, conforme autorizado. t_docs.js original continua com SHA-256 `79c4dd36c51650503610c2c892181c51587bc9165c8c2063e006fecb93fb3688`; teste e mecanismo de resultado não mudaram. Na execução anterior houve 41 PASS, a linha `FAIL NEG controle deliberado` e código 1 esperado. Não se afirma nova execução negativa contra v40. Prova referenciada em `verification-final.json` e na pasta irmã ds-v39-independente/logs/negative.txt.

Os originais dos três testes fornecidos estão em `original-tests`. As cópias executadas mudam somente import do launcher e conversão de caminho Windows para file URL; os patches de adaptação estão nesta pasta. O independent-checks preserva as mesmas nove asserções, substituindo apenas a URL da peça. Não houve ajuste nas asserções para obter aprovação.

O teste novo usa catch vazio no helper de clique e uma janela estreita de 20 ms no cenário R5. Esses limites não foram tomados como prova suficiente sozinhos: os quatro P2 foram rechecados pelo harness independente, que exige cliques reais sem ignorar erros, além da leitura dos diffs. Não é garantia de ausência de qualquer condição de corrida futura.

Execução: Node v24.22.0, Edge headless 156.0.4314.50 e Playwright já instalado no runtime. Mesmo launcher anterior: perfis isolados, proxy local sem saída, interceptação permitindo apenas file/data/blob e service workers bloqueados. Quatro execuções, zero pedidos externos registrados e zero pageerrors. Não houve instalação, rede de conteúdo externa, sessão do usuário, produção, PNCP, CNPJ Proprio, alteração de autenticação, modelo, configuração ou permissões.

Comandos, a partir desta pasta:

```powershell
.\run-suite.ps1 fixes
.\run-suite.ps1 independent
.\run-suite.ps1 docs
.\run-suite.ps1 pacote
```

Logs e códigos ficam em `logs`; `verification-final.json` confirma resumos, códigos, hash final, integridade da v39 e auditoria de rede.

## Limites finais

Aprovada somente a resolução dos quatro P2 nos bytes reconstruídos correspondentes ao hash de KitProposta. ZIP v40, manifesto integral, dependências completas do gerador, bytes de PerfilDocumentos e publicação ao vivo não foram verificados por este agente. Catálogo 41/build 40 é a identificação informada pela coordenação.

A persistência segue sendo simulação em memória/TXT. Nenhuma afirmação de backend real, DOCX, autenticação real ou acessibilidade completa. Nenhuma edição do produto/DS, commit ou fullverify; escritas somente nesta QA e na cópia isolada autorizada.
