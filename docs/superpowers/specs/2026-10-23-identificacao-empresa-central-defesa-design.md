# Identificação da empresa e anexos privados na Central de Defesa

Data: 23/10/2026. Estado: desenho aprovado pelo usuário, implementado e homologado LOCALMENTE. Não publicado em produção.

## Objetivo

Vincular contrato social e cartão CNPJ à empresa ativa, reaproveitar documentos já cadastrados, confirmar os dados extraídos e preencher identificação e destinatário das minutas sem enviar documentos empresariais, CPF ou dados cadastrais à IA jurídica. O órgão destinatário vem do edital correspondente, separado da empresa interessada.

## O que existe

- `operacao.html:86–99,123–138`: seleção de empresa, tabela `operacao_documentos`, upload no bucket privado `operacao-documentos` e links assinados de 60 segundos. Caminho existente: `organizacao_id/empresa_id/uuid-nome`.
- `supabase/operacao_licitacoes.sql:23–58`: empresa com razão social, CNPJ e responsável; documentos com tipo, título, caminho, nome e datas. Não há endereço cadastral nem qualificação confirmada do representante.
- `supabase/acesso_empresa_convites.sql:18–60,136–149,185–197`: acesso por empresa, função `pode_acessar_empresa_operacao`, política de armazenamento que valida organização e empresa do caminho e proteção de colaboradores convidados. A migração base antiga isolava apenas por organização: a implantação dessa migração posterior precisa ser comprovada antes de liberar a nova interface.
- `painel.html:3009–3084,4578–4598`: a Central já conhece usuário, empresa ativa e edital, verifica troca de contexto e lê razão social/CNPJ por RLS. O cache da lista de empresas precisa ser invalidado após edição de dados cadastrais.
- `defesa-ui.js:4–9,183–184`: preenche razão social e CNPJ localmente depois da análise; esses dados não vão à IA. Rascunhos usam chave por usuário, empresa e edital.
- `defesa-licitante.js:13–30`: minuta documental já recebe `orgao`, mas a minuta da análise em `_defesa_contexto.js:205` mantém destinatário como marcador genérico. `preencherIdentidadeLocal` hoje também deixa destinatário em aberto.

## Alternativas

1. **Somente reutilizar documentos e cadastro atual:** anexar e abrir os dois documentos; razão social/CNPJ/responsável já preenchidos. Menor esforço, porém não cobre endereço, representante e confirmação rastreável.
2. **Reutilizar documentos privados + identificação confirmada por empresa — recomendada:** manter bucket e tabela existentes; acrescentar apenas um perfil confirmado. Extração gera sugestões, nunca substitui o cadastro silenciosamente. A minuta funciona com confirmação manual quando a extração não puder ler o arquivo.
3. **Base empresarial enviada à IA/RAG:** mais processamento e exposição de dados; desnecessária para preencher identificação e fora desta fatia.

## Fluxo recomendado

1. Na Central, mostrar “Dados da empresa”, empresa ativa e “Usar documento existente”/“Anexar contrato social”/“Anexar cartão CNPJ”. O anexo é permanente da empresa, não do edital atual.
2. Reaproveitar o upload privado. Limitar tipos e tamanho, verificar assinatura do arquivo e gerar nome físico aleatório. Nunca aceitar URL arbitrária para extração ou usar caminho de outra empresa.
3. Oferecer campos editáveis de razão social, CNPJ, endereço, representante e cargo. Não coletar CPF por padrão. Os dados existentes são preenchidos sem consulta a serviço de CNPJ.
4. Extração determinística de PDF nativo gera candidatos com documento, hash, página e trecho. CNPJ múltiplo, endereço de filial ou sócio não autorizam escolher automaticamente. Divergência com a empresa ativa bloqueia a confirmação até conferência explícita.
5. Exibir candidatos lado a lado com a fonte; o usuário confirma os campos. Escaneado, ilegível, protegido, incompleto ou acima do limite segue para preenchimento/conferência manual; não declara leitura completa.
6. Persistir somente dados confirmados e sua proveniência. Na troca do arquivo, invalidar a confirmação derivada daquele hash. Nunca reaproveitar confirmação de outra empresa.
7. Ao preparar minuta, carregar identificação confirmada sob a sessão/RLS atual e preencher marcadores localmente. Órgão vem do edital canônico ativo; autoridade, endereço/canal e prazo permanecem para confirmação quando não houver fonte inequívoca.
8. Preservar editor, revisão obrigatória antes do DOCX, rascunho isolado, bloqueios de fonte/cotas e ausência de envio/protocolo automático.

## Esquema mínimo proposto

Uma tabela `operacao_identificacao_empresa`, uma linha por empresa:

- `empresa_id uuid` como chave primária; `organizacao_id uuid` obrigatório.
- FK composta `(empresa_id, organizacao_id)` para `operacao_empresas(id, organizacao_id)`.
- `dados_confirmados jsonb`: conjunto fechado de campos de identificação, com limites de tamanho e tipos validados. Não guarda texto integral do contrato.
- `proveniencia jsonb`: documento cadastrado, caminho, hash SHA-256 e página/trecho por campo, ou origem “preenchimento manual”. Referências precisam pertencer à mesma empresa e organização.
- `confirmado_por uuid`, `confirmado_em timestamptz`, `atualizado_em timestamptz`.

RLS usa `pode_acessar_empresa_operacao(organizacao_id, empresa_id)` e a FK composta. A confirmação deve passar por operação autenticada que valida campos, empresa, documento e hash; identidade de quem confirmou e horário não vêm livremente do cliente. A política existente é de acesso por empresa, não de somente leitura: restrições por papel, se desejadas, devem ser especificadas separadamente.

