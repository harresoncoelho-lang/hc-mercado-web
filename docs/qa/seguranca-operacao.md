# Segurança operacional — validação local

A migração `supabase/seguranca_operacao.sql` é incremental, idempotente e transacional. Não executa coletores, envia convites/e-mails nem altera dados existentes. Este roteiro não autoriza aplicação em produção.

## Ordem de aplicação

Em banco local descartável, aplicar as migrações da operação já existentes nesta ordem:

1. `operacao_licitacoes.sql` (base operacional; não existe `schema_operacional.sql` neste checkout).
2. `operacao_acompanhamento.sql` e as ampliações operacionais existentes.
3. `limite_cnpjs_operacao.sql`.
4. `acesso_empresa_convites.sql`.
5. `identificacao_empresa.sql`.
6. **Por último**, `seguranca_operacao.sql`.

Reaplicar migrações antigas de permissões depois da nova pode restaurar as regras vulneráveis. Nesse caso, reaplicar a nova migração e repetir a validação. O gate de identificação fecha se as policies esperadas forem removidas, alteradas ou se houver outra policy nas tabelas verificadas.

## Efeitos

- `leitura` consulta o próprio escopo, mas não insere, altera nem exclui dados operacionais ou objetos privados.
- `gestor`/`operador` escrevem somente no escopo permitido. A manutenção de empresas e tipos continua restrita ao membro sem `empresa_id`, como antes; o colaborador de uma empresa mantém a escrita nos documentos, processos e demais registros dessa empresa.
- As policies de consulta mantêm o acesso existente. As policies de escrita exigem papel autorizado, vínculo e organização/empresa coerentes.
- FKs compostas protegem documentos, processos, agenda, prazos e empenhos também quando o backend usa `service_role`. As tabelas de acompanhamento já tinham FKs compostas.
- Documento e anexo de processo só podem referenciar caminho do próprio CNPJ (`organizacao/empresa/arquivo`). `arquivo_caminho` nulo continua permitido em documento sem upload.
- A organização/empresa de um documento ou processo existente não pode ser transferida. Reenviar os mesmos IDs passa; para outro CNPJ, criar novo documento/processo. Os formulários atuais não transferem esses registros.
- A RPC de confirmação permanece exclusiva de `service_role` e agora valida também o papel do usuário informado, além do vínculo, cadastro e evidências já exigidos. Um backend não consegue confirmar identificação em nome de leitor.
- O bootstrap perde EXECUTE público/anônimo; usuários autenticados mantêm a chamada com as validações existentes.
- O gate `identificacao_empresa_habilitada()` continua retornando booleano, verifica RLS das tabelas privadas e de `storage.objects`, bucket, comandos/papéis/expressões exatas das policies e os corpos dos cinco helpers novos. As impressões MD5 são de integridade de definição, não de dados nem credenciais; ignoram CRLF. Alterações legítimas nesses helpers exigem revisão do gate e dos testes na mesma mudança.

## Dados legados e rollback

A migração verifica previamente inconsistências entre organização, empresa, processo e caminhos de arquivo. Se encontrar alguma, aborta com `Escopo legado inconsistente...`; não move nem corrige dados silenciosamente. Revisar os registros num ambiente autorizado antes de nova tentativa.

A transação impede aplicação parcial; o teste `--legacy` comprova que helpers novos não permanecem e os documentos antigos não são apagados após o erro. Depois de uma aplicação bem-sucedida, não há rollback automático para as permissões vulneráveis. Uma reversão administrativa precisa de revisão própria; não reaplicar migrações antigas como procedimento de recuperação.

## Executar os testes

Usa somente PGlite já instalado, em memória, com usuários e dados fictícios. Nenhuma dependência nova.

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node docs/qa/testar-seguranca-operacao-local.cjs --baseline
node docs/qa/testar-seguranca-operacao-local.cjs
node docs/qa/testar-seguranca-operacao-local.cjs --legacy
node docs/qa/testar-decisao-local.cjs
npm run verify
```

`--baseline` deve falhar: comprova que o SQL anterior permite ao leitor inserir documento. O modo padrão deve passar e executa também o roteiro anterior `testar-identificacao-empresa-local.sql` sem alterar seu conteúdo. `--legacy` deve passar ao comprovar rejeição segura da migração.

Cobertura: leitor restrito e leitor da organização; CRUD legítimo do operador/proprietário; documentos, processos, contratos, itens, agenda, prazos, empenhos, ocorrências, anexos, renovações e storage; tipos/membros; anônimo; outra organização e empresa; reparent bloqueado; RPC privada, papel e evidência cruzada; gate ausente/permissivo e desativação/reativação de RLS em `storage.objects`; repetição da migração e rollback.

## Limites

PGlite executa PostgreSQL real e RLS, mas a fixture mínima de `auth`/`storage` não substitui integração com GoTrue, PostgREST, upload/download do Supabase Storage e navegador. Produção não foi acessada. O gate compara expressões decompiladas por PostgreSQL: diferenças de versão/formatação podem fechar o gate com segurança; validar a mesma migração no stack local de homologação antes de implantar.

A migração não altera o resumo de edital, boletim, provedores, agendamentos ou geração do kit. A camada que usa chave de serviço continua responsável por autenticar o usuário antes de informar `p_usuario` à RPC; essa chave continua tendo poder administrativo por definição.
