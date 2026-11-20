# Ato QA de escala — preparado, não executado

Destino exclusivo: projeto `luguscapasskcsficckf`. SQL não consegue provar project-ref: conferir URL/conexão externamente antes de qualquer ato. Revisão independente antes de execução. Não produção.

1. Rodar somente `ATO-ESCALA-00-CAPTURAR.sql` (readonly): exige baseline atual MD5 `64c94369bded0ca5721959406a8d5434`, assinatura/owner/ACL esperados. Salvar JSON completo retornado em arquivo local. Ele inclui definiçãoEXATA pg_get_functiondef, metadados, ACL e `rollbackSql` completo gerado com essa definição. Não inventar backup a partir da formatação do arquivo.
2. Conferir backup salvo e extrair `rollbackSql` para arquivo separado antes de aplicar. Se resultado truncado/ausente, parar. Não há backup de dados nem alteração dos usuários existentes.
3. Após revisão, executar `ATO-ESCALA-01-APLICAR.sql`: janela QA sem operações concorrentes, lock na tabela kit, CAS de baseline novamente, substituir somente função ensaiada, validar corpoMD5 candidato e mesmos metadados/ACL, só então COMMIT. Sem GRANT/REVOKE novo. Falha aborta, exige ROLLBACK explícito pelo operador se editor mantiver transação.
4. Guardar resultado e conferir função atual. Retomar homologação Auth/UI/REST separadamente; aplicação não prova essas etapas.

Reversão gerada captura definição exata e só roda se candidato/metadata ainda coincidirem. Recusa caso existam peças que usem mais50 itens ou rascunhos incompatíveis com teto antigo50k: não reduzir limite deixando dados ineditáveis. Nesse caso preservar função/dados e planejar reversão compatível. Reversão não altera grants e confirma MD5/ACL/meta após restaurar. Não executar cegamente.

Fonte é exatamente `supabase/kit_documentos_escala_proposta.sql` SHA256LF `f5a8da7bcfaca55e9a331b7c6b051ae778394467e12aa049af899399bba43d0a`, presente no ensaio rollback b128… já validado pela coordenação. MD5 corpo candidato `a1c37914704cdb3dce5fb6dc056e9896`. Hashes dos atos em `ATO-ESCALA-manifesto.json`. Um teste estático passou; nenhum ato foi executado nesta tarefa.

Advisory lock coordena estes atos; administradores externos que o ignorem continuam exigindo janela sem DDL concorrente. Preservam-se autenticação, resumo/e-mail/boletim e dados existentes; muda apenas a RPC do kit de QA. Não há cópia de dados, segredo ou chamada externa.
