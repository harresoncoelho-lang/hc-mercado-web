# Ponte proposta → extensão: estado revisado e próximo incremento

Atualizado em 02/11/2026. O produtor do vínculo foi implementado localmente e testado; o canal autenticado abaixo ainda é desenho, sem instalação ou ativação.

## O que já está resolvido localmente

- Importação PNCP rastreável: `netlify/functions/importar-item-pncp.js`, `supabase/importacao_item_pncp.sql`, `processos.html`. Não recriar importação nem usar ID PNCP como prova automática de equivalência ao portal.
- `kit-documentos.js` já prepara operação, confere revisão/hash e revalida sessão/documento após I/O. A fonte padrão de evidência portal permanece ausente: 409, `vinculo_portal_indisponivel`, lote nulo.
- `operacao-assistida/proposta-para-lote.mjs` e `preparar-operacao.mjs` já compõem revisão, vínculo, catálogo, mapeamento e pré-validação. Não falta outro motor.
- `collector.mjs` reconhece o CNPJ no cabeçalho observado, com hierarquia estrita, visibilidade e rejeição de ambiguidade/malformação. Não retorna nome ou CPF.
- O título `P.compra` direto em `APP-IDENTIFICACAO-COMPRA`, com os três spans observados, é normalizado. `aria-hidden` do N° não significa ocultação visual; filhos realmente ocultos ou candidato malformado invalidam a coleta. UASG já era compatível.
- hCaptcha visível bloqueia contexto; frame ambíguo deixa incompleto; frame 0×0 é passivo. Não lê internals cross-origin, não resolve desafio. A observação real de página 2 selecionada com cards 1–10 preservados impede tratar seleção do paginador como prova de navegação.
- Cards estão integrados **collector → adapter → popup**, sem módulo solto: até dez IDs, descrições públicas limitadas, quantidade solicitada textual limitada a 64 caracteres e unidade. Grupo e exigências ficam desconhecidos. Adapter só libera lista parcial em contexto confirmado; popup limpa/descarta resultado em edição, erro, CAPTCHA ou mudança durante leitura.
- Revisão independente encerrou os achados dessa etapa. **47/47 testes locais passaram.** São testes Node com DOM/APIs simulados; não instalação/homologação da extensão real.

Não reabrir cabeçalho, título, CAPTCHA, leitura dos cards ou motor como trabalho ainda inexistente. Manifesto continua apenas `activeTab`/`scripting`, sem rede. Nenhum resumo, e-mail ou robô de boletins foi alterado por essa entrega.

## Próxima integração

A comparação manual foi descartada por não integrar o SaaS. O desenho concreto do canal autenticado está abaixo, reutilizando sessão, peça revisada e motor existentes.

## Contratos que ainda faltam para operação completa

1. **Campos/estrutura do portal:** grupos/composição, marca/modelo/fabricante e obrigatoriedade, precisão efetiva, estado de carregamento e prova de conclusão de navegação. A página parcial atual não entrega catálogo completo nem torna desconhecido igual a opcional.
2. **Origem e mapeamento:** vínculo revisado UUID do item interno → ID do portal, por contexto e versão; fonte do catálogo, completude e limites. Captura do browser não é certificação independente.
3. **Canal SaaS ↔ extensão:** transporte autenticado, usuário/carteira/CNPJ, referência proposta/versão/hash, validade, revogação e reconsulta. Não existe hoje e não cabe ativá-lo silenciosamente sob a CSP atual sem rede.
4. **Homologação real:** extensão ainda não instalada/testada no navegador; DOM observado em sessão humana e fixtures são evidências distintas. Sem novas permissões ou instalação autorizada, integração runtime permanece pendente.
5. **Escrita:** autorização explícita futura, prevenção de duplicidade, conciliação de resultado incerto e condições reais do portal. Nenhum incremento de leitura autoriza proposta ou lance.

## Limites da conclusão

Cabeçalho/título/CAPTCHA/cards locais estão corrigidos e revisados; a transferência autenticada da proposta e o catálogo completo permanecem pendentes. Preservar 409/lote nulo quando fonte confiável faltar. Não criar segundo motor, não reconstruir importação PNCP, não tomar paginação selecionada como carga concluída e não alegar capacidade de 1.000 usuários ou prontidão comercial com esses testes.

