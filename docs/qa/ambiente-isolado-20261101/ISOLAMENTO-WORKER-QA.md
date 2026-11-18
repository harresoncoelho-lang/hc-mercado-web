# Worker de homologação privada: plano de isolamento

Análise de 01/11/2026. O usuário autorizou homologação privada, com aviso antes de custos. Este documento especifica a próxima implementação: não foi criado, compilado, enviado ou implantado um Worker nesta frente. Nenhum original, autenticação, modelo, resumo, e-mail ou robô foi alterado.

## Decisão recomendada

Construir remotamente uma **cópia derivada para QA**, preservando os handlers e a árvore completa de imports do bundle Pages. Alterar somente seis literais de configuração em quatro cópias de arquivos, mediante hashes e comparação explícita. Encapsular esse bundle em uma entrada exclusiva de QA que aceite apenas POST/OPTIONS nas duas rotas de documentos. Implantá-lo posteriormente em um Worker separado, protegido integralmente por Access e conectado exclusivamente ao Supabase de homologação.

Isso permite ensaiar os handlers reais sem editar os 20 arquivos protegidos. O resultado não é binariamente igual ao artefato aprovado: contém configurações de QA e um pequeno controle adicional de entrada. A medição deve identificar claramente essa diferença.

## Correção do inventário de origens

A leitura focada encontrou **quatro origens fixas, e não apenas três**, além de duas chaves públicas de projeto. A quarta origem pertence à operação de confirmação de identificação; deixá-la intacta manteria uma chamada direta ao RPC de produção.

| Cópia do arquivo | Configuração a substituir | Quantidade |
|---|---|---:|
| `netlify/functions/_auth.js` | `SUPABASE_URL` e `SUPABASE_ANON_KEY` | 2 |
| `netlify/functions/_empresa_identificacao_contexto.js` | `URL` e `ANON` | 2 |
| `netlify/functions/_kit_documentos_persistencia.js` | `URL` | 1 |
| `netlify/functions/empresa-identificacao.js` | `URL` | 1 |

As quatro URLs passam para `https://luguscapasskcsficckf.supabase.co`. As duas chaves públicas devem vir desse mesmo projeto, verificadas antes do preparo. Não reutilizar a chave pública de produção. A chave de serviço será somente a de QA, fornecida depois por secret do ambiente, sem entrar em código, diff, relatório ou logs. A associação de uma chave opaca ao projeto precisa de procedência verificada; formato ou decodificação não comprovam essa associação.

O preparador deve comparar declarações exatas e hashes, exigir uma ocorrência esperada de cada declaração e falhar diante de divergência. Não fazer substituição genérica no repositório, nem alterar um bundle minificado. A prova de diff é simples: cada cópia final deve ser exatamente o original com essas substituições, sem qualquer outra diferença.

## Entrada e alcance do ensaio

A entrada adicional permite somente os caminhos literais `/api/empresa-identificacao` e `/api/kit-documentos`, com POST ou OPTIONS; os demais retornam 404/405 antes de chamar o bundle. Ela importa e encaminha ao `fetch` do bundle completo, preservando o router, adaptador, imports e handlers originais. Testar também caminhos codificados, sufixos, barras extras e métodos indevidos.

O router completo carrega outros handlers estaticamente. Portanto, o pacote ainda poderá conter referências textuais a origens de produção pertencentes a rotas bloqueadas. Não declarar “nenhuma URL de produção no bundle”. Inventariar essas referências, revisar efeitos no carregamento dos módulos e comprovar que as rotas bloqueadas não executam seus handlers. A entrada não constitui um firewall de saída. Se houver chamada externa no carregamento ou caminho indireto alcançável fora das seis configurações mapeadas, interromper o preparo até resolver o isolamento.

Não adicionar secrets de SMTP, IA de produção, agendamentos, filas, bindings de produção ou recursos de resumo/boletim. Ativar somente a flag já existente `IDENTIFICACAO_EMPRESA_LOCAL=1`. A autenticação da aplicação continua validando uma sessão real de usuário de QA e suas permissões por CNPJ.

