# Migrações, ambiente, recuperação e capacidade

Pedido autorizado em 31/10/2026: preparar migrações e permissões faltantes e validar ambiente, backup e capacidade, sem publicação ou alterações no resumo, e-mail e robô.

## Limites

Trabalho local e consultas administrativas de leitura pelo navegador interno. Não aplicar SQL em produção, habilitar recursos, criar ambientes pagos, revelar credenciais, publicar, fazer push, iniciar Docker ou controlar aplicativos nativos. Preservar os 20 arquivos protegidos e todas as evidências anteriores. Dados pessoais não devem entrar nos relatórios. A inspeção do catálogo só lê metadados; não busca registros de clientes.

## Tarefas e aceitação

- [x] Inventariar catálogo/ACLs/RLS necessários no Supabase, com consulta explicitamente de leitura e inventário sanitizado. Recorte de 31/10 documentado; não é catálogo global ou prova do estado atual.
- [x] Preparar deltas mínimos transacionais e gates de pré/pós-condição. Sem reaplicação da base antiga. Correção mínima de ACL, 595 verificações e revisão independente do candidato final concluídas em 01/11.
- [x] Validar evidências de backup e distinguir banco, arquivos Storage e ensaio de restauração. Duas cópias locais reconciliadas; restauração e cópia independente continuam pendentes. Procedimento preparado sem restaurar sobre produção.
- [x] Conferir isolamento do preview e capacidade Free; comparar pacote local com limites oficiais e uso observado. Isolamento remoto e capacidade não aprovados: preview aponta à base de produção; perfis locais sinalizam risco de CPU. Relatórios registram as provas que faltam.
- [x] Verificar artefatos, revisão, hashes protegidos e entregar resultado com pendências reais, sem publicação. Relatório ENTREGA-20261101.md; 20/20 protegidos iguais e zero workerd ativo.

## Execução

Coordenação opera IAB e mantém continuidade. Especialista de banco prepara SQL/QA; especialistas de infraestrutura fazem inspeções independentes de capacidade e backup. Não há implementação paralela de arquivos compartilhados.

Base: preparação final de integrações de 31/10, rodada-04-leitor-pdf e homologação real anterior. Não repetir a suíte geral sem mudança nova que a justifique.

## Encerramento da preparação — 01/11/2026

Os itens acima encerram a preparação e a avaliação das evidências, não a homologação remota ou a liberação para produção. Continuam pendentes: destino isolado, ensaio do delta em PostgreSQL 17.6 com serviços reais, recuperação de banco/Storage e medição remota de capacidade. Nenhum recurso pago, publicação ou alteração de produção foi autorizado por este fechamento.
