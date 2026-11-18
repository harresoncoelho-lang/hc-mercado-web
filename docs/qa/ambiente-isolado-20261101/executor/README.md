# Inventário remoto do backup fictício

Pacote V2 para revisão em 01/11/2026, ainda não enviado nem executado. A V1 foi executada uma vez no run privado `41338100692`: seis testes passaram e o inventário parou na guarda `source_version`. O diagnóstico limitado aos primeiros 512 bytes do dump confirmou duas strings de versão **17.11**, identidade que passa a ser exigida na V2. Este ensaio somente extrai o índice e o esquema do arquivo: **não inicia banco, não executa SQL e não comprova restauração**.

## Conteúdo exato

O repositório remoto deverá ser novo, privado, sem integrações, secrets, variáveis de serviço, deploys ou outros workflows. Os únicos seis arquivos versionados são:

- `.github/workflows/inventario.yml`
- `inventory.py`
- `test_inventory.py`
- `README.md`
- `package-manifest.json`
- `input/ficticio.dump`

O sexto arquivo não está copiado neste diretório de preparação. A coordenação deverá adicionar somente a cópia byte a byte do dump fictício autorizado, com 505.274 bytes e SHA256 `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c`. Não incluir nenhum outro backup, `.env`, credencial, log, PDF real ou arquivo do produto. A lista e os hashes são validados antes de baixar a imagem. O manifesto não inclui seu próprio hash; seu hash externo integra a revisão de entrega.

## Execução autorizável após revisão

Confirmar repositório privado e conteúdo, franquia Actions/armazenamento e bloqueio de cobrança adicional da conta; preservar o orçamento existente. Depois, um único disparo manual pela interface Actions. Sem cron, push trigger, cache, secrets ou instalação de dependências Python. Timeout de cinco minutos e concorrência de uma execução. A preparação não liga Docker nesta máquina; o script recusa execução fora de GitHub Actions e exige evento manual de repositório privado.

O runner baixa uma imagem oficial fixa e, em seguida, cria containers individuais exclusivamente com `pg_restore` como entrypoint. Antes de iniciá-los, verifica pelo Docker inspect rede `none`, filesystem raiz somente leitura, usuário não privilegiado e capacidades removidas. Exige exatamente dois mounts do tipo bind, com origens e destinos conhecidos e ambos somente leitura: a entrada em `/input` e um diretório vazio criado pelo runner em `/var/lib/postgresql/data`. O segundo sobrescreve explicitamente o VOLUME declarado pela imagem, evitando um volume anônimo gravável. Há limites de memória/CPU/processos; os containers são removidos ao terminar. Nenhuma porta ou socket Docker é montado. Nenhuma variável/credencial do host é passada ao container. Checkout e upload do artefato usam a rede do runner; a contenção sem rede aplica-se ao processo que interpreta o dump, não ao runner inteiro.

Comandos de inventário: `pg_restore --version`, `pg_restore --list /input/ficticio.dump` e `pg_restore --schema-only --file=- /input/ficticio.dump`. Sem `--dbname`, servidor, `--clean`, `--no-owner`, `--no-acl` ou `--no-comments`. O esquema preserva comentários, ownership e ACL para análise; não contém dados das tabelas, mas pode conter corpos de funções e literais, portanto continua **privado**, não deve ser colado em logs públicos nem executado antes de revisão.

O log mostra somente status, contagem, categoria de erro e hash. O relatório privado é escrito antes da extração, a cada fase e também na falha; inclui somente versões numéricas do cabeçalho/cliente, status, configurações verificadas, contagens e hashes/tamanhos dos arquivos gerados. Não inclui conteúdo de funções. O upload usa `always()` e preserva os arquivos já gerados entre `report.json`, `version.txt`, `toc.list` e `schema.sql`, com retenção de um dia. Uma divergência de versão/TOC bloqueia a extração do esquema. Uma falha durante a extração conserva o arquivo parcial e seu hash, sem apresentá-lo como completo. Falhas anteriores à criação do diretório de evidência podem não gerar artefato; timeout total ou encerramento do runner também pode impedir o upload. Não há garantia de preservação sob encerramento abrupto.

Baixar e arquivar os arquivos em evidência privada antes da expiração; conferir os hashes do relatório. O dump fictício permanece no repositório privado até uma decisão explícita de remoção; retenção do artefato não apaga arquivos versionados. Falhas interrompem o job sem retentativas automáticas. Não imprimir stderr de Docker/pg_restore, que pode conter detalhes do esquema.

## Proveniência e limites

Consulta pública ao Registry Docker em 01/11/2026: tag oficial `postgres:17.11-bookworm`, índice `sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5`, manifesto `linux/amd64` fixado em `sha256:2cd2c0f809604aaeff6f0ec8f40aecbd025613107561015c69369a1a7f1d3416`. O job exige cliente, origem e pg_dump **17.11**, além de 812 entradas; divergência exige diagnóstico. Isso verifica a leitura do arquivo com o cliente oficial; **não demonstra compatibilidade das extensões Supabase com um servidor vanilla**. A versão da origem fictícia é estabelecida pelo próprio arquivo e não deve ser confundida com a versão observada em produção.

O config OCI `sha256:99445113a4a19e82dd3713c65bd9f6fb5bf972065ab043df8d1e1c93e957da9a`, consultado diretamente no Registry sem Docker local, confirma o VOLUME `/var/lib/postgresql/data`. A V1 executada, com seus seis arquivos, está preservada em `revisoes/pacote-v1-run-41338100692.zip`; a prova sanitizada da leitura limitada está em `revisoes/cabecalho-dump-20261101.json`. A versão anterior à correção do volume também permanece em `revisoes/antes-bind-pgdata-20261101.zip`. Esses arquivos não pertencem à allowlist remota e não devem ser enviados. A V1 não preservou TOC/esquema no artefato porque seu upload dependia de sucesso; a V2 corrige essa perda diagnóstica sem reduzir as guardas.

Actions fixadas em commits confirmados pela API GitHub: checkout v4.2.2 e upload-artifact v4.6.2. O runner `ubuntu-24.04`, Python e Docker do runner são fornecidos pelo GitHub e não constituem uma imagem de runner imutável; a interpretação do dump ocorre na imagem Postgres fixada. Não há dependências pip/npm instaladas.

Referências: [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [imagem oficial PostgreSQL](https://hub.docker.com/_/postgres), [checkout v4.2.2](https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683), [upload-artifact v4.6.2](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02).

Próximo gate: revisar índice, extensões, roles, ACLs e funções extraídas; preparar servidor compatível vazio, preservar ownership/ACL e comparar o restore com a baseline fictícia. Não misturar o resultado deste inventário com migração, restauração de bytes Storage, homologação autenticada, capacidade Cloudflare ou recuperação de produção.
