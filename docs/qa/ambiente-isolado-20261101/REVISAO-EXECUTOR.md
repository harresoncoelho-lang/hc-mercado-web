# Revisão do executor de inventário privado

Revisão independente em 01/11/2026, com Ponytail Review. O pacote extrai somente o índice e o esquema de um dump fictício em um runner GitHub. Não inicia PostgreSQL nem executa o SQL extraído. A revisão não executou Docker, upload, workflow, conexão privada, alteração de produto ou configuração de cobrança.

**Veredito de especificação e qualidade: aprovado para o inventário manual privado delimitado abaixo. Nenhum defeito bloqueante encontrado.** A aprovação está vinculada aos hashes desta revisão, aos seis arquivos exatos e à conferência do repositório/custo antes do disparo. Não constitui validação de restauração, migração, capacidade ou execução remota concluída.

## Identidade revisada

Manifesto `executor/package-manifest.json`, SHA-256 recalculado:

`61012be856b4b1d9b5ccba2cce2103e7e380cea13eb47b665b45c5e7bf63446f`

| Arquivo permitido no repositório remoto | SHA-256 conferido |
|---|---|
| `.github/workflows/inventario.yml` | `38089712999ae1c6f9a59a8e8b1a9ad32578306fc0c06f437f8610753d2fa490` |
| `inventory.py` | `c185d8950c2e71fe70a51c4d73022918eb83187bb23cfdf8e598d28a4bba4cdc` |
| `test_inventory.py` | `e81d68f5442e23b530dc009ff4a815dcb3873499cf0d9ea6f77e24df2b332eb1` |
| `README.md` | `4e50e1eade5837de4bc79cf725986782f97ddc109eb227ccd7754c7f2c8b383a` |
| `package-manifest.json` | `61012be856b4b1d9b5ccba2cce2103e7e380cea13eb47b665b45c5e7bf63446f` |
| `input/ficticio.dump` | `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c` |

Os cinco arquivos de código/documentação/manifesto existem no diretório de preparação e conferem. O dump ainda não foi copiado para `executor/input/`. Foi conferido diretamente na origem autorizada `C:/Users/harre/AppData/Local/LicitaPlena/supabase-homologacao/antes-correcao-acl-20261031T022043Z.dump`: **505.274 bytes e hash acima**, lendo bytes apenas para tamanho e SHA-256. A revisão não interpretou seus dados.

`executor/revisoes/antes-bind-pgdata-20261101.zip` não está na allowlist. Não enviar a pasta inteira: ZIP, este relatório e quaisquer outros arquivos também ficam fora do repositório remoto. Recalcular hashes da seleção efetivamente enviada e conferir o commit remoto antes de executar; o manifesto não assina a si mesmo.

## Fluxo conferido

| Requisito | Evidência no pacote |
|---|---|
| Um ensaio manual e limitado | Somente `workflow_dispatch`, repositório privado exigido no job e no script, `timeout-minutes: 5`, concorrência de uma execução, sem cron, trigger de push ou retentativa automática. |
| Sem credenciais adicionais | `contents: read`, checkout com SHA fixado e `persist-credentials: false`, nenhum secret/variável de serviço fornecido ao processo. O token interno necessário ao checkout não é passado ao container. |
| Seleção fechada | `git ls-files` precisa coincidir com os seis nomes. O conteúdo listado é validado antes do pull; symlinks de arquivo, hash e identidade/tamanho do dump são recusados quando divergentes. |
| Interpretação contida | `docker create` com `--network none`, raiz read-only, usuário `65534:65534`, `--cap-drop ALL`, `no-new-privileges`, IPC none, 64 processos, 256 MiB e uma CPU. Sem portas, socket Docker ou env do host montados. |
| Dois mounts, ambos read-only | Bind da entrada em `/input` e bind vazio em `/var/lib/postgresql/data`. O inspect prévio exige exatamente esses dois mounts, tipo bind, origem/destino exatos e `RW=false`; volume anônimo extra causa falha antes do start. |
| Sem banco ou SQL executado | O entrypoint da imagem é substituído por `pg_restore`; somente `--version`, `--list` e `--schema-only --file=-`. Não há `--dbname`, servidor, `--clean`, supressão de ownership/ACL/comentários ou comando posterior de execução do SQL. |
| Evidência sem conteúdo nos logs | Saídas dos subprocessos vão para arquivo/PIPE; falhas imprimem categoria sanitizada, sem stderr. Sucesso imprime status, contagem e hash. O upload seleciona apenas report, TOC e esquema, com retenção de um dia. |
| Falhas interrompem | Erro de comando, timeout, isolamento, versão, contagem ou origem causa exit 1. Container criado é removido em `finally`; o job não repete a extração automaticamente. |

