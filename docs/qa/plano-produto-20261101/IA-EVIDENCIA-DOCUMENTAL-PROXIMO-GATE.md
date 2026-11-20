# Próximo gate: evidência documental especializada

Inspeção local em 02/11/2026; sem serviço, segredo, SQL ou código alterado. Este arquivo é plano, não comprovação de homologação.

## Decisão

O próximo incremento deve ligar **um anexo de edital de um processo autorizado à leitura de evidências**, com versão registrada e seleção documental revisada. Não adicionar provedor. O menor resultado útil é a tela mostrar trecho, página, hash e origem de um PDF armazenado, e validar uma resposta candidata estruturada contra essa evidência. Enquanto a vigência não for comprovada, retornar insuficiente: não fabricar `situacao: vigente` para fazer o validador passar.

Há bloqueio real de dados, não falta de prompt. `integracao-ia/grounded-answer.mjs` exige empresa/CNPJ/processo/documento/versão/situação vindos do repositório. Nenhuma API atual oferece esse conjunto para edital.

## Reúso e lacunas comprovadas

- `supabase/operacao_acompanhamento.sql:74`: `operacao_anexos_processo` tem UUID, organização, processo, tipo, título e arquivo_caminho/nome. FK composta liga ao processo. Não possui hash, revisão vigente, páginas ou retificações.
- `processos.html:145` já consulta anexos por processo. Deve receber acesso à evidência na mesma jornada, não novo chat desconectado.
- `netlify/functions/empresa-identificacao.js`: ação extrair baixa documento autorizado, calcula SHA256; confirmar relê bytes e confere hash/página/trecho. É padrão útil de confiança, mas documentos empresariais não são edital. Não chamar essa ação para anexo de processo nem alterar o handler.
- `supabase/identificacao_empresa.sql`: proveniência e versão do perfil confirmado, invalidado por mudança/remoção. Isso comprova cadastro empresarial revisado; não vigência de edital nem histórico de retificação. Não reaproveitar versão do perfil como versão documental do processo.
- `_empresa_pdf_leitor.js`: leitor exclusivo empresarial, limitado a2MiB/8páginas. Não ampliar seus limites ou usá-lo silenciosamente como leitor genérico de editais. A experiência com PDF.js pode orientar um leitor de anexos separado, com orçamento explícito e resultado parcial insuficiente.
- `supabase/importacao_item_pncp.sql`: observações versionadas de JSON de item; não PDF/páginas. `hash_atual`/`estado` não viram versão/situação de edital. Observações sequer estão liberadas ao authenticated pelo contrato atual.
- `integracao-ia/private-handler.mjs` e `private-transport.mjs`: hoje somente empresas e três tabelas; não fingir que o transporte já autoriza anexos/Storage.

## Menor patch completo proposto

1. Preparar migração isolada para evidências de anexo: FK para anexo/processo/organização; versão SHA256 dos bytes; extratorVersao; páginas/trechos; leitura completa ou incompleta; revisão documental explícita com versão escolhida e estado pendente/conflito/aprovada. Hash é identidade técnica, não comprovação de vigência jurídica. Aprovação descreve versão selecionada para esta análise, sujeita a novas retificações.
2. Na jornada de anexos existente, preparar leitura do arquivo já armazenado, usando JWT/RLS e processo→empresa verificados. Origem permitida vem do caminho no banco, nunca URL enviada por cliente/modelo. Persistência somente por operação autenticada e escopo validado, sem grants amplos. Exibir evidência antes de revisão. Não aplicar SQL neste estágio.
3. Adaptador de repositório conecta esse registro a `validateGroundedAnswer`: revalida sessão, cliente aprovado, membro, empresa/CNPJ, processo e anexo; filtra tudo em todas consultas; verifica hash dos bytes e versão de revisão. Seleção técnica pelo operador NÃO se traduz para `documentState.situacao='vigente'`: comprova apenas quais bytes foram selecionados para revisão. O contrato atual de `validateGroundedAnswer` continua exigindo vigência comprovada e deve retornar insuficiente diante desses metadados técnicos. Pendência, conflito, remoção, fonte nova ou leitura incompleta também impedem conclusão. Um contrato futuro para validação estrutural na versão selecionada precisa ser explicitamente distinto, sem alterar ou relaxar a entrada existente; não está implementado nem autorizado por este documento.
4. Evidência recebe ID persistido e fonte identificável da aplicação (não URL pública do bucket). Conferir acesso ao abrir a fonte; não expor signed URL duradoura/token em citações. Campo fonte atual aceita URL, portanto definir rota autenticada de visualização de anexo antes de citar, sem inventar URL não funcional.
5. Primeiro ensaio sem modelo: resposta candidata fixture com referência verdadeira passa estruturalmente; referência errada é recusada. UI deve dizer validação estrutural, não resposta jurídica verificada. Nenhuma chamada ChatGPT/Claude/Gemini.

