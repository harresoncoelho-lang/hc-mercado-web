# Ambiente isolado — plano de execução

> **For agentic workers:** usar superpowers:subagent-driven-development para implementação e revisão. Não realizar commit/push no repositório do produto nem publicar produção. A coordenação está autorizada a usar repositório privado separado e homologação privada, conforme resposta explícita do usuário.

**Goal:** validar migração, recuperação e capacidade fora da máquina do usuário, preservando produção e avisando antes de custos.

**Architecture:** projeto Supabase Free separado para os testes de banco; somente dados fictícios. O executor de restauração e a medição Cloudflare são frentes independentes, cuja disponibilidade, isolamento e custo devem ser comprovados antes da execução.

**Tech Stack:** PostgreSQL/Supabase, SQL, scripts de QA existentes, Cloudflare Workers.

**Spec:** pedido de 01/11/2026 e `docs/qa/migracoes-capacidade-20261031/ENTREGA-20261101.md`.

## Restrições

- Produção `lsqjamqvmrcyrvowndiu`: somente inventário administrativo de leitura, sem dados de negócio ou execução de funções da aplicação.
- Homologação criada pelo usuário: `luguscapasskcsficckf`, organização Free `vhmjospwgiryrnrndkpd`, nome `licitaplena-homologacao`, Canadá, NANO. Não usar outra referência como destino.
- Preservar os 20 arquivos protegidos, candidato original e todas as evidências anteriores.
- Sem Docker, carga local, controle de desktop, instalação, SMTP, PNCP, IA externa ou CNPJ Proprio.
- Não criar custo, recurso pago ou chave de acesso automaticamente. A criação da senha do banco foi concluída pelo usuário. Homologação privada está autorizada; publicação de produção e conexão do repositório do produto continuam proibidas.
- Não copiar dados de produção para homologação. Não usar o projeto Radar SICAF.

## Foco de revisão

- Referência errada de projeto deve interromper antes de escrita.
- Bootstrap deve recusar ambiente já ocupado e dependência ausente, sem inventar helpers.
- Guardas do delta original permanecem; eventual variante de ensaio precisa de diff explícito e catálogo próprio.
- Um restore parcial não pode ser chamado de recuperação integral, e metadados do Storage não substituem os bytes.
- Medição de workerd em runner não comprova CPU faturada na Cloudflare; URL de produção fixa impede isolamento por simples variável.

## Tarefas

### 1. Identificar destino e custo
**Files:** `docs/qa/ambiente-isolado-20261101/ambiente.json`, `EXECUCAO-REMOTA.md`.
**Depends-on:** none.
- [x] Conferir organizações existentes e formulário Free, sem ativar cobrança.
- [x] Preparar nome, região e exposição manual; usuário define senha e conclui criação.
- [x] Confirmar projeto separado Healthy, Free, sem integração GitHub ou migrações.
- [x] Registrar baseline real e evidência visual sem credenciais.

### 2. Preparar e ensaiar migração
**Files:** `docs/qa/ambiente-isolado-20261101/banco/*`, `ENSAIO-BANCO.md`.
**Depends-on:** 1.
- [x] Capturar somente catálogos do destino e dependências explícitas faltantes da origem.
- [x] Preparar bootstrap mínimo pré-kit, com direitos/RLS explícitos e sem dados copiados, para o destino vazio.
- [x] Revisar o SQL e os controles de alvo antes da primeira escrita.
- [x] Aplicar no destino autorizado, capturar baseline, ensaiar o delta com guarda própria explicitamente revisada e conferir preservação/rollback.
- [x] Executar cenários SQL de autorização por CNPJ com rollback: 15 blocos, mesmo catálogo e zero resíduos.
- [ ] Validar percurso autenticado por JWT/HTTP em ambiente privado; os claims SQL não substituem essa prova.

### 3. Restauração e capacidade
**Files:** `docs/qa/ambiente-isolado-20261101/EXECUCAO-REMOTA.md`, artefatos de ensaio definidos após confirmação do executor.
**Depends-on:** 1; restauração de fixtures novas depende também de 2.
- [x] Identificar executor remoto privado, quota/custo e contenção de saída; não usar a máquina do usuário.
- [x] Preparar pacote mínimo e revisar o conteúdo antes de qualquer transferência.
- [x] Restaurar origem fictícia preservando ownership/ACL e registrar escopo: run 41343013570 passou, 40 tabelas e sete checks. Os bytes Storage e baseline Auth completa continuam fora desta prova.
- [ ] Resolver o isolamento de rede do bundle e autorização de implantação exclusivamente de teste antes de medir na Cloudflare. Não contornar a proibição de publicar.
- [x] Registrar quotas e consumo observado, distinguindo-os da capacidade ainda não medida: banco/CAPACIDADE-SUPABASE-OBSERVADA.md. Medição hospedada permanece suspensa na fronteira de ativação Cloudflare escolhida pelo usuário.

**Decisão posterior do usuário:** não ativar Cloudflare Zero Trust Free enquanto exigir cartão e autorização para excedentes. A medição hospedada está suspensa nessa fronteira; continuar banco e backup. Não trocar por endpoint público para contornar a decisão.

### 4. Fechamento
**Files:** relatório de entrega e ledger desta etapa.
**Depends-on:** 2 e 3.
- [x] Revisão independente, hashes protegidos, evidências de encerramento e entrega da etapa de banco/backup com pendências reais: docs/qa/ambiente-isolado-20261101/ENTREGA-20261101.md.