O runner precisa de rede para checkout, pull da imagem e artefato. **A ausência de rede vale para o container que interpreta o dump**, não para toda a VM. A documentação Docker distingue a raiz read-only dos mounts e permite verificar `Mounts[].RW`; a guarda foi conferida com essa distinção. [Docker volumes](https://docs.docker.com/engine/storage/volumes/) e [docker create](https://docs.docker.com/reference/cli/docker/container/create/).

Na forma usada, `pg_restore` produz texto SQL sem conectar a um banco. Esse texto deve continuar privado e ser revisto antes de qualquer execução posterior; ownership, ACL e corpos de funções não são eliminados para fazer o ensaio passar. [PostgreSQL 17 — pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).

## Imagem OCI conferida independentemente

Consulta pública ao Registry Docker, sem Docker local, sem download de layers e sem conteúdo do projeto nas requisições:

- Manifesto fixado `linux/amd64`: `sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3`. O Registry retornou esse mesmo digest.
- Config referenciado: `sha256:567d5d704a3e5a4864393b623a0d50eb1b5a4ad134cdac7cf19555cb2d8ffe9e`. Foram lidos 10.139 bytes e o SHA-256 calculado corresponde ao digest.
- Config: Linux/amd64; `PG_VERSION=17.6-2.pgdg12+1`; entrypoint original `docker-entrypoint.sh`, comando original `postgres`; **VOLUME `/var/lib/postgresql/data`**.
- O pacote sobrescreve explicitamente entrypoint/comando e cobre esse VOLUME com o segundo bind read-only. Assim não depende de `--read-only` para neutralizar sozinho um volume declarado pela imagem.

Não foram executadas as flags em Docker nesta revisão. A prova operacional virá do inspect e do exit code da rodada remota. O pin valida a identidade da imagem usada; não transforma o runner Ubuntu, Python ou Docker fornecidos pelo GitHub em componentes imutáveis.

## Testes executados

Com o Python existente, sem bytecode, Docker ou instalação de dependências:

`python.exe -B -m unittest -v test_inventory.py`

**6 testes passaram em 0,018 s**, cobrindo guarda remota antes de subprocessos, evento manual/repositório privado, allowlist e adulteração, falha fechada de rede/raiz/mounts, argumentos sem conexão ou supressão de ACL e contagem de entradas TOC. Foram usados arquivos fictícios temporários; nenhum dump foi interpretado pelos testes.

## Condições de execução e limites remanescentes

1. A coordenação deve conferir o repositório privado separado, os seis arquivos e hashes remotos, a franquia e o bloqueio de cobrança existentes imediatamente antes do disparo. Não alterar limites de cobrança para superar bloqueio. O requisito de cartão/autorizar excedentes encontrado no Cloudflare não é necessário para este inventário GitHub e continua pendente separadamente.
2. Após êxito, guardar os três artefatos em evidência privada antes do prazo de um dia e conferir TOC/esquema pelos hashes do relatório. O relatório incorpora a versão textual do cliente; `version.txt` é intermediário e não está no upload. O dump versionado não é apagado pelo prazo de retenção do artefato.
3. A guarda espera cliente/origem 17.6 e 812 entradas. Uma divergência ou timeout exige diagnóstico, sem suavizar verificação nem chamar falha de sucesso parcial.
4. Não verificados aqui: conteúdo do esquema, execução no runner, disponibilidade/quota no instante futuro, TOC atual extraído, compatibilidade das extensões, restauração de dados/roles/ACL/Storage, UI autenticada ou CPU Cloudflare. A revisão estática e os seis testes não comprovam essas etapas.

**Veredito final: pode seguir com o pacote exato para o inventário privado autorizado, após os gates de transferência/custo. Não há correção de código exigida por esta revisão.**
