# Núcleo de leitura autorizado para IA

Implementação isolada, sem SDK, servidor, provedor de IA, rede, credenciais, instalação ou dependências. Não é conector MCP/OAuth pronto e não está ligado ao produto. Reaproveita o padrão de filtros e verificação de organização/empresa/processo observado em `netlify/functions/kit-documentos.js`, sem importar nem modificar seus handlers.

## Fronteiras

`executeRead(contextoConfiavel, nomeFerramenta, argumentosModelo, repositorio)` exige contexto separado dos argumentos. Somente código confiável pode construir o primeiro parâmetro, após autenticação, validade/revogação e carregamento atual das permissões. `ativo: true` em JSON não comprova identidade. Não expor a função diretamente como endpoint aceitando esse objeto do cliente.

Contexto: `usuarioId`, `organizacaoId`, `ativo`, `empresas: [{empresaId, cnpj}]`, `scopes`. IDs admitem letras/números/hífen/underscore até 100 caracteres. CNPJ neste recorte é identificador numérico normalizado de 14 dígitos, **não valida cadastro/DV nem CNPJ alfanumérico**. A carteira confiável é a fonte do vínculo. Scope genérico `*` não substitui os específicos.

Ferramentas fechadas:

| Nome | Scope | Argumentos além de limit/offset opcionais |
| --- | --- | --- |
| listar_empresas_autorizadas | empresas:read | Nenhum |
| buscar_oportunidades | oportunidades:read | empresaId, cnpj; consulta opcional |
| obter_itens | itens:read | empresaId, cnpj, processoId |
| consultar_esteira | esteira:read | empresaId, cnpj |
| consultar_evidencia_documental | documentos:read | empresaId, cnpj, processoId, documentoId; consulta opcional |

Parâmetros extras são rejeitados, não ignorados. Scope e carteira são conferidos antes de chamar o repositório. Sem ferramentas de escrita, chamadas automáticas adicionais ou avaliação de instruções em documentos. Documento retornado continua sendo conteúdo não confiável para o cliente de IA; a proteção contra prompt injection do sistema completo ainda precisa ser homologada.

## Contrato do repositório

Um único método `read(request)` recebe objeto copiado/congelado:

```js
{
  tool: 'obter_itens',
  scope: {
    usuarioId: 'user-a', organizacaoId: 'org-a',
    empresas: [{ empresaId: 'empresa-a', cnpj: '11222333000181' }]
  },
  query: { limit: 20, offset: 0, processoId: 'proc-a' }
}
```

O adaptador futuro deve aplicar TODOS os filtros no banco, manter RLS e verificar acesso ao processo/documento. Ele não pode substituir essa consulta por leitura ampla seguida apenas de filtro em memória. O núcleo exige novamente o escopo de cada linha, rejeitando a resposta inteira se houver divergência. Esta segunda verificação não substitui autorização/RLS do repositório. Contexto é conferido no início de cada chamada e após o await do repositório: inatividade, scope removido ou mudança de usuário/organização/carteira impede a devolução. Isso detecta alterações no objeto confiável local, **não consulta revogação remota**. Atualização desse objeto, expiração, remoção remota de acesso e prevenção de alterações transitórias/revertidas ainda dependem do adaptador real; contexto congelado antigo não se atualiza sozinho.

Resposta: `{records: [...], hasMore: boolean}`. Cada linha contém `organizacaoId`, `empresaId`, `cnpj`, `id` e os campos abaixo. Itens/documentos exigem `processoId` igual ao consultado; evidência exige também `documentoId` igual. Na lista de empresas, `id` deve ser a própria `empresaId`.

- Empresas: id, nome.
- Oportunidades: id, titulo, fonte, versao.
- Itens: id, descricao, quantidade, unidade, fonte, versao.
- Esteira: id, titulo, etapa, fonte, versao.
- Evidência: id, trecho, pagina, fonte, versao.