Este primeiro ensaio é **de API pelo executor remoto**. A lista de CORS original permanece intacta. Não forjar `Origin` de produção para aparentar homologação do navegador. Autenticação visual, CORS e a interface no Design System exigem uma etapa própria; sucesso dos handlers não comprova esses aspectos.

## Por que não interceptar o fetch global

| Opção | Consequência |
|---|---|
| Substituir os seis literais nas cópias antes de compilar | Não acrescenta chamadas, branches ou interceptação em cada operação; mantém o fluxo original e gera um diff finito e auditável. |
| Reescrever destinos em `globalThis.fetch` | Altera o ambiente de todos os imports, exige preservar Request, headers, body, redirects e sinais; adiciona trabalho em cada chamada e pode deixar caminhos de fallback para produção. Dificulta comparar comportamento e CPU. |

Recomenda-se a primeira opção. O gate de entrada é separado da lógica de negócio, possui alcance limitado e não concede acesso nem substitui a autenticação existente.

## Arquivos necessários na próxima implementação

Todos abaixo são novos e exclusivos de QA, no diretório deste relatório; ainda não foram implementados.

1. `preparar-worker-qa.cjs`: preparar cópias em diretório novo e privado, validar os 20 hashes protegidos, aplicar as seis substituições, compilar com as versões fixadas e produzir manifesto/diff. Reaproveitar a seleção de fontes e as guardas de `docs/qa/integracoes-producao-20261031/preparar-cloudflare.cjs`, sem executar seu fluxo local ou reutilizar seu destino. Não incluir arquivos PNCP, `.env`, PDFs privados ou conteúdo do usuário.
2. `entrada-worker-qa.mjs`: gate das duas rotas, seguido do encaminhamento para `./produto-qa.js`. Não alterar `fetch` global, handlers ou adapter.
3. `worker-qa.test.cjs`: conferir substituições exatas, falha diante de origem/chave ausente ou inesperada, preservação dos originais e bloqueio de todos os caminhos fora do escopo. Usar doubles locais no executor; nenhuma chamada a produção.
4. `wrangler.qa.template.jsonc`: Worker separado, nome proposto `licitaplena-qa-documentos`, `compatibility_date: 2025-09-01`, `nodejs_compat`, `workers_dev: false`, `preview_urls: false`; inicialmente sem rotas, assets ou bindings de produção. Observabilidade de invocações para a etapa hospedada, sem registrar corpos ou credenciais. A chave de serviço não pertence a esse arquivo.
5. `validar-worker-remoto.cjs`: ensaio serial dos dois endpoints, somente no hostname de QA certificado, com sessões fictícias reais, isolamento entre CNPJs, revisão antes de aprovação e geração de documento. Credenciais Access e sessão Supabase são independentes. Registrar resultados sanitizados e correlacioná-los à versão e à medição da plataforma.

O build mantém Wrangler 4.151.1 e as dependências fixadas já registradas. Deve reutilizar a compilação Pages completa; não fazer tree-shaking manual de handlers para reduzir artificialmente o custo de startup. Os assets não são publicados neste ensaio de API. Antes de enviar, verificar como o bundle compilado trata o binding ASSETS e confirmar que os dois caminhos autorizados não o exigem.

O manifesto privado deve registrar: hashes dos originais e das cópias; seis transformações e suas contagens; hashes das chaves públicas, sem segredo; inventário de fontes/imports; versões e configuração; tamanho bruto/gzip; hash do bundle derivado; hash do gate; identidade do projeto QA e diferença para a referência aprovada. Guardar fontes, source maps, manifesto e diff fora da pasta de upload. O payload remoto contém apenas os módulos/configuração necessários, após inspeção. Não usar o repositório vinculado ao deploy automático do site.

## Acesso privado antes de qualquer tráfego

Proteger **o Worker inteiro**, opção Access **All traffic**, não somente uma URL de preview. A proteção por Worker abrange seus domínios e rotas associados; uma aplicação Access por hostname cobre apenas o hostname configurado. Manter também as duas flags de URLs automáticas explicitamente desativadas. [Proteção por Worker](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) e [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).

Sequência a preparar para revisão:

