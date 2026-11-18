# Correção 2 do harness — pendência da fonte e tratamento das esperas

Escopo autorizado após falha da rodada-01: corrigir somente a preparação da fixture, propagação das esperas e registro de propriedade. Produto, SQL e servidor permanecem inalterados.

## Alterações

- Depois de restaurar os bytes, `consultar` deve indicar identificação pendente e `preparar` deve retornar 422. A identificação é então reconfirmada pelo endpoint real, usando os dados e a proveniência já extraídos. Uma nova consulta exige status confirmado antes de iniciar o navegador.
- Resposta HTTP e download usam `esperarAcao`, que anexa imediatamente `Promise.all` à espera e à ação. Timeout ou falha da ação rejeitam o conjunto e alcançam os `finally`; a falha posterior da outra promessa também fica tratada. As aberturas de nova página já usavam `Promise.all` e foram mantidas.
- `fixtures.jsonl` é criado com `wx`. Cada criação confirmada de usuário, organização, documento de origem ou peça registra somente tipo, UUID e timestamp; nenhum dado de autenticação é gravado. Isso auxilia recuperação abrupta e não substitui a limpeza.

Baseline pré-correção preservada, sem sobrescrita, em `C:/Users/harre/AppData/Local/LicitaPlena/homologacao-real-baseline-20261031/fix2/`. Diff delimitado: `harness-fix2.diff`. Teste novo: `testar-esperas-ui.cjs`.

## Prova offline

Todos com exit 0:

```powershell
node --check docs/qa/homologar-kit-real-local.cjs
node --check docs/qa/homologacao-real-20261031/verificar-ui-real.cjs
node --unhandled-rejections=strict docs/qa/homologacao-real-20261031/testar-esperas-ui.cjs
node docs/qa/homologar-kit-real-local.cjs --self-test
```

O teste de esperas verifica timeout, falha síncrona da ação, rejeições tardias do outro ramo e sucesso. Dois cenários de falha exigem execução do `finally`. Ele usa somente Promises locais, sem navegador ou serviços. `git diff --no-index --check` contra a baseline privada não apontou erros.

| Arquivo | SHA-256 |
|---|---|
| `homologar-kit-real-local.cjs` | `e08a73d1d73fb45796a38a043819069a9c50fa822903969aeacf8ea06e29dea1` |
| `verificar-ui-real.cjs` | `69c619edf125141977a7c2752e34206130e254872701b25b04250efa618295fb` |
| `testar-esperas-ui.cjs` | `30d97d3459ea5f17f9b05535fac28b523debac8caf72b26db1fc2c25bc442365` |

Nenhuma segunda execução real foi feita. A prova offline não certifica o percurso real corrigido.
