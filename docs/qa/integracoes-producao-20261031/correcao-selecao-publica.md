# Correção da seleção de dados públicos

Data: 31/10/2026 UTC. Escopo autorizado: corrigir o empacotamento local do Cloudflare Pages sem publicar, alterar o histórico por destinatário ou executar robôs.

## Problema e alteração

`scripts/montar_publico.js` copiava `data/` recursivamente. Isso incluía qualquer JSON ou subdiretório adicionado à origem, inclusive `editais_vistos.json`, que não pertence ao pacote público. A reprodução foi feita somente com conteúdo fictício. Esta prova não demonstra que o histórico real esteja exposto atualmente; a URL correspondente não foi consultada.

A cópia passou a usar uma seleção explícita de cinco arquivos, com os nomes confirmados por inventário de caminhos:

- `capag-municipios.json`
- `convenios.json`
- `sistema_s_am.json`
- `mercado_meta.json`
- `contratos_meta.json`

O nome existente é `capag-municipios.json`, não `capag.json`. A função exportada `arquivosDeDados()` retorna uma nova lista a cada chamada e foi combinada com o responsável pelo preparo isolado de Cloudflare, para evitar duas seleções divergentes.

As assinaturas de `montarPublico()` e `arquivosDaRaiz()` foram preservadas. Não houve troca de `build:cloudflare`, alteração da seleção dos arquivos da raiz, mudanças em CI, instalação ou publicação. Um arquivo público obrigatório ausente causa falha de cópia e interrompe o comando; não existe fallback para copiar toda a pasta.

## Prova RED/GREEN

Teste novo: `scripts/montar_publico_dados.test.js`.

O teste copia somente o código do builder para uma fixture temporária. Cria os cinco JSON públicos fictícios, um histórico fictício, um JSON privado futuro, um subdiretório privado e um resíduo de histórico na saída anterior. O destino resolvido é validado como filho da fixture; a limpeza valida a raiz temporária e seu prefixo antes de remover. Não executa `montarPublico()` no worktree real nem lê o histórico real.

Antes da correção, os dois testes falharam:

1. Histórico, futuro JSON privado e subdiretório privado apareciam em `publico/data`.
2. Ausência de um arquivo público obrigatório não interrompia o build.

Depois da correção, **15 testes passaram**: os dois novos, três do builder existente e dez de integração CAPAG. A prova exige os cinco arquivos copiados byte a byte, exclusão de todos os desconhecidos/subdiretórios, remoção do resíduo da saída fictícia e histórico de origem fictício intacto. As páginas e `_headers` continuam copiados.

Comandos executados:

```powershell
node --test scripts/montar_publico_dados.test.js
# RED: exit 1, duas falhas esperadas; selecao-publica-red.log

node --test scripts/montar_publico_dados.test.js scripts/montar_publico.test.js scripts/capag.test.js
# GREEN: exit 0, 15/15; selecao-publica-green.log

node node_modules/eslint/bin/eslint.js scripts/montar_publico.js scripts/montar_publico_dados.test.js
node node_modules/@biomejs/biome/bin/biome check scripts/montar_publico.js scripts/montar_publico_dados.test.js --diagnostic-level=error
node --check scripts/montar_publico.js
node --check scripts/montar_publico_dados.test.js
git diff --check -- scripts/montar_publico.js scripts/montar_publico_dados.test.js
```

ESLint, Biome, sintaxe e diff check terminaram com exit 0. O gate geral fica com a coordenação após as demais integrações; não foi repetido por este subagente.

## Arquivos e integridade

| Arquivo | SHA-256 após a correção |
|---|---|
| `scripts/montar_publico.js` | `e7cffcbee709fdb92f484d0acd0cbfd10179b0c102cdee5588f09372fa99df9f` |
| `scripts/montar_publico_dados.test.js` | `68838f82644190d2965402f0fb88e41bfd4b8583a7a66842cf9958fe2310e09a` |

O histórico original não foi aberto, movido ou alterado por esta tarefa. Robô, resumo, e-mail, autenticação, modelos e Functions ficaram fora das alterações. Não foi recriada a pasta `publico/` do projeto. O rollback de código é a reversão deste diff local; nenhuma operação remota precisa ser revertida.

## Limites

Esta correção limita os arquivos de `data/` no builder Cloudflare existente. Novos dados públicos exigem inclusão deliberada na seleção e nova revisão. O Netlify ainda tem configuração própria de publicação da raiz; ela não foi alterada nem executada. Esta tarefa não certifica esse caminho alternativo, o conteúdo semântico dos cinco JSON ou o estado de produção.
