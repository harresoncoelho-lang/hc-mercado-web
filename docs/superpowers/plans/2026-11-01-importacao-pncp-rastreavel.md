# Importação PNCP rastreável — plano local

Objetivo: item oficial consultado pelo servidor entra no cadastro interno existente com proveniência versionada; não vira ID Compras.gov.

1. TDD do handler autenticado: seletores apenas, reuso contexto/autorização, origem fixa GET item, limites de resposta/tempo e reserva de cadência persistida7s; RPC grava atomically item+observação, idempotente. Fonte alterada não sobrescreve oferta ou documento revisado.
2. Migração preparada com duas RPCs service-only, escopo revalidado e FK; reserva global de origem e importação. Não aplicar SQL.
3. Trocar botão de cópia PNCP na tela processos por ação autenticada e refresh da lista existente; cadastro manual continua. Adicionar rota allowlisted sem publicar.
4. Testes locais/fetchfake/SQLestático e revisão. Sem modificar QA harness de outros agentes. Docs públicas endpoint: https://pncp.gov.br/manual/pt-br/2.5/contratacao/consultar_item_de_uma_contratacao.html .

Limites: uma observação por item, não catálogo completo; referência do processo é candidato verificado pela resposta na URL oficial, não confirmação Compras.gov. Valores da oferta não vêm do preço estimado PNCP. Migração e origem real permanecem não homologadas.
