# Recuperação de cobertura em homologação — 28/10/2026 UTC

## Escopo e resultado

Recuperação das 13 UFs que permaneceram pendentes na execução remota `40593821785`: AL, BA, CE, DF, ES, GO, MG, PA, PB, PR, PE, RJ e RS. **Resultado local: 13/13 UFs conferidas, 445 páginas e 21.944 IDs únicos.** Nenhuma UF pendente dentro desse escopo. A rotina não usa credenciais nem escreve no Supabase; os arquivos ficam fora do repositório e da publicação do site.

`concluida` significa páginas recuperadas localmente, contagem de IDs distinta igual ao total declarado pela fonte e primeira página conferida novamente. Não significa sincronização em produção nem cobertura de todos os portais. As outras 14 UFs não são declaradas atualizadas por esta rodada.

A fonte alterou PR duas vezes durante a coleta: 3.329 registros/67 páginas → 3.392/68 → 3.416/69. As tentativas foram interrompidas sem confirmar cobertura; preservaram 26 e 8 páginas parciais, respectivamente. As nove UFs já concluídas foram mantidas. PE/RJ/RS foram concluídos separadamente. A última tentativa de PR, depois da virada do dia em Brasília, conferiu 3.410 registros/69 páginas e terminou com código 0. A consolidação usa somente as UFs concluídas; as tentativas parciais continuam preservadas fora dela.

Os quatro diretórios de tentativa estão em `C:\Users\harre\AppData\Local\LicitaPlena`: `recuperacao-pncp-20261028`, `recuperacao-pncp-20261028-final`, `recuperacao-pncp-20261028-restantes` e `recuperacao-pncp-20261028-pr-ultima`. Cada um mantém seu próprio `manifesto.json` sem reescrever a história das tentativas anteriores.

O endpoint consultado é `/api/consulta/v1/contratacoes/proposta`, com `dataFinal=20271028`. Não existe filtro por data de publicação nesta consulta: são contratações com recebimento de propostas aberto segundo a fonte no momento da leitura, com término até 28/10/2027. Não é um backfill de todos os editais publicados em um intervalo nem uma recuperação de contratos/atas. O manifesto registra o início e a conferência de cada UF, pois não há um instante único de snapshot nacional.

## Conjunto final e integridade

Diretório: `C:\Users\harre\AppData\Local\LicitaPlena\recuperacao-pncp-20261028-consolidado`.

- `oportunidades-pncp-bruto.json`: 21.944 registros, com UF de consulta e payload original; 44.324.922 bytes. É o formato bruto de homologação, ainda sem importação para o modelo do produto.
- `conferencia.json`: contagens por UF, consulta, datas, quatro manifestos e SHA-256 das 445 páginas aceitas, dos manifestos e do consolidado. Todos os hashes foram relidos e conferidos.
- Período da execução: 28/10/2026 02:00:12Z até a última conferência de PR às 03:22:47Z; em Brasília, de 27/10 às 23h00 a 28/10 às 00h22. Consolidação: 03:23:06Z.
- Publicações observadas: 12/09/2023 10:25:39 até 28/10/2026 00:00:11. Encerramentos observados: 27/10/2026 23:59 até 28/10/2027 23:59, nos valores fornecidos pelo PNCP.
- **4.507 oportunidades foram publicadas antes de 30/06/2026**, apesar de retornarem na consulta de propostas abertas. A retenção antiga por publicação as atingia; a correção em homologação preserva esses registros.

| UF | Páginas conferidas | IDs únicos |
|---|---:|---:|
| AL | 6 | 284 |
| BA | 52 | 2.572 |
| CE | 24 | 1.179 |
| DF | 11 | 518 |
| ES | 13 | 623 |
| GO | 27 | 1.330 |
| MG | 103 | 5.137 |
| PA | 12 | 572 |
| PB | 12 | 590 |
| PR | 69 | 3.410 |
| PE | 20 | 990 |
| RJ | 31 | 1.502 |
| RS | 65 | 3.237 |
| **Total** | **445** | **21.944** |

## Evidência anterior

