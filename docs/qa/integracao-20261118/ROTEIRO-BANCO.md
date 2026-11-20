# Roteiro: aplicar no banco de produção o SQL do CRM (18/11/2026)

Projeto Supabase: **`lsqjamqvmrcyrvowndiu`**. Confira o nome no topo do painel antes de colar qualquer coisa.
Tempo previsto: 15 minutos, incluindo o backup. O SQL leva poucos segundos.

Decisões já tomadas:
- arquivos soltos, juntados em um script só. O pacote `02-delta-operacional.sql` não é usado;
- importação de itens do PNCP **ligada**;
- vínculo com o portal **fora**: `vinculo_compra_portal.sql` **não** é aplicado e o botão continua escondido.

Você vai usar dois arquivos desta pasta:

| Arquivo | O que faz | Grava no banco? |
|---|---|---|
| `01-aplicar.sql` | Instala tudo, numa transação só. Se der erro, nada fica gravado. | Sim |
| `02-verificar.sql` | Confere item por item e devolve `ok` ou `falha`. | Não (só leitura) |

Não edite os dois arquivos. Se uma fonte em `supabase/` mudar, rode `node testar-aplicar.cjs --gerar` e depois `node testar-aplicar.cjs`.

---

## Passo 0. Antes da janela

1. Ninguém mais pode mexer no banco durante a janela: nem outro SQL, nem mudança de policy pelo painel.
2. Os robôs do GitHub Actions podem continuar ligados. Eles não usam as tabelas `operacao_*`.
3. **Ainda não** mude as variáveis do Cloudflare. Isso fica para o Passo 5.

## Passo 1. Backup (obrigatório)

1. No painel do Supabase, abra **Database → Backups**. Confira se existe um backup **COMPLETED** de hoje e anote o horário. Se não houver backup de hoje, **pare** e remarque a janela.
   - Esse backup cobre só o banco. Os arquivos do Storage não entram nele. Este SQL não apaga nem move arquivos: só troca permissões e acrescenta um gatilho em `storage.objects`.
   - O PITR (volta a qualquer minuto) não está contratado. Voltar o backup significa restaurar um projeto novo, o que é demorado. É a última opção.
2. Guarde uma "foto" das permissões de agora. No **SQL Editor**, abra uma query nova e cole o arquivo `docs/qa/migracoes-capacidade-20261031/01-catalogo-readonly.sql`. Clique em **Run** e baixe o resultado (**Download → JSON**). Salve como `catalogo-antes-AAAAMMDD.json` numa pasta privada, fora do repositório. Esse arquivo só lê o catálogo.
3. Em **Storage → operacao-documentos**, confira se continuam 2 arquivos, como no inventário de 18/11.

## Passo 2. Aplicar `01-aplicar.sql`

1. Abra uma query **nova** no SQL Editor (não reaproveite uma aba antiga).
2. Cole o conteúdo **inteiro** de `01-aplicar.sql`. A primeira linha útil é `begin;` e a última é `commit;`.
3. Clique em **Run**. Se o painel avisar que a query tem operações destrutivas, confirme: o aviso vem dos `drop policy`, e cada um é recriado logo em seguida.
4. **Deu certo** quando o painel mostra *Success* sem nenhuma linha vermelha de erro. O painel pode mostrar uma tabelinha final com `anon`/`authenticated`: é só informativa.

O script junta, nesta ordem:

| # | Arquivo de `supabase/` | O que faz, em uma linha |
|---|---|---|
| 1 | `identificacao_empresa.sql` | Cria a tabela de identificação da empresa (endereço, representante e cargo), com o gatilho que a invalida quando o cadastro ou um documento muda. |
| 2 | `seguranca_operacao.sql` | Separa leitura de escrita: só gestor e operador gravam, e só no próprio CNPJ. Acrescenta FKs de escopo e reescreve as policies de 10 tabelas e do Storage. **É o passo de maior risco.** |
| 3 | `kit_documentos.sql` | Cria a tabela das peças (declaração e proposta) e a RPC `gravar_kit_documento`, restrita ao servidor. |
| 4 | `kit_documentos_escala_proposta.sql` | Troca só o corpo da RPC do kit para aceitar propostas com muitos itens. |
| 5 | `importacao_item_pncp.sql` | Cria as tabelas de origem, observação e cadência da importação de itens do PNCP, com as RPCs de servidor. |
| 6 | `endurecer_rpc_servidor.sql` | Tira do navegador o acesso à `selecionar_sicaf_para_enriquecimento`, que só os robôs usam. |
| 7 | 1 linha de `rls_e_limite_de_uso.sql` | Tira do navegador o acesso à `incrementar_uso`. O grant da linha seguinte mantém o acesso do servidor. |

