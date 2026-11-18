# Bootstrap v3 — dependências de chaves estrangeiras

**Candidato corrigido, não aplicado por esta frente; precisa de revisão antes da coordenação executar.** Alvo exclusivo: `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, PostgreSQL 17.11.

## Diagnóstico do 42830

A coordenação executou v2 e recebeu `there is no unique constraint matching given keys for referenced table "operacao_processos"`. A inspeção do próprio DDL explica a falha: a FK `operacao_anexos_processo_processo_id_organizacao_id_fkey` era criada na linha 533, referenciando `(id, organizacao_id)`, enquanto o UNIQUE independente `operacao_processos_id_org_idx` só era criado na linha 605. O PRIMARY KEY existente sobre `id` sozinho não representa a chave composta referenciada.

O preparador colocava as constraints `p,u,c,f` antes de todos os índices independentes. Seis FKs dependem de dois desses índices; não é falha de rede, dados ou privilégio, nem exige mudar o catálogo esperado. As regras de integridade e o papel das chaves únicas estão descritos na [documentação PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-constraints.html), consultada via Context7 sem conteúdo privado.

O teste de ordem criado antes da correção percorreu as **29 FKs** públicas do inventário, verificando as colunas de referência e os provedores únicos correspondentes. O v2 falhou nas seis dependências:

| Provedor criado tarde | FKs afetadas |
|---|---|
| `operacao_processos_id_org_idx` | anexos, contratos, itens de resultado, ocorrências |
| `operacao_empresas_id_org_idx` | convites, membros |

As evidências com nomes completos, linhas e hash estão em `bootstrap-v2-falha-ordem-fks-resultado.json`. A primeira execução do verificador parou diante de um índice gerenciado de Storage que não é alvo dessas FKs; o recorte de índices gerenciados foi limitado a `auth.users`, única relação gerenciada referenciada. O arquivo inicial `bootstrap-v2-falha-ordem-fks.json` contém somente uma quebra de linha e não é evidência de resultado; foi preservado, sem reutilização.

## Correção mínima e preservação

A ordem agora é: tabelas, constraints primárias/únicas/CHECK, índices independentes, FKs e o restante do bootstrap. Nenhuma definição foi alterada ou descartada. O teste adicional compara os blocos anteriores/posteriores e o conjunto exato de comandos da região reordenada com v2; o SQL readonly permanece idêntico byte a byte. O catálogo esperado, as guardas de vazio/versão, a transação e todas as permissões permanecem iguais.

O v2, preparador/verificador anteriores e evidências locais estão preservados em `candidato-v2-0ca77f64/`; os arquivos v2 originais continuam existentes. A coordenação preservou separadamente o erro remoto e confirmou rollback explícito. O catálogo pós-rollback `catalogo-apos-rollback-v2.json` tem SHA-256 `67214d34734aae35b380dbfdb550611620027712b58143ce388909d1e80a895f`, e a coordenação informou o mesmo MD5 vazio `785cf53d0d88df117eff15085f879018`. Nenhuma tentativa automática foi feita.

| Arquivo v3 | SHA-256 |
|---|---|
| `01-bootstrap-prekit-staging-v3.sql` | `caca8c3d324e256a88bb1735662178dee35bb02822c62cc3459aca78a41d2272` |
| `02-verificar-bootstrap-somente-leitura-v3.sql` | `944a711c18e0c8cb1ced227a83a1c6fc80ae6d635b2fe5eb0928ee9041888480` |
| `preparar-bootstrap-especifico.cjs` | `50866a97a3db8e90ad7b35a275d7c83910543a430ebb9fdfc19de3e0c7292fd3` |
| `verificar-bootstrap-artefato.cjs` | `3f498da306ea5a25c403579e40ed5f5f4243e17f4fa15f80b10b32c877927211` |
| `verificar-ordem-bootstrap.cjs` | `84d248b5e5dc43189e0deba060293d199acd18b1f7e2cdfe5f1628b556beb5a2` |

O manifesto de emissão está em `bootstrap-manifesto-v3.json`. O preparador passou em `node --check`; `bootstrap-verificacao-estatica-v3.json` aprovou as verificações anteriores e a prova de alteração somente na ordem. `bootstrap-v3-ordem-fks.json` registra **29 FKs verificadas, zero falhas de ordenação**. São testes de artefato, sem banco ou SQL local: demonstram a correção da causa identificada, mas não substituem a execução remota e seus gates.

O checkpoint posterior permanece: aplicar somente após revisão e confirmação da conexão isolada; conferir gate readonly antes de fixtures; preservar catálogo pré-kit novo; preparar depois a variante explícita do delta. Não executar v1 ou v2.