1. Reconfirmar capacidade gratuita e possibilidade de criar um Worker isolado sem rotas/URLs automáticas. A primeira criação requer deploy; `versions upload` não cria um Worker novo. Não apresentar essa etapa como simples leitura ou upload sem implantação. [Deployment management](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/).
2. Se a identidade do Worker precisar existir antes de configurar Access, criar primeiro um stub que sempre nega acesso, sem secrets, rotas ou URLs automáticas; aplicar Access antes de disponibilizar o módulo de QA. Se a plataforma não garantir essa ordem fechada, parar e informar a limitação.
3. Preparar política All traffic: e-mail exato do operador verificado e Service Auth com um token específico de CI, escopo exclusivo desta aplicação e validade curta. Sem Everyone, bypass, wildcard ou “qualquer service token”. Mostrar nome, alcance, validade e política antes de eventual confirmação de segurança exigida pela ferramenta.
4. Somente após Access estar aplicado, associar um único hostname de QA, por exemplo `qa-documentos.licitaplena.com.br`, sujeito à disponibilidade e revisão. Nunca alterar apex, domínio principal ou rotas amplas. O endereço existe na internet, mas seu conteúdo exige autenticação; não chamá-lo de rede privada sem exposição de endereço.
5. Validar acesso anônimo negado antes do handler e acesso autorizado limitado às duas rotas. O runner utiliza `CF-Access-Client-Id` e `CF-Access-Client-Secret`; preservar `Authorization: Bearer <sessão QA>` para a aplicação. Não usar a alternativa Access de header único sobre Authorization. [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Não criar token, aplicar política, subir código ou associar hostname com base apenas neste relatório. Essas ações ficam para a coordenação da implementação e seus gates concretos de acesso/custo.

## Capacidade: prova e limites

As seis substituições adicionam **zero chamadas de rede e zero branches**, mas tamanhos dos literais e saída do compilador podem variar. Medir a diferença de bytes no build. O gate acrescenta parse de URL, verificações de caminho/método e um encaminhamento; seu custo em milissegundos é desconhecido antes da medição. Não descontar uma estimativa, nem afirmar equivalência binária ou limite conservador garantido.

Capturar `startup_time_ms` fornecido pela Cloudflare e CPU por invocação/versão na plataforma, com unidades documentadas. Medir chamadas frias e aquecidas, PDF curto e próximo dos limites existentes (2 MiB/8 páginas), e proposta próxima de 50 itens, respeitando validações atuais. Não confundir tempo de parede do HTTP, espera de banco, startup local ou workerd em runner com CPU da Cloudflare. Version URLs não oferecem a observabilidade necessária; usar o Worker de QA protegido com logs de invocação. [Limites e medição](https://developers.cloudflare.com/workers/platform/limits/) e [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).

O resultado certificará os handlers com dados e configuração de QA, gate adicional e aquela versão, não a capacidade de produção em qualquer carga. Supabase QA 17.11 também difere do PostgreSQL 17.6 de produção. A conclusão deve separar prova de banco, API, interface e capacidade; não convertê-las em uma única alegação de ambiente idêntico.

## Custo e próximo gate concreto

A coordenação informou verificação somente leitura da conta GitHub Free: compute incluído $0 usado de $12, armazenamento 0 GB de 0,5 GB, budget Actions existente $0 com “Usage blocked”. Isso permite planejar um job privado de até 30 minutos com runner padrão, mas é necessário reconfirmar saldo, organização/repositório cobrados, retenção e bloqueio imediatamente antes de disparar. Não mudar orçamento ou habilitar cobrança para vencer um bloqueio.

A hospedagem Cloudflare precisa de verificação própria: plano da conta, consumo agregado, disponibilidade do Access e limites do Worker. Não presumir que crédito GitHub cobre Cloudflare ou que o projeto Supabase Free garante qualquer custo de compute externo. Qualquer upgrade, cobrança, runner maior ou recurso pago exige avisar e obter autorização antes.

Próximo avanço seguro: implementar e revisar os cinco arquivos de QA e seu manifesto em pacote privado; executar o preparo/testes no runner separado após confirmar o custo zero; apresentar o Worker, política Access e hostname concretos antes da ativação. Nenhuma publicação do LicitaPlena, transferência de dados reais ou alteração de produção faz parte deste plano.
