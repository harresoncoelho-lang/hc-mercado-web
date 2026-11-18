# Revisão de segurança: esteira do edital (18/11/2026)

Escopo da revisão: commits `ac15eaa..76184ea` (esteira E1–E14) na branch `retomada/app-comercial-20261117`.
As correções abaixo ficam no working tree, sem commit. Nenhum banco real foi tocado. As provas usam PGlite em memória e handlers em Node com `fetch` falso.

## Achados do revisor (resumo)

| # | Gravidade | Achado |
|---|---|---|
| A1 | Alta | O CPF do representante ficava legível pelo papel **leitura** em `operacao_kit_documentos`. O lote de declarações (`_kit_declaracoes.js`) gravava o CPF formatado em `dados.declaracao.texto`, e depois em `revisao_previa`. A policy SELECT do kit (`kit_documentos.sql:21-24`) inclui o papel leitura. O perfil (`operacao_perfil_empresa`) esconde o CPF desse papel, mas o kit vazava. A sonda mostrou `P1 leitura le kit (CPF no texto)`. |
| M1 | Média | A fila de IA podia ser inflada. O gatilho `iniciar_esteira_processo` punha **qualquer** `origem_externa_id` em `fila_dossies` com prioridade `interesse`, sem teto, e repetia isso a cada UPDATE de status. Prioridade `interesse` lê todos os anexos e passa à frente (`gerar_dossies_gemini.js`). Na sonda, 50 IDs inventados viraram 50 `interesse` (P4). Um vaivém de status subia de prioridade um edital alheio (P4e). |
| M2 | Média | LGPD: a política de privacidade não falava do CPF do representante nem dos dados bancários do Perfil da empresa. |
| B1 | Baixa | O operador apagava a premissa Padrão (`*\|*`) direto pelo PostgREST (P3). |
| B2 | Baixa | O cliente informava `criado_por` no processo, e o gatilho usava `coalesce(new.criado_por, auth.uid())` nas tarefas. O autor podia ser forjado (P4b). |
| B3 | Baixa | O CHECK de `logo_caminho` só exigia o escopo e a pasta `perfil`. Aceitava `perfil/../../<outra org>/...` e qualquer nome de arquivo (P8). A Function é mais estrita. |
| B4 | Baixa | Regressão no texto da proposta formato 1: `Item ${id}:${descricao}` tinha perdido o espaço depois dos dois-pontos. |
| CSP | — | Conferir se `img-src` aceita a URL assinada do Supabase usada na prévia da logo. |

## Correções aplicadas

### A1: o CPF não vai mais para o kit
- `netlify/functions/_kit_declaracoes.js`
  - `variaveis()` não carrega mais o CPF.
  - `preencherVariaveis()` mantém o marcador literal `{{cpf_representante}}`, normalizado sem espaços.
  - O lote **nunca** lê `cpf_representante`. O select do perfil ficou sem a coluna.
  - O texto `edital` e o `livre` passam por `escaparChaves()` antes de `preencherVariaveis()`. Assim `{{`/`}}` viram `{ {`/`} }`, e um edital não consegue puxar variável nenhuma (nem o CPF, nem outra).
  - Nova função `lerCpf(c, empresa)`. Ela lê o CPF com o token de quem exporta, e a RLS do perfil só libera gestor e operador.
- `netlify/functions/_kit_documentos.js`
  - `declaracao()` aceita `{{cpf_representante}}`. Prévia, `revisao_previa` e `revisaoHash` usam `[CPF do representante]`. O hash cobre o texto com o marcador, não o CPF.
  - `preparar()` expõe `textoComCpf(cpf)` só quando a peça pede CPF.
  - Novo `textoFinal(resultado, cpf)`: devolve o texto do DOCX, ou `null` quando a peça pede CPF e o perfil não tem.
- `netlify/functions/kit-documentos.js`
  - `exportar` (uma peça) e `exportarDeclaracoes` (lote) leem o CPF **na hora** e só quando a peça pede. O CPF é lido uma vez por lote.
  - Sem CPF no perfil, `exportar` responde 409 com "Preencha o CPF do representante no Perfil da empresa antes de exportar.". `exportarDeclaracoes` deixa a peça de fora, com `motivo: 'campos_pendentes'`.
  - Nada é gravado com o CPF.
  - Efeito LGPD: limpar o CPF no Perfil já tira o CPF de todas as exportações futuras, sem nova revisão.

