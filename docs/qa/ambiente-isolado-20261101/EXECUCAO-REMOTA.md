# Execução remota isolada: opções e limites

Análise em 01/11/2026. Nenhum upload, execução, provisionamento, alteração de configuração, contratação ou publicação foi realizado nesta frente. Foram lidos os relatórios e trechos do harness/adaptadores; documentação pública consultada via Context7 e fontes oficiais. Este documento prepara a decisão, não atesta capacidade remota.

## Recomendação operacional

Separar os dois ensaios:

1. **Migração e restauração:** usar um executor Linux remoto privado e efêmero para subir PostgreSQL 17.6, Auth e Storage de teste, reaproveitando os serviços/harness existentes e apenas dados fictícios. Isso permite executar fora do computador do usuário, sem publicar um site. Depende de executor disponível, quota/custo verificados e pacote privado revisado. Não reutilizar o repositório integrado à publicação automática.
2. **Capacidade Cloudflare:** manter como etapa própria. Um workerd rodando nesse executor comprova comportamento naquele executor, não CPU faturada, startup validado ou capacidade do hardware Cloudflare. Não trocar o nome da medição para aparentar que esse gate foi atendido.

A primeira opção reduz a dependência imediata de um projeto Supabase hospedado pago. Não reproduz integralmente o plano NANO gerenciado nem comprova recuperação de produção. O especialista de banco deve definir a comparação de catálogos e o uso do delta exato, sem remover sua guarda para fazê-lo aceitar qualquer banco.

## O que a Cloudflare permite de fato

| Caminho | Prova possível | Limite para este pedido |
|---|---|---|
| `wrangler versions upload` em Worker de teste **já existente** | A plataforma informa `startup_time_ms` sem promover a versão ao tráfego normal. | Continua enviando código/configuração à Cloudflare. Não executa a jornada nem mede CPU por requisição. |
| Primeiro upload para um novo Worker | Criação do Worker. | A documentação exige C3 ou `wrangler deploy`; `versions upload` não funciona na primeira criação. Não é um atalho para contornar a restrição de publicação. |
| Version URL | Requisições a uma versão específica. | Quando habilitada, a URL é pública; não oferece Workers Logs, Wrangler tail ou Logpush. Não adotar para obter prova de CPU por chamada. |
| Worker Preview | Ambiente de branch com configurações e observabilidade próprias. | Cria implantação de teste e URL. Exige esclarecer autorização para homologação privada, proteção de acesso e isolamento real dos recursos. |
| Version override com 0% | Seleção de versão dentro do deployment atual. | A versão precisa estar no deployment atual. Não usar no produto como teste disfarçado; isso altera a implantação e não atende ao isolamento pretendido. |