## Desenho concreto do canal autenticado — substitui comparação manual

**Não implementar a recomendação anterior de JSON/manual no popup.** Ela não integra a proposta real do SaaS. O próximo trabalho de integração deve reutilizar a sessão existente em `kit-documentos-ui.js`, que já envia `Authorization: Bearer` para `/api/kit-documentos`, e a revisão/escopo conferidos no handler. Nenhum token Supabase será entregue ao portal ou à extensão.

### Transporte proposto para revisão técnica

Usar uma porta Chrome de mensagens externas, iniciada pela página autenticada do LicitaPlena (`chrome.runtime.connect` com ID fixo da extensão), limitada a uma origem HTTPS de homologação previamente escolhida. A página continua sendo o único cliente autenticado do backend. A extensão conversa apenas com a página permitida e faz leitura do portal; não precisa de rede própria, `host_permissions` globais ou acesso a cookies.

Isso exige mudança futura explícita no manifesto (`externally_connectable.matches` com origem exata) e um receptor de mensagens com ciclo de vida definido. Proposta: service worker pequeno para receber/validar a porta e coordenar o popup existente; não executa leitura automática nem ganha permissão permanente. `activeTab` do SaaS não autoriza o portal: o usuário precisa acionar a extensão na aba Compras.gov.br e fazer a leitura manual já existente. Se o worker reiniciar ou a porta fechar, a associação pendente é descartada; não usar fila persistente sem contrato separado.

**Ainda é desenho, não ferramenta ativada.** Instalação/ID estável da extensão, origem HTTPS privada autorizada e API Chrome precisam de homologação posterior. Não alterar manifesto ou iniciar worker nesta rodada.

### Percurso integrado e contratos

1. Na peça revisada da interface existente, ação “Conectar à extensão” solicita ao backend uma sessão de ponte. Body contém somente seletores `empresaId`, `processoId`, `documentoId`, `versaoEsperada`; a sessão do usuário e os papéis/escopos são obtidos pelo backend. Reusar os controles atuais de `carregarEscopo`, abertura/versionamento e revisão, não confiar em CNPJ/hash enviados pelo cliente.
2. Backend cria registro curto de sessão de ponte, vinculado a usuário, organização, empresa, processo, documento, versão e hash de revisão atuais. Retorna identificador aleatório e desafio de uso único, com expiração curta proposta de cinco minutos. O desafio não é bearer de acesso ao documento: todas as requisições seguintes ainda exigem a mesma sessão autenticada e escopo. Guardar hash do desafio, não seu valor bruto; nunca colocar em URL, log ou DOM do portal.
3. Página abre porta para o ID fixo da extensão e transmite envelope versionado `iniciarLeitura`: sessão de ponte, desafio, contexto esperado gerado pelo backend e finalidade `somente-leitura`. Não transmitir token de login, conteúdo integral do documento, preços ou autorização de envio nesta fase. A extensão valida origem/caminho do remetente, tamanho/esquema/versão, unicidade da solicitação e expiração. Outra página/contexto não pode reaproveitar a porta.
4. Usuário abre o popup na aba do portal. O popup mostra empresa/pregão esperados para conferência e usa a leitura existente. Retorna pela porta `resultadoLeitura` com sessão/desafio, contexto observado e página parcial, ou erro explícito de CAPTCHA/mudança/ausência. O resultado continua `writeAuthorized:false`. Não inventar catálogo completo, grupo ou exigências.
5. Página envia esse envelope a endpoint autenticado de receber observação. Backend revalida usuário, associação, papéis, versão/hash e prazo; consome desafio uma única vez com operação atômica. Repetição idêntica tem resultado idempotente; payload diferente após consumo é conflito. CAPTCHA/erro/incompleto encerra ou invalida a tentativa, sem promover observação válida anterior.
6. Servidor armazena resultado como **observação do cliente**, com origem, data, contexto e escopo. Isso NÃO produz automaticamente `evidencia.vigente=true`. A validação de catálogo completo, exigências e mapeamento continua separada. A etapa existente `prepararOperacao` só deixa 409 quando seu produtor confiável realmente satisfizer esses requisitos e revalidar tudo após I/O.
7. Com requisitos completos futuramente, o fluxo continua no botão/handler/motor já existentes; não criar segundo motor. Alteração de revisão, CNPJ, pregão, permissões ou expiração revoga a sessão de ponte. Fechar a porta descarta estado local; logout precisa revogação explícita da tentativa e backend sempre revalida autenticação. Receber dados não autoriza proposta, lance ou aceite de declarações.

