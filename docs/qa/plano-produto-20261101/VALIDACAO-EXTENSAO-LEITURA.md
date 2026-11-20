# Validação local da extensão de leitura — 01/11/2026

Escopo: protótipo isolado em `extensao-leitura`, sem instalação, publicação, envio de propostas/lances ou alteração de módulos existentes.

## Resultado

26 testes locais passaram, zero falhas, em aproximadamente 190 ms:

```text
node --test extensao-leitura/adapter.test.mjs extensao-leitura/collector.test.mjs extensao-leitura/popup.test.mjs
```

Cobertura relevante: CNPJ explicitamente rotulado como fornecedor, CNPJ inválido/ausente/divergente, identidades ambíguas, UASG conflitante, ano divergente, duplicação idêntica, URL host/path/query restritos, sessão/CAPTCHA, conteúdo invisível, coleta truncada, navegação para outra compra na mesma aba/origem, alteração de cada campo esperado durante a leitura, erros de execução e descarte de resultados antigos.

Achado corrigido nesta rodada: um rótulo de fornecedor malformado ao lado de outro válido era descartado pelo coletor. Teste negativo reproduziu a falha; agora marca coleta incompleta sem retornar o texto malformado. Outras ampliações de testes não exigiram mudança funcional.

O coletor também valida a URL dentro do frame antes de qualquer acesso ao DOM. Destinos inválidos têm teste de zero leituras DOM e não retornam URL arbitrária/token. O manifesto permite somente `activeTab` e `scripting`, acionados pelo popup, e bloqueia conexões na CSP. Inspeção estática dos módulos executáveis não encontrou chamadas de rede, armazenamento, cookies, clique ou submissão no portal. A escrita dos próprios campos/status do popup não modifica o portal.

## Limites obrigatórios

- São testes Node com DOM e APIs Chrome simulados. Não são teste end-to-end nem comprovam execução no portal real.
- A inspeção real nesta retomada ficou indisponível: handle anterior sem acesso e nova aba com acesso não autorizado, conforme observação da coordenação. Não houve relaxamento do rótulo obrigatório do fornecedor.
- O rótulo real `CNPJ do fornecedor:` ainda não foi comprovado na tela. A ausência mantém identidade não confirmada; digitar o CNPJ esperado não substitui evidência observada.
- Não há conexão SaaS, autenticação integrada, aprovação de proposta ou automação de lances nesta entrega. **Aprovação NÃO comprovada.**
- Não houve ensaio de carga ou concorrência. **1.000 usuários ativos NÃO é capacidade validada.** Quantidade de itens por pregão também não foi validada pelo adaptador, que só lê contexto.
- Resultado `confirmado` significa correspondência pontual dos identificadores no snapshot; não autoriza escrita e não certifica a sessão no servidor.
- Resumo, e-mail, boletins, produção e credenciais permanecem fora do escopo.
