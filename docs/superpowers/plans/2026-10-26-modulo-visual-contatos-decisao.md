# Primeiro módulo visual, contatos e decisão do cliente

> Execução nesta conversa com superpowers:executing-plans. Requisitos confirmados diretamente pelo usuário; sem nova rodada de aprovação do desenho.

## Contrato
Preservar resumo aberto, síntese, desempenho, impressão, DOCX, HTML do e-mail e robô. Manter complementos documentais extensos sob demanda conforme implementação atual. Aplicar Direção A ao painel real por CSS; não substituir renderizador por protótipo.

Base: 8255241 (documentos da conversa anterior); produção 8150e5c difere da base anterior apenas em dois metadados PNCP. Checkout original permanece intacto. Worktree manual porque ferramenta nativa rejeitou o repositório dentro da pasta de trabalho.

## Entregas
- [x] CSS do painel em claro/escuro, navegação e boletins, sem alterar resumo nem saídas.
- [x] Contatos locais por usuário, pesquisa nome/e-mail, seleção e remoção, gravação somente após envio confirmado. Sem sincronização entre dispositivos nesta versão.
- [x] Botões de decisão ao final do e-mail; página sem login, token aleatório armazenado somente como hash, confirmação POST explícita, prazo e resposta única. Painel consulta decisões da conta. Sem inscrição automática no pregão.
- [x] Testes antes/depois, inspeção visual 375/1280, revisão final e relatório.

## Verificação
Baseline: 629 testes passaram, 4 ignorados. Testar armazenamento bloqueado/corrompido, conta diferente, nomes acentuados, múltiplos destinatários; decisão GET sem escrita, token inválido/expirado, resposta repetida/conflitante, isolamento e e-mail sem recursos novos idêntico. Não enviar e-mail real nem migrar banco remoto sem homologação.

## Arquivos
painel.html integra painel-design.css e contatos-resumo.js. scripts/contatos-resumo.test.js verifica dados e UI. Envio atual recebe extensão opcional de decisão, sem modificar montarConteudoEstruturado, resumo-modelo.js ou scripts do robô. Supabase recebe tabela dedicada e RPC atômica; página responder-oportunidade.html e API dedicada consultam token. Aprovação desativada até implantação da migração e configuração explícita.

## Fechamento e decisões de implementação
- Evolução local aprovada pelo usuário; não houve autorização de publicar esta etapa em produção.
- Ruling: contatos ficam no navegador por conta (limite 200), comunicado durante execução. Não sincronizam dispositivos e são perdidos se os dados locais forem apagados.
- Ruling: decisão em página de confirmação com link individual; não é assinatura nem autenticação de identidade. Nome é declarado pelo portador do link.
- Ruling: aprovação opcional no envio e desativada por configuração até migração/homologação. Mantém o envio antigo independente do banco novo.
- Ruling: complementos e itens extensos continuam sob demanda para manter velocidade; todas as seções principais, incluindo Outras informações relevantes, abrem por padrão. Conteúdo da geração, impressão e exportação preservados.
- Revisão independente: corrigidos rolagem do modal, ícones claros, contraste escuro, estado de envio recusado/incerto, fixture autocontida e troca de contexto durante envio. Testes UI/API/SQL confirmam correções.
- 642 testes JS passaram, 4 legados ignorados; lint 0 erros/50 avisos; build local passou. Testes SQL PGlite e UI Edge 1280/375 aprovados. Dois testes Python do robô executados diretamente porque pytest não está instalado.
- Pendências reais: Docker indisponível nesta sessão; migração não aplicada no Supabase real, envio SMTP e renderização Gmail/Outlook não testados. HTML antigo verificado por hashes para texto e resumo estruturado; sem nova confirmação é idêntico. Jurídico não alterado. Robô/workflows não alterados.