O upload separado de deploy está documentado em [Deployment management](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/), inclusive a restrição do primeiro upload. A medição de startup vem da validação da plataforma, conforme [limites de startup](https://developers.cloudflare.com/workers/platform/limits/#worker-startup-time). Ela não deve ser confundida com o wall time de `mf.ready` já medido localmente.

Para um Worker de teste existente, a configuração explícita deve manter `workers_dev: false`, `preview_urls: false` e nenhuma rota/domínio. Omitir `preview_urls` não garante desativação de configuração existente. Desabilitar essas URLs impede invocação por elas; não gera, por si só, um caminho privado para executar o fluxo. [Version URLs e controles de acesso](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).

Worker Previews requer Wrangler 4.135.0 ou posterior; a versão instalada registrada, 4.151.1, satisfaz esse piso sem upgrade. Esses Previews têm variáveis/bindings próprios, mas recursos só ficam isolados quando vinculados a destinos separados. Service bindings de Preview chamam o deployment de produção do Worker vinculado; não adicionar um deles por conveniência. [Previews](https://developers.cloudflare.com/workers/previews/). A observabilidade de Preview é independente; o `wrangler tail` não o suporta atualmente. [Test and debug](https://developers.cloudflare.com/workers/previews/test-and-debug/).

## Bloqueio de isolamento encontrado no código atual

O bundle aprovado ainda contém URLs fixas do Supabase de produção em:

- `netlify/functions/_auth.js`, linha 14;
- `netlify/functions/_empresa_identificacao_contexto.js`, linha 3;
- `netlify/functions/_kit_documentos_persistencia.js`, linha 3.

Portanto **criar um banco separado e trocar somente uma variável de ambiente não isola esse bundle na Cloudflare**. O arquivo de autenticação faz parte do conjunto protegido e não foi modificado.

O harness existente resolve isso em desenvolvimento com `dev.outboundService` e um roteador de fixtures, em `docs/qa/integracoes-producao-20261031/testar-worker.cjs`, linhas 18–20. A auditoria também verifica `globalOutbound`. Isso é contenção do runtime de teste; não há nesta análise evidência de que essa configuração seja transplantável a um Worker hospedado comum.

Consequência: o runner remoto pode reutilizar o mecanismo e os destinos fictícios/isolados, mas o teste de requisições hospedadas na Cloudflare precisa primeiro de uma configuração de isolamento suportada e revisada. Um wrapper que intercepte rede ou uma troca de configuração de autenticação constituiria outro artefato/alteração e não deve ser introduzido silenciosamente. Startup isolado, se autorizado e sem efeitos globais de rede, é uma prova separada; não libera o fluxo.

## Custos: o que precisa ser conferido antes de iniciar

| Opção | Regra pública consultada | Decisão necessária |
|---|---|---|
| GitHub Actions, runner Linux padrão em repositório privado | A franquia de compute é compartilhada. Referência pública: Free US$ 12/mês; Pro US$ 18/mês. Linux x64 de 2 cores: US$ 0,006/min. | Conferir plano, saldo real, armazenamento e orçamento da conta. Não presumir saldo porque existe franquia. |
| Ensaio ilustrativo de 30 minutos nesse runner | US$ 0,18 de consumo computacional antes de franquias; não inclui armazenamento, impostos ou outros recursos. | A duração é um teto proposto para o primeiro job, não previsão de que toda a homologação termine nele. |
| Workers Free | 100 mil requisições/dia e 10 ms CPU por invocação; quotas de conta. | Conferir estado da conta e o uso compartilhado antes de gastar a quota. Não habilitar serviços adicionais pagos. |
| Workers Paid | Mínimo público de US$ 5/mês por conta, com cobranças adicionais por uso além da inclusão. | Não contratar para resolver automaticamente o sinal de CPU local. Avisar e obter decisão antes de qualquer mudança. |

As referências de Actions são [cobrança e franquias](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Armazenamento tem franquia/cobrança própria; não basta limitar minutos. O valor real incremental desta conta não foi inspecionado por esta frente. Repositório público daria outra regra de gratuidade, mas publicar código ou evidências para obter gratuidade está fora do pedido.

Budgets só bloqueiam consumo se a opção de parada estiver habilitada; alerta de orçamento sozinho não limita gasto. Uma alteração de orçamento da conta também não deve afetar os robôs existentes por tabela. Verificar o escopo e o bloqueio já disponível antes de propor qualquer mudança. [Controle de orçamento](https://docs.github.com/en/billing/how-tos/set-up-budgets). Sem comprovar contenção de cobrança adicional, a execução precisa aguardar o aviso/decisão do usuário, mesmo com estimativa pequena.

O preço e a franquia Cloudflare vêm de [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Quota gratuita não significa capacidade comprovada; o relatório anterior já sinaliza risco no Free.

## Pacote mínimo para executor remoto privado

Preparar somente após identificar o destino, sem enviar nada nesta fase:

1. Lista explícita dos scripts de QA, SQLs revisados, lockfile/dependências fixadas e fixtures fictícias indispensáveis. Fixar hashes do delta, bundle e fontes. Não fazer upload do worktree inteiro.
2. Excluir `.env*`, credenciais, git/metadados locais, diretórios privados de backup, PDFs reais, brutos PNCP, bases de prospecção, `data/editais_vistos.json`, logs com tokens e artefatos antigos não publicáveis. Os nomes de arquivos do backup privado também não são necessários nesse pacote.
3. Executor efêmero dedicado, sem secrets herdados da produção, sem acesso a Docker da máquina do usuário, sem cron, SMTP, IA externa ou integrações de deploy. Disparo manual único, uma execução por vez e timeout. Não adicionar workflow ao repositório ligado a Pages sem análise, porque push pode disparar publicação.
4. Instalar/baixar dependências e imagens fixadas apenas no executor; depois fechar a rede de execução para os serviços de teste. Demonstrar que requests ao host de produção são interceptados ou negados antes da primeira ação de produto.
5. Executar migração/restauração e percurso autenticado com CNPJs fictícios, usando o procedimento do especialista de banco. Um novo teste de workerd serve à compatibilidade do artefato no runner, não ao gate Cloudflare.
6. Guardar somente resultado sanitizado, hashes, versões, exit codes, comprovação de isolamento e encerramento; retenção curta. Dumps fictícios e arquivos de teste podem ficar em artefato privado conforme orçamento, nunca com tokens ou dados reais.

## Ponto exato de parada

Antes do primeiro job remoto: destino privado identificado, custo adicional bloqueado ou autorizado, conteúdo do pacote e isolamento revisados. Nada disso é substituído pelo pedido genérico de "não gerar custos".

Antes do primeiro upload Cloudflare: confirmar se a autorização inclui uma implantação **somente de homologação privada**, sem tráfego/domínio de produção, e resolver o endereço fixo de produção no bundle. Sob a interpretação literal de "sem publicar", não executar `deploy`, `preview`, nem criar exposição por Version URL. Sem Worker de teste existente, nem o caminho de upload-only fica pronto.

Resultado desta análise: há caminho concreto para migração/restauração em executor remoto privado, sujeito à disponibilidade e custo da conta. Não foi demonstrado um caminho pronto para concluir toda a medição Cloudflare sem nova implantação/configuração. Não declarar nenhum dos ensaios remotos executado.