### Fronteira de confiança indispensável

Mensagens externas restritas protegem o percurso contra sites não permitidos, mas o backend não consegue provar, apenas pelo JSON autenticado, que o DOM veio de uma extensão íntegra. O usuário/página podem adulterar esse relato. Uma assinatura ou segredo embarcado na extensão não resolve isso. Portanto, registrar a captura como observação autenticada do usuário, sem chamá-la de certificação independente do portal. Para promover a evidência operacional é necessário um contrato explícito de validação/reconciliação e fonte/completude do catálogo; não transformar a nova tabela em atalho para o gate existente.

### Arquivos previstos — ainda sem implementação

- `kit-documentos-ui.js`: ação de conexão, porta, estados de tentativa e encaminhamento autenticado; reutilizar `enviar`/sessão atual e peça aberta. Não mudar resumo/e-mail/boletim.
- Novo endpoint `netlify/functions/ponte-extensao.js`: emitir/receber/revogar tentativa, usando `_auth` e controles de escopo/revisão existentes. Antes de extrair helper de `kit-documentos.js`, adicionar prova de paridade para não reduzir autorização.
- Migração nova `supabase/ponte_extensao.sql`: sessões e observações isoladas, RLS sem acesso entre organizações/empresas; consumo/revogação atômicos, retenção curta, sem gravar bearer. Não aplicar migração nesta rodada.
- `extensao-leitura/manifest.json`: somente allowlist externa exata e receptor futuro. Manter rede bloqueada e permissões mínimas; nenhum content script global.
- Receptor pequeno da porta + integração ao `popup.mjs` existente. Collector/adapter atuais continuam como fonte local; não criar outro coletor.
- Composição futura de `carregarEvidenciaPortal` em `kit-documentos.js`: permanece nula enquanto observação parcial não puder satisfazer catálogo/mapeamento/completude. Não conectar tabela bruta diretamente ao motor.

### O que pode ser implementado/testado localmente antes de ativar

Contratos de envelope e testes do endpoint/porta com mocks integrados aos callers acima; migração revisável, sem aplicação; testes de escopo e concorrência do consumo; expiração, replay, origem errada, outra extensão, usuário/CNPJ/pregão trocado, versão alterada durante I/O, porta encerrada, worker reiniciado, CAPTCHA com itens antigos, saída parcial nunca promovida a catálogo. Regressões do handler de kit existente devem continuar passando. Não limitar entrega a helpers sem caller.

### Dependências de homologação e autorização posterior

- Escolher origem privada estável e ID/instalação da extensão de teste; revisar `externally_connectable` e ciclo de vida das APIs na documentação oficial atual antes de código.
- Validar runtime real SaaS↔extensão no navegador, sessão autenticada, reinício/fechamento de porta e reentrada do usuário. Mocks não comprovam esse canal.
- Confirmar isolamento/banco e migração em ambiente de teste autorizado; não reiniciar servidor QA nem gerar custo silenciosamente.
- Completar contratos DOM de grupo/exigências/loading e reconciliação de catálogo/mapeamento. A página atual cobre apenas parte desse insumo.
- Aprovação técnica de protocolo/segurança não é publicação, instalação, autorização comercial ou autorização de envio ao portal. Essas etapas permanecem posteriores e separadas.

**Entrega desta rodada: desenho para revisão, nenhum canal ativado.** A ponte autenticada transportará observação do usuário de forma vinculada à peça real; prontidão para cadastro só existe depois dos gates de dados e homologação, não pelo transporte isolado.

### Documentação oficial consultada na revisão (02/11)
Context7, biblioteca /websites/developer_chrome_extensions, confirmou:
- https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable: matches permite páginas específicas; omitir ids impede conexões de outras extensões. Não adicionar wildcard de extensões.
- https://developer.chrome.com/docs/extensions/reference/api/runtime: onConnectExternal recebe a porta de página permitida.
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle: desde Chrome114, abrir uma porta não reinicia os timers do worker; mensagens podem mantê-lo ativo. Desenho deve suportar perda da memória/porta sem falso estado conectado e sem heartbeat criado para contornar ciclo de vida.
Estas fontes confirmam viabilidade do transporte, não autenticação independente do DOM nem homologação deste projeto. Revisão contra callers existentes em andamento; não houve mudança de manifesto.

