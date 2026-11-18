# Execução contínua do LicitaPlena

Referência: 01/11/2026. Auditoria documental do estado registrado e dos arquivos presentes, sem iniciar serviços, migrações ou testes nesta auditoria. Contagens abaixo pertencem às evidências citadas, não a uma nova homologação.

## Objetivo e limites

Entregar a jornada Empresa e Assessoria: oportunidade → processo/CNPJ → resumo preservado → decisão → documentos → proposta revisada → operação assistida no portal → acompanhamento. Cadastro automático e robô são requisitos atuais; não removê-los do escopo por conveniência. Conector ChatGPT/Claude deve permitir trabalhar com dados e ações autorizadas do LicitaPlena, e não apenas exibir um chat genérico.

O usuário autorizou execução contínua e agentes. A autorização não libera produção, propostas/lances reais, aceite de declarações, custos, instalação de extensão, ampliação de permissões ou mudanças no resumo, e-mail e robô de boletins. Não retomar migração automaticamente. O Design System canônico permanece o privado do Claude: `https://claude.ai/artifact/6Th8mgnv1z1aoYAvCixrGc`.

## Estado real — matriz de entrega

| Frente | Código / prova existente | Design System / demonstração | Lacuna para concluir |
|---|---|---|---|
| Documentos por CNPJ | `empresa-identificacao-ui.js`, `netlify/functions/empresa-identificacao.js`, `_empresa_identificacao*.js`, `_empresa_documentos.js`; kit com API, persistência e revisão. Homologação local autenticada: 13 grupos, oito DOCX, troca A→B→A e conflito 409. | Revisão integral e cadastro demonstrados no catálogo; não equivalem ao runtime remoto. | Matriz exigência → fonte → documento → validade/revisão; timbrado/representantes/modelos prometidos; renderizar DOCX; comprovar percurso no ambiente privado de entrega. |
| Proposta documental | `kit-documentos-ui.js`, `netlify/functions/_kit_documentos.js`, `_kit_documentos_persistencia.js`, `kit-documentos.js`, `supabase/kit_documentos.sql`. Peças persistidas, revisão ligada à versão e DOCX. | Importação operacional demonstrativa separada. | Produto documental ainda tem limite 50 itens e precisão própria de duas casas; não confundir com demonstração de milhares de itens/quatro casas. Separar custos privados; decidir e testar contrato de importação, grupos e formatos. |
| Extensão de leitura | `extensao-leitura/`: Manifest V3 manual, `activeTab`/`scripting`, validação antes de DOM, contexto sem escrita; 26 testes Node e revisão independente registradas. | Nota v52 registra critérios; o contador 23 da nota é histórico anterior à suíte 26. | Não instalada/homologada. Vínculo semântico do CNPJ visível ao fornecedor não confirmado. APIs Chrome/DOM de teste são simuladas. Não relaxar a identidade para produzir sinal verde. |
| Cadastro de ofertas | Não há executor transacional real entregue. Inspeção somente leitura comprovou pregão 41/2026 UASG 788820, 206 itens, 21 páginas de dez. | `IntegracoesOperacionais` v48: CSV, campos, totais BigInt, paginação 10, massas até 2.500 relatadas; coordenação conferiu 206 e grupo. V49 recupera checkpoint **só para inspeção**. | Fonte simulada independente e conciliação após recarga; contrato com proposta real; confirmação externa por item; exclusividade; homologação autorizada de treinamento. Fonte de confirmação não pode ser o próprio checkpoint. |
| Robô de lances | Nenhum motor operacional real comprovado. | Regras, piso/limites, pausa e política separada demonstrados. | Motor determinístico, contrato de modalidade/preço/desconto, relógio/sessão, executor único, limites, revogação, reconciliação de resposta incerta, canal permitido e teste de treinamento. Não usar texto de IA como ordem direta de lance. |
| IA especializada / ChatGPT / Claude | Leitura AI Studio: três ensaios fictícios, com problema de origem de nome de arquivo; componentes internos de IA existentes não são conector externo. | Cartões e escopos demonstrativos; nenhum MCP/OAuth comprovado. | Confirmar demonstrações do Prime; ferramentas do domínio com autorização tenant/CNPJ e fontes; ID/hash do anexo controlado pelo sistema; avaliações de extração, abstinência, vazamento e injeção; depois conexão cliente real autorizada. |
| Empresa e Assessoria | Organizações/membros/empresas e limite técnico de CNPJs existentes. | Plano de produto e componentes de carteira. | Direitos comerciais no servidor; carteira acionável; pedidos e portal restrito do cliente; contrato de assessoria/honorários e prestação de contas. Não confundir plano com papel ou contrato público com assessoria. |
| Landing / login / onboarding | Páginas e autenticação atuais preservadas. | `LandingSaaS`, `AuthLogin`, `AppShell` são prévias; apresentação final unificada pendente. | Percurso visual completo Empresa/Assessoria, responsivo/acessível, estados de erro/vazio/permissão, primeira preparação e promessa compatível com provas. Login ilustrativo não é recuperação de acesso testada. |
| Planos / pagamento | `clientes.plano` administrativo, sem checkout/webhook implementados na auditoria. | Empresa R$149, Assessoria R$299 e expansão R$599 são hipóteses, não preços aprovados. | Entitlements, consumo, provedor e taxas, eventos assinados/idempotentes, atraso/cancelamento/saída; validar margens. Sem ativar cobrança ou custos. |
| Segurança / operação / escala | RLS/RPC e isolamento do kit testados localmente; restore V4 do banco fictício validou escopo registrado, não recuperação de produção/Storage completo. Protegidos 20/20 preservados nas últimas verificações. | Estados de bloqueio e critérios documentados. | Testes de autenticação/arquivos reais no destino privado, autorização de cada ferramenta, logs/retensão/alertas, recuperação de arquivos, carga com perfil definido. 1.000 ativos em 2027 não é prova de 1.000 simultâneos. |

