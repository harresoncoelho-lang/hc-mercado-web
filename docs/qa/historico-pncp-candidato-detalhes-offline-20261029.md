# Candidato descartável para detalhes por IDs — 29/10/2026

**Viabilidade demonstrada somente em cópia isolada. Nada aplicado ao coletor real e nenhuma coleta liberada.** O experimento estende a combinação já existente `ataIds` + `snapshotAnterior`, sem descobrir o catálogo nacional. O histórico real continua parado em 230 páginas/115.000 IDs, com 459 detalhes pendentes e cinco atas anteriores preservadas.

## Mudança e alcance

Na cópia de `prepararConsulta`, seis linhas novas validam seleção explícita não vazia e origem absoluta, externa e diferente do destino; registram `detalhes: true` e a origem na identidade da consulta. O retorno passa a incluir esse caso em `modoRetomavel`. Isso reutiliza **sem modificar** `importarCertificados`, a validação dos hashes e da fila/período, e `buscarNoSnapshot` por compra. A identidade própria impede converter silenciosamente um checkpoint do modo comum ou trocar a origem na retomada.

Histórico e catálogo não entram nesse ramo. `--catalogo` continua exigindo certificado de catálogo concluído. Não foram alterados igualdade das âncoras, deduplicação, orçamento, cadência, helper HTTP ou regras de expiração. Os cenários novos usam `renovarParciais: false` explicitamente; o padrão da função não foi alterado e essa opção continua obrigatória no eventual chamador operacional.

Chamadores examinados: testes existentes, CLI do próprio utilitário, launcher histórico e encadeador externo. **A CLI atual não encaminha uma origem no modo de IDs; o candidato só foi exercitado por `recuperar()` via API local.** Launcher e encadeador históricos continuam fixos em `historico: true`; não foram adaptados nem executados. Nenhuma instalação ou dependência nova.

## Evidência reproduzível

Pasta externa: [candidato-detalhes-offline-20261029](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/candidato-detalhes-offline-20261029). Contém cópias congeladas de core, testes e dos módulos `atualizar_dados`/`supabase_dados`, além de [patch](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/candidato-detalhes-offline-20261029/candidato.patch) e [harness](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/candidato-detalhes-offline-20261029/aceitacao.test.cjs) de 163 linhas. Identidades de duas referências originais são apenas chaves: todos os corpos, contratos, itens e resultados são fictícios. Respostas/relógio simulados, `fetch` bloqueado, saídas em novas pastas `execucoes/`. O teste de pasta interna usa o repositório **simulado da cópia**, não escreve no worktree real.

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
Set-Location 'C:\Users\harre\AppData\Local\LicitaPlena\historico-pncp-20261028\candidato-detalhes-offline-20261029'
$env:PNCP_PROVA_ALVO='baseline' # RED esperado; depois trocar por candidato
node --test '.\aceitacao.test.cjs'
node --require '.\rede-bloqueada.cjs' --test '.\candidato\scripts\recuperar_contratos_atas_local.test.js'
```

O primeiro RED foi observado antes de editar a cópia. Após reforçar as verificações de expiração e identidade do checkpoint, o harness final foi executado em ambas as versões:

| Verificação | Resultado |
| --- | --- |
| Baseline, mesmo harness final | 9 cenários falharam como esperado; um passou. O runner conta também o contêiner reprovado: 11 testes, 1 aprovado/10 falhas. |
| Candidato, mesmo harness final | 10 cenários + contêiner: **11/11 aprovados**, zero falhas, aproximadamente 1,09 s. |
| Testes existentes contra a cópia candidata | **33/33 aprovados**, zero falhas, aproximadamente 2,29 s. |

Cobertura nova: seleção sem catálogo; zero reconsulta de contratos e da compra certificada; resultados faltantes sem repetição após orçamento; recusa de compra parcial após sete horas simuladas, sem renovação/chamadas, preservando os estados e brutos anteriores; IDs desconhecidos/duplicados/ausentes; origem relativa/interna/igual ao destino; fila/período diferente ou origem incompleta; artefato adulterado; mudança do manifesto/origem após checkpoint; modo comum e sua validade global preservados; catálogo parcial recusado. As cinco atas anteriores ficam verificáveis na origem íntegra; não se exige copiá-las para outro destino.

Logs: `red.log`/`green.log`, `red-final.log`/`green-final.log` e `regressoes.log`, na pasta externa. [Resultado final do candidato](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/candidato-detalhes-offline-20261029/execucoes/candidato-1793308498007/resultado.json) contém casos e inventários antes/depois; [auditoria final](C:/Users/harre/AppData/Local/LicitaPlena/historico-pncp-20261028/candidato-detalhes-offline-20261029/auditoria-final.json) reconferiu **251 arquivos reais intactos**, zero tentativas de rede.

## Congelamento e limites

- Core real/baseline: `C5AF81CA893D0C6A2D5C8E8080B1C0AAABF6BA93732E5F3ADEFDECDCB686D8C1`.
- Cópia candidata: `8C125E5C1E7CA5019FCEE9C41F0C2463B034219AB240DC192D1FBD04F4E76686`.
- Harness final: `DCA82A84E173FBEDC51595BBC7BE805E3D326E639769F65243AFCA61A6A22EBC`.
- Manifesto real: `09416DA77E0DDCFFFE05E922AB9339089CF04D40DF45D933F9A6AAE57FCF0D23`.

Revisão independente somente leitura aprovou a **viabilidade offline**, sem P1/P2: conferiu diff, validações, identidade do checkpoint, hashes e logs, sem repetir a execução. O coordenador também leu patch, relatório, auditoria e saídas finais. A renovação continua verdadeira por padrão na API existente; o futuro chamador deve fornecer `renovarParciais: false` explicitamente. Essa ressalva não pode ser perdida ao integrar o experimento.

Este resultado não resolve a paginação nacional mutável nem certifica o catálogo. Não foi exercitada operação real das 459 referências, gate global do projeto, CLI nova, encadeador de detalhes ou publicação. A adoção ainda exige incorporação controlada dos testes ao projeto e definição/verificação do chamador operacional isolado, mantendo origem exclusiva, sete segundos e `renovarParciais: false`. **Não executar o patch ou a cópia contra dados reais a partir deste relatório.** Resumo, e-mail, boletins, autenticação e modelos não foram tocados.