## Revisão obrigatória do desenho — quatro bloqueadores corrigidos

Esta seção especifica e restringe o percurso acima; não autoriza implementação/ativação.

### 1. Fonte do contexto esperado: bloqueio real antes do endpoint de ponte

`carregarEscopo` atual carrega número/órgão do processo; não fornece UASG, ano e identificador de compra de 17 dígitos. Logo **não existe hoje produtor do contexto esperado descrito no passo 2**. Não implementar endpoint que prometa sessão de ponte utilizável com esses dados ausentes.

Dependência concreta: cadastro de **vínculo revisado processo ↔ compra do portal**, dentro do fluxo do processo existente. Registro precisa conter organização/empresa/processo, CNPJ derivado da empresa autorizada, UASG, número, ano, compra17, URL exata suportada, origem da referência, evidência pública consultada, responsável pela conferência, momento, versão e estado revogado. A fonte inicial é a referência pública da compra no próprio Compras.gov.br conferida por operador autorizado; número do PNCP isoladamente não preenche esse vínculo. A concordância URL↔UASG/número/ano precisa de evidência consultada e revisão, não de decomposição numérica presumida.

Seletores/observação da extensão podem auxiliar a conferência, mas não são automaticamente fonte independente. A gravação do vínculo exige fluxo explícito de revisão por usuário com permissão no processo e controle de versão; a origem deve ser classificada como revisão humana baseada em referência pública, sem falsa certificação do backend. Falta ainda decidir e implementar esse fluxo produtor no processo e sua persistência com RLS. Antes disso, emissão da sessão responde **409 `vinculo_processo_portal_indisponivel`**; não aceita contexto arbitrário no payload para contornar ausência.

Ordem de execução corrigida: (a) contrato e produtor do vínculo revisado; (b) testes/persistência do vínculo por processo e versão; (c) somente então canal/endpoint de ponte. Catálogo/mapeamento continuam requisitos adicionais para preparar operação, distintos do vínculo da compra.

### 2. Rota e caller reais

`enviar()` de `kit-documentos-ui.js` fixa `/api/kit-documentos`; não existe roteamento genérico atual. A futura integração deve adicionar um caller restrito para `/api/ponte-extensao`, preservando o mesmo ciclo `obterSessao`, verificação de geração/usuário antes e depois do I/O e tratamento de erro. Alternativa de extração deve aceitar apenas essas duas rotas constantes internas, nunca URL recebida de mensagem/payload. Não modificar o comportamento dos callers atuais.

`functions/api/[nome].js` importa handlers estaticamente e usa `ROTAS` explícito. Incluir futuramente import estático e chave `ponte-extensao`, além do endpoint Netlify proposto. Testar a rota Cloudflare até o handler com autenticação e bloqueios, e 404 para nomes fora da allowlist; mock do endpoint sozinho não prova integração. Não mudar outras rotas, bindings, autenticação ou deploy.

### 3. Associação única porta ↔ popup ↔ aba/documento/geração

Adotar **uma única tentativa ativa por instância da extensão** nesta primeira integração. Ao existir tentativa ativa, rejeitar nova associação; cancelamento explícito invalida a anterior antes de aceitar outra. Não escolher “a última porta” silenciosamente.

Estado em memória associa: ID da tentativa, desafio, origem/caminho e porta remetente, aba/documento SaaS quando disponíveis e verificados pelo `MessageSender`, geração da interface, usuário/escopo/peça/versão/hash esperados e expiração. Popup seleciona essa tentativa única de forma explícita, mostra CNPJ/pregão/documento e, após ação manual na aba do portal, vincula o `tabId`, frame principal, URL e identificador de documento de execução quando disponível. Ausência de identificação suficiente do remetente/runtime exige bloqueio, não fallback permissivo.

