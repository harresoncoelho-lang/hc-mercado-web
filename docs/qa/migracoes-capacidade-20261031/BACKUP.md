# Backup e recuperação — evidências de 31/10 e validação local de 01/11/2026

**Estado: cópias locais dos dois objetos do Storage reconciliadas em 01/11; recuperação completa ainda não demonstrada.** Identidades, campos exportados e tamanhos conferem nas duas capturas de 31/10. Foram calculados SHA-256 locais. A cópia está na mesma máquina, não é offsite e não foi restaurada. Sem SHA-256 da origem, não há prova de igualdade criptográfica entre a origem e os downloads. A integridade dos dois dumps locais de homologação foi confirmada na auditoria anterior; os backups físicos de produção apenas constavam como concluídos no provedor.

Esta auditoria não iniciou Docker, serviços, interfaces nativas ou conexões privadas. Não leu credenciais, dados de negócio ou conteúdo textual dos documentos. Não alterou produção, configurações, resumo, e-mail ou robô. O inventário inicial dos dumps leu bytes para tamanho, cabeçalho e SHA-256. Na retomada, os PDFs foram lidos exclusivamente pelo cálculo de SHA-256, sem renderização, extração de texto ou inspeção de cabeçalho. Somente os CSVs privados de metadados foram interpretados.

## Cópia privada do Storage — validação de 01/11/2026

O [novo inventário sanitizado](backup-storage-inventario-20261101.json) complementa o [inventário inicial](backup-inventario.json), preservado sem alteração. O manifesto completo e o verificador permanecem no diretório privado de backup, fora do worktree. Nenhum caminho de objeto, nome original, identificador ou hash por documento foi incluído no novo relatório compartilhado.

- Duas linhas em cada CSV; dois arquivos locais; correspondência 1:1 por bucket, caminho e identificador. Nenhuma identidade duplicada, ausente ou alterada.
- Cada download foi associado exclusivamente ao prefixo de basename registrado na retomada. A ordem das linhas dos CSVs não foi usada como identidade.
- Os nove campos exportados relativos ao objeto permaneceram iguais: identificador, bucket, caminho, criação, atualização, versão, tamanho declarado, última modificação e ETag. O horário de observação foi tratado separadamente; a captura posterior sucede a anterior. O JSON completo de metadados não estava nos CSVs e não foi comparado.
- Tamanhos individuais confirmados: **80.003 e 7.596.002 bytes**, total **7.676.005 bytes**. Zero cópias ausentes ou com tamanho divergente.
- Dois SHA-256 calculados e registrados somente no manifesto privado. Tamanho, horário de modificação e identidade local dos arquivos permaneceram estáveis durante a leitura de hash. Os hashes estabelecem uma referência para futuras verificações dessas cópias.
- O verificador passou em **22 verificações sintéticas**, incluindo reordenação válida, divergências de identidade e metadados, objeto ausente ou duplicado, seleção errada, tamanhos individuais trocados mantendo o total e caminhos locais/de origem inadequados.

O ETag foi comparado como marcador de alteração, sem assumir que equivale a SHA-256 ou a outro hash utilizável da origem. A evidência cobre exatamente os dois registros dos CSVs fornecidos; não houve nova enumeração remota nem prova de snapshot transacional. A estabilidade dos campos exportados não prova igualdade criptográfica dos bytes com a origem, nem garante que todos os metadados do Storage ficaram estáveis.

**Limites mantidos:** cópia na mesma máquina; nenhuma cópia offsite verificada; nenhum banco físico de produção baixado; nenhum arquivo ou banco restaurado; nenhum RPO/RTO medido. A recuperação conjunta de banco, arquivos e permissões permanece pendente.

## Evidência local

Foram relidos [HOMOLOGACAO.md](../homologacao-real-20261031/HOMOLOGACAO.md), [PREPARACAO.md](../integracoes-producao-20261031/PREPARACAO.md) e os manifestos referidos no [inventário sanitizado](backup-inventario.json).

| Artefato privado de homologação | Bytes | SHA-256 verificado agora | Índice validado na homologação anterior |
|---|---:|---|---:|
| `antes-kit-documentos-20261031T020748Z.dump` | 489.155 | `8f2b1dcce8d6fd6d80626e897820245c9a3bd38d7c04e7fd021ac14f1bdbf57f` | 795 entradas |
| `antes-correcao-acl-20261031T022043Z.dump` | 505.274 | `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c` | 812 entradas |