Somente esses campos são devolvidos. Todos são obrigatórios; `pagina` é inteiro positivo e demais campos strings não vazias de até 4.000 caracteres. Fonte é HTTPS sem credenciais, query ou fragmento; o adaptador deve produzir link de referência seguro, não URL assinada de download. `limit` é inteiro entre 1 e 50, padrão 20; `offset` é inteiro entre 0 e 1.000.000, padrão zero. `consulta` tem no máximo 500 caracteres. A resposta não pode ultrapassar o limite solicitado.

O resultado público adiciona `nextOffset`: offset atual + número de linhas devolvidas quando `hasMore=true`, senão null. Solicitar a próxima página exige nova chamada com o mesmo contexto/filtros e esse offset; toda autorização é refeita. Página vazia com `hasMore=true` é inválida para evitar ciclos sem avanço. Se o próximo offset ultrapassar 1.000.000, ocorre `limite_paginacao`, nunca falso término. Esse é um limite explícito do contrato do protótipo, não capacidade comercial demonstrada. O repositório deve ordenar deterministicamente por chave estável e aplicar offset/limit depois dos filtros de escopo. Em fonte mutável, offset pode ter deslocamento/duplicação; não há snapshot transacional, certificado de completude ou deduplicação entre páginas. O adaptador de produção deverá definir snapshot/cursor consistente antes de alegar cobertura integral.

Allowlist remove propriedades arbitrárias como token/senha, mas **não é DLP de texto livre**. Títulos, trechos e demais campos selecionados devem vir de documentos já autorizados e minimizados pelo adaptador. Nunca incluir credenciais nesses campos. Não há logging de dados, armazenamento, cache, assinatura ou transmissão nesta pasta. O callback `read` é fornecido por código confiável; os testes usam apenas memória.

Erros públicos têm código e mensagem genéricos: `acesso_negado`, `entrada_invalida`, `ferramenta_indisponivel`, `resposta_invalida`, `consulta_indisponivel`, `limite_paginacao`. Falha do repositório não propaga mensagem interna/SQL/token. A integração HTTP deverá mapear códigos e registrar incidentes de forma redigida, sem alterar este contrato para expor exceções.