### M1: teto e origem real para `interesse`
`supabase/operacao_esteira.sql`, gatilho `iniciar_esteira_processo`:
- Prioridade `interesse` só na **primeira entrada**. Isso vale para o processo que ainda não tinha tarefas, seja no INSERT, seja na primeira vez no Funil. Um UPDATE de status depois disso enfileira `clique` sem mexer em quem já está na fila.
- Exige que `origem_externa_id` exista em `oportunidades_abertas`, quando a tabela existe.
- Teto de 20 processos novos por organização em 24 h, contados por `operacao_esteira_tarefas.criado_em`. Um `pg_advisory_xact_lock` por organização evita furar o teto com inserções em paralelo.
- Quem fica fora dessas regras entra como `clique` (`on conflict do nothing`), sem upgrade.
- `scripts/gerar_dossies_gemini.js` não mudou: a fila já não recebe `interesse` inflado.

### M2: política de privacidade
`politica-privacidade.html` ganhou a seção "11. Dados da empresa e do representante". Ela cobre:
- quais dados: CPF do representante e dados bancários;
- finalidade: proposta e declarações;
- base legal: art. 7º, II e V, da LGPD;
- quem vê: gestor e operador; o papel leitura vê só "[CPF do representante]";
- envio à IA: não enviado;
- retenção: enquanto a empresa estiver cadastrada;
- como apagar: limpar no Perfil (some das exportações futuras) ou pedir por licitaplena.site@gmail.com.

A data de atualização passou para 18/11/2026.

### B1 a B4 e CSP
- **B1** (`operacao_perfil_empresa.sql`): novo gatilho `proteger_premissa_padrao` BEFORE DELETE. Ele recusa apagar `*|*` quando `auth.uid()` não é nulo e a empresa ainda existe. A cascata ao apagar a empresa continua, porque nessa hora a empresa já não existe. O `service_role` sem JWT passa.
- **B2** (`operacao_esteira.sql`): as tarefas usam `coalesce(auth.uid(), new.criado_por)`. O novo gatilho `carimbar_criador_processo` BEFORE INSERT em `operacao_processos` grava `criado_por := coalesce(auth.uid(), new.criado_por)`. Não havia gatilho parecido. Nenhuma policy nem código existente depende de `criado_por` diferente do JWT; o `grep` não achou nenhum caso.
- **B3** (`operacao_perfil_empresa.sql`): nova constraint `operacao_perfil_empresa_logo_caminho_check`, criada com drop e add idempotentes. A regra é `^<org>/<empresa>/perfil/logo-<logo_hash>\.(png|jpe?g)$`, igual a `tipoCaminhoLogo`, inclusive o hash do nome igual a `logo_hash`.
- **B4** (`_kit_documentos.js`): voltou o texto `Item ${i.identificador}: ${i.descricao}`.
- **CSP**: `img-src 'self' data: https:` em `_headers` e `netlify.toml` já aceita a URL assinada `https://<projeto>.supabase.co/storage/v1/object/sign/...`. Nada foi alterado.

## Provas