Ambos mantêm tamanho e hash registrados, com cabeçalho `PGDMP`. São dumps do **banco local de teste**, não de produção. O índice não foi reexecutado nesta etapa. Hash e índice legível não provam que roles, extensões, permissões e dados possam ser restaurados corretamente.

Também foram inventariados oito artefatos legados de preservação — um SQL e sete JSON — sem examinar seus conteúdos. Não foram classificados como backup completo ou utilizável para recuperação.

A evidência anterior registra os volumes `licitaplena-qa-real_dados` e `licitaplena-qa-real_arquivos` preservados após desligamento. O estado atual dos volumes e seus bytes não foi inspecionado. O manifesto final anterior conta **um bucket e cinco registros em `storage.objects`**: isso prova metadados naquele teste, não cinco arquivos íntegros recuperáveis. No levantamento inicial de 31/10, não foi encontrado manifesto de cópia independente com hashes por arquivo nos locais auditados. A cópia privada validada em 01/11 cobre os dois objetos dos CSVs de produção, não aqueles cinco registros do teste local.

As portas locais conhecidas da homologação — 8792, 56321, 56322, 56324 e 56325 — estavam sem listeners. `psql` e `pg_restore` não foram encontrados no PATH nem uma instalação na pasta padrão consultada. Essa verificação não é um inventário completo da máquina. Não há executor e destino isolado disponível e autorizado nesta etapa.

## Evidência do provedor

A coordenação inspecionou a interface administrativa pelo navegador interno, somente leitura. Sua evidência está em [observacao-remota.json](observacao-remota.json). Este agente não operou essa interface.

- Oito backups **PHYSICAL**, de 24 a 31/10, constavam como **COMPLETED** na tela de restauração para novo projeto. O mais recente é de **31/10/2026 às 05:16:47 UTC**.
- A interface informa que os bytes do Storage não estão incluídos.
- PITR não está habilitado; a interface oferece o adicional. Nenhum adicional foi contratado.
- Projeto Healthy, compute NANO e nenhuma branch disponível. Nenhum destino de restauração foi criado, nem botão Restore acionado.