O resultado só pode voltar para a mesma porta/tentativa/geração e contexto associados. Comparar antes/depois da leitura como já faz o popup. Mudança de documento/aba, contexto, edição da peça ou troca de geração cancela tentativa e exige nova associação. Fechamento da porta, recarga da página, reinício do worker ou cancelamento descartam o estado; **sem restore, persistência ou reuso automático**. Nova aba do SaaS não herda tentativa. Repetir leitura exige tentativa/desafio novos após consumo. Testes precisam exercitar duas abas SaaS, duas portas, recarga, atraso de resposta e A→B→A.

### 4. Consumo e gravação: reautenticação + transação CAS

Não basta validar versão/hash em uma leitura e depois consumir o desafio em outra operação. O endpoint de recebimento reautentica imediatamente antes da gravação e verifica identidade invariável; em seguida invoca uma única transação de banco que:

- bloqueia a tentativa e os registros relevantes, verifica prazo/estado/hash do desafio e usuário vinculado;
- verifica membership/papel/escopo atuais, documento vigente, versão e hash de revisão, vínculo da compra e sua versão/estado;
- aplica compare-and-swap de tentativa pendente para consumida e insere a observação na mesma transação;
- falha integralmente em concorrência, revogação, nova versão/hash ou escopo alterado; nenhuma observação órfã ou consumo sem gravação;
- guarda hash canônico do envelope para idempotência: repetição idêntica pode recuperar recibo somente após nova autenticação e escopo atual; conteúdo diferente retorna conflito.

As alterações concorrentes de membership, peça e vínculo precisam participar da mesma estratégia de bloqueio/isolamento da transação; uma simples query `exists` sem proteção de concorrência não satisfaz o contrato. Função SQL deve ter permissões estreitas, `search_path` fixo se precisar de SECURITY DEFINER e RLS/escopo explicitamente verificados. Não confiar em userId fornecido pelo browser. Projetar a identidade de chamada a partir da sessão autenticada existente, sem expor chave privilegiada. Documentar a janela inevitável entre provedor externo de autenticação e commit; o banco garante atomicidade dos estados locais, não uma transação distribuída com Supabase Auth. Revogação/logout não pode ser descrita como instantânea além desse contrato.

Testes de concorrência obrigatórios: revisão alterada enquanto recebimento aguarda; membership revogada; vínculo trocado; dois consumos simultâneos; expiração; rollback de inserção; replay após revogação. Todo caso deve conservar 409/lote nulo quando evidência operacional continuar insuficiente.

## Gate para começar implementação do canal

**Gate local do produtor cumprido:** dossiê existente → handler → rota → RPC de vínculo revisado implementados. Root executou 7/7 testes incluindo migração real em PGlite sobre sete migrações operacionais preservadas, isolamento entre empresas/organizações, cliente revogado, CAS serial, invalidação e histórico. A base remota e concorrência multissessão não foram homologadas. O canal não está ativado: instalação, origem privada, ID e permissões continuam gates externos. Vínculo humano não certifica o portal.

### Próxima fatia em revisão: reutilizar o handler do kit

Para evitar duplicar autenticação, escopo e cálculo da revisão, a proposta atual é acrescentar ações estritas `iniciarLeitura`, `registrarLeitura`, `cancelarLeitura` ao `/api/kit-documentos` e reutilizar `enviar()` na UI. Isso substitui a proposta de endpoint separado somente após revisão técnica. Gate próprio fechado por padrão; nenhuma ação nova pode cair no ramo final de exportação. Cancelamento precisa funcionar após alteração da revisão, limitado ao usuário/tentativa autorizados. Consulta da RPC de vínculo fornece contexto esperado, nunca o corpo enviado pelo navegador.

Receptor da extensão será testado como factory junto ao popup/coletor existentes, sem registrar worker nem ampliar manifesto nesta etapa. SQL de tentativa/observação e teste composto devem comprovar consumo atômico, contexto, prazo, replay e invalidação. A observação parcial permanece distinta da evidência operacional; `prepararOperacao` conserva 409/lote nulo sem catálogo e mapeamento confiáveis.

## Produtor implementável: aproveitar cadastro de processo existente

A fatia inicial não é um segundo cadastro. `processos.html` já contém campos `sistema`, `uasg`, `numero` e `url_origem` no formulário (aproximadamente linha 36), exibe esses dados (~198) e carrega/grava o processo (~228/235). `supabase/operacao_acompanhamento.sql` já possui UASG. Reaproveitar esses campos como rascunho; seu preenchimento atual, livre, não equivale a vínculo revisado.