## Verificação executada

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node --test integracao-ia/core.test.mjs
node --check integracao-ia/core.mjs
```

16 testes aprovados em 01/11/2026, com fixtures fictícias. Primeiro houve RED por módulo ausente; caso adicional de resposta sem evidência falhou por ausência de rejeição e foi corrigido. Ampliação posterior reproduziu RED para revogação durante await e paginação ausente antes da correção. Casos cobrem duas organizações, carteira/CNPJ, scope, tentativa de sobrescrever identidade, nomes de escrita/herdados, filtro obrigatório, processo/documento divergentes, saída mínima, link com token, limite/parcialidade, 73 registros em duas páginas, revogação local durante consulta e erro redigido. Não comprovam OAuth, revogação remota, identidade real, cliente ChatGPT/Claude, segurança integral, precisão jurídica ou capacidade de 1.000 usuários.

Próximo passo: revisão independente deste núcleo; adaptador de dados de homologação com ordenação/snapshot; autenticação/revogação reais; transporte MCP e testes privados em cada assistente. Sem publicar, ativar billing ou alterar resumo, e-mail e robô de boletins.

## Especialização por evidências — versão 1.0.0

`INSTRUCOES-LICITACOES-v1.md` contém instruções de domínio versionadas para separar exigência/recomendação, citar fontes, abster-se e tratar texto de documentos como dado. Isso é contrato de comportamento **não testado em modelo**, não fine-tuning ou prova de compreensão jurídica.

`validateGroundedAnswer(contextoConfiavel, consulta, respostaCandidata, repositorio)` em `grounded-answer.mjs` reutiliza `executeRead` com `consultar_evidencia_documental`. A consulta recebe somente empresaId, cnpj, processoId, documentoId e consulta opcional; identidade/permissões continuam separadas e não vêm da resposta do modelo. A resposta candidata é copiada antes da leitura. Nenhuma inferência ou requisição externa é feita.

O repositório confiável fornece, além de records/hasMore, um metadado `documentState`:

```js
{
  organizacaoId: 'org-a', empresaId: 'empresa-a', cnpj: '11222333000181',
  processoId: 'proc-a', documentoId: 'doc-a', versao: '2', situacao: 'vigente'
}
```

Esse estado deve ser calculado pelo adaptador de dados a partir de versões/retificações verificadas, nunca aceito dos argumentos do modelo. Ausência, escopo divergente, documento superado ou conflito impedem conclusão. Não inferimos vigência procurando a palavra “retificação” no texto. O contrato opera sobre um único documento lógico; a relação com anexos e retificações deve ser consolidada pelo adaptador. **Metadado fornecido não é certificado criptográfico ou constatação independente de vigência.**

O validador recupera no máximo 50 trechos da consulta com autorização do núcleo. Se `hasMore=true`, abstém-se; não afirma ter conferido o documento completo nem ignora trechos restantes. IDs duplicados, versões discordantes ou evidência ausente também retornam `insuficiente`. A implementação não percorre páginas automaticamente nessa camada: o adaptador de recuperação deve fornecer conjunto suficiente/versionado, ou um próximo incremento deverá agregar páginas de forma consistente.

Referências candidatas precisam corresponder exatamente a ID/página/fonte/versão recuperados. O resultado `validada_estruturalmente` preserva a classificação exigência/recomendação e declara `veracidadeVerificada: false`. **Não verifica se a afirmação decorre do trecho, se a classificação está correta, se o texto é juridicamente correto, se o PDF é autêntico ou se um modelo resiste a prompt injection.** O ensaio malicioso demonstra apenas que este código puro não executa instruções do texto; ele inclusive pode aprovar estruturalmente uma afirmação sem suporte semântico. A aplicação deve exibir fonte e manter revisão, sem rotular esse status como resposta correta ou documento aprovado.

Resposta do modelo malformada ou referência inventada retorna `bloqueada`; insuficiência explícita exige zero afirmações. Erros de autorização/repositório preservam os códigos do núcleo e não são convertidos em resposta útil. Metadado documental e valores de contexto adicionais na resposta do modelo são rejeitados.

Verificação adicional: `node --test integracao-ia/core.test.mjs integracao-ia/grounded-answer.test.mjs` — **25/25 aprovados** (16 núcleo + 9 resposta fundamentada). `node --check integracao-ia/grounded-answer.mjs` aprovado. Fixtures são exclusivamente fictícias em `grounded.fixtures.mjs`. Testes cobrem referência inventada, página/fonte/versão erradas, empresa/processo, ausência/parcialidade, situação documental/retificação conflitante e abstenção. Nenhum cliente ChatGPT/Claude, provider, autenticação real ou chamada de IA foi ligado.

## Ponte privada de leitura — factory não publicada

`private-handler.mjs` exporta `createPrivateReadHandler({config, verifySession, readRows})`. Recebe `Request`, devolve `Response` e aceita apenas POST JSON com `ferramenta: "listar_empresas_autorizadas"`, `organizacaoId` e seletores opcionais `empresaId` + `cnpj`, `limit` e `offset`. Organização solicitada é uma seleção, não autoridade: o vínculo do usuário verificado é consultado e conferido. Nenhum endpoint foi registrado no roteador ou publicado.

Configuração confiável exige `enabled: true`, `authProjectUrl` igual a `dataProjectUrl` e ambas em `allowedProjectUrls`. Não existem defaults de produção. As dependências são injetadas pelo host:

- `verifySession({projectUrl, authorization})` precisa verificar de verdade o Bearer no projeto configurado e devolver `{id}` somente para sessão válida. O handler não verifica assinatura JWT sozinho.
- `readRows({projectUrl, authorization, method: "GET", resource, query})` precisa fazer leitura sob o JWT do usuário, com chave pública e RLS habilitada; nunca service role. Não há implementação de rede aqui. `query` é a string URLSearchParams com filtros explícitos de usuário/organização/atividade e empresa quando selecionada.

O formato usa `clientes.id/status`, `operacao_membros.usuario_id/organizacao_id/empresa_id/papel` e `operacao_empresas.id/organizacao_id/razao_social/cnpj/ativo` observados no repositório. A tabela de membros observada não tem `ativo`: remoção do vínculo significa revogação. Papéis gestor, operador e leitura podem apenas listar. Resultados que violam filtros são recusados antes da projeção pelo núcleo existente. A carteira aceita até 1.000 empresas, carregada com limite 1.001 para detectar excesso; a paginação da resposta ocorre sobre essa carteira validada. Acima disso fica indisponível, sem truncar silenciosamente.

Sessão, aprovação, vínculo e carteira são consultados novamente antes da resposta, que falha se mudarem. Isso depende de adaptadores sem cache obsoleto; não fornece transação atômica ou revogação instantânea após a última consulta. A factory não registra logs; tokens/headers/erros internos não são refletidos. O host continua responsável por não registrar credenciais. Nome empresarial vem de dados autorizados, portanto não é garantia genérica de ausência de conteúdo sensível.

Ferramentas documentais permanecem indisponíveis nessa ponte: não há fonte real versionada implantada e não se reutiliza o resumo como se fosse evidência privada. Os testes usam Requests reais em memória e adaptadores fictícios; não comprovam autenticação ou RLS do ambiente remoto, OAuth/MCP ou integração com Claude/ChatGPT.

## Transporte privado configurável (não ativado)

`private-transport.mjs` fornece `createPrivateTransport({config, fetchImpl, timeoutMs?, maxResponseBytes?})`. Uso pelo host confiável:

```js
const transport = createPrivateTransport({ config, fetchImpl: fetch });
const handler = createPrivateReadHandler({ config, ...transport });
```

O exemplo não registra rota nem executa requisições. `config` deve vir da configuração confiável: `authProjectUrl`, `dataProjectUrl`, `allowedProjectUrls`, `publicKey`, `enabled`. Nenhuma variável de ambiente, credencial ou destino de produção foi acessado. Só conectar `fetch` real em homologação explicitamente configurada e revisar a allowlist.

O transporte aceita chave `sb_publishable_…` ou JWT legado cujo payload declare role `anon`; recusa `sb_secret_…` e service_role. A classificação local de JWT **não verifica assinatura nem legitimidade da chave**. O Bearer separado precisa declarar role `authenticated`, e a verificação real da sessão é feita por GET `/auth/v1/user` no projeto confiável. Essa política deliberadamente não suporta outras roles customizadas. Leitura REST usa o mesmo Bearer e chave pública; RLS precisa existir e estar correta no banco, não é criada por este código.

Há somente GET para auth e três recursos REST fechados: clientes, operacao_membros e operacao_empresas. Consultas têm projeções, filtros UUID, atividade, ordem e limites compatíveis com a factory; duplicatas de parâmetros, joins, offset, endpoints e métodos arbitrários são recusados. Não há cache ou redirecionamento permitido. Timeout padrão 10 segundos (máximo configurável 30) cobre headers e body; body padrão 2 MB (máximo configurável 4 MB). Erros são genéricos e não há logs. Fetch injetado deve respeitar AbortSignal; Promise.race limita a espera do chamador mesmo quando um mock ignora abort, mas não pode encerrar trabalho interno de uma implementação defeituosa.

REST exige `Prefer: count=exact`, confirmação `Preference-Applied: count=exact`, `Content-Range` numérico coerente e quantidade recebida igual ao mínimo entre total e limite solicitado. Ausência de contagem, respostas parciais silenciosas ou cap do servidor abaixo da faixa necessária falham fechadas. Não retoma páginas automaticamente: a carteira acima de 1.000 continua indisponível pelo handler. Contagem exata tem custo no banco e não é snapshot entre requisições; nenhum benchmark remoto foi realizado.

Fontes públicas consultadas via Context7: [chaves Supabase](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/getting-started/api-keys.mdx), [headers](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/functions/auth-headers.mdx), [PostgREST paginação e contagem](https://github.com/postgrest/postgrest/blob/main/docs/references/api/pagination_count.rst), [limite de linhas](https://github.com/postgrest/postgrest/blob/main/docs/references/configuration.rst). Testes usam somente fetch fake e Requests/Responses em memória, inclusive ligação completa com a factory. Nenhum teste remoto ou custo foi gerado.
