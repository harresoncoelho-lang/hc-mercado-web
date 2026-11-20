# Documentos e propostas por CNPJ no Design System

> **For agentic workers:** Use superpowers:subagent-driven-development para tarefas delegáveis. A implementação visual ocorre no Claude nativo já autorizado, no mesmo catálogo privado, sem commit ou publicação do SaaS.

**Goal:** Completar a prévia de identidade documental e formação simples do preço dentro do fluxo existente por CNPJ/processo.

**Architecture:** Reutilizar PerfilDocumentos e KitProposta, seus modelos, validações e estados de revisão. Mudanças no gerador devem ficar restritas a essas composições; não regenerar resumos ou helpers globais com efeitos em outras telas.

**Tech Stack:** HTML/CSS/JavaScript e geradores já existentes no catálogo Claude. Sem dependências novas, API externa ou conexão com produção.

**Spec:** Pedidos do usuário nesta conversa: documentos com dados/logo/timbrado da empresa, proposta e apoio à planilha de custos; seguir no Design System existente e preservar resumo, e-mail e boletins. O usuário já delegou decisões rotineiras e pediu execução. Escopo desta fatia definido pelo coordenador abaixo.

## Restrições e decisões

- Mesmo artefato `2c37c3c7-4bb3-474d-85e2-24267a3e1435`, partindo da v28, compartilhamento Apenas você.
- Preservar ResumoCompleto, SummaryFull, JornadaIntegrada, BoletimOportunidades e InteligenciaHub byte a byte.
- Identidade visual por empresa: reutilizar logos de exemplo, mostrar cabeçalho/rodapé do timbrado na prévia; nenhuma imagem ou documento real será enviado.
- Custos por item/processo: custo-base, frete unitário e outros custos unitários; acréscimo percentual sobre o custo, explicitamente distinto de margem sobre venda. Sugestão = soma dos custos × (1 + acréscimo/100), com arredondamento monetário. Nenhum cálculo tributário automático.
- Preço só muda por ação explícita. Custos/acréscimo são internos e não aparecem na proposta destinada ao cliente/órgão. Campo pendente não equivale a zero; zero explícito pode ser usado para despesas inexistentes.
- Modelos de declaração/proposta já existentes mantêm fonte/versão, revisão, condições e escopo. Não construir biblioteca ampla, persistência remota, upload real ou exportador novo nesta fatia.

## Foco de revisão

1. Troca A→B→A ou de processo não mistura logo, timbrado, custos e aprovação.
2. Campo vazio/negativo/decimal inválido não produz preço válido nem substitui o digitado.
3. Alterar identidade ou preço invalida revisão e aprovação; estado antigo não autoriza download.
4. Leitor/sessão encerrada não alteram nem aplicam preço; visão consolidada exige CNPJ.
5. Custos internos não vazam na prévia externa; identidade não aparece de outra empresa.

## Tarefas

### 1. Diagnóstico independente e configuração do escopo
**Files:** somente leitura de código, planos e QA locais; nenhuma UI pelo subagente.
- [x] Confirmar kit local e protótipos existentes para evitar recriação.
- [x] Fixar como alvo PerfilDocumentos/KitProposta, mantendo resumos intocados.

### 2. Implementação nativa e verificações
**Files:** gerador específico e `project/components/PerfilDocumentos/{preview.html,README.md}`, `project/components/KitProposta/{preview.html,README.md}` no ambiente do Claude; testes locais do catálogo. Confirmar caminhos reais antes de editar.
- [x] Registrar hashes dos cinco componentes protegidos e inspecionar o gerador existente. Runtime/tokens não tinham baseline anterior à v29; registrar essa limitação.
- [x] Acrescentar identidade/timbrado à prévia, mantendo o isolamento existente.
- [x] Acrescentar custos e ação de aplicar preço por item: 2,50 + 0,50 + 0,00, acréscimo de 20%, resulta em 3,60.
- [x] Executar testes negativos do foco de revisão, regressões de documentos, 18 seções abertas e ausência dos campos extras rejeitados — execução relatada pelo Claude, 104 verificações de formação e guardas existentes.
- [x] Conferir 375/450/650/704/1280 px por testes de geometria relatados pelo Claude; temas e controles diretamente no visualizador. Corrigir corte dos custos encontrado na v29.
- [ ] Percurso completo por teclado, foco do diálogo e contraste medido: não concluídos nesta rodada, sem alegação de acessibilidade integralmente validada.
- [x] Salvar revisão v30 no mesmo catálogo privado, sem alterar compartilhamento ou publicar SaaS.

### 3. Conferência direta e continuidade
**Files:** `docs/qa/homologacao-design-system-claude.md` e ledger de continuidade; sem alterações de código da aplicação.
- [x] Principal confere prévia, troca de CNPJ, sugestão/aplicação de preço e tema no visualizador nativo.
- [x] Distinguir testes relatados pelo Claude de verificações diretas; registrar versão, alterações e limitações em `docs/qa/homologacao-design-system-claude.md`.

**Resultado desta fatia:** v30 salva e conferida no mesmo catálogo privado. Sem backend novo, persistência remota, upload real ou exportador novo. A homologação de acessibilidade completa e a integração futura com a aplicação permanecem pendentes; não afirmar que o fluxo de produção recebeu esta revisão.

## Investigação PNCP paralela e independente

O especialista `historico_retomada` tem exclusividade da origem. Diagnóstico limitado diferencia DNS/TLS, primeira página e página 201; até três GETs, intervalo mínimo de sete segundos, timeout diagnóstico até 60 segundos sem alterar o coletor. Qualquer retomada depende da análise coordenada das evidências. Os 200 arquivos e 100.000 IDs permanecem preservados. Não escrever em produção nem executar SMTP/robôs.
