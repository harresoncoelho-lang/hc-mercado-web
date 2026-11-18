# Prontidão do LicitaPlena — jornada principal e comercialização

Data de referência: 31/10/2026 UTC. Trabalho local na branch `local/design-modulo-um-20261026`, sem implantação. Este documento separa funcionalidades existentes, demonstrações e pendências; testes locais não certificam produção.

**Atualização da homologação autenticada:** documentos, propostas e cadastro por CNPJ passaram no PostgreSQL, GoTrue, PostgREST e Storage reais locais: 13 grupos, incluindo quatro de interface, oito DOCX e limpeza com baseline preservada. Revisão independente final aprovada. A migração do kit recebeu correção delimitada das permissões herdadas; resumo/e-mail/boletins continuam intactos. Relatório e limites: [homologação real](../homologacao-real-20261031/HOMOLOGACAO.md). Esta atualização fecha a lacuna de persistência/roles/storage desse módulo, sem liberar produção nem concluir as pendências comerciais abaixo.

## Decisão de produto

**Atualização da preparação de produção:** o projeto correto do Cloudflare e os metadados do Supabase foram conferidos em leitura. As tabelas/RPCs novas não foram encontradas e a habilitação do módulo não está listada em produção. O Worker completo passou em 14 verificações locais com serviços fictícios, incluindo leitura automática do PDF e duas exportações DOCX. Foram corrigidos somente o empacotamento de dados públicos e o leitor empresarial; 20 protegidos intactos. Gate geral: 839 aprovados, quatro skips, zero falhas. O resultado fecha a prova local de compatibilidade do módulo, sem aplicar migração ou publicar. Pendências remotas, capacidade, isolamento de preview e backup estão em [preparação das integrações](../integracoes-producao-20261031/PREPARACAO.md). As pendências comerciais desta matriz continuam válidas.

Manter um SaaS com duas rotinas. **Empresa** atende o responsável interno por licitações de um CNPJ. **Assessoria** atende uma carteira inicial de pelo menos três CNPJs, com equipe, acompanhamento dos clientes e prestação de contas. O papel do usuário (administrador, editor ou leitor) é independente do plano contratado. Um analista interno pode usar Empresa; um consultor externo pode administrar Assessoria.

A jornada vendável é: configurar a empresa → selecionar oportunidade → enviar o resumo já existente → obter decisão do cliente → reunir documentação → preparar declaração/proposta → revisar o documento completo → exportar e acompanhar a participação/contrato. O diferencial a demonstrar é reduzir o trabalho e as pendências dessa jornada, com origem verificável e separação dos clientes. Não prometer vitória, habilitação garantida ou participação automática.

## Resultado deste incremento

Implementado localmente: acesso direto à identificação empresarial pela Central Operacional e pelo kit, reutilizando o cadastro existente; verificador SQL somente leitura para detectar desconfiguração das peças salvas antes de uma implantação. A revisão de UX foi feita no mesmo Design System privado do Claude, sem gerar um catálogo paralelo. Os critérios observados estão em `revisao-ux-claude-observada.txt`.

A confirmação cadastral não aprova a declaração/proposta. O atalho abre outra aba e mantém o rascunho original; ao voltar, a reconsulta e uma nova revisão são exigidas. A UI compartilhada da Defesa conserva seus padrões anteriores. Nenhum item desta seção constitui autorização para publicar.

### Evidências da rodada

- Navegador interno: seis verificações independentes de cadastro por CNPJ, confirmação, separação entre empresas e retorno/rascunho, em `iab-verificacao.json`. A imagem `cadastro-iab.png` usa exclusivamente dados fictícios.
- Navegador headless: 11 cenários, zero erros JavaScript ou saídas externas, incluindo 375/704/1280 nos temas existentes; `t1-navegador-resultados.json`. Regressões do kit: 11 grupos + seis cenários de sessão/processos, em `t1-kit-regressao-green.log`.
- Re-review T1 aprovado após cobrir as formas alternativas de abrir o cadastro. Clique comum, botão do meio e menu de contexto invalidam a revisão; Atualizar lista reconsulta dados preservando a proposta. Três cenários focados, nove unitários e lint passaram; `t1-fix1-green.log`, `t1-navegador-focal-resultados.json` e `t1-fix1-unitarios-green.log`.
- Testes focados: 53 aprovados, em `t1-regressao-green.log`.
- SQL real em PGlite efêmero: 184 verificações, 62 configurações indevidas rejeitadas com rollback da fixture; `seguranca-fix1-green.log`. Re-review T2 aprovado após corrigir a resolução de helper homônimo. Não foram alteradas a migração nem a autenticação.
- Primeira execução geral: 820 testes, 816 aprovados, quatro skips preexistentes, zero falhas; lint detectou quatro declarações de globais ausentes, corrigidas. O log `verify-completo.log` preserva essa falha. Lint posterior: exit 0, zero erros, 58 avisos preexistentes e 185 arquivos conferidos pelo Biome; `lint-final.log`.
- **Gate geral final, após todas as correções:** `npm run verify` terminou com exit 0; 820 testes, 816 aprovados, quatro skips, zero falhas; lint zero erros e os mesmos 58 avisos; Biome 185 arquivos. Evidência: `verify-final.log`. O SQL/PGlite é uma verificação separada e não está incluído nesses 820 testes.
- Proteção dos fluxos existentes: 20/20 hashes coincidem com a baseline; `protegidos-final.json`.
- Manifesto público inclui as duas novas dependências JS/CSS e as páginas afetadas. Não foi executado build que remove/recria `publico/`, nem compilação de Functions.