- A [recuperação remota de 27/10](https://github.com/harresoncoelho-lang/hc-mercado-web/actions/runs/40593821785) terminou verde mesmo com as 13 UFs pendentes por HTTP 429; persistiu uma base acumulada de 27.316 oportunidades. O código em homologação já propaga essa condição como falha parcial.
- A [coleta diária de 27/10](https://github.com/harresoncoelho-lang/hc-mercado-web/actions/runs/40526185296) teve zero das 27 UFs de oportunidades concluídas. Contratos percorreu 8 de 110 páginas nacionais e a persistência falhou com SQL 57014. Mercado ainda tinha 464 atas pendentes e uma janela de backfill. Esses dois conjuntos não estão recuperados pela rotina de oportunidades.
- O [Swagger oficial do PNCP](https://pncp.gov.br/api/consulta/swagger-ui/index.html), consultado em 28/10/2026, limita `contratacoes/proposta` a 50 registros/página. Uma sonda com 500 recebeu HTTP 400. O tamanho permanece 50.

## Procedimento

Comando inicial da execução auditada; uma nova rodada deve usar outra pasta e a data final desejada, preservando este conjunto de evidências:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node scripts/recuperar_cobertura_local.js 'C:\Users\harre\AppData\Local\LicitaPlena\recuperacao-pncp-20261028' 'AL,BA,CE,DF,ES,GO,MG,PA,PB,PR,PE,RJ,RS' 20271028
```

A execução exige pasta absoluta fora do repositório. Guarda a consulta e cada resposta por UF/página com escrita temporária e rename. Na retomada, valida as páginas salvas e busca somente as faltantes; ao fim de cada UF consulta novamente a primeira página. A conferência compara IDs e sua ordem, pois o PNCP pode alterar a ordem das propriedades JSON sem mudar registros.

Não há teto de 20 páginas. A cadência é uma chamada a cada 7 segundos, inclusive retentativas, reaproveitando timeout e backoff do coletor. A primeira rodada a 2 segundos foi interrompida em BA por 429 após salvar 5 páginas; a retomada preservou esse progresso. Ao persistir falha, a rotina para a rodada inteira, mantém as demais UFs pendentes e sai com código 1. Não insiste em todas as UFs contra uma fonte que começou a recusar a origem.

Consultas diferentes não podem usar a mesma pasta; checkpoints com mais de 6 horas exigem pasta nova. Mudança do total de páginas, contagem distinta divergente (inclusive por repetição de IDs), resposta inválida ou mudança dos IDs da primeira página impedem conclusão. O PNCP não oferece snapshot transacional: estas verificações detectam deslocamentos comuns, mas não provam que nenhum dado intermediário mudou entre duas requisições.

## Trava após encerramento forçado

Falha normal e encerramento normal fecham e removem `recuperacao.lock`. Encerramento forçado pode deixar a trava. Versões atuais gravam nela PID e horário. Não se remove automaticamente: um processo ainda ativo não pode perder a exclusividade.

1. Leia somente a trava da pasta dessa recuperação.
2. Confira o PID com `Get-Process -Id <PID>` e o horário/processo correspondente. Se estiver ativo, mantenha a trava e acompanhe a execução.
3. Somente após confirmar que o processo terminou, remova **apenas** o arquivo `recuperacao.lock` pelo caminho absoluto com `Remove-Item -LiteralPath`. Preserve `manifesto.json` e todas as páginas.
4. Execute novamente o mesmo comando. Se a trava estiver vazia ou ilegível, confira também os processos de coleta em andamento antes de removê-la.

## Verificação

`node --test scripts/recuperar_cobertura_local.test.js scripts/atualizar_dados.test.js scripts/supabase_dados.test.js`

Os testes cobrem interrupção de rede e retomada, mais de 20 páginas, divergência/duplicação, mudança da primeira página, propriedades JSON reordenadas, resposta inválida, consulta diferente, checkpoint corrompido, resposta vazia contraditória e trava concorrente identificada por PID. ESLint e Biome dos arquivos novos passaram sem avisos/erros.

Em `atualizar_dados.js`, esta etapa exporta `fetchComRetentativa` e executa `main` apenas quando chamado como programa. Corrige também a limpeza do timer: o prazo agora permanece ativo durante a leitura do corpo da resposta e sempre é limpo em `finally`. Um teste reproduziu a aceitação indevida de um corpo que chegava depois do prazo e confirmou a correção, preservando timeout e retentativas.

A recuperação revelou ainda editais antigos que continuam abertos. A retenção foi corrigida em homologação para podar somente encerramentos comprovadamente anteriores a 120 dias, tanto em memória quanto no DELETE REST. Datas desconhecidas ficam preservadas; o JSON original não muda. Os testes reproduziram a exclusão incorreta de edital aberto vindo do PNCP e do cache antes da correção. Detalhes em [cobertura-persistencia.md](cobertura-persistencia.md). Nenhum workflow foi disparado, nenhum banco remoto foi alterado, nenhum DELETE remoto foi executado e nenhum e-mail foi enviado nesta homologação.

## Pendências de produção

O segredo de serviço do Supabase de produção não está no ambiente local. A recuperação local não comprova que o timeout de persistência foi removido em produção. Importar os dados recuperados exige normalização para o modelo do produto, uma etapa separada de escrita confirmada e atualização dos metadados somente depois dela. A autorização atual é sem publicação.

O utilitário local supera 20 páginas; o limite do coletor publicado não foi removido por essa execução. Sua integração com a recuperação paginada precisa ser concluída e validada antes de afirmar cobertura automática contínua. As outras 14 UFs, outros provedores e todo o histórico de editais não estão comprovados por este conjunto. A homologação pontual de contratos/atas tem [evidências separadas](recuperacao-contratos-atas-evidencias.json); os 21.944 registros acima são somente oportunidades.
