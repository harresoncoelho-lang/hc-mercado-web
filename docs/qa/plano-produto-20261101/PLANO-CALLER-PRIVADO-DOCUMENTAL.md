# Plano revisado — integração privada documental no servidor

Somente plano. Não criar formulário manual, chat paralelo ou tarefa adicional de redigir afirmações/trechos para o usuário. Integra o contrato já existente para receber futuramente um resultado estruturado de provedor; não gera respostas, não ativa provedor e não afirma IA funcionando em produção.

## Alteração mínima na mesma factory/rota

`integracao-ia/private-handler.mjs`: acrescentar operação fechada `verificar_resposta_anexo_selecionado`, mantendo `listar_empresas_autorizadas` e seu contrato. Corpo documental: `{ferramenta,organizacaoId,empresaId,cnpj,processoId,anexoId,resposta}`. Somente esses campos; exigir IDs/CNPJ e formato do candidato existente. Contexto, scopes, usuário, destino e credenciais nunca vêm do candidato.

Reusar `loadAccess` (Auth/clientes/membro/carteira). Construir contexto com `documentos:read` no ramo documental e chamar `validateSelectedAnnexAnswer`. Depois repetir `loadAccess`, exigir identidade/vínculo/carteira iguais antes da resposta. Preservar scope de empresas e paginação da listagem.

Dependência opcional de servidor `readAnnex({projectUrl,authorization,acao:'consultar',empresaId,processoId,anexoId})`, injetada pelo host confiável. Ausência retorna503 somente no ramo documental. Closure fixa ação consultar, mesmoJWT validado e mesmo projeto Auth/dadosallowlisted. Compor `criarHandler` de anexos sem service_role nem escrita; nunca importar `_auth` com destino fixo, chamar produção ou confiar em URL enviada. Essa composição com doubles não prova autenticação/RLS remotas.

## Limites HTTP streaming, sem truncar contrato

O parser precisa conhecer a operação após JSON; portanto ler stream com teto GLOBAL fixo de **1 MiB (1.048.576 bytes)**, abortar/cancelar ao ultrapassar, sem aceitar Content-Length como única evidência. Decodificar UTF8 estrito e parsear uma vez. Guardar quantidade de bytes lidos.

Após parse e antes de Auth/REST, usar discriminante estrito `ferramenta` e shape fechado:

- Listagem: se bytes>4.096, retornar413. O contrato de listagem continua4KiB; apenas orçamento transitório do parser comum cresce para teto finito. Operação desconhecida não chega ao banco.
- Documental: teto1MiB e limites estruturais do contrato existente: até20 afirmações, texto até4.000 caracteres cada, até10 referências por afirmação. Referência contém somente tipo/anexoId/hash/página/início/fim, todos limitados. Não reduzir a uma afirmação ou impor formulário manual.
- Antes de chamar reader, validação existente da ponte rejeita arrays/campos/intervalos fora dos limites. Sem truncagem de textos/refs.

Justificativa de capacidade: os80mil code units máximos de textos custam até480mil bytes se todos escapados como `\\uXXXX`;200 referências, mesmo considerando IDs de100 caracteres completamente escapados e chaves/valores, ficam abaixo250mil bytes; overhead de seletores/objetos cabe na margem restante. O teste deve construir candidato válido de limite máximo, com texto escapado e referências no tamanho permitido, e comprovar bytes<1MiB. Se a serialização canônica ou limites reais divergirem, ajustar orçamento medido antes de codar; nunca reduzir silenciosamente o contrato. Whitespace arbitrário pode exceder teto e ser recusado mesmo com semântica equivalente.

A mudança transitória de4KiB para1MiB no parser comum é risco explícito de memória/CPU: não é corpo ilimitado. Testar stream em chunks, limite exato/excedido, UTF8inválido e cancelamento. Nenhum aumento no parser de outro handler/servidor nesta etapa.

## Arquivos

1. `integracao-ia/private-handler.mjs`: parser bounded+contagembytes, branch documental, dependência opcional e fechamento de acesso.
2. `integracao-ia/private-handler.test.mjs`: preservar listagem e adicionar limites/discriminante/ausênciareader.
3. `integracao-ia/documental-handler.test.mjs`: composição real das factories sob doubles com PDF fictício real e todos gates abaixo. Reusar private-transport e anexos+ponte, não duplicar auth.

Nenhuma alteração de UI, `_auth`, servidorQA vivo, SQL, rotas públicas, geraçãoLLM, OAuth/MCP, faturamento ou produção. Futuro caller de resultado de provedor envia o candidato à mesma operação; sua construção/ativação é etapa separada. Retorno permanece validação estrutural da versão selecionada com flags jurídicas falsas.

## Testes de integração / bloqueadores

Request/Response em memória → private-handler → private-transport/Authdouble → vínculos/carteira → readAnnex com mesmoJWT/projeto → anexoshandler/RESTStorage doubles/PDFreal → ponte → consultas finais → revalidação final de acesso. Preparar registro/seleção fictícios antes da verificação; o caminho de verificação só consulta.

Exigir: resultado válido sem geraçãoLLM;20afirmações/10refs/textos4k aceitos quando fontes válidas; listagem>4KiB413; documental>1MiB413 antesAuth; leitor ausente503;401 semJWT; empresa/CNPJfora carteira antesdownload; contextoscopesadulterados; fonte/refinventada; bytes/seleção alterados entre consultas; revogação apenas noúltimo loadAccess; token/service_role/detalhestransporte nunca na saída; nenhuma escritaRPC/provider/SMTP. O reader deve receber exclusivamente consultar, mesmo Authorization e projectUrl verificados.

Bloqueia: alterar contratoHTTPS/vigência legado, pedir usuário para redigir manualmente resposta da IA, confundir candidato validado com resposta gerada, ativar host para testar, ou permitir modelo fornecer contexto. Revisão independente do plano e delta antes de qualquer ativação. Testes locais não são homologação remota.
