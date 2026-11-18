# Cobertura observável da consulta de oportunidades

O usuário autorizou continuar a correção de cobertura e evoluir por módulos, sem publicar e preservando resumo/e-mail/boletins. A conferência local identificou um corte silencioso de 20 mil registros na consulta do cache nacional. O Radar também consulta PNCP ao vivo; o corte do complemento não equivale à ausência dessas oportunidades na fonte.

## Escopo decidido

Aplicar a UF no servidor antes da paginação, mantendo o limite operacional existente; devolver e propagar indicação de limite atingido no Radar e no diagnóstico. Reutilizar o aviso de cobertura existente. Não aumentar indiscriminadamente o volume transferido, trocar o mecanismo de busca, criar componente avulso ou alterar fluxos do resumo. Palavras continuam com a semântica existente; não introduzir interpolação de SQL/PostgREST.

Alternativas consideradas: remover o limite pode sobrecarregar a interface; apenas sinalizá-lo mantém a redução evitável da amostra por UF. Filtro de UF antes do limite mais aviso explícito resolve o defeito observado com menor mudança. Decisão de implementação do coordenador dentro do escopo já autorizado, sem nova escolha de produto.

## Implementação e verificação

1. Responsável especialista: mapear todos os chamadores/cache de `carregarOportunidadesSupabase`; capturar baseline de `painel.html` e `scripts/verificar_painel.test.js` antes de editar.
2. Testes de regressão primeiro: mais de 20 mil registros comunica limite; consulta curta não comunica limite; UF é aplicada antes do intervalo; trocar UF não reutiliza cache de outro escopo; consumidores distinguem limite do complemento de falha na busca ao vivo.
3. Alterar somente helper, seus chamadores e aviso existente. Preservar HTML/CSS e rotinas do resumo, o envio por e-mail e robô/workflow. Manter coletor histórico/principal intactos durante a execução em curso.
4. Revisão independente do diff, testes direcionados, `npm run verify`. Confirmar escopo do diff de `painel.html`, pois agora esse arquivo recebe correção funcional de busca; não alegar diff vazio para o arquivo inteiro. Demais arquivos protegidos devem continuar sem diff.
5. Representar o estado no mesmo Design System nativo privado do Claude, usando os componentes de oportunidades/cobertura existentes. Nenhuma mudança no resumo, nenhum campo de consideração, nenhuma demonstração avulsa. Conferência direta quando acessível.

Contratos e atas têm amostragem própria; seus problemas de filtros/avisos ficam registrados para outra fatia. Importação, publicação, SMTP e escrita remota permanecem fora do escopo. Não reexecutar coleta PNCP em paralelo à recuperação já ativa.
