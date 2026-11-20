# LicitaPlena — segurança, cobertura e documentos por CNPJ

Validação local em 27/10/2026. Worktree `design-modulo-um`, base `f76be11`. Alterações mantidas localmente; nenhuma publicação ou migração de produção foi executada.

## Fluxo disponível para experimentar

[Abrir demonstração local](http://127.0.0.1:8793/). Usa duas empresas fictícias, o componente real, o endpoint real e o gerador DOCX real. Autenticação, banco e arquivos são simulados somente na fronteira; não há conexão externa. A simulação não comprova permissões de produção.

1. Escolha empresa/processo e clique em **Preencher exemplo fictício**.
2. Escolha declaração ou proposta. Para proposta, selecione o item e informe unidade, validade, entrega e pagamento.
3. Clique em **Preparar prévia**, confira o conteúdo integral e marque a revisão.
4. Clique em **Baixar DOCX**. Alterações posteriores exigem nova preparação/revisão.

O mesmo componente está integrado ao dossiê de `processos.html`. A declaração substitui as variáveis do modelo informado pelos dados confirmados da empresa. A proposta usa os itens e preços persistidos daquele processo, com cálculo decimal exato. Dados ausentes bloqueiam a geração; a ferramenta não inventa regularidade, habilitação ou condições comerciais.

Em outro momento, reinicie a demonstração na raiz do worktree com `node docs/qa/servir-kit-documentos-local.cjs` (VOLTA_HOME configurado). O servidor aceita apenas localhost e arquivos permitidos.

## Correções realizadas

- **Permissões:** leitor permanece em consulta; escrita exige papel e escopo adequados. Organização, empresa, processo e arquivos privados têm validações e referências coerentes. Alterar o CNPJ de um processo/documento existente fica bloqueado para evitar deslocar apenas parte do conjunto de dados.
- **Migração segura:** incremental e transacional; inconsistência legada aborta a aplicação sem saneamento destrutivo. O gate exige RLS também no storage. Ordem e roteiro em [seguranca-operacao.md](seguranca-operacao.md).
- **Persistência e cobertura:** checkpoints só avançam depois da confirmação de gravação. Falhas e limites deixam pendências; não são anunciados como cobertura integral. Atas incompletas continuam na fila. Na falha da coleta, o workflow publica somente os dois arquivos de metadados confirmados e mantém resultado de erro; temporários e bases privadas ficam fora.
- **Revisão do documento:** exportação revalida identificação, fontes privadas, versão e dados do processo. Mudança de conteúdo invalida o hash. Troca de CNPJ, fechamento, recarga e saída/troca de usuário descartam respostas antigas. Renovação do token do mesmo usuário preserva o trabalho.

## Evidências executadas

| Verificação | Resultado |
|---|---|
| `npm run verify` | 685 aprovados, 4 ignorados, zero falhas; lint zero erros/50 avisos preexistentes |
| SQL real local (PGlite) | 227 verificações de isolamento, CRUD, RPC, policies e repetição da migração |
| Legado inconsistente | Aplicação abortada e transação revertida, dados preservados |
| Aprovação por e-mail (SQL anterior) | Consulta, repetição, conflito, expiração e permissões aprovados |
| Testes Python do boletim | 2 verificações aprovadas, sem executar envio |
| QA no Edge | Declaração, proposta, download DOCX, temas claro/escuro, teclado e 375 px; zero rede externa |
| Página real de processos | 6 cenários aprovados: logout, troca de usuário, troca silenciosa, recarga com falha, mesmo usuário e renovação do token |
| Build público | Concluído, 37 arquivos da raiz + data |
| Diff dos fluxos protegidos | `painel.html`, envio do resumo, robô Python e workflow do boletim sem alterações nesta etapa |

O DOCX foi aberto estruturalmente como ZIP/XML e lido pelo Mammoth. Word/LibreOffice não estão disponíveis neste ambiente; a apresentação final nesses aplicativos não foi validada.

Revisão independente por tarefa e revisão final integrada concluídas. Todos os achados foram encerrados. O QA de sessão aguarda a Promise real da exportação, sem espera fixa; controles positivos aguardam o download e negativos comprovam zero tentativas nativas.

## Produção: evidência de leitura, sem intervenção

- [Coleta PNCP 40526185296](https://github.com/harresoncoelho-lang/hc-mercado-web/actions/runs/40526185296): registrada como sucesso, apesar de timeout 57014 em contratos e zero de 27 UFs concluídas naquele ciclo.
- [Recuperação 40593821785](https://github.com/harresoncoelho-lang/hc-mercado-web/actions/runs/40593821785): registrada como sucesso com 13 UFs ainda pendentes após HTTP 429.
- [Boletim 40606653778](https://github.com/harresoncoelho-lang/hc-mercado-web/actions/runs/40606653778): log registrou envios. Isso não comprova recebimento na caixa do destinatário.
- [ComprasNet Legado 40553052134](https://github.com/harresoncoelho-lang/hc-mercado-web/actions/runs/40553052134): falha na autenticação do clone de outro repositório, antes da coleta. Credenciais não foram alteradas.

## Limites e próxima homologação

A cobertura histórica remota ainda não foi recomposta. Limites existentes (20 páginas por UF e 30 itens por ata) agora ficam explícitos como pendência; requerem recuperação/paginação posterior. Cancelamento forçado do runner ainda pode perder checkpoint local. Lotes já gravados não têm rollback distribuído; repetição usa upsert idempotente.

Antes de publicar: validar a migração contra uma cópia do banco real, confirmar PostgREST/projeções numéricas, permissões e storage no ambiente de homologação, abrir os DOCX em editor de texto e acompanhar uma coleta autorizada. A geração continua desabilitada sem a identificação habilitada e o gate válido.

Este é o primeiro fluxo de documentos/propostas: sem biblioteca persistente de modelos, logo/timbrado, planilha de custos, assinatura ou protocolo automático. Essas etapas seguem depois da validação deste fluxo. Resumo, e-mail e boletim seguem como referências protegidas.