### Fluxo concreto no mesmo processo

1. Manter formulário/salvamento atual. Ao selecionar sistema Compras.gov.br e salvar, apresentar seção “Conferir vínculo com a compra” na mesma tela, usando UASG/número/URL existentes como referência editável do processo, sem copiar para outro cadastro.
2. Acrescentar dados que realmente faltam: `numero_pregao` normalizado, `ano_pregao`, `compra_portal_id` (string17) e referência pública consultada. Número livre do processo não deve ser reescrito silenciosamente. Extrair o parâmetro `compra` apenas da URL exata suportada pode preencher rascunho, mas não comprova que UASG/número/ano correspondem; exige conferência explícita da referência pública pelo operador.
3. Antes de confirmar, mostrar CNPJ derivado da empresa autorizada, compra/URL, UASG, número/ano e aviso “Vínculo conferido pelo responsável a partir da referência informada; não certificação do portal”. Usuário compara a referência consultada e confirma. Não transformar checkbox sozinho em leitura automática do portal.
4. Ação dedicada no caller existente envia seletores do processo, versão esperada e dados para revisão ao endpoint de vínculo, com sessão existente. Backend deriva empresa/organização/revisor da sessão/escopo, valida formatos/URL e grava transacionalmente. Não aceitar revisor/CNPJ/estado/vigência enviados pelo cliente.
5. Alterar `sistema`, `uasg`, `numero`, `url_origem`, empresa ou dados específicos da compra invalida revisão na mesma operação de persistência, inclusive atualizações fora da UI (trigger/regra no banco). Uma confirmação concorrente usa compare-and-swap contra a versão atual do processo; falha se rascunho mudou.

### Persistência mínima proposta

Tabela de revisão vinculada ao processo, não duplicação de seus campos livres: `processo_id`, `organizacao_id`, `empresa_id`, `versao_vinculo`, `sistema_portal`, `uasg_revisada`, `numero_pregao`, `ano_pregao`, `compra_portal_id`, `url_portal_revisada`, `fonte_tipo` (inicialmente `revisao_humana_referencia_publica`), `fonte_url`, `referencia_consultada_em`, `revisado_por`, `revisado_em`, `processo_versao_ou_hash`, `invalidado_em`, `motivo_invalidacao`. Hash canônico dos campos pertinentes pode vincular revisão ao processo se não houver versão adequada; não confundir esse hash com assinatura da fonte. Não persistir tokens, HTML privado ou CPF.

Unicidade da revisão vigente por processo/contexto, histórico de alterações e RLS por organização/empresa. Datas/revisor de confirmação são do servidor. `referencia_consultada_em` é informação declarada pelo usuário se a consulta não foi feita pelo sistema; deve permanecer classificada assim, não carimbo de consulta automática.

### Callers e arquivos a incluir na primeira fatia

- `processos.html`: seção de conferência no formulário existente, leitura do estado revisado e invalidação visual após edição; reaproveitar rotina de sessão e tratamento de erro atuais.
- Handler restrito `netlify/functions/vinculo-compra-portal.js`, mais import estático/allowlist em `functions/api/[nome].js`: consultar/confirmar/invalidate quando aplicável, com autorização de processo e CAS. Reusar helpers reais de escopo; não presumir permissões pelo HTML.
- Migração aditiva em `supabase/vinculo_compra_portal.sql`: revisão, RLS e invalidação atômica por mudança relevante no processo. Revisar compatibilidade com o salvamento existente antes de aplicar em teste.
- Testes integrados caller→rota→handler com banco isolado/mocks apropriados: rascunho não revisado retorna pendência; revisão A aceita; alteração/CNPJ divergente/usuário sem acesso/versão concorrente invalidam; URL de outro host não confirma; dados PNCP não geram vínculo automaticamente.

Depois dessa fatia, o emissor de ponte consulta a revisão vigente e deriva seu contexto esperado. A sessão de ponte transporta finalidade somente leitura; o fato de existir vínculo revisado humano ainda não resolve catálogo/mapeamento nem transforma observação em certificação independente. Assim o produtor pode ser implementado de forma útil no percurso real antes de ativar o canal, sem duplicar cadastro e sem parar no diagnóstico.
