# Ponte do núcleo de IA para o backend existente

01/11/2026 — inspeção somente de arquivos locais. Nenhum endpoint executado, banco consultado, segredo lido, migração feita ou código alterado nesta análise. O schema descrito é o schema versionado no repositório; não comprova aplicação em produção.

## Incremento recomendado

Preparar um handler privado **somente de leitura**, ainda fora da allowlist de rotas e sem publicação, começando por `listar_empresas_autorizadas`. É a ferramenta cujo retorno cabe integralmente nos dados reais existentes sem inventar fontes, unidades ou versões documentais. O handler deve usar `executeRead` depois de construir contexto por sessão validada e vínculos do banco. Não expor `contextoConfiavel`, scopes ou `ativo` no corpo recebido.

Não iniciar chamando `kit-documentos` por HTTP: ele mistura leitura/escrita, possui gates próprios e carrega/extrai mais dados que o necessário. Não adicionar ferramenta de leitura na função `ia-edital`, no resumo ou no robô. Não habilitar OAuth fictício para dizer que ChatGPT/Claude já estão conectados.

## Reúso comprovado

| Arquivo | O que existe e pode orientar a ponte | Restrição |
| --- | --- | --- |
| `netlify/functions/_auth.js` | `exigirUsuarioLogado(event)` valida sessão via `/auth/v1/user`; retorna userId; `cabecalhosPadrao` mantém formato/CORS | URL/chave pública de projeto são fixas no arquivo. Não chamar contra staging achando que a variável de ambiente troca o destino. Não retorna organização, papel, carteira ou scopes. Não alterar helper protegido nesta tarefa. |
| `netlify/functions/_empresa_identificacao_contexto.js` | REST com JWT do usuário e chave pública, checagem `clientes.status`, empresa ativa, paths privados | Carrega perfis/documentos e gate de identificação; é amplo demais para listagem de empresas. Reusar padrão, não disparar leitura/download de documentos desnecessários. |
| `netlify/functions/kit-documentos.js` | Filtros e pós-checagem de usuário/organização/empresa/processo; leitura de itens com decimais em texto; `Cache-Control: no-store` | `carregarEscopo` não exportado e exige gestor/operador para fluxo com escritas. Não mover/refatorar agora, nem importar handler para executar ações. |
| `supabase/acesso_empresa_convites.sql` | `pode_acessar_empresa_operacao`, `pode_acessar_processo_operacao`, `meu_acesso_operacao`; membro de empresa não herda toda organização | SQL versionado, não prova RLS instalada. `meu_acesso_operacao` escolhe acesso com limite; não assumir que resolve seleção multi-organização sem ambiguidade. |
| `supabase/seguranca_operacao.sql` | Policies de leitura por empresa/processo e separação da escrita por papel; funções de escopo | Manter JWT do usuário nas consultas, não usar service_role para facilitar leitura. |
| `functions/api/[nome].js` | Roteador Cloudflare por imports/allowlist explícita | Adicionar endpoint a essa rota é etapa separada de publicação/revisão. Não alterar nesta fase. |
| `netlify/functions/__tests__/kit-documentos.test.js` | Harness Node mockando fetch, verificando JWT e filtros | Dá base para ensaio sem rede; não comprova RLS real. |

Esses caminhos são relativos a `C:/Users/harre/AppData/Local/LicitaPlena/design-modulo-um`.

## Schema observado e mapeamento

- `operacao_membros`: `usuario_id`, `organizacao_id`, `papel`; migração de acesso acrescenta `empresa_id` opcional. Papéis originais são `gestor`, `operador`, `leitura`. `empresa_id=null` indica vínculo organizacional, sujeito às policies; ID preenchido restringe à empresa. Não existe coluna `tenant_id` comprovada.
- `operacao_empresas`: `id`, `organizacao_id`, `razao_social`, `cnpj`, `ativo`. Mapeia empresa/carteira e retorno `{id,nome}`. CNPJ pode ser nulo no schema; o núcleo atual só admite 14 dígitos. Empresa incompleta deve gerar pendência explícita ou exclusão justificada no contrato, nunca CNPJ inventado. O primeiro incremento deve falhar fechado se a carteira selecionada não for representável.
- `operacao_processos`: `id`, `organizacao_id`, `empresa_id`, `objeto`, `status`, `url_origem`, `atualizado_em`, entre outros. Cabe mapear esteira, mas `url_origem` é opcional e `atualizado_em` não comprova versão de edital.
- `operacao_itens_resultado`: `id`, `organizacao_id`, `processo_id`, `identificador`, `tipo`, `descricao`, `quantidade`, `fonte_oficial`, `atualizado_em`; migrações acrescentam preço unitário/marca/modelo. Não há `empresa_id` direto: precisa validar o processo pai. `unidade` não foi localizada nessa tabela; unidade configurada na proposta não é automaticamente unidade do edital. Descrição/fonte também podem estar ausentes.
- `operacao_anexos_processo`: arquivo por organização/processo, tipo e título; não possui, nos arquivos lidos, chunks por página, hash/versão vigente, cadeia de retificação ou estado documental `vigente/superado/conflito`.
- `operacao_documentos` guarda documentos empresariais; não é repositório de evidência de edital por processo. `_empresa_documentos.js` extrai campos de identificação com limites próprios; não deve ser reutilizado como leitor genérico de todos os editais.
- `dossies_editais` tem chave PNCP, `versao`, `status`, `fonte_lida`, `dossie` JSON e timestamps; leitura autenticada ampla no SQL consultado. Não é um tenant/CNPJ privado e não garante contrato de trechos/páginas/versionamento necessário ao validador. Não alterar esse fluxo protegido para preencher lacunas.

