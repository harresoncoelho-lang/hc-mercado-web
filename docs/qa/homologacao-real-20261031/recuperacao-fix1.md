# Recuperação dirigida — correção após revisão

Atende ao P2 de `.superpowers/sdd/2026-10-31-homologacao-autenticada/cleanup-review.md`. Nenhum DELETE executado durante a correção.

O inventário original `rodada-01/recuperacao-preflight.json` permanece inalterado e é validado pelo SHA-256 `0e252e5da13a418ebadb9644a5b46f2b076a35d5df58148e88b8a749e40c0469`. Não se descobrem novos alvos para apagar.

- A inspeção valida os sobreviventes como subconjunto do inventário, comparando ID, origem temporal e vínculos. IDs ausentes são aceitos como já removidos.
- O objeto é localizado por ID, bucket e caminho exatos, independentemente da presença do documento. Um objeto diferente reutilizando o caminho é rejeitado.
- A ordem permanece Storage → transação de peças/organizações → Auth. Qualquer falha de Storage interrompe antes de apagar vínculos; ausência do objeto é conferida antes da cascata. Falha SQL impede exclusões Auth.
- Falha parcial de Auth pode ser retomada usando somente os IDs ainda presentes. Todos os registros fora do conjunto revisado devem continuar iguais à baseline antes de cada tentativa.
- Inspeção e relatório usam timestamp por tentativa e criação exclusiva; o preflight e relatórios anteriores nunca são sobrescritos.

Baseline privada do script anterior: `C:/Users/harre/AppData/Local/LicitaPlena/homologacao-real-baseline-20261031/recuperacao-fix1.cjs`. Diff: `recuperacao-fix1.diff`.

## Verificação

`node --check docs/qa/homologacao-real-20261031/recuperar-limpeza-rodada-01.cjs` e `node docs/qa/homologacao-real-20261031/recuperar-limpeza-rodada-01.cjs --self-test` passaram com exit 0. O teste offline prova que falha Storage preserva dependências, falha SQL impede Auth, Auth parcial permite retomada só dos sobreviventes e ID externo é rejeitado. Não usa DB ou HTTP.

SHA-256 atual: `e6c4cc00a0d29da97c762712ccc19daf0ba7993f7de461751b7af790d74d48ab`.

Após revisão e liberação separada, o comando dirigido é:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
$env:QA_RECUPERAR_RODADA_01='1'
node docs/qa/homologacao-real-20261031/recuperar-limpeza-rodada-01.cjs --limpar
```

O modo padrão continua somente leitura. Sucesso de limpeza exige relatório sem erro e igualdade integral das 33 tabelas com a baseline inicial.
