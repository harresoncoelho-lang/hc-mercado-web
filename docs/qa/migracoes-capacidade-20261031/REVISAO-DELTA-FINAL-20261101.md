# Revisão independente do delta final — 01/11/2026

**Parecer: sem bloqueador técnico restante identificado para conservar este pacote como preparação local revisada.** A correção restringe as três ACLs previstas e acrescenta um gate que recusa permissões residuais nas quatro funções internas de trigger. Não altera seus corpos, regras de negócio, triggers ou permissões das funções utilizadas pelo aplicativo em relação ao candidato anterior.

Este parecer vale somente para o SHA-256 `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94`. **Não autoriza aplicar SQL em produção, publicar, habilitar o módulo ou executar uma homologação remota.** Os requisitos de ambiente isolado, recuperação e PostgreSQL 17.6 continuam abertos em [MIGRACOES.md](MIGRACOES.md).

## Escopo e método

Revisão independente somente por leitura de arquivos, comparação textual/estruturada e recálculo de hashes. Foram examinados o candidato completo, as duas fontes modificadas, kit/gate, gerador, harness de testes e evidências finais. A busca de referências fora dos relatórios encontrou os chamadores SQL esperados; não encontrou chamada direta do aplicativo às quatro funções internas.

Não executei SQL, PGlite, produto, suíte de testes, Docker, serviços, rede, navegador ou aplicativo nativo. Não executei o gerador nem alterei candidato, fontes ou evidências. A única gravação desta revisão é este relatório. Não houve demonstração de uso indevido de uma função de trigger.

Foram concluídas 58 verificações de consistência estática, além da comparação estruturada das 30 policies do gate com o catálogo-alvo e dos hashes dos 12 corpos novos. Esses números são distintos das 595 verificações registradas pela execução local anterior.

## Identidade conferida

| Arquivo | SHA-256 atual |
|---|---|
| `02-delta-operacional.sql` | `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94` |
| `gerar-delta-local.cjs` | `8dac1aa6c25a1134d0067accb0e587d5d65a33de32451b7e57f93e5a668ca11d` |
| `testar-delta-local.cjs` | `52d6607579b0d478e322956a30dbf0d4c1c8fd50c8c191f8176d56dae85c0b18` |
| `delta-manifesto.json` | `03c9c0de5c5675b46d3d28de0d22efb9e83cd061c9f7ee1ee5fa22bbb7328cac` |
| `delta-testes-permissao-trigger-local.json` | `9bd4eb7efa6ed94d3665910b3d11b7774d37a8ffffd42673d290ab3a05031d3a` |
| `preservacao-delta-permissao-trigger-local.json` | `b97069e81e7ddbfb0ea9275bbfa45efff84631a2dccdc7ef8ce9d321d790ac7f` |
| `permissao-trigger-validacao-snapshot-final.log` | `0aeb80290c103d49470b7d8e3780bab2c9fad1d65160ea2a35b6c9ca323d1614` |
| `integridade-permissao-trigger-20261101.json` | `98d06a9fcc6aeeb2c7bd24a471db7f3fb28d417b3049998903ed11d659dfd01d` |

O manifesto, a evidência dos testes, a integridade e o candidato concordam sobre o hash final. A cópia anterior conserva `7cbe38e48980e9d58f73f95d69e8f926950517d616fe6d00f92dfd091b5502bf`. As nove cópias em `evidencia-anterior-permissao-trigger-20261101/` conferem com os hashes registrados. Os dois JSONs de teste/preservação anteriores mantidos na pasta principal continuam idênticos às cópias arquivadas.

Os hashes das quatro fontes no manifesto foram recalculados com a mesma normalização de CRLF usada pelo gerador. O gate `supabase/verificar_kit_prepublicacao.sql` conserva `2c4023cb0cac4e9b5fa29afee68398a0b4e402663dee9cd9fa580e7ea19178cf` nessa normalização e aparece integralmente uma única vez no candidato.

## Permissões, propriedade e chamadores

| Função | Correção conferida | Chamadores legítimos preservados |
|---|---|---|
| `invalidar_identificacao_empresa()` | Revogação de PUBLIC, anon, authenticated e service_role. | Alteração de cadastro, UPDATE/DELETE de documento e UPDATE/DELETE de objeto no bucket operacional. |
| `preservar_escopo_operacao()` | Inclusão de service_role na revogação existente. | BEFORE UPDATE de documentos e processos. |
| `validar_arquivo_processo_operacao()` | Inclusão de service_role na revogação existente. | BEFORE INSERT/UPDATE de anexos de processo. |
| `kit_documento_escopo_imutavel()` | Sem alteração; normalização anterior mantém somente o dono. | BEFORE UPDATE das peças, inclusive a segunda gravação pela RPC. |

A comparação de `supabase/identificacao_empresa.sql` com a cópia anterior mostrou somente comentário de escopo e a revogação. Em `supabase/seguranca_operacao.sql`, a única diferença é a retirada de service_role das duas funções internas. Removidas essas diferenças declaradas e o novo gate posterior, o candidato final é textualmente igual ao anterior. Não houve mudança de corpo, SECURITY DEFINER, search_path, assinatura, retorno, trigger ou policy nessa correção.

O pacote cria funções novas com `CREATE FUNCTION`, exige executor `postgres` e não contém troca de papel ou de proprietário. Não substitui funções preexistentes com `CREATE OR REPLACE`. As revogações estão dentro da mesma transação da criação. O proprietário mantém o acesso registrado pelos testes; a correção não o transfere a um papel de aplicação. Os grants da confirmação e da RPC do kit continuam intactos.