**Revisão final do conjunto aprovada no escopo local**, sem achados abertos. T1 e T2 passaram nas revisões independentes e no reexame de suas correções. A revisão final recalculou os hashes dos sete arquivos T1, do SQL/harness T2 e dos 20 protegidos, todos coincidentes. Parecer completo: `.superpowers/sdd/2026-10-31-fechar-jornada-cadastro/final-review.md`. Nenhuma dessas evidências substitui homologação autenticada ou libera produção.

## Matriz de prontidão

| Área | O que existe e evidência | O que falta para a oferta |
|---|---|---|
| Resumo, e-mail e boletins | Fluxos em uso relatados pelo usuário; escopo protegido. Baseline de 20 arquivos em `.superpowers/sdd/2026-10-30-kit-persistente/protegidos-baseline.json`. | Preservar comportamento e apresentação; testar regressão na homologação futura. Não acrescentar campos de considerações. |
| Empresas e acesso | Organizações, membros e empresas; limite técnico configurável em `supabase/limite_cnpjs_operacao.sql`. | Aplicar direitos comerciais reais por organização, sem confundir papel com plano. Campo livre `clientes.plano` não faz esse controle. |
| Oportunidade → processo | Seleção associada ao CNPJ e processo existentes em `painel.html`/`processos.html`. | Provar a jornada completa em ambiente isolado, incluindo seleção incorreta, falta de acesso e sessão expirada. |
| Identificação empresarial | Endpoint e formulário existentes; acesso antes concentrado na Central de Defesa. | Este incremento abre o cadastro na rotina operacional. A confirmação cadastral nunca equivale à aprovação de um documento. |
| Documentos e propostas | Interface e backend com peças, versões, revisão integral e DOCX; persistência, roles, Storage e cadastro por CNPJ homologados com serviços reais locais. Evidência: `../homologacao-real-20261031/HOMOLOGACAO.md`. | Conferir configuração/integrações do ambiente remoto autorizado. Fechar o pacote efetivamente necessário ao piloto: identidade visual, dados bancários e representantes, modelos permitidos e vínculo às exigências. |
| Exigências do edital | Checklist e referências disponíveis; referências manuais são indicadas como não verificadas. | Construir matriz exigência → arquivo/página/trecho → documento apresentado → validade → revisão. Checklist textual não certifica habilitação. |
| Proposta e custo | Proposta por itens e aritmética decimal verificadas; escopo atual limitado a 1–50 itens, unidades manuais e peça individual. | Planilha de custo separada do valor enviado, importação/exportação de planilha e lotes/pacote se fizerem parte da oferta inicial. Margens internas nunca devem aparecer no arquivo do cliente. |
| Assessoria | Separação por empresa, membros e processos. | Visão consolidada da carteira, pendências/responsáveis, contrato de assessoria e honorários, relatórios de entregas/resultados. São funcionalidades de produto, não configuração de serviços. |
| Contratos públicos | Cadastro de contrato, valores, datas, anexos e empenhos em `supabase/operacao_acompanhamento.sql` e UI correspondente. | Rotina de obrigações, execução, recebimentos e histórico conforme a oferta. Contrato público não substitui contrato de prestação de assessoria. |
| Aprovação do cliente | Trabalho anterior de envio/decisão é preservado; não revalidado nesta rodada. | Homologar o percurso com tokens, expiração, revogação e isolamento, sem enviar e-mail real nesta etapa. Só então descrevê-lo como pronto na oferta. |
| IA documental | Três ensaios fictícios no AI Studio: 23/23 campos semanticamente corretos em cada ensaio; origem do nome do arquivo falhou em todos. Relatório: `../ai-studio-leitura-20261030/resultados/RELATORIO.md`. | Vincular saída a ID/hash do anexo controlado pela aplicação, normalizar tipos, validar esquema e CNPJ, mostrar fonte e exigir revisão humana. Não é integração de produção nem medida de precisão geral/custo. |
| Cobertura PNCP | Recuperação local de 14 UFs registrada; histórico nacional preservado em 230 páginas/115.000 IDs. | Reconciliar catálogo mutável e resolver detalhes pendentes; normalizar e homologar importação depois de autorização. O estado está pausado e não foi reavaliado por rede nesta rodada. Não anunciar cobertura nacional histórica completa. |
| Planos e assinatura | Cadastro/aprovação de acesso existem; planos exibidos e campo administrativo não são uma assinatura implementada. | Entitlements por organização, vigência, limites, suspensão/cancelamento, trilha de ativação e conciliação. Definir preço após custo real e piloto. |
| Cobrança | Nenhuma integração de checkout/webhook identificada nesta auditoria. | Checkout hospedado, eventos assinados e idempotentes, tratamento de atraso/estorno e reconciliação. Alternativa inicial: cobrança assistida com ativação registrada e limites efetivos; nunca liberação apenas por mensagem informal. |
| Landing page, login e ajuda | Páginas e autenticação existentes, preservadas. | Alinhar promessa ao que foi homologado, demonstrar fluxo real, planos/condições transparentes, conteúdo de onboarding e recuperação de acesso testada. |
| Operação e suporte | Código e evidências locais de segurança/regressão. | Backup/restauração ensaiados, alertas de falha, logs sem segredos, política de retenção, suporte, rollback e limites de custo. |
| Robô de lances | Ideia de evolução, fora da jornada atual. | Avaliar portais/integrações permitidas, controle explícito, limites e auditoria. Não comercializar como recurso disponível. |