## Construção segura do contexto

1. Gate novo fechado por padrão e corpo pequeno/estrito; método POST de consulta e resposta `no-store`. CORS não substitui autenticação.
2. Validar sessão com adaptador confiável que preserve o fluxo existente. Carregar `clientes.status=aprovado` e vínculos para o userId autenticado; todos os IDs do request são seletores sujeitos a verificação, nunca provas de permissão.
3. Resolver organização selecionada somente entre vínculos do usuário. Se houver mais de uma e nenhuma escolha verificada, devolver contexto ambíguo em vez de escolher a primeira. Não confiar em claim `tenant` inventado nem em organização enviada sem vínculo.
4. Ler empresas ativas com JWT do usuário/RLS e filtros organizacionais; aplicar restrição `membro.empresa_id`, conferir linhas e CNPJ normalizado. Mapear somente scopes de leitura permitidos pela política explícita do endpoint. Papéis de leitura não devem receber escritas por reutilização do gate do kit.
5. Invocar `executeRead` com contexto derivado e `repository.read` implementado por consultas parametrizadas/validadas. Revalidar sessão/vínculo perto da resposta quando necessário; rechecagem do objeto local no núcleo não detecta revogação remota sozinha.
6. Falha de consulta/autorização retorna erro genérico, nunca fallback para dados de outra organização ou uso de service_role.

**Staging:** `_auth.js` e `_empresa_identificacao_contexto.js` apontam para o projeto produtivo por constantes. Portanto o próximo artefato deve ser uma factory/handler com dependências de autenticação e REST injetadas no teste; não conectá-lo ao ambiente real por importação automática desses helpers. O wiring autorizado de homologação precisa usar autenticação e REST do MESMO projeto isolado. A decisão de parametrizar helpers existentes é separada e não está implícita nesta análise.

## Paginação e evidência documental

O núcleo agora admite offset/limit. O adaptador deve enviar filtros de organização/empresa em **todas** as páginas, ordenar por chave estável e buscar limite+1 para determinar `hasMore` sem inferência de total. Mudança de vínculo entre páginas exige nova negação. Offset sobre fonte mutável não é snapshot: isso permanece expresso, sem deduplicação silenciosa ou promessa de catálogo completo.

Para `consultar_evidencia_documental`, não foi comprovada fonte de `documentState`/trechos versionados no banco existente. **Até existir um adaptador que prove escopo, bytes/hash, páginas e retificações vigentes, a ferramenta deve responder indisponível/insuficiente.** Não criar páginas, `versao='1'`, URL fictícia ou `situacao='vigente'` para satisfazer o validador. Não converter timestamps de cadastro em vigência jurídica do edital.

## Teste de integração possível sem infraestrutura

Uma factory do handler fora do roteador, dependências injetadas e fetch simulado permite testar o fluxo HTTP→sessão→membros/empresas→núcleo→resposta:

- 401 sem sessão; 503 no validador indisponível; 403 cliente não aprovado.
- Corpo não pode fornecer userId, scopes ou contexto trusted; IDs inesperados rejeitados.
- Duas organizações, usuário limitado a uma empresa, papel leitura, empresa inativa/nula e vínculo removido.
- Verificar URL/headers/filtros gerados e ausência de service_role, gravação, SMTP ou provider.
- Paginação segunda página ainda filtra organização/empresa e não retorna linhas indevidas se mock simular falha de filtro.
- Evidência documental indisponível permanece indisponível, sem fallback ao resumo ou texto inventado.
- Falha preserva `no-store` e mensagem redigida; nenhuma query arbitrária, token ou segredo em saída.

Isso comprova composição de código e contrato HTTP simulado, não autenticação/RLS real. Homologação JWT/RLS privada continua dependendo do ambiente e permissões já descritos nos relatórios anteriores. Nenhum custo ou rede é necessário para esse próximo teste local.