Ajustes feitos só no script juntado (os arquivos originais não mudaram):
- O `begin;`/`commit;` de cada arquivo foi removido: tudo roda dentro de **um** `begin; ... commit;`.
- Nenhum arquivo usa `create index concurrently`, `vacuum` ou outro comando que não roda em transação. Os índices novos são pequenos e normais.
- Em `importacao_item_pncp.sql` entrou `drop policy if exists origem_pncp_leitura` antes do `create policy`. Assim o script pode rodar duas vezes sem erro.
- Do arquivo `rls_e_limite_de_uso.sql` entraram só o `revoke` e o `grant ... to service_role` da linha seguinte. Sem o grant, o limite diário da IA poderia falhar e o resumo de edital responderia "tente novamente".
- `lock_timeout = 5s`: se alguma tabela estiver ocupada, o script desiste em vez de travar o site.
- Os arquivos de marca/modelo e de valores unitários não entram, porque o inventário mostra que as colunas já existem.
- O cabeçalho do `01-aplicar.sql` traz o SHA-256 de cada fonte.

Conferência feita: nenhuma página do site chama `incrementar_uso` nem `selecionar_sicaf_para_enriquecimento` pelo navegador. A única chamada é em `netlify/functions/_auth.js`, com a chave de serviço.

## Passo 3. Se der erro

1. **Pare.** Não rode o script de novo e não tente corrigir nada à mão.
2. Numa query nova, rode só isto:
   ```sql
   rollback;
   ```
   O aviso "there is no transaction in progress" é normal: ele quer dizer que o banco já tinha desfeito tudo.
3. Copie a mensagem de erro inteira e mande para análise. Como tudo está numa transação, **nada foi gravado**: o banco continua como antes.
4. Erros conhecidos e o que querem dizer:

| Mensagem | Significado |
|---|---|
| `canceling statement due to lock timeout` | Uma tabela estava ocupada. Espere alguns minutos e tente de novo, uma vez. |
| `Escopo legado inconsistente...` | Algum documento ou processo está com empresa ou caminho trocado. Precisa de revisão antes de seguir. Hoje o inventário mostra zero casos. |
| `must be owner of table objects` ou `permission denied for table objects` | O Supabase não deixou criar o gatilho ou as policies em `storage.objects`. Não force: pare e analise. |
| `Instale primeiro o isolamento por empresa` / `Bucket privado obrigatório` | A base esperada não está lá. Pare. |

## Passo 4. Verificar com `02-verificar.sql`

1. Numa query nova, cole o `02-verificar.sql` inteiro e clique em **Run**. Ele roda em modo só leitura e não grava nada.
2. **Deu certo** quando aparece uma tabela de **81 linhas** e a coluna `resultado` mostra `ok` em todas.
   - Contém o `verificar_kit_prepublicacao.sql` intacto. Se o painel mostrar um erro começando com `Kit pré-publicação:`, o kit não passou: anote a mensagem.
   - A linha `gate identificacao_empresa_habilitada() = true` é a mesma conferência que o servidor faz antes de liberar a identificação da empresa.
3. Se alguma linha mostrar `falha`, ou se aparecer erro: **não ligue as variáveis do Passo 5**. Mande a lista do que falhou. O site continua funcionando como antes, porque as telas novas ficam desligadas enquanto as variáveis estiverem desligadas.
4. Rode o `02-verificar.sql` de novo depois de qualquer mudança de permissão no painel.

## Passo 5. Variáveis de ambiente no Cloudflare Pages (projeto `licitaplena`)

Faça isto **só depois** do Passo 4 dar 81 `ok`. Caminho: **Workers & Pages → licitaplena → Settings → Variables and Secrets**, no ambiente **Production**.
Quem lê as variáveis são as funções de `netlify/functions/`, servidas pela rota `functions/api/[nome].js`. Essa rota copia `context.env` para `process.env` a cada chamada.
Variável nova só vale depois de uma **nova publicação**. Use **Deployments → Retry deployment** no último deploy, ou publique de novo.

### Necessárias para o CRM

