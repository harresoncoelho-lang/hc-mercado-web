# Supabase: plano, consumo observado e capacidade comprovada

**O ambiente Free já executou a migração e seus gates. Isso valida essa operação no staging; não estabelece quantos clientes ou acessos simultâneos o produto suporta.** A ausência de benchmark não desfaz a migração comprovada.

Consolidação em **01/11/2026**, reutilizando evidências administrativas de 31/10 e do staging de 01/11. As regras públicas abaixo foram reconferidas hoje via Context7 e páginas oficiais. Não houve nova consulta privada, carga, benchmark, upgrade ou contratação nesta consolidação.

## Quotas públicas do Free

| Item | Regra pública consultada | Interpretação para a homologação |
|---|---|---|
| Banco | 500 MB por projeto | Limite de dados PostgreSQL; não é a capacidade de arquivos Storage |
| Arquivos Storage | 1 GB | Quota própria, compartilhada no âmbito da organização |
| Auth | 50 mil usuários ativos mensais | Franquia de uso; não equivale a 50 mil usuários simultâneos |
| Transferência sem cache | 5 GB | Envelope próprio de saída de dados |
| Transferência com cache | 5 GB | Envelope separado; não presumir intercâmbio com a franquia sem cache |
| Compute Free | CPU compartilhada e 500 MB RAM | Não determina latência ou throughput do módulo |
| Projetos ativos gratuitos | Até dois | Limite aplicado entre organizações em que a pessoa é Owner/Administrator |
| Inatividade | Pausa após uma semana | Precisa ser considerada na rotina de homologação |

Fontes: [preços e limites Free](https://supabase.com/pricing), [escopo das quotas e limite de projetos](https://supabase.com/docs/guides/platform/billing-on-supabase) e [transferência com/sem cache](https://supabase.com/docs/guides/platform/manage-your-usage/egress). As quotas de uso agregam projetos da organização, com a exceção expressa de tamanho de banco por projeto.

Ao ultrapassar 500 MB de banco no Free, o serviço pode entrar em modo somente leitura. A documentação distingue esse teto do espaço de disco, que também contém WAL e arquivos operacionais. Não converter o percentual de disco observado em produção para MB sem conhecer sua base e o tipo da métrica. [Tamanho de banco e disco](https://supabase.com/docs/guides/platform/database-size).

## Evidência real disponível

| Ambiente/data | Observação preservada | O que comprova |
|---|---|---|
| Produção, 31/10/2026 | Healthy, NANO; CPU 3%, disco 21%, RAM 55%; seis conexões de um limite exibido de 60 | Um instante de operação do projeto existente |
| Staging, 01/11/2026 | Organização Free, Healthy, NANO, região Canadá, PostgreSQL 17.11 | Destino isolado criado e operável, distinto da produção PostgreSQL 17.6 |
| Migração no staging | Bootstrap, rejeição do original, rollback e aplicação da variante concluídos | Compatibilidade do delta revisado com esse catálogo real |
| Pós-migração | 21 tabelas públicas vazias, zero usuários e objetos, bucket privado; 626 verificações offline aprovadas | Estado resultante e permissões comprovados, com volume de dados mínimo |

Os seis de 60 são **conexões PostgreSQL observadas**, não seis usuários ou capacidade para 60 clientes. CPU 3% e RAM 55% não medem picos, fila, cache, disputa de recursos ou margem sob carga. Não há medição atual consolidada de bytes livres, crescimento mensal, transferência restante, consultas por segundo ou concorrência aceitável do novo módulo. Nenhum desses números foi extrapolado.

O compute chamado NANO na interface não define sozinho o plano de cobrança. O staging Free está identificado em `ambiente.json`; a observação antiga de produção preserva o nome do compute e suas métricas. O projeto produtivo `lsqjamqvmrcyrvowndiu` permanece separado do staging `luguscapasskcsficckf`.

Evidências reutilizadas:

- `../ambiente.json`, registrado em 01/11 às 18:21 UTC; SHA-256 `e6b3f915c68584bd223978302895a4245105c8ac8e5b26ea671e1f73cebdf03e`. Seu estado inicial “somente leitura” é histórico; a execução posterior está no relatório de migração.
- `../../migracoes-capacidade-20261031/observacao-remota.json`; SHA-256 `95c9ab84f656d27df744d6c2c09871bee959b1c37481da91c18f976f218d862a`.
- `RESULTADO-MIGRACAO-EXECUTADA.md` e `comparacao-pre-posdelta-staging.json`, SHA-256 `9bb4b1168305045bba69e38f7fe626958f9e3fc0609767a8cefe05b57bf5d777`.

## Backup não se deduz da quota

A documentação oferece backups diários acessíveis nos planos Pro/Team/Enterprise e orienta projetos Free a fazer exportações próprias e manter cópias externas. Backups do banco incluem metadados, mas não os bytes dos objetos Storage. Essa regra exige uma prova de recuperação separada; criar tabelas ou fazer rollback não restaura um dump. [Backup oficial Supabase](https://supabase.com/docs/guides/platform/backups).

Na produção, a evidência de 31/10 listava oito backups físicos concluídos, de 24 a 31/10, e PITR desativado. Isso demonstra a listagem do provedor naquele momento, não um restore executado. No staging recém-criado havia “No backups”; nenhuma política de backup ou adicional foi contratado nesta frente. O inventário e a restauração do dump fictício têm acompanhamento próprio.

## Consequência prática

A homologação de banco pode seguir com fixtures pequenas no destino existente; a migração já foi demonstrada nesse plano. O ensaio RLS preparado é funcional e transacional, não teste de capacidade.

Antes de dimensionar a oferta comercial, faltará relacionar tamanho e número de documentos, frequência de leitura/exportação, consultas por jornada, usuários simultâneos e consumo medido do ambiente alvo. Esses dados podem sustentar uma decisão futura de plano; as franquias sozinhas não a sustentam. Qualquer custo novo continua sujeito ao aviso prévio solicitado pelo usuário.

O risco de CPU em **Cloudflare Workers Free**, documentado em `../../migracoes-capacidade-20261031/CAPACIDADE.md`, é outra camada. Sucesso SQL no Supabase não valida CPU, memória ou inicialização do Worker; a medição local anterior também não substitui a capacidade remota do produto.