Arquivos continuam em `operacao_documentos`/bucket existente. Incluir tipo “Cartão CNPJ” na lista, sem duplicar documento se já houver um selecionável. Upload seguido de falha no registro deve remover apenas o objeto recém-criado e autorizado para evitar órfãos; exclusão deve manter consistência entre registro, perfil e storage.

## Extração e limite de CPU

O projeto já tem `pdf-parse`, `mammoth` e leitor/OCR local. Não reutilizar o leitor de URLs do PNCP para buscar anexos privados, nem habilitar OCR remoto ou IA nova. Primeiro medir extração de cartão CNPJ de uma página e contrato social real no limite do Worker Free. A limitação de CPU já observada impede prometer extração arbitrária síncrona de qualquer contrato. A interface deve continuar completa com confirmação manual; ampliar processamento somente mediante resultado dessa medição e autorização compatível com custo zero.

## Integrações implementadas localmente

- Interface/identificação: `defesa-ui.js`, `painel.html`, `defesa-licitante.js` e testes correspondentes.
- Reuso/extração: helper específico para dados cadastrais; autorização por sessão e RLS, download privado autenticado sem chave de serviço no navegador. Nenhum documento empresarial entra em `_defesa_contexto`/prompt jurídico.
- Persistência: uma migração local para a tabela/perfil e operação de confirmação, com testes de isolamento entre organizações, empresas e convidados.
- Destinatário: preencher apenas nome canônico do órgão do edital; não inventar autoridade, endereçamento ou legitimidade de assinatura.

## Critérios de aceitação local

- Upload e perfil sobrevivem a sair/entrar e ficam apenas na empresa escolhida.
- Outro cliente/empresa/convidado sem acesso não consegue listar, ler, assinar URL, confirmar ou excluir o arquivo/perfil.
- Troca de empresa durante upload/análise não anexa ou preenche dados no contexto novo.
- CNPJ divergente, vários sócios, fonte parcial e campos sem prova exigem confirmação manual e não liberam falso preenchimento automático.
- Empresa e órgão não se confundem; alteração dos dados invalida revisão da minuta quando afetar o documento.
- Zero chamadas de IA para extração/preenchimento; zero envio automático; modelo, autenticação e cotas existentes preservados.

## Limites desta investigação

Somente fontes locais foram lidas. Não confirmei schema, políticas ou cota de armazenamento efetivamente implantados em produção e não abri documentos empresariais. Não foi executado upload, extração de dados pessoais, migração nem chamada de IA.

## Ajustes da revisão do desenho

- **Cadastro canônico:** razão social e CNPJ da tabela `operacao_empresas` continuam sendo a identidade canônica da empresa. O perfil confirmado complementa esse cadastro, sem criar uma segunda razão social ou CNPJ concorrentes. Extração divergente exige conferência e eventual correção explícita do cadastro autorizado; anexar ou confirmar um documento nunca sobrescreve esses campos silenciosamente.
- **Invalidação em todos os caminhos:** alteração, substituição ou exclusão de um documento invalida os campos confirmados que dependem de seu hash e a revisão das minutas afetadas. Isso inclui operações realizadas pela Central Operacional em `operacao.html`, não apenas pela nova interface da Central de Defesa. Não basta invalidar somente no navegador atual: a confirmação precisa ser conferida novamente ao carregar dados e antes de preparar/exportar uma minuta.
- **Validação no servidor:** empresa ativa, organização, registro do documento, caminho no bucket, hash e vínculo de cada campo confirmado são verificados no servidor sob a sessão autenticada. Caminho/hash/empresa informados pelo navegador não são prova suficiente de acesso ou de conteúdo. Referências a documentos alterados, excluídos, de outra empresa ou sem correspondência de hash são recusadas.
- **Gate de implantação remota:** a funcionalidade remota permanece bloqueada até comprovação da migração posterior de RLS por empresa e das políticas de Storage em `supabase/acesso_empresa_convites.sql`, com testes reais de isolamento entre organizações, empresas e convidados. A existência desses arquivos no repositório não comprova que as políticas foram aplicadas. A migração base que isola apenas por organização não é suficiente.

Estado final: desenho aprovado e implementação local homologada. Alterações remotas e publicação desta feature não foram realizadas.


## Fechamento da homologação local

- [x] Cadastro canônico preservado; divergência de documento bloqueada no navegador, sem afrouxar validadores.
- [x] Login, logout e novo login reais no ambiente isolado.
- [x] Upload privado, extração PDF nativa, revisão, confirmação, reabertura do perfil e aplicação na minuta pela interface real.
- [x] Auth/RLS/Storage reais: isolamento entre organizações e convidados, hashes, substituição de objeto, invalidação, confirmação manual e bloqueio de escrita direta/RPC pelo usuário.
- [x] Três ocorrências de proveniência em até dois documentos distintos aceitas; três documentos distintos rejeitados.
- [x] Gate final: 633 testes, 629 passaram, 4 ignorados, zero falhas. Build estático com 30 arquivos raiz e Worker compilado.
- [x] Testes descartáveis limpos; conta e empresa fictícias do preview preservadas intencionalmente para revisão do usuário.

Limites: extração automática somente de PDF com texto nativo, até 2 MiB e 8 páginas, por rótulos explícitos. Upload até 4 MiB permanece anexado mesmo quando a extração exige preenchimento manual. Não há OCR novo, IA de extração, coleta de CPF ou envio de documentos empresariais à IA jurídica. Razão social/CNPJ do cadastro não são sobrescritos. O custo de CPU desta NOVA feature em Worker remoto ainda não foi medido; a compilação não substitui esse teste. O perfil e a migração existem somente no ambiente local: não anunciar disponibilidade em produção.