## Segurança e homologação

A migração local do kit foi desenhada com RLS e RPC restritas. Foi identificada uma lacuna de verificação: a checagem geral da identificação não verifica a configuração específica da tabela do kit. O novo verificador pré-implantação deve detectar essa desconfiguração, não corrigi-la nem substituir RLS. A reprodução de acesso indevido ocorreu somente em fixture efêmera após desligar RLS deliberadamente; isso não é evidência de vazamento atual em produção.

Na homologação, o executor SQL deve interromper o arquivo no primeiro erro. Um `SELECT` final de status isolado não comprova aprovação. O gate não certifica corpos de funções ou helpers transitivos, outras views/RPCs nem privilégios globais; essas responsabilidades continuam na revisão do ambiente real. Reconsulta entre abas permanece explícita e as permissões do endpoint existente não foram ampliadas.

O roteiro `../HOMOLOGACAO-KIT-REAL.md` foi ampliado e executado com banco, autenticação, REST e Storage reais, cobrindo as novas peças persistidas e o cadastro integrado. O resultado posterior está em `../homologacao-real-20261031/HOMOLOGACAO.md`; os serviços foram encerrados ao terminar e os volumes/backups preservados. A base reconstruída localmente não certifica a configuração de produção. PGlite e respostas simuladas permanecem provas complementares, não substitutos desse percurso real.

Ainda há URL Supabase fixa nos adaptadores de identificação/persistência; uma instância de homologação exige configuração explícita e revisão, não apenas trocar uma chave. A compilação e o smoke local do Worker completo foram comprovados posteriormente em `../integracoes-producao-20261031/RUNTIME-CLOUDFLARE.md`. Permanecem a integração remota, minificação explícita do CI e validação das cotas de CPU/inicialização, preservando o ambiente atual.

## Sequência para chegar ao piloto vendável

1. Fechar o incremento atual: revisão, testes focados, gate geral, comprovação visual e integridade dos arquivos protegidos.
2. Homologar a jornada real em ambiente isolado com contas Empresa e Assessoria, dois CNPJs, leitor/editor, arquivos fictícios, falhas e exportação. Resolver adaptadores/configuração e compatibilidade de Functions antes de qualquer produção.
3. Completar o pacote documental necessário ao piloto: modelos, timbrado, representantes e exigências rastreáveis, mantendo revisão humana. Priorizar lacunas que impedem preparar uma participação real.
4. Implementar os dois planos e os direitos por organização. Selecionar cobrança assistida registrada ou checkout hospedado; preço, canal e provedor ainda são decisões comerciais, sem habilitar cobrança agora.
5. Fechar suporte, onboarding e landing page com as promessas comprovadas. Rodar piloto acompanhado com empresas e assessoria antes de ampliar a oferta.
6. Somente após autorização de publicação: backup, migração controlada, segredos no servidor, integrações, smoke test e rollback. Resumo/e-mail/boletins permanecem sob regressão obrigatória.

## Critérios de liberação

- Cada empresa visualiza apenas seus dados; organização, papel e plano são validados no servidor. Alterar a URL não concede acesso.
- Trocas de CNPJ/sessão e respostas tardias não contaminam cadastro, peça, revisão ou exportação.
- Documento integral corresponde à versão revisada. Editar dados invalida revisão. Dados ausentes bloqueiam ou aparecem como pendência, sem invenção pela IA.
- Erros de rede, repetição de ações e retomada não geram peças/cobranças duplicadas nem aprovação silenciosa.
- Banco/rest/storage reais, migrações, políticas, grants, backup e rollback têm evidência reproduzível.
- O plano limita de fato a operação; pagamento/ativação têm origem verificável e eventos idempotentes.
- Cobertura de dados e limitações são mostradas honestamente. O catálogo PNCP observado não é snapshot transacional.
- Nenhuma regressão nos fluxos protegidos; nenhum dado real enviado à IA sem a configuração e a autorização aplicáveis.

## Fontes e limites desta análise

Inspeção do worktree, planos aprovados, relatórios locais citados e revisão de UX do mesmo Claude. Não foi feita nesta rodada uma auditoria nova de todos os endpoints de produção, auditoria jurídica, análise de custo de API ou homologação bancária. A lista é uma matriz de trabalho verificável, não certificação de que o produto já está pronto para venda.
