# Motor de cadastro fictício

IDs de comando usam SHA-256 (Web Crypto) da identidade estrutural integral do lote, incluindo contexto, versão e itens, mais ID do item. Mesmo lote mantém ID; valores/contexto diferentes mudam ID. O digest não autentica a fonte nem concede permissão; não contém credenciais e não deve ser tratado como segredo.

Máquina reutilizável sem rede, DOM, credenciais, instalação ou escrita no Compras.gov.br. Reutiliza validarLote e validação de formato do contexto existente. A porta deve declarar tipo ficticia; isso é contrato de desenvolvimento, não sandbox contra código malicioso.

O coordenador confiável fornece contexto, versão, catálogo, linhas, relógio e autorização vinculada ao lote integral. vinculo é identidade estrutural, não assinatura ou prova criptográfica. Não aceitar autorização ou catálogo diretamente de conteúdo não confiável. Nenhuma autorização de portal é produzida.

lerPagina recebe contexto e cursor, retorna contexto, ids (até dez) e proximo (string ou null). aplicar recebe comando com ID estável, contexto, versão e item validado. Retorna aplicado/rejeitado com eco integral do comando. Exceção, timeout ou resposta divergente deixa pendência incerta. conciliar deve ler uma fonte fictícia independente do checkpoint; retorna aplicado ou nao_aplicado com comando exato. Ausência de fonte bloqueia. Após reconciliação exige autorização nova.

Confirmações evitam repetição dentro da instância. Não há persistência, trava entre abas/processos, watchdog, garantia de cancelamento, autenticidade da fonte ou integração de produção. Uma Promise que não termina mantém exclusividade; o contrato da porta deve sinalizar timeout, sem presumir cancelamento de escrita. Recriar instância perde estado: não usar para retomada real. Paginação 206/1001 é simulação, não capacidade homologada do portal nem expansão do limite de 50 itens do kit atual.

Teste: node --test motor-cadastro/motor.test.mjs. Resumo, e-mail, robô de boletins e autenticação permanecem intocados.

## Diário durável local do cadastro

`abrirPortaDuravel({arquivo, contexto}, fonteFicticia)` envolve a porta já consumida por `criarMotor` e `criarCadastro`. Usar caminho absoluto em diretório privado local previamente criado. A mesma porta deve ficar aberta durante toda a operação e ser fechada no encerramento normal. Não conectar ao portal real.

Antes de aplicar, grava intenção completa e faz fsync. Após reabrir, todo comando registrado consulta a fonte independente: confirmação exata evita repetir; fonte ausente/divergente bloqueia; não aplicado retorna rejeição para o motor invalidar autorização, permitindo uma tentativa posterior apenas após nova autorização. Reconciliação explícita não aplicada também libera essa tentativa. A fonte é separada do diário; não pode reconstruir confirmações a partir dele. Autorização não é gravada. O motor novo continua pausado.

Lock `wx` impede dois processos cooperantes no mesmo caminho. Crash deixa lock, exigindo diagnóstico manual; não removemos trava automaticamente. Journal incompleto/corrompido/contexto diferente falha fechado. Falha de gravação/sync bloqueia a instância antes de chamar aplicar. Intenções contêm valores e CNPJ, portanto exigem ACL privada; modo0600 não garante ACL Windows. Não é proteção contra adulteração administrativa, exclusão do arquivo, alias de caminho ou concorrência distribuída. Fsync do arquivo não garante sobrevivência a toda falha de hardware/energia/metadata do diretório. Limite de leitura16MiB; não há rotação automática.

Os testes usam disco real, processos Node separados, fonte fictícia independente, resposta perdida, lock interprocesso e falha de sync. Nenhum transporte de rede. Lances ainda não têm restauração durável.