## Teste que prova a ponte

Teste integrado com PDF fictício real armazenado em double de Storage e metadados fixture: extrair trecho na página conhecida → salvar versão/evidência → revisar versão → carregar pelo adaptador com JWT → validar referência. A versão retornada deve ser SHA256 dos bytes efetivamente lidos, não string constante. Trocar bytes após revisão deve impedir conclusão. Mesmo documentoId sob outra empresa/processo/organização retorna negação antes do download. Testar revogação entre leitura e resposta, remoção, retificação conflitante, página inexistente, chunk inventado, resposta truncada e instrução hostil dentro do PDF como texto sem autoridade.

Posteriormente repetir em QA com fixtures e RLS/Storage reais; teste local não prova policy remota. O validador atual consulta no máximo50 evidências e recusa hasMore: manter esse limite explícito neste gate; seleção por pergunta não pode ser usada para esconder versão conflitante. A implementação não deve declarar suporte a edital longo enquanto extrator e orçamento não forem medidos.

## Ordem / ponto de autorização

Não começar modificando `grounded-answer` ou inventando provider. Primeiro confirmar implementação atual de upload/Storage dos anexos e policy por empresa; preparar versão documental+revisão como parte do módulo de anexos. Sem isso, o incremento honesto é consulta de fonte com estado pendente, sem conclusão. O padrão empresarial pode ser demonstrado separadamente, mas não substitui a evidência de edital pedida.

## Retificação do plano — incompatibilidades verificadas

A redação anterior do item3 confundia seleção técnica com vigência; foi corrigida. Nenhum runtime foi alterado nesta retificação. O comportamento atual permanece insuficiente sem vigência comprovada.

- `grounded-answer.mjs` aceita somente situação `vigente`; `anexos-evidencias.js` retorna seleção do operador e `vigenciaJuridicaComprovada:false`. Esses estados não são equivalentes.
- `core.mjs` exige fonte HTTPS sem query/fragmento; anexos retornam nome+ID, sem URL autenticada de referência. Não inventar endereço nem fornecer signed URL como fonte persistente. Uma futura referência interna precisa de contrato e resolução autorizada próprios.
- Evidências no core têm até4.000 caracteres por trecho e o validador lê até50 registros. Páginas do extrator podem exceder isso. Fragmentação futura deve preservar página/posição e totalidade; exceder50 fragmentos resulta em insuficiência, sem truncagem ou omissão silenciosa.
- A resposta atual de anexos não contém todos os metadados de organização/empresa/CNPJ/processo requeridos pelo repositório. Eles precisam vir do escopo validado no servidor, jamais do candidato ou de seletores não conferidos.

Gates futuros antes de qualquer integração: PDF fictício real → hash dos bytes efetivamente baixados → versão registrada/selecionada → consulta revalidada → referências estruturais; negar versão não selecionada, outro CNPJ/processo, hash alterado, revogação, fonte/ID/página inventados e excesso de fragmentos. Preservar todos os testes existentes de `validateGroundedAnswer` e provar que seleção técnica continua insuficiente nessa entrada. Uma entrada futura distinta, caso autorizada, deverá declarar validação apenas na versão selecionada, sem vigência jurídica ou veracidade semântica. Nenhuma dessas propostas comprova homologação Auth/RLS/Storage/UX remota.