## Fila executável

### Incremento já atribuído pela coordenação

O núcleo `prevalidacao-lote` está em implementação por agente dedicado: não iniciar outro escritor para essa entrega. Revisão independente vem depois do resultado. A conclusão deste núcleo deve anteceder a integração de seus contratos ao simulador; esta auditoria não afirma que o núcleo já passou em testes. Enquanto o agente trabalha, a próxima frente liberada é a recuperação simulada abaixo, desde que não escreva nos mesmos arquivos nem altere os contratos em paralelo.

### 1. Agora: fechar recuperação simulada com fonte independente

É o próximo incremento viável sem login governamental, nova infraestrutura ou custo. Atua no mesmo componente `IntegracoesOperacionais` do Claude, preservando todas as outras prévias e os módulos reais.

- Reaproveitar a fila, IDs de contexto, quatro casas e checkpoints da v49. Acrescentar uma fonte fictícia independente que represente o estado confirmado pelo portal; não derivar essa fonte do checkpoint recuperado.
- Recuperar sempre parado e sem autorização; conciliar cada item por CNPJ, compra, ID e valores. Um resultado incerto continua bloqueado quando a fonte não responde; valor divergente exige revisão, nunca reenvio automático.
- Provar reload com resposta perdida depois de confirmação: item já confirmado na fonte não é enviado de novo. Fonte sem correspondência também não transforma automaticamente um item em pendente seguro.
- Aceite: 206 itens/21 páginas e 1.001 itens/101 páginas no cenário completo; interrupção no meio, recarga, reconciliação e nova autorização explícita; zero duplicações, zero mistura A→B→A; totais exatos, pausa e corrupção de checkpoint cobertos. Registrar quais testes foram remotos do Claude e quais foram independentes.
- Limite: concluir esse simulador não homologa extensão ou ComprasGOV. A palavra “simulado” permanece visível.

### 2. Em paralelo: contrato verificável da integração IA

Pesquisa oficial fica com um agente; código/contrato com outro após achados. Começar por duas capacidades sem escrita: consultar processo autorizado e listar pendências documentais com fontes. Argumentos do modelo não definem livremente organização ou permissões: identidade e escopos são conferidos no servidor. Anexos são dados não confiáveis, nunca comandos.

