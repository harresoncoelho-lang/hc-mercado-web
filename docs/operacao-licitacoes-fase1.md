# Central Operacional de Licitações — diagnóstico e implantação

## Diagnóstico técnico

O produto atual já entrega descoberta de oportunidades, boletim, inteligência de mercado,
pesquisa de preços e um Kanban local. O Kanban, filtros e lembretes são vinculados ao
navegador (`localStorage`), portanto não formam uma operação compartilhável nem uma
trilha confiável para assessorias. Também não existe hoje uma entidade de empresa cliente
separada do usuário autenticado, nem repositório privado de documentos ou agenda única.

Problemas observados na página pública:

- A prévia de convênios podia permanecer em `Carregando dados...` quando a chamada ao CDN
  não respondia. O cliente agora encerra a espera após 12 segundos e mostra a mensagem de
  recuperação já prevista na interface.
- O login exige `clientes.status = aprovado`; a aprovação manual é uma regra explícita do
  fluxo atual, não um erro visual. A troca por aprovação automática deve ser uma decisão
  de risco/fraude e não foi alterada nesta fase.
- Não há uma estratégia pública de planos pronta. Não foram criados preços nem cobrança:
  antes disso é preciso decidir limites por usuário, arquivos, IA e volume de consultas.

## Modelo de dados proposto

`operacao_organizacoes` é o isolamento principal (empresa individual ou assessoria).
`operacao_membros` cria a base para gestor, operador e leitura. Cada organização possui
múltiplas `operacao_empresas`; assim uma assessoria não mistura dados de clientes.

Na fase inicial, `operacao_documentos` armazena metadados, vencimentos e referência a
arquivo privado no Supabase Storage. `operacao_renovacoes_documento` preserva o histórico
de cada renovação. `operacao_agenda` reúne tarefas e marcos por empresa. Todas as tabelas
possuem RLS baseada em associação explícita do usuário à organização; arquivos também
ficam em bucket privado segregado pelo UUID da organização.

## Fases

1. **Entregue localmente:** Central Operacional autenticada; empresa inicial criada a
   partir do cadastro, múltiplas empresas, cadastro de documentos, anexos privados,
   status de validade, prontidão, agenda e exportação CSV.
2. **Gestão da disputa:** substituir/estender o Kanban local por licitações persistentes,
   com o funil completo, itens, proposta, concorrentes, lances, resultado, responsáveis,
   anexos e atividade auditável.
3. **Agenda e notificações:** gerar eventos a partir de documentos e disputas; configurar
   alertas em 30/15/7/3/1 dias; e-mail e painel de pendências por responsável.
4. **Relatórios e assessorias:** relatórios de resultado, motivo de perda e volume; painel
   consolidado de carteira; gestão de usuários/permissões e exportações PDF/Excel.
5. **Comercial e integrações:** definir custos e limites reais por recurso antes de expor
   planos públicos; conectar o HC Licitações somente por contratos de API explicitamente
   autorizados, sem compartilhar bases privadas por padrão.

## Como ativar a fase 1

1. No Supabase do LicitaPlena, abra **SQL Editor**.
2. Execute integralmente `supabase/operacao_licitacoes.sql`.
3. Publique os arquivos do repositório e acesse `operacao.html` após fazer login.

Sem a migração, a Central informa claramente a dependência e não grava dados no navegador
nem expõe documentos.
