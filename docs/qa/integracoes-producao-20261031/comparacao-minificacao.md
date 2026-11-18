# Comparação local de minificação

> **Adendo da revisão:** medidas e hashes do Worker abaixo continuam válidos. A igualdade dos 45 inputs era apenas de nomes; `fontes-build.json` inicial resolveu a base errada, corrigida na rodada 03. Os pacotes 01/02 incluem histórico privado por destinatário e não podem ser publicados. Ver `revisao-pre-runtime.md` e `PRE-EXECUCAO-2.md`. A rodada 03 exclui esse arquivo e mantém exatamente o mesmo hash do Worker minificado. Evidências anteriores preservadas.

31/10/2026. Mantidos o mesmo código-fonte, todos os handlers/imports, `compatibility_date = 2025-09-01` e `nodejs_compat`. Sem publicação ou alteração do build do produto.

| Compilação | Bytes do JS | Bytes gzip local |
|---|---:|---:|
| `rodada-01`, sem `--minify` | 17.035.908 | 3.418.954 |
| `rodada-02-minificada`, com `--minify` | 8.099.146 | 2.798.266 |
| `rodada-04-leitor-pdf`, com `--minify` e correção do leitor empresarial | 8.099.878 | 2.798.537 |

A rodada 04 executou os 14 checks do smoke completo e exportou dois DOCX; ver `RUNTIME-CLOUDFLARE.md`. A equivalência entre a versão inicial e a corrigida não é alegada: o leitor empresarial mudou para contornar a falha constatada. Os 20 protegidos permaneceram iguais.

Os dois metafiles listam os mesmos 45 nomes de inputs do produto. Isso não comprova os hashes dessas fontes durante os builds antigos. Os 45 arquivos estáticos das rodadas iniciais foram selecionados pelas mesmas listas; essa seleção foi depois corrigida por conter um histórico privado. Ambos os builds saíram com código zero e sem stderr. Os 20 protegidos mantiveram seus hashes. A comparação registra tamanhos dos bundles e igualdade dos nomes de inputs; a captura de hashes corrigida da rodada 03 é posterior à compilação. Equivalência funcional do bundle minificado depende do smoke, ainda sujeito a revisão prévia da coordenação.

A [documentação pública do compilador Pages Functions](https://github.com/cloudflare/workers-sdk/blob/main/packages/pages-functions/README.md) define minificação como opção booleana, desligada por padrão. Consulta via Context7 utilizou somente termos públicos.

Verificação no Wrangler **instalado** 4.151.1, sem executar deploy:

- `wrangler-dist/cli.js`, bloco `pagesFunctionsBuildCommand`, perto da linha 305715: `minify` booleano, padrão `false`.
- `buildFunctions`, perto da linha 305483: parâmetro `minify = false`.
- Chamada por `pages deploy`, perto da linha 306796: não passa `minify` ao compilar a pasta `functions`.

Não é prova do comportamento da etapa gerenciada do Git/CI, nem do limite do plano remoto, de CPU ou de inicialização. O painel remoto, auditado separadamente pela coordenação, mostra Workers Free. A medida gzip local deve ser confrontada ao mecanismo de empacotamento efetivo; não se conclui falha de deploy apenas a partir da rodada não minificada.

Proposta mínima futura: tornar explícita a minificação oficial do bundle completo no mecanismo de build aprovado, preservar `/api/*`, ASSETS, data/flags e usar o bundle exato homologado. A integração precisa evitar que o serviço recompilhe a pasta `functions` sem minificar; qualquer uso futuro de artefato `_worker.js`/modo avançado requer revisão própria. **Nenhum script global, wrangler.toml, plano, billing, import ou handler foi alterado nesta tarefa.**