Aceite do núcleo isolado: tenant A não lê B, ausência/revogação de escopo bloqueia, documento sem evidência retorna pendência em vez de inventar, referência usa ID/hash controlados, segredo não aparece em resultado/log. Usar adaptadores falsos em testes; nenhum token OAuth/API nem endpoint público nesta fase. Contrato de transporte e conexão real só após documentação oficial e revisão.

### 3. Completar leitura real quando o acesso estiver disponível

Reutilizar `adapter.mjs`, `collector.mjs` e os três arquivos de testes. Inspecionar sem escrita a associação do CNPJ no contexto representado do portal. Guardar fixture sanitizada estrutural, não dados pessoais. Homologação exige observar o marcador real e demonstrar rejeição de órgão/CPF/empresa divergente; não basta o CNPJ esperado digitado.

A falta de acesso bloqueia essa prova, não as frentes 1, 2 e 4. Não criar sucessivas abas nem solicitar repetidamente login na mesma falha. Instalar extensão ou ampliar permissões não decorre automaticamente da pesquisa.

### 4. Motor de cadastro e motor de lances isolados

Implementar cada motor separado, primeiro contra porta/adaptador fictício, sem acoplar a UI do portal. Reutilizar contratos comprovados do componente, sem copiar mocks como produção. Cadastro usa ID estável, valores exatos, plano de diferenças, estado por item e conciliação. Robô usa política determinística versionada, piso/teto conforme critério, expiração/revogação, pausa e exclusividade por CNPJ/compra/item.

Aceite: resposta incerta nunca vira sucesso; nenhuma repetição cega; edição/expiração/contexto invalidam autorização; dois executores não emitem para o mesmo escopo; novas emissões param após pausa; comando já emitido permanece em conciliação. Sem seleção de estratégia ou preço pelo modelo de linguagem. Adaptador de escrita real e testes de treinamento são etapas posteriores com acesso e autorização próprios.

### 5. Fechar a apresentação vendável e a jornada documental

No catálogo canônico, unir landing → ofertas → login/onboarding → Hoje → processo → documentos/proposta → operação, com Empresa e Assessoria. Utilizar marca e temas aprovados. O resumo permanece integralmente aberto, sem “considerações da equipe”. Não fingir funcionamento de telas ausentes.

Reutilizar o kit real e seus testes em vez de reconstruí-lo. Resolver explicitamente a diferença entre os 50 itens do documento e milhares do cadastro operacional antes de prometer suporte integrado. Aceite: documento integral visível antes de aprovar, alteração invalida revisão, formato final renderizado e campos privados ausentes, troca de empresa não reaproveita dados/autorizações.

### 6. Comércio, segurança e destino privado

Preparar regras de planos e transições sem ativar pagamento. Definir franquias a partir de consumo medido; valores atuais continuam hipóteses. Não esperar o checkout para testar direitos por organização com fixtures. Depois: testes end-to-end em destino privado autorizado, recuperação de bytes dos documentos, matriz de papéis, carga/custo, suporte e resposta a incidente. Cloudflare Zero Trust não foi ativado por decisão do usuário; não contornar isso com exposição pública.

Migração e publicação permanecem fora desta fila automática. A preparação comercial só termina com provas de funcionamento e limites explícitos, não com presença de botões.

## Coordenação contínua

Configuração confirmada pela coordenação nesta rodada: objetivo nativo ativo e heartbeat `continuar-desenvolvimento-licitaplena` ativo a cada 30 minutos nesta conversa. A retomada já não depende de um novo comando do usuário, mas depende de o ambiente local estar disponível. Não criar segundo agendamento para o mesmo trabalho nem interferir no monitor PNCP antigo.

