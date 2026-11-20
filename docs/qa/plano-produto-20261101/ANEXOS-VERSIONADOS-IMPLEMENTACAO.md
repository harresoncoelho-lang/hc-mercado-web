# Anexos versionados — implementação local, não ativada

Reutiliza `operacao_anexos_processo` e upload existente de `operacao-acompanhamento-ui.js`. O handler `netlify/functions/anexos-evidencias.js` recebe autenticação/transporte confiáveis injetados pelo host: `criarHandler({enabled,auth,request})`. Auth retorna userId verificado; `request(path,options,event)` deve usar JWT do usuário nas leituras e credencial de servidor APENAS nas duas RPCs marcadas privileged, com destino fixo no mesmo projeto e prazo máximo. Não aceitar path/config do browser. Nenhum host vivo, rota produtiva ou helper Auth foi alterado. Há wiring de UI no painel existente via dependência `evidenciasAnexo(body)`; sem essa dependência o botão não aparece. Ativar exige composição do host coordenada e migração previamente validada.

Ações: ler→baixa bytes por caminho registrado, extrai páginas, registra SHA256/versão; consultar→recalcula hash e exige versão persistida; selecionar→exige hash mostrado e relê bytes antes de registrar seleção. Toda ação revalida escopo perto da resposta. PDF empresarial, resumo, e-mail e boletim permanecem intocados.

`_anexo_pdf.js` é separado: PDF textual até2MiB/20páginas/150mil caracteres/10s. Nenhuma truncagem silenciosa ou OCR. Arquivo original não é alterado. Extrator usa PDF.js já instalado, sem dependência nova. PDF malformado/semtexto/excesso falha e preserva o arquivo.

SQL `supabase/anexos_evidencias.sql` preparado NÃO APLICADO: versões imutáveis por(anexo,hash), seleção única, RLS leitura por processo/empresa/cliente aprovado, RPC escrita apenas service_role rechecando usuário aprovado, papel gestor/operador e carteira. Nova versão observada remove seleção anterior. Não há grants de escrita para authenticated nem alteração de Auth. `testar_anexos_evidencias.sql` preparado com rollback, fixtures QA existentes, sem criação de usuários/Storage/rede.

A revisão significa somente versão selecionada pelo operador. Não comprova vigência jurídica ou ausência de retificações. Não é traduzida para `grounded-answer.documentState.situacao=vigente`; adaptação semântica continua pendente. Fonte exibida é nome+anexoId e o botão existente de abrir arquivo, não URL fictícia nem signed URL em referência.

Limites: testes Node com PDF real fictício e doubles comprovam extração/composição, não RLS/Storage real nem execução SQL. Storage pode mudar após a última leitura; consulta sempre revalida bytes, mas não se promete snapshot transacional entre Storage e Postgres. Timeout/restrição do transporte pertencem ao host confiável e são requisito para ativação. Revisor independente deve verificar SQL e integração antes do próximo gate.

## Ensaio RLS preparado — ainda não executado

`supabase/testar_anexos_evidencias.sql` agora alterna explicitamente para `authenticated` com claims A/B e confere `auth.uid()`: leitura própria positiva e leitura cruzada vazia nas duas direções. Exercita papel `leitura`, negação efetiva das duas RPCs de escrita, vínculo revogado e empresa desativada. Os casos administrativos iniciais continuam verificando imutabilidade/seleção e escopo da RPC; não são usados como prova de RLS.

Somente QA `luguscapasskcsficckf`, com migração já presente e fixtures A/B existentes, confirmadas, aprovadas e com vínculos de operador por empresa. O marcador `CONFIRMAR_QA_EXTERNAMENTE` bloqueia o script por padrão. Após conferir o destino externamente, o coordenador pode substituí-lo pelo ref QA. Essa declaração não detecta o projeto real: PostgreSQL não fornece aqui uma identidade confiável de project-ref. Não executar em produção nem ampliar grants para fazer o ensaio passar.

Usar sessão exclusiva sem atividade concorrente e executar integralmente. Cria somente anexos/evidências sintéticos e uma tabela temporária de IDs; não cria usuários, objetos Storage ou chamadas HTTP. Papel, vínculo e `ativo` são modificados apenas na transação. Um savepoint restaura o vínculo entre casos; `RESET ROLE` separa cada fase; `ROLLBACK` final restaura tudo, inclusive metadados originais do membro. Qualquer erro exige parar e emitir `ROLLBACK` na mesma sessão, sem tratar a linha de sucesso anterior como prova de preservação pós-rollback. Conferir o estado original novamente fora da transação antes de registrar sucesso.

Claims SQL simulam a identidade para exercitar policies sob o papel real; não validam assinatura JWT, Auth HTTP, upload, Storage ou extração PDF. Preparação e verificações estáticas não equivalem à execução deste ensaio ou à homologação RLS.