| Variável | Valor | Tipo | Quem lê | Sem ela |
|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | chave *service_role* do projeto | **Secret** | `_auth.js` (limite diário: `ia-edital`, `despesas-fornecedor`, `sancoes`, `enviar-duvida`, `enviar-resumo-edital`), `admin-excluir-cliente`, `busca-publica`, `convenios-publico`, `empresa-identificacao`, `importar-item-pncp`, `kit-documentos` (por `_kit_documentos_persistencia.js`), `decisao-oportunidade` e `enviar-resumo-edital` (por `_decisao_oportunidade.js`), `ia-edital` (por `_dossies_persistidos.js`) | Kit, identificação e importação ficam indisponíveis; o resumo por IA responde "tente novamente". |
| `IDENTIFICACAO_EMPRESA_LOCAL` | `1` | texto | `empresa-identificacao`, `kit-documentos` | As duas respondem 503 ("ainda não habilitada"). **O kit do CRM não funciona sem ela.** Apesar do "LOCAL" no nome, é a chave que liga o recurso. |
| `IMPORTACAO_PNCP_LOCAL` | `1` | texto | `importar-item-pncp`; `kit-documentos` (por `_kit_proposta_itens.js`) | A importação de itens do PNCP fica desligada. |

### Já usadas pelo site (conferir se continuam lá; o SQL não depende delas)

| Variável | Quem lê | Observação |
|---|---|---|
| `GROQ_API_KEY` (Secret), `GROQ_MODEL` (opcional) | `lib/ia-edital.js` | IA do resumo de edital. |
| `TRANSPARENCIA_TOKEN` (Secret) | `despesas-fornecedor`, `sancoes` | Portal da Transparência. |
| `ZEPTOMAIL_TOKEN` (Secret), `EMAIL_DUVIDAS` (opcional) | `enviar-duvida`, `enviar-resumo-edital` | Envio de e-mail. |
| `DECISAO_CLIENTE_ATIVA` (`1` liga) | `_decisao_oportunidade.js` | Decisão do cliente no e-mail; fora do escopo deste roteiro. |
| `DOSSIES_EDITAIS_CHAVE` (Secret) | `lib/ia-edital.js` | Chave do robô interno de dossiês. |
| `URL` (opcional) | `_resumo_gateway.js` | Padrão `https://licitaplena.com.br`. |
| `TIMEOUT_ARQUIVO_PNCP_MS`, `TIMEOUT_LISTA_PNCP_MS` (opcionais) | `lib/ia-edital.js` | Tempos de espera do PNCP. |

### Deixar **sem** valor no Cloudflare

`LEITURA_DOCUMENTAL_LOCAL`, `LEITURA_OCR_LOCAL`, `OCR_LOCAL_IDIOMA`, `OCR_LOCAL_PDFTOPPM` e `OCR_LOCAL_TESSERACT` (lidas por `lib/ia-edital.js` e `_pdf_ocr_local.js`). Elas dependem de programas locais (`pdftoppm`, `tesseract`), que o Cloudflare não tem.

O vínculo com o portal **não** tem variável. A rota `vinculo-compra-portal` continua publicada, mas sem o SQL dela qualquer chamada falha. Por isso o botão precisa continuar escondido.

## Passo 6. Conferência final

1. Rode `02-verificar.sql` de novo: **81 linhas `ok`**.
2. No site publicado, com um usuário gestor:
   - abra uma empresa e confirme a identificação (endereço, representante, cargo);
   - gere e salve uma declaração no kit;
   - num processo com compra do PNCP, importe um item;
   - peça um resumo de edital por IA: confirma que o limite diário continua funcionando.
3. Em **Advisors → Security**, os avisos de `incrementar_uso` e `selecionar_sicaf_para_enriquecimento` executáveis por `anon` devem sumir.

## Se algo der errado depois do commit

- O SQL não apaga dados e não tem "desfazer" automático. Reabrir as permissões antigas devolveria a falha de isolamento entre empresas.
- Primeiro passo: **desligue** `IDENTIFICACAO_EMPRESA_LOCAL` e `IMPORTACAO_PNCP_LOCAL` no Cloudflare e publique de novo. As telas novas param, e o resto do site segue como antes.
- Com o `catalogo-antes-*.json` do Passo 1, dá para analisar e reverter uma policy específica à mão. Restaurar o backup inteiro é a última opção, porque cria um projeto novo e não traz os arquivos do Storage.

---

## Ordem dos SQL novos (depois do `01-aplicar.sql` e do `02` com 81 `ok`)