Referência consultada pela coordenação: [orquestração de subagentes — soumatheusgomes/vibe-coding-toolkit](https://github.com/soumatheusgomes/vibe-coding-toolkit/blob/main/docs/tools/02-subagent-orchestration.md). Aplicação prática: coordenação, escopos, um escritor por arquivo e revisão. Nenhuma instalação, troca de cliente/modelo, proxy ou ampliação de permissão é necessária ou autorizada por essa referência.

1. Antes de começar, ler `progress.md`, este plano e agentes ativos. Dar propriedade exclusiva de arquivos a cada executor; evitar dois agentes no mesmo componente ou navegador.
2. Manter até três frentes úteis: implementação isolada, pesquisa/contrato e revisão. A coordenação integra e verifica. Um login ausente não encerra trabalho independente.
3. Cada incremento entrega comportamento, testes adequados, revisão independente e evidência; documentação registra o resultado, não substitui implementação. Reexecutar apenas testes afetados e gates exigidos, sem repetir suítes idênticas para preencher tempo.
4. Registrar falha e causa antes de repetir. Não afrouxar guarda para produzir sucesso. Se houver bloqueio externo, deixar dependência explícita e puxar a próxima tarefa liberada.
5. Atualizar o ledger após trabalho útil. Não declarar trabalho contínuo fora de turno sem agente/meta/agendamento realmente ativo. O agendamento da conversa não dispensa ambiente local disponível.
6. Pedir ao usuário apenas decisão indispensável de acesso, custo ou ação consequencial; preparar antes o resultado concreto. Não pedir “posso continuar?” ao fim de cada teste.

## Fontes da auditoria e critério de encerramento

Fontes lidas: `PLANO-PRODUTO-E-COMERCIAL.md`, `DECISAO-DE-ESCOPO.md`, `LACUNAS-PRIME-LICITAPLENA.md`, `ESPECIFICACAO-INTEGRACOES-DS.md`, `VALIDACAO-EXTENSAO-LEITURA.md`, `../jornada-cadastro-20261031/PRONTIDAO.md`, `../homologacao-real-20261031/HOMOLOGACAO.md` e `.superpowers/sdd/2026-11-01-ambiente-isolado/progress.md`. Arquivos locais do kit, identificação, operação e extensão foram inventariados; esta auditoria não reexecutou seu runtime.

Não há base para afirmar “tudo pronto” ou “100% funcionando”. Encerrar a entrega somente quando a matriz não tiver lacunas na oferta prometida, a jornada estiver apresentada e testada de ponta a ponta, os riscos e limites estiverem registrados e os atos externos autorizados tiverem sua própria homologação. Uma restrição vigente de publicação/operação não pode ser silenciosamente removida para satisfazer o objetivo.


## Atualização de implementação — após v54 (01/11/2026)

Esta seção supersede as descrições históricas de ausência de núcleo acima; não supersede as lacunas de homologação real.

- **Cadastro:** pré-validação isolada já existe e foi revisada (35 testes totais da extensão/prevalidação). Ponte `operacao-assistida/proposta-para-lote.mjs` valida o documento/hash do kit real e mapeamento explícito de IDs; oito testes novos, 30 afetados na revisão. Ainda sem endpoint, execução portal ou UI ligada. Motor de cadastro em implementação exclusiva por `plano_execucao_continua` em `motor-cadastro/`.
- **Robô:** `motor-lances/` entregue e revisado, 18 testes; decisões candidatas determinísticas, sem transporte. Exclusividade apenas da instância. Não é robô operacional homologado.
- **IA:** `integracao-ia/` possui ferramentas de leitura com escopos e revalidação, referências estruturais e factory privada de listagem de empresas. 35 testes revisados. Nenhum MCP/OAuth/provedor ou endpoint real. Validação de referências não prova verdade semântica ou jurídica.
- **Design System:** v54 privada corrigiu conciliação no último item e foco perdido. Claude relatou 12/12 último item1001 e 11/11 teclado, rc0; regressão parcial com logs brutos. Evidência antiga274 filtrada não prova exit status individual. Complementação dos logs em curso no mesmo chat, seguida da implementação de `PEDIDO-JORNADA-INTEGRADA-DS.md`.
- **Escala documental:** limite50 real continua; diagnóstico específico atribuído a `pesquisa_ia_prime`, sem remover limite cegamente e sem edição concorrente.
- **Próxima ligação IA:** revisor inspeciona adaptadores e ambiente privado existentes, sem rede/credenciais/publicação, para sair da factory isolada com destino correto e autenticação real.

Migração, produção, pagamentos, aceites de declarações e propostas/lances reais continuam fora da autorização atual. O estado comercial segue incompleto.