| Prova | Resultado |
|---|---|
| `node --test netlify/functions/__tests__/kit-declaracoes.test.js` (com kit-documentos e kit_documentos) | 46/46 |
| Teste novo "CPF: rascunho, prévia e revisão guardam só o marcador; a exportação leva o CPF lido na hora" | Rascunho, `revisao_previa` e respostas sem `52998224725` nem `529.982.247-25`. O CPF não é lido antes da exportação. O DOCX de `exportar` e o de `exportarDeclaracoes` contêm `529.982.247-25`. Com o CPF apagado, `exportar` dá 409 e o lote dá 422 com `campos_pendentes`. |
| Teste do lote | O lote não lê `cpf` no perfil. O edital com `{{razao_social}}`/`{{cpf_representante}}` fica `{ {...} }`. `escaparChaves('{{{{a}}}}')` não deixa nenhum `{{` nem `}}`. |
| Teste B4 | A prévia do formato 1 fixa `Item 1: Caneta\nQuantidade: 2,000 \| Unidade ... \nUnitário ofertado: R$ 1,25 \| Total: R$ 2,50`. |
| `supabase/testar_kit_modelos.sql` | Como papel leitura, `dados` e `revisao_previa` de uma peça com marcador são legíveis, sem CPF e com `{{cpf_representante}}`. O perfil não é legível. |
| `supabase/testar_esteira.sql` | 50 processos novos numa organização, todos com edital coletado, dão 20 `interesse` e 30 `clique`. O ID inventado `99999999000199-1-1/2026` fica `clique`. O vaivém de status num processo com tarefas não sobe de volta para `interesse`. O edital `000002`, que não foi coletado, fica `clique`. Com o operador forjando `criado_por` = gestor, o processo e as tarefas ficam com o operador. |
| `supabase/testar_perfil_empresa.sql` | O gestor não apaga `*\|*` ("A premissa Padrão..."). Uma premissa comum é apagada. Apagar a empresa A2 com JWT presente leva o Padrão junto. A logo com `..`, com hash do nome divergente, com nome livre ou `.gif` dá `check_violation`. `.jpeg` passa. |
| `node docs/qa/integracao-20261118/testar-dezembro.cjs` | `ENSAIO DEZEMBRO OK`: 2 rodadas, todos os `testar_*.sql` ok, 02 com 81/81 ok, dados preservados. |
| Sonda do revisor (`sonda.cjs`, PGlite) depois da correção | P3: `A premissa Padrão não pode ser removida`. P4b: `criado_por` = operador. P8: `violates check constraint operacao_perfil_empresa_logo_caminho_check`. P4: 20 (a sonda não cria `oportunidades_abertas`, então vale só o teto). P1 continua lendo CPF porque a própria sonda grava o CPF à mão no kit, como dado legado (ver riscos). |
| `npm test` | 1544 testes: 1534 passaram, 6 falharam. São as 6 falhas já conhecidas: Miniflare 5, app-comercial-layout, app-comercial-movel, ponte_leitura_sql, vinculo_compra_baseline e migração PGlite efêmera. |
| `npm run lint` | 0 erros e 71 avisos, todos de complexidade e já existentes. |

## Riscos restantes

1. **Dados legados.** Peças de declaração já geradas pelo lote antes desta correção podem ter o CPF gravado em `dados`/`revisao_previa`, e o papel leitura ainda lê essas peças. Antes de publicar, rode no SQL Editor uma consulta que **só conte** as peças `tipo='declaracao'` cujo texto bate com `\d{3}\.\d{3}\.\d{3}-\d{2}`. Se houver alguma, decida entre regerar as peças ou trocar o número pelo marcador. Nenhuma limpeza automática foi feita.
2. **Mudança de comportamento.** Nos textos `edital` e `livre` do lote, as variáveis deixaram de ser preenchidas: o texto fica com `{ {...} }` visível. Isso é intencional (o edital não puxa dado do perfil), mas quem usava `{{razao_social}}` em texto livre do lote precisa editar a peça. O caminho `salvar` manual continua com as variáveis.
3. **Revisões antigas.** O B4 muda a prévia da proposta formato 1. As revisões já confirmadas dessas propostas deixam de ser vigentes e precisam de nova prévia e confirmação. As declarações antigas não mudam de hash, porque o texto delas não tem o marcador.
4. **CPF alterado depois da revisão.** O hash cobre o marcador, não o número. Trocar o CPF no Perfil muda as exportações seguintes sem nova revisão. É o comportamento pedido e está documentado na política.
5. **M1.** Sem `oportunidades_abertas` no ambiente, vale só o teto de 20 por dia. Um usuário legítimo ainda pode marcar até 20 editais reais por dia como `interesse`.
6. **Aplicação manual.** É preciso rodar de novo `operacao_perfil_empresa.sql` e `operacao_esteira.sql` no SQL Editor. A constraint B3 é criada validando as linhas existentes. Se alguma logo antiga estiver fora da regra, o arquivo falha inteiro (transação única) e é preciso corrigir a linha antes.
