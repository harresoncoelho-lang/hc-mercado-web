# Próximo percurso Auth/Storage/UI — fixtures preparadas, não executadas

`FIXTURES-AUTH-UI.sql` é um seed separado, com COMMIT explícito para manter somente fixtures durante a jornada; não confundir com o ensaio de escala rollback. Não instala RPC nova. Execução depende de revisão e liberação da coordenação no projeto `luguscapasskcsficckf`.

## Antes do seed

- Handoff: `operador-a@qa.invalid` e `operador-b@qa.invalid` existentes/confirmados no Auth QA. Senhas ficam com o usuário, nunca no chat, script ou relatório. Script não cria login nem remove Auth users.
- Os dois registros `clientes` precisam estar aprovados por ação de QA separada e autorizada. O script não modifica dados preexistentes; se o trigger criou status pendente, aborta com pré-condição explícita.
- Nenhuma organização preexistente pode pertencer a esses usuários. IDs abaixo devem estar livres. Em conflito, diagnosticar; sem ON CONFLICT/UPSERT.
- Bucket privado e RPC de identificação existentes. O gate deve ser conferido com JWT QA real; presença da função não comprova permissão.
- A RPC de escala passou no ensaio com rollback, portanto não está instalada permanentemente. Salvar propostas de 51/200 permanece bloqueado pelo contrato de banco anterior até autorização/revisão de aplicação QA separada. Não promover implicitamente.

## Identidades constantes desta rodada

| Objeto | A | B |
|---|---|---|
| Organização | a1000000-0000-4000-8000-000000000001 | b1000000-0000-4000-8000-000000000001 |
| Empresa | a1000000-0000-4000-8000-000000000002 | b1000000-0000-4000-8000-000000000002 |
| Processo | a1000000-0000-4000-8000-000000000003 | b1000000-0000-4000-8000-000000000003 |
| CNPJ fictício de teste | 11222333000181 | 12345678000195 |
| Itens | a2000000-0000-4000-8000-000000000001 até ...000051 | b2000000-0000-4000-8000-000000000001 até ...000200 |

Resultado do seed registra UUIDs reais dos dois usuários, horário e baseline count/MD5 das tabelas public/auth/storage, sem conteúdo de senha/token. Salvar saída integral em artefato privado da rodada antes da UI. UUIDs de documento, objeto e peça criados depois devem ser acrescentados a `fixtures.jsonl` na confirmação de criação; não inferir propriedade por horário ou nome.

## Percurso que não finge identificação confirmada

1. Login QA no navegador interno com A. Conferir que B não é acessível; os dois contextos podem estar na lista do harness, mas o handler/RLS deve recusar o outro usuário. Repetir inverso com B.
2. Identificação começa pendente. Subir PDF inteiramente fictício pelo handler/UI de identificação existente para Storage QA; registrar UUID do documento, bucket/caminho e hash. **Não inserir `dados_confirmados`, `confirmado_em` ou proveniência vazia via SQL.**
3. Ler documento, revisar dados reais extraídos da fixture e confirmar pelo endpoint autenticado. Confirmar que proveniência aponta para bytes/arquivo daquela empresa. Documento de A não pode confirmar B. Falha de arquivo/permissão interrompe.
4. O harness atual serve apenas UI canônica do kit, não toda a interface de identificação. Integrar a UI existente de identificação numa rota QA revisada ou realizar esse passo pelo fluxo QA já aprovado; é dependência explícita, não um cadastro pronto por este seed.
5. Com identificação confirmada e RPC de escala instalada **somente quando separadamente autorizada**, escolher páginas, guardar/reabrir proposta, revisar integralmente, confirmar revisão e exportar. A=51, B=200. Totais esperados: R$127,50 e R$500,00. Registrar DOCX/hash/primeiro/último item.
6. Alterar fonte fictícia no Storage deve invalidar revisão. Restaurar bytes não basta: reconfirmar identificação, conforme diagnóstico de 31/10. Preservar negativa; nunca contornar o bloqueio para completar teste.

## Limpeza restrita — não liberada automaticamente pelo seed

Não apagar usuários Auth, clientes existentes, objetos por prefixo genérico ou organização por cascade indiscriminado. Primeiro comparar inventário com baseline e diário, incluindo peças/documentos/arquivos criados na UI. Remover bytes Storage apenas pelos caminhos exatos registrados e verificar ausência antes de qualquer exclusão de metadados; falha de Storage interrompe limpeza.

Depois da conferência, preparar transação de limpeza com allowlist literal dos IDs da rodada e condições de organização/empresa/processo/owner. Excluir somente itens determinísticos acima, peças/documentos/identificação listados no diário, membros dos dois usuários nas duas organizações e processos/empresas/organizações constantes. Se houver dependente não registrado, negar limpeza em vez de usar CASCADE. Contagens/hashes das linhas fora da allowlist devem continuar iguais. Os Auth users e clientes permanecem intactos para o handoff; não fazem parte da limpeza.

**Não há DELETE executável neste pacote:** antes da UI não existem os IDs dos objetos e peças que ele teria de proteger. Reutilizar o procedimento de inventário e limpeza dirigida de `homologacao-real-20261031/recuperar-limpeza-rodada-01.cjs` como referência, sem rodá-lo contra esta rodada (os IDs e destino são outros).
