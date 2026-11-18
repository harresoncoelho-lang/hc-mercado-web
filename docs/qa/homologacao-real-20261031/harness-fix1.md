# Correção 1 do harness — isolamento no DOCX

Atende exclusivamente ao P2 de `.superpowers/sdd/2026-10-31-homologacao-autenticada/harness-review.md`. Execução real permanece bloqueada até aceite da revisão e gate SQL aprovado.

## Mudança

- A fixture do processo A ganhou um terceiro item válido, `Item valido excluido QA`, com valor unitário de R$ 999,00. A consulta confirma que ele está disponível nesse processo.
- As propostas API e UI continuam selecionando somente os dois itens anteriores. A UI confere explicitamente que o terceiro está desmarcado.
- DOCX de proposta legado, persistido e UI exigem os textos `Item decimal QA` e `Item inteiro QA` e rejeitam `Item valido excluido QA`.
- Todas as exportações verificadas exigem o CNPJ exato da empresa, com limites de dígitos, e rejeitam o CNPJ da outra empresa. Os CNPJs esperados agora seguem explicitamente para o módulo UI.
- Permanecem os totais R$ 3,71 e R$ 7,04. Não houve alteração de preço/quantidade dos dois itens selecionados, produto, servidor, rede, credenciais ou limpeza.

## Preservação e diff

Antes de editar, os dois arquivos foram copiados sem sobrescrita para `C:/Users/harre/AppData/Local/LicitaPlena/homologacao-real-baseline-20261031/fix1/`. Essa baseline corresponde aos hashes do pacote pré-exec anterior.

O diff exclusivo desta correção está em `harness-fix1.diff`. Os hashes atuais substituem os hashes do pacote pré-exec somente para estes dois arquivos:

| Arquivo | SHA-256 |
|---|---|
| `docs/qa/homologar-kit-real-local.cjs` | `dfccdd7e6a6d22f8402c96f55a95f57abfbd24165191b781d6fee6de992cefaa` |
| `docs/qa/homologacao-real-20261031/verificar-ui-real.cjs` | `c4f172bde1d12942e4cd97ff9d0d46e717ff92ee9e8ca5a903f975e9287de5e0` |
| Servidor, inalterado | `b2951f7a07556a4e45b5a38cf7ac06dcfd3ac08449b10cb3653924f0b4f1b8cb` |

## Verificação offline

Com `VOLTA_HOME=C:\Users\harre\AppData\Local\Volta`, os comandos abaixo passaram:

```powershell
node --check docs/qa/homologar-kit-real-local.cjs
node --check docs/qa/homologacao-real-20261031/verificar-ui-real.cjs
node docs/qa/homologar-kit-real-local.cjs --self-test
```

`git diff --no-index --check` contra cada cópia privada não apontou erro de whitespace. O self-test segue cobrindo contenção/sanitização/limpeza; as novas assertions de conteúdo serão exercitadas na execução real após liberação. Nenhum Docker, DB, HTTP, navegador ou segredo foi acessado nesta correção.