O gate novo verifica as quatro assinaturas derivadas das funções novas com retorno `trigger`. Recusa ausência, tipo incompatível, qualquer ACL direta destinada a outro papel e EXECUTE efetivo para anon, authenticated ou service_role. Assim, defaults ou herança que preservem acesso inesperado fazem o pacote abortar; o gate não corrige defaults globais silenciosamente. Os controles integrais de owner, RPC, tabela, policy, trigger e privilégio efetivo do kit também permanecem antes do commit.

## Transação, consistência e preservação

O candidato conserva um único `BEGIN` e um único `COMMIT`, `lock_timeout='2s'`, `statement_timeout='30s'` e `search_path=pg_catalog,public`. Os locks exclusivos e a verificação do executor/fingerprint precedem o DDL do módulo. O CTE do inventário foi comparado integralmente com a consulta original; o fingerprint remoto `4550d262d2f09edec1efd68b4c699f67` permanece no arquivo. Não há fallback para ignorar divergência, aplicação parcial ou repetição após commit.

Os blocos de identificação, segurança e kit presentes no candidato correspondem às fontes após as transformações explícitas do gerador: retirar transações/notificação internas, usar criação nova e retirar DROP preparatórios. O JSON de policies esperado corresponde às 30 entradas do catálogo-alvo no recorte. Os 12 corpos novos correspondem aos hashes esperados. As duas funções preexistentes com ACL ajustada pelo delta original continuam sem substituição de corpo.

O preflight de vínculos/caminhos, os gates finais e a notificação transacional permanecem. Erro antes do commit exige parar o executor e efetuar rollback. O pacote não inclui limpeza de dados, remoção de tabelas ou downgrade automático de permissões. A reversão após commit continua dependendo de análise própria; retornar a grants antigos pode reabrir a condição corrigida.

Os 20 arquivos protegidos foram novamente lidos e seus SHA-256 atuais conferem com o baseline registrado. Não houve alteração de resumo, e-mail, robô, autenticação, modelos, produto ou pipeline por esta revisão.

## Evidência local existente e sua qualidade

O JSON final e `permissao-trigger-validacao-snapshot-final.log` têm conteúdo estruturado idêntico e registram **595 verificações aprovadas para o hash final**. A revisão não repetiu essa execução. O harness foi lido para confirmar o que cada resultado significa:

- Há 488 registros únicos de objetos preexistentes comparados. As duas funções com redução de ACL do delta original são comparadas separadamente, preservando os demais campos.
- Os hashes de dados antes/depois são iguais para 18 tabelas públicas. A captura posterior ocorre imediatamente após o delta, antes das mutações legítimas dos casos funcionais; não mistura o teste de migração com os efeitos esperados desses casos.
- A comparação dos dois candidatos na mesma fixture registra 33 funções. Exceto pelas três ACLs corrigidas, os demais campos, ACLs, triggers e policies são comparados integralmente.
- As quatro funções internas registram dono `postgres` e ausência de EXECUTE efetivo para anon, authenticated e service_role. O teste também exige EXECUTE do dono.
- O operador mantém UPDATE de documento/processo e INSERT/UPDATE de anexo válido. Os cinco percursos de invalidação começam com confirmação válida e verificam `invalidado_em` após a mutação legítima. A segunda gravação da peça por service_role verifica a progressão de versão pela RPC.
- Os nove cenários negativos incluem divergência de ambiente, policy/helper/ACL inesperados, instalação parcial, vínculo legado inconsistente, falha após gates, grant extra na função interna e segunda aplicação. O helper de recusa verifica a exceção, executa rollback e compara o fingerprint anterior/posterior. A variante com grant extra é somente SQL em memória; não chama diretamente uma função de trigger.

O log vermelho registra a ACL excessiva anterior. `permissao-trigger-green.log` registra uma falha do harness, apesar do nome; não foi interpretado como aprovação. A comparação atual remove BEGIN/COMMIT somente da consulta em memória usada dentro da transação destinada a rollback. O inventário em disco permanece preservado. O resultado final, com hash exato e snapshot de dados corrigido, é a evidência utilizada neste parecer.

## Limites e condição para avançar

A execução disponível é PGlite/PostgreSQL 18.6; o inventário remoto registra PostgreSQL 17.6. Auth e Storage são estruturas de compatibilidade na fixture, sem os serviços gerenciados. As evidências demonstram o comportamento local registrado; não provam aplicação em produção, volume real, concorrência, recuperação ou compatibilidade integral dos serviços de destino.

O fingerprint cobre o recorte documentado e o MD5 serve para detectar divergências desse inventário. Não é uma prova global do projeto ou de todas as dependências dinâmicas. A avaliação de lock usa uma migração administrativa única, sem operadores concorrentes alterando DDL; os dois segundos são prazo de espera por lock e os 30 segundos são por comando, não duração total garantida.

Não encontrei achado acionável restante no pacote examinado que impeça sua preparação local. Para avançar além disso, permanecem obrigatórios o destino isolado comprovado, o ensaio autorizado em PostgreSQL 17.6/serviços reais, a recuperação verificável, a conferência atual do catálogo/hash e a autorização específica do alvo. Este relatório não substitui essas condições nem concede autorização de aplicação.
