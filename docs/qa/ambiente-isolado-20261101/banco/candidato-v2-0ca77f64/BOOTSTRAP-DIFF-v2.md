# Bootstrap específico v2 — correção em revisão

**Não aplicado. Parecer completo da revisão independente ainda pendente.** O único alvo permanece `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, PostgreSQL 17.11. Produção e o delta original não foram alterados.

| Arquivo | SHA-256 |
|---|---|
| `01-bootstrap-prekit-staging-v2.sql` | `0ca77f649ad34d1a383c268f7c34e97bdb0a4782a373681eaa9ae3b6762f3ceb` |
| `02-verificar-bootstrap-somente-leitura-v2.sql` | `944a711c18e0c8cb1ced227a83a1c6fc80ae6d635b2fe5eb0928ee9041888480` |
| `preparar-bootstrap-especifico.cjs` | `1d0e9d277c39cddd95260f044900e583f6283af249b3eb6659e3912a20b55c66` |
| `verificar-bootstrap-artefato.cjs` | `fae23f64b172f6c56be23cbbbbbd04b30d7277545321e22b705998ef1521d7e8` |

## Correções sobre v1

1. O filtro de `pg_policies` do gate posterior inclui `dados_robo`. Antes, as relações e os arrays esperados incluíam essa tabela, mas a consulta das policies não; as duas policies não seriam observadas e o gate abortaria a transação. O filtro anterior à criação continua intacto, ligado ao catálogo vazio aprovado.
2. O catálogo esperado do gate é declarado uma vez em uma variável JSON. As comparações conservam as contagens e as duas direções de `@>`. A inspeção local compara cada array com o literal esperado do candidato anterior: nenhum array, corpo, atributo ou ACL esperados mudou.
3. A emissão usa nomes `-v2` e recusa sobrescrita. O candidato anterior, seu preparador, verificador, manifesto, relatório e evidência foram copiados para `candidato-v1-3756dd11/`, com hashes conferidos. Os SQLs e manifestos v1 originais também permanecem preservados.

O bootstrap passou de **563.406 para 337.992 bytes**, e o gate readonly de **463.655 para 238.241 bytes**. Cada arquivo tem um gate; cada gate tem um catálogo esperado. Não foi criado helper permanente, tabela auxiliar, dependência ou executor.

## Verificação realizada

A nova asserção do filtro falhou no v1 com `Gate precisa observar as duas policies de dados_robo`. Após a correção, o preparador passou em `node --check`, emitiu os arquivos novos e o verificador passou. A evidência está em `bootstrap-verificacao-estatica-v2.json`.

Além dos checks anteriores, o verificador confirma 33 policies esperadas, sendo duas de `dados_robo`, compara todos os arrays esperados v2 com v1 e exige comparação inversa de cada seção. Isso verifica geração e preservação do artefato; não interpreta nem executa SQL e não comprova funcionamento PostgreSQL.

Continuam previstos 19 tabelas, 22 funções públicas e três triggers da aplicação, sem linhas de negócio/fixtures ou alterações em defaults, roles, schemas e corpos gerenciados. A necessidade de revisão independente e ensaio remoto permanece. O candidato v1 **não deve ser aplicado**.

Depois de um bootstrap aprovado e executado pela coordenação: conferir o gate readonly antes de fixtures; registrar 19 tabelas públicas vazias e Auth/Storage vazios; capturar o catálogo pré-kit novo pela consulta original; somente então preparar a variante explícita do delta. Restauração PGDMP e jornada com JWT continuam provas separadas.