Essas observações não comprovam retenção contratada, cópia externa própria, restauração bem-sucedida ou SLA. A documentação distingue o backup do banco dos objetos de Storage e descreve retenção por plano; não inferimos o plano a partir do compute ou da quantidade de backups visíveis. [Backups do Supabase](https://supabase.com/docs/guides/platform/backups).

## Bloqueios concretos

1. Falta um destino isolado e um executor autorizados para o ensaio. Iniciar o ambiente local existente ocuparia recursos da máquina e não foi feito.
2. A lista de backups concluídos não substitui o teste de recuperação. Os backups de produção não foram baixados nem restaurados.
3. A cópia local dos **bytes** dos dois objetos foi reconciliada, com manifesto e hashes privados. Faltam destino independente da máquina, comparação criptográfica com a origem e ensaio de recuperação. Não houve nova enumeração além dos CSVs capturados.
4. A coordenação concluiu o inventário sanitizado de extensões e triggers, descrito no adendo abaixo. Isso não examina os corpos das funções nem certifica ausência de ações externas. O [SQL sanitizado preparado](inventario-automacoes-somente-leitura.sql) não retorna comandos, corpos de funções, URLs, headers ou segredos.
5. É preciso conciliar banco, roles/ACL/RLS, configurações de Auth, bucket e arquivos no mesmo ensaio. Não há RPO/RTO medidos.

**Não usar clone físico como atalho de isolamento.** O Supabase informa que extensões de operações externas, como `pg_cron`, `pg_net` e wrappers, são copiadas e podem executar assim que o clone termina; não há exclusão prévia nesse fluxo. O clone também cria custo e não copia os objetos/configurações de Storage nem todas as configurações de Auth. A documentação recomenda restauração lógica quando é necessário examinar/remover operações externas antes de executarem. [Restaurar para novo projeto](https://supabase.com/docs/guides/platform/clone-project).

## Procedimento mínimo para o próximo ensaio autorizado

**Primeiro: recuperar o dump fictício existente.** Selecionar o dump de 812 entradas, sem sobrescrever nenhum artefato. Criar destino vazio separado dos volumes e bancos atuais, com versões compatíveis de PostgreSQL/Supabase e saída de rede bloqueada antes de carregar qualquer objeto. Desabilitar execução de tarefas externas na configuração desse destino, sem alterar produção. Registrar host, banco, versão, hash da origem e prova do bloqueio de rede; nunca colocar senha ou URL com credenciais em comandos/logs.

1. Obter a lista do custom dump com `pg_restore --list` e conservar a lista original. Preparar uma lista de restauração derivada e revisada, via `--use-list`, separando objetos de tarefas, extensões externas e triggers suspeitos. Não executar o SQL exportado antes da revisão. Uma lista filtrada serve ao ensaio contido; não equivale a restauração integral. Documentar cada exclusão e sua dependência. Não omitir RLS, ACL ou ownership para fazer o teste passar.
2. Provisionar as roles/extensões esperadas no destino isolado. O dump de um banco não substitui o inventário de roles do cluster. Restaurar com falha imediata e transação única quando compatível, sem `--clean` sobre banco existente e sem atalhos `--no-owner`/`--no-acl`. Se uma dependência impedir a transação, parar, preservar logs e revisar; não improvisar permissões. As opções e o destino precisam ser revisados antes da execução. [Restauração lógica Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
3. Conferir tabelas, índices, funções, constraints, políticas e grants contra os manifestos de origem. Executar testes com contas fictícias: CNPJ correto acessa, outro CNPJ e usuário sem sessão não acessam, troca de identidade não permite leitura/escrita. Manter SMTP e tarefas externas bloqueados. Medir duração real e registrar falhas.

**Depois: comprovar recuperação de arquivos.** A cópia privada dos dois objetos de 31/10 está pronta para servir como origem de um futuro ensaio autorizado. Antes desse ensaio, reconciliar a abrangência e o momento da captura com o banco escolhido; qualquer nova coleta precisa preservar o manifesto existente. Usar somente acesso já autorizado para enumerar todas as páginas/prefixos do bucket e copiar os bytes a um destino privado independente. Não criar chaves ou habilitar S3 por conveniência nesta fase. Registrar bucket/caminho, tamanho, SHA-256, versão ou marcador de alteração disponível e horário em manifesto privado; o relatório compartilhado terá somente totais e resultados. As opções oficiais de download incluem clientes e ferramentas de migração. [Download de objetos](https://supabase.com/docs/guides/storage/management/download-objects).

4. Detectar alterações durante a cópia por janela controlada ou reconciliação posterior; não alegar snapshot transacional. Qualquer objeto ausente, alterado ou ilegível fica pendente explicitamente.
5. Restaurar arquivos no Storage isolado, com os mesmos caminhos e vínculo de proprietário/empresa, conciliando metadados e bytes. Comparar todos os hashes e tamanhos e provar acesso autorizado e negação entre CNPJs. Uma cópia de `storage.objects` não substitui esse passo.
6. Somente após aprovação desse ensaio preparar recuperação de uma origem real em destino separado, com custo e tratamento de dados definidos. O sucesso do dump fictício não certifica recuperação de produção. Preservar backups, volumes e evidências originais.

Conclusão futura exige: inventário reconciliado, zero arquivos obrigatórios pendentes, hashes conferidos, testes de autorização aprovados e duração medida. O RPO deve considerar separadamente o horário do banco e a captura dos arquivos. Não existe garantia de recuperação ou prazo de restauração comprovado neste relatório.

## Adendo da coordenação — inventário remoto executado

A coordenação executou a fase A em uma única consulta JSON, envolvida em `BEGIN READ ONLY` e timeouts. Resultado integral exportado pelo SQL Editor em `automacoes-producao-20261031.csv` e `.json`; SHA-256 do JSON `209bb2fb4a0314f6bc3004b5f0637260c8d3153f26927460a236d860f0bcfca8`. A transação confirmou `read_only=on`.

Foram observadas seis extensões: pg_stat_statements, pg_trgm, pgcrypto, plpgsql, supabase_vault e uuid-ossp. `cron.job` não existe nesse banco observado; portanto a contagem da fase B não foi executada. Onze triggers não internos foram identificados somente por nomes, estado, tabela e função. Não foram consultados comandos, argumentos, configurações do Vault, corpos de trigger ou dados de clientes.

O recorte não encontrou pg_cron/pg_net/wrappers instalados. Isso reduz o risco específico dessas extensões, mas não certifica ausência de efeitos externos em funções ou configurações fora da consulta. A restauração permanece não executada e não autorizada por este inventário. A pendência de cópia local dos dois objetos foi atendida pela validação de 01/11; destino independente e ensaio de recuperação continuam abertos.