Cada arquivo é de `supabase/`, roda sozinho numa query nova e pode rodar de novo sem erro. Mesma ordem de
`ambiente-teste/subir.cjs` e de `testar-dezembro.cjs`:

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `operacao_itens_proposta.sql` | Preço por item, premissas e referência. |
| 2 | `operacao_funil_etapas.sql` | Etapas do Funil. |
| 3 | `operacao_portal_cliente.sql` | Portal do cliente (links e aceites). |
| 4 | `operacao_perfil_empresa.sql` | Perfil da empresa e "Proposta padrão". |
| 5 | `operacao_exigencias.sql` | Exigências do processo. |
| 6 | `operacao_esteira.sql` | Esteira do edital (tarefas e gatilho). |
| 7 | `operacao_kit_modelos.sql` | Modelos e formato das peças do kit. |
| 8 | `importacao_item_pncp_numero_int32.sql` | Troca só o corpo de `gravar_importacao_pncp`: o número do item passa de 1..1000000 para 1..2147483647 (inteiro do PNCP). Sem ele, compras da Licitanet (ex. item 8184615) dão HTTP 400. `importacao_item_pncp.sql` e o `01` ficam como estão (fonte preservada por hash); por isso este arquivo vem **depois** do `01`. Se o `01` rodar de novo, rode este de novo. |
| 9 | `operacao_itens_numero_ordem.sql` | Coluna gerada `numero_ordem` (identificador só com dígitos, senão null) e índice em `operacao_itens_resultado`. A lista de itens pagina por ela; sem a coluna, o servidor volta à ordem por id (1ª página sem os menores números). Reescreve a tabela de itens uma vez (coluna `stored`), com `lock_timeout` de 5 s; não toca `atualizado_em`. |
| 10 | `sancoes_empresas.sql` | Sanções de empresas do CEIS/CNEP (CGU), carga diária pelo robô `coletar_sancoes_cgu.js`. Só CNPJ (pessoa física barrada por check), leitura para autenticado, escrita só `service_role`, sem delete (histórico com `fora_da_lista`). Não depende das tabelas `operacao_*`; nas listas de `subir.cjs`/`testar-dezembro.cjs` vem logo depois de `historico_licitacoes.sql`. Sem ele, o aviso de sanção do Hoje mostra "não foi possível carregar" e `/api/sancoes-cnpj` responde 503. |
| 11 | `pregoes_gravados.sql` | Base compartilhada dos pregões gravados pela extensão (modo "Gravar pregão no LicitaPlena"): `pregoes_gravados`, `pregoes_gravados_propostas`, `pregoes_gravados_mensagens` e a RPC `gravar_pregao_gravado` (só `service_role`). Dado público: leitura para autenticado, `anon` sem acesso, escrita só pela RPC; CHECKs recusam CPF. Não depende das tabelas `operacao_*`; nas listas de `subir.cjs`/`testar-dezembro.cjs` vem depois de `sancoes_empresas.sql`. Sem ele, `/api/pregao-gravado` responde 502. Contrato: `docs/pregao-gravado.md`. |
| 12 | `prospeccao.sql` | Tabela enxuta `prospeccao_itens` da tela Prospecção (`prospeccao.html`): PCA/PGC, IRP aberta, ata com saldo para adesão e contrato vencendo, carga diária pelo robô `scripts/coletar_prospeccao.js` (PNCP + Compras.gov dados abertos, sem login). Leitura para autenticado, `anon` sem acesso, escrita e limpeza só `service_role` (cache de dado público: o vencido sai). CHECKs: link só de pncp.gov.br/dadosabertos.compras.gov.br/contratos.comprasnet.gov.br, fornecedor só com CNPJ. Não depende das tabelas `operacao_*`; nas listas vem depois de `pregoes_gravados.sql`. Sem ele, `/api/prospeccao` responde 503. |
| 13 | `analise_cnpj.sql` | Análise por CNPJ (Analisar concorrente do painel): colunas `historico_compras.uf` e `historico_participacoes.situacao_proposta` (código cru do arquivo de propostas), fila/cache `historico_cnpj_consultas` (só CNPJ, leitura autenticado, escrita `service_role`), índice de `pregoes_gravados_mensagens` por fornecedor (se a tabela existir) e a RPC de leitura `analise_cnpj_participacoes(cnpj)` (security invoker, `anon` sem execução). Exige `historico_licitacoes.sql`; nas listas vem depois de `prospeccao.sql`. **Rodar antes do deploy** do código: sem ele `/api/analise-cnpj` responde 502 e a tela mostra "não foi possível ler o histórico". |
| 14 | `filtros_salvos.sql` | Painel (Encontrar Licitações): `filtros_salvos` (até 20 por conta, nome único sem diferenciar maiúsculas), `editais_sem_interesse` (descartes por conta, até 5.000) e, em `lembretes`, as colunas `hora_aviso` (0 a 23, Brasília) e `enviado_em`. RLS: cada conta só vê e altera as próprias linhas; `anon` sem acesso. Não toca `clientes.boletim_filtro`. Guarda `to_regclass('public.lembretes')` (o ensaio PGlite não tem essa tabela). Depois de aplicar, o workflow `lembretes-licitacoes.yml` (agora de hora em hora) usa as colunas novas. |
| 15 | `operacao_contratos_publicos.sql` | Contrato, aditivos, empenhos e pagamento (PNCP + Contratos.gov.br, sem login) por processo ganho, gravados pelo robô da esteira (etapa 8). Só `service_role` escreve; leitura pela regra de empresa. Depende de `operacao_esteira.sql`, que também ganhou as etapas `resultado` e `contrato`. |

