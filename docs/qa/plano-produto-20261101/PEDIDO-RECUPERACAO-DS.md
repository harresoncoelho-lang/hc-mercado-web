# Pedido ao Claude — concluir recuperação e conciliação demonstrativas

Trabalhe no **mesmo Design System privado LicitaPlena**, no componente existente `IntegracoesOperacionais`. A versão mais recente observada é a v52 documental; a prévia funcional continua baseada na v49. Leia a versão atual antes de editar para não sobrescrever trabalho posterior.

**Esta é uma tarefa de implementação e validação da prévia, não outra nota documental.** Hoje a recuperação após recarga permite somente inspeção porque não existe uma fonte independente para conciliar confirmações. Feche essa lacuna com o menor incremento completo. Preserve a paleta, temas claro/escuro, acessibilidade, paginação de dez itens e cálculos exatos já implementados.

## Escopo e preservação

- Alterar somente o preview de `IntegracoesOperacionais`, seu README e arquivos de teste diretamente necessários no seu ambiente. Atualizar o catálogo apenas pelo fluxo normal de salvar o mesmo componente; não criar outro Design System.
- Preservar todas as outras composições, tokens, resumo, e-mail, boletim, autenticação e modelos. Não mudar compartilhamento, cliente, modelo ou cobrança.
- Não acessar portais, APIs ou arquivos reais; não instalar extensão, usar credenciais, enviar proposta/lance/e-mail, ativar serviços pagos ou publicar o produto. Tudo é fictício e privado.
- Manter visível “Demonstração — dados fictícios, sem integração real”. Este ensaio não homologa ComprasGOV, extensão, concorrência real, volume comercial ou segurança de armazenamento local.
- Não depender de `prevalidacao-lote` em implementação separada: preserve o contrato atual e indique onde poderia ser integrado depois, sem importar um artefato incompleto.

## Contrato da fonte fictícia independente

Separe claramente dois estados:

1. **Checkpoint do cliente:** fila, IDs/valores preparados, versão e resultados que o cliente conheceu. Pode estar desatualizado após uma resposta perdida. Nunca contém autorização válida após recarga.
2. **Estado do portal simulado:** registros fictícios e resultados de comandos efetivamente processados pelo simulador, independentes do checkpoint. Seu histórico tem identidade do comando e valor recebido/confirmado. Ele continua existindo quando o cliente é recarregado.

Use mecanismo compatível com a prévia existente, sem infraestrutura nova. Chaves/objetos e funções distintos são suficientes para a demonstração se a independência for testável. Não alegue que dois objetos no mesmo navegador são isolamento de segurança. A fonte é independente no **modelo de execução**, não um serviço autenticado real nem uma autoridade resistente a adulteração. Usuário com controle do armazenamento pode alterar ambos; a prova real exige backend/portal autenticado, fora deste escopo.

Requisitos:

- A fonte nasce do catálogo fictício do cenário e recebe mudanças somente pelo simulador de processamento. **Não reconstruí-la a partir dos estados `confirmado`, valores ou contadores do checkpoint recuperado.** Apagar ou corromper o checkpoint não recria nem altera as confirmações da fonte.
- O identificador do contexto inclui CNPJ DEMO, portal simulado, compra/processo e identificação da instância do cenário. Versão de esquema da fonte e versão do lote são distintas; mudança de dados do lote não muda retroativamente o registro que o portal simulado já recebeu.
- Cada intenção tem ID de comando estável e chave do item/contexto. Tentativa incerta mantém esse ID até a conciliação; não gerar novo ID para contornar incerteza.
- Canonicalizar os dados comparáveis: ID de item/grupo, quantidade, preço unitário exato em quatro casas, total, marca, fabricante e modelo conforme o cenário. Calcular hash do conteúdo canônico e da lista de IDs selecionados. Nunca usar posição/página ou número de ponto flutuante como identidade/valor.
- Hash é evidência de integridade/comparação, **não autenticação**. Uma fonte com dados inválidos, contexto incompatível, versão desconhecida ou conflito de IDs bloqueia a conciliação; não “corrigir” silenciosamente.
- A fonte oferece resultados distintos: `aplicado` com registro/valores, `nao_aplicado` comprovado pelo cenário, `rejeitado` com causa conhecida, `desconhecido` e `indisponivel`. Ausência de linha/registro por si só é `desconhecido`, não autorização para reenviar.
- Processar novamente o mesmo ID com o mesmo hash no simulador devolve o resultado já existente, sem nova gravação. Mesmo ID com outro hash é conflito. Testar essa idempotência; não usar apenas botão desabilitado como prova.

## Recuperação e fluxo visível

Na recarga, restaurar contexto e valores apenas para inspeção. Mostrar “Recuperado — conciliação necessária”. Execução parada, sem temporizador ativo, sem autorização herdada e sem envio fictício automático. Estado em trânsito vira incerto.

Oferecer **Conciliar com portal simulado**. A conciliação consulta a fonte, nunca copia resultados da fila para ela. Reconciliar todos os itens que seriam considerados já confirmados ou elegíveis para nova emissão; não confiar somente no subconjunto marcado incerto no checkpoint.

| Resposta da fonte | Tratamento |
|---|---|
| Aplicado e valores/hash iguais ao lote recuperado | Confirmado na simulação; excluir da fila de novas emissões. |
| Aplicado, mas valores/contexto/item divergem | Divergência visível, retomada bloqueada para o item/lote afetado; exigir revisão e decisão, sem sobrescrever. |
| Não aplicado comprovado ou rejeitado conhecido | Mostrar causa; somente após nova revisão e autorização tornar elegível para nova tentativa. |
| Desconhecido, indisponível, ausência de fonte ou versão inválida | Continuar bloqueado; preservar evidências e checkpoint. Não zerar ou reenviar. |

