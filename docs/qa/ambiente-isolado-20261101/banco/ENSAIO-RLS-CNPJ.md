# Ensaio SQL de isolamento por CNPJ

**Executado e validado no staging em 01/11/2026 às 19:07:06.709882 UTC.** A coordenação executou o SQL integral depois da revisão; esta frente conferiu os arquivos de evidência, sem reexecutar. As notas de preparação abaixo foram preservadas. Alvo: projeto `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, PostgreSQL 17.11. A identidade da conexão foi conferida pela coordenação; o rótulo no SQL não é prova por si só.

Arquivo: `07-ensaiar-rls-cnpj-com-rollback.sql`. SHA-256: **`8363e05287cc2ff78778f30977099f205e52d96889cffae26eb3a6f389d76379`**. O manifesto `ensaio-rls-cnpj-manifesto.json` lista identidades fictícias, casos e limites. O gerador apenas emite texto e recusa sobrescrita.

O ensaio reaproveita a matriz de `docs/qa/homologar-kit-real-local.cjs` (em torno das linhas 79–105) e o padrão SQL de `docs/qa/migracoes-capacidade-20261031/testar-delta-local.cjs` (em torno das linhas 174–191). Nenhuma suíte, rota, função ou tabela do produto foi criada ou alterada.

## Execução comprovada

`rls-cnpj-execucao.json` registra o hash exato do SQL, editor integral conferido, execução sem erro e retorno **`RLS_CNPJ_SQL_ROLLBACK_OK`**. Foram atravessados os **15 blocos de casos**; depois do ROLLBACK, o papel voltou a `postgres`, o fingerprint permaneceu **`830899ecee2a58d23beec619b4963fed`**, as 21 tabelas públicas estavam vazias e havia zero usuários Auth e zero objetos Storage. As quatro identidades e demais fixtures não persistiram.

| Evidência | SHA-256 |
|---|---|
| `rls-cnpj-execucao.json` | `43ea2b873a0c3d793545e8143bc3698cd395db582a9718eaea5ee9525d1ba256` |
| `rls-cnpj-sucesso.jpg` | `65c7c3a68ddd65aeb6a11987355749fb4d26ca4ad4a74a5bc8ab63726e862ac4` |

A captura mostra o projeto de homologação e o retorno da consulta final; o JSON preserva os valores completos. O editor exibiu a última consulta, não um log individual de cada negativa. A conclusão decorre da execução integral do arquivo conferido, cujas asserções interrompem o script se qualquer caso falhar, e do retorno posterior ao rollback.

Isso comprova a matriz de autorização **SQL/RLS** descrita abaixo e a reversão das fixtures. Não houve emissão de JWT, login, HTTP, exportação ou arquivo Storage; esses limites continuam válidos.

## Contenção

Há um único BEGIN/ROLLBACK para todo DML. Antes das fixtures, locks com espera máxima de dois segundos protegem as tabelas vazias; cada comando tem timeout de 30 segundos, e há timeout de 60 segundos para sessão ociosa na transação. O script exige executor/banco `postgres`, versão `170011`, fingerprint pós-delta **`830899ecee2a58d23beec619b4963fed`**, 21 tabelas públicas vazias, Auth sem usuários, Storage sem objetos e o único bucket privado conhecido.

As quatro linhas transitórias de `auth.users` usam IDs fixos de fixture e endereços `@example.invalid`, sem senha, token, identidade de login, envio ou chamada de Auth. O trigger real deve gerar quatro clientes pendentes; o script confere isso antes de aprovar os clientes fictícios como administrador. Nenhum trigger é desabilitado. As demais fixtures são duas organizações, CNPJs A/B na mesma organização, dois processos, dois metadados documentais e duas peças gravadas pela RPC real com papel service_role.

Não há DDL, grants, revokes, troca de proprietário, limpeza via DELETE administrativo, configuração persistente, arquivo Storage ou chamada HTTP. As tentativas DELETE fazem parte das negativas de permissão e devem falhar com SQLSTATE 42501. Um erro inesperado exige parar, preservar a mensagem e executar ROLLBACK explicitamente; não repetir nem trocar guardas.

## Matriz coberta pelos 15 blocos

- O gestor lê documentos e peças A+B; operador e leitor restritos leem somente A; o usuário de outra organização não lê A nem B.
- O operador altera o documento A, altera zero linhas de B e não consegue inserir um documento em B. O leitor altera zero linhas de A.
- A RPC privada cria declaração A e rascunho de proposta B com autor autorizado. Rejeita operador restrito em B, outra organização, leitor e cliente pendente com PT403; processo de A informado junto de B com PT404.
- authenticated e service_role não conseguem INSERT/UPDATE/DELETE direto no kit. authenticated e anon não executam as RPCs de kit e confirmação de identificação; anon não consegue SELECT no kit.
- O cliente pendente não lê peças do kit. Esse teste não presume que o status pendente bloqueie a tabela documental: a policy existente dessa tabela tem outro contrato.
- Ao final, negativas não devem ter criado peças, mudado suas versões nem alterado o documento B. Tudo é revertido pelo ROLLBACK.

Depois do ROLLBACK há somente consultas em um bloco DO e um SELECT final. O DO usa `set_config(..., true)` local à transação implícita para normalizar o search_path do catálogo; não abre outra transação de escrita nem muda configuração persistente. Reconferem-se o mesmo fingerprint, 21 tabelas vazias, zero usuários e zero objetos. O retorno final exigido é **`RLS_CNPJ_SQL_ROLLBACK_OK`**, com contagens e horário reais. Se o retorno não existir, o ensaio não está validado.

## Histórico: verificação feita na preparação

O preparador fixa os hashes do catálogo pós-delta e da consulta original. Confere as colunas obrigatórias de `auth.users` (somente `id` sem default), o trigger real esperado e os nomes das tabelas. Passou em `node --check` e em suas asserções de emissão: um BEGIN/ROLLBACK, nenhum COMMIT/DDL, ausência de senha/HTTP/alteração de replicação, uma inserção explícita de usuários e duas guardas do mesmo catálogo. **Nenhum SQL foi executado nesta frente.** A revisão deve avaliar o SQL completo, inclusive resolução de papéis e efeitos dos triggers.

## Limites

`SET LOCAL ROLE` e claims locais exercitam permissões/RLS no PostgreSQL real, **não autenticam ninguém nem comprovam JWT, login ou autorização HTTP**. A proposta é somente rascunho sem itens; o teste não cobre cálculo, revisão, exportação ou protocolo. Os documentos têm apenas metadados e caminhos fictícios; não há leitura nem upload de PDF. Não testa Storage por HTTP, concorrência da API, restauração de dump ou capacidade.

A migração e a comparação anterior permanecem concluídas no relatório `RESULTADO-MIGRACAO-EXECUTADA.md`. Este ensaio adicional também foi validado na execução documentada acima; os limites de JWT/HTTP, documentos, exportação, restauração e capacidade permanecem separados.