Testes (só no ambiente de teste, tudo em `rollback`): `testar_itens_proposta.sql`, `testar_funil_etapas.sql`,
`testar_portal_cliente.sql`, `testar_perfil_empresa.sql`, `testar_exigencias.sql`, `testar_esteira.sql`,
`testar_kit_modelos.sql`, `testar_itens_numero_ordem.sql`, `testar_sancoes_empresas.sql`, `testar_pregoes_gravados.sql`, `testar_prospeccao.sql`, `testar_analise_cnpj.sql`, `testar_filtros_salvos.sql`, `testar_contratos_publicos.sql`.

---

## Ensaio local (18/11/2026)

Script: `testar-aplicar.cjs`. Saída: `resultado-teste-20261118.txt`.
Roda em PGlite (PostgreSQL 17.5, em memória, dados fictícios, sem rede). Produção usa 17.6.

Como a base imita produção:
- stubs mínimos de `auth.users`/`auth.uid()`, `storage.buckets`/`storage.objects`/`storage.foldername` e papéis `anon`/`authenticated`/`service_role`, com os privilégios padrão do Supabase;
- `clientes` e `admins` com as colunas do catálogo de produção de 31/10;
- stub de `selecionar_sicaf_para_enriquecimento`, que veio do projeto Radar SICAF e não tem `.sql` aqui;
- depois disso, os SQL base na ordem em que produção os recebeu: `rls_e_limite_de_uso.sql` (seções 1 e 2; a seção 3 exige `admins.id`, que não existe em produção), `operacao_licitacoes`, `operacao_acompanhamento`, `limite_cnpjs_operacao`, `acesso_empresa_convites`, `operacao_checklist_edital`, `operacao_kanban_sync`, `operacao_itens_valores_unitarios`, `operacao_itens_marca_modelo`;
- por fim, a execução de `incrementar_uso` foi reaberta para `anon`/`authenticated`, como o advisor mostrou em 17/11.

As 20 policies dessa base (`operacao_*` e `storage.objects`) foram comparadas com o catálogo de produção de 31/10: nome, comando, papéis, `using` e `check` são iguais. As funções públicas também batem, menos `criar_cliente_no_cadastro()`, que é o gatilho de cadastro e está fora do escopo.

Resultado:
- `02` antes do `01`: recusado pelo gate do kit, como esperado.
- `01` com um erro forçado no fim: rollback completo, nada sobrou.
- **Rodada 1:** `01` aplicou sem erro; `02` deu 81 `ok` e 0 `falha`.
- **Rodada 2:** `01` aplicou de novo sem erro, o que prova que é idempotente; `02` deu 81 `ok` e 0 `falha`.
- Dados fictícios preservados: 2 documentos, 4 processos, 1 item, 1 membro e 2 objetos.
- Com uma policy removida numa transação desfeita depois, o `02` apontou exatamente essa policy como `falha`.
- `incrementar_uso` depois do `01`: `anon` e `authenticated` negados; `service_role` executa.

O ensaio **não** prova:
- dono e permissões reais de `storage.objects` no Supabase (o PGlite roda como superusuário);
- o tempo de lock com o tráfego real;
- a API real do PostgREST, do Auth e do Storage;
- mudanças feitas em produção entre 31/10 e 18/11 fora do que o inventário de 18/11 registrou.