Após conciliação bem-sucedida, mostrar totais de confirmados, elegíveis, divergentes e sem resultado. O operador revisa diferenças e autoriza novamente a versão atual. **Retomar simulação** deve emitir somente itens elegíveis, nunca os já confirmados. Retorno ao contexto anterior A→B→A também exige conciliação/revisão/autorização nova.

Se os dados forem editados após conciliação, invalidar autorização e comparação afetadas. O novo conteúdo não pode herdar confirmação de valores antigos. Não “resolver” divergência apenas recalculando o hash do checkpoint.

Pausa deve interromper novas emissões. Comando já processado mas sem resposta ao cliente permanece incerto até consultar a fonte. Não representar pausa como cancelamento de algo já aplicado.

## Falhas de armazenamento e controles de cenário

- Fonte e checkpoint têm persistência independente. Se salvar a fonte falhar, não devolver sucesso confirmado. Se a fonte persistir e salvar o checkpoint falhar, informar checkpoint não salvo; a próxima recuperação deve consultar a fonte e não duplicar a emissão.
- Armazenamento negado/quota/JSON inválido/versão incompatível devem ser mensagens claras e bloqueios verificáveis, sem queda silenciosa para “sucesso só em memória”. Se oferecer execução descartável em memória, deixe explícito que **não há recuperação após recarga**, e não use esse caminho para aprovar este requisito.
- Acrescentar controles de cenário pequenos e explícitos para: resposta perdida depois de aplicado, fonte indisponível, valor divergente e checkpoint corrompido. Não expor console técnico no fluxo principal.
- “Reiniciar cenário fictício” limpa somente as chaves próprias daquele cenário/contexto e informa que descarta a simulação. Não limpar `localStorage` inteiro nem apagar outras composições. Não iniciar nada após o reset.

## Testes necessários e aceites

Use testes determinísticos e uma prova de UI salva. Não repetir baterias antigas completas sem necessidade; rode regressões afetadas. Feche navegadores/recursos do harness em `finally`; não deixe tarefas de teste sem término.

1. **206 itens:** dez por página, 21 páginas. Interromper entre confirmação na fonte e recebimento pelo cliente. Recarregar efetivamente, conciliar, revisar/autorizar de novo e concluir. Exigir 206 confirmados e zero gravações duplicadas; conferir registros por ID, não só o contador.
2. **1.001 itens:** dez por página, 101 páginas. Mesmo percurso, com interrupção no limite de página e no último item. Os confirmados da primeira parte não são reemitidos após a recuperação; zero pendências ocultas e soma de estados correta.
3. **Checkpoint falso:** exportar o estado pelo harness, adulterar um item pendente para confirmado e importar pelo mesmo parser de recuperação. Isso não altera a fonte nem promove o resultado a confirmado durante a conciliação. Fazer também o caso mesmo ID com valor/hash diferente: bloquear divergência, sem transformar a fonte em cópia do importado. Não é necessário criar UI de importação só para esse teste. Apagar checkpoint não pode recriar fonte a partir de valores padrão e fingir recuperação completa.
4. **Fonte ausente/indisponível:** nenhum reenfileiramento automático ou falsa conclusão; evidência preservada. Voltar a disponibilizá-la apenas habilita nova conciliação, não início automático.
5. **Divergência:** modificar na fonte fictícia marca/modelo/preço de um item confirmado. Mostrar diferenças, invalidar retomada e manter valor observado distinto do preparado. Campos de custo privado não entram no registro externo simulado.
6. **Contexto:** A→B→A, com compra e itens de mesmo número em contextos diferentes. Zero mistura de fonte/checkpoint, zero reaproveitamento de autorização. Contexto/versão adulterados bloqueiam.
7. **Falhas:** quota/negação ao salvar fonte e ao salvar checkpoint, esquema desconhecido e JSON inválido. Sem perda silenciosa ou confirmação não persistida. Reset afeta só o cenário alvo.
8. **Precisão:** preservar `3 × 12,3456 = 37,0368`, IDs e campos já demonstrados; hash de valores diferentes diverge e representação canônica equivalente permanece consistente.
9. **Idempotência:** mesmo comando/hash aplicado duas vezes produz uma gravação; mesmo comando/outro hash dá conflito; comando incerto não recebe ID novo para permitir reenvio.
10. **UI:** claro/escuro, teclado/foco e viewport estreita; contexto CNPJ/processo permanece visível com painel recolhido. Botões de conciliar, revisar, autorizar e retomar refletem estados verdadeiros.

## Entrega solicitada

Salve a implementação no mesmo componente privado e releia a versão salva. Informe versão, arquivos alterados, hashes antes/depois, testes executados com resultados e qualquer limitação restante. Mostre uma evidência do fluxo após recarga com fonte conciliada e nenhum duplicado. Preserve evidências de falhas corrigidas.

Não afirmar “retomada concluída” se a UI ainda permitir só inspeção, se o teste não tiver recarregado, se a fonte vier do checkpoint ou se só os contadores tiverem sido conferidos. Se o armazenamento da prévia impedir a prova, registre a limitação exata e não substitua por mais texto de README. Continue os testes independentes possíveis e entregue o impedimento concreto à coordenação.
