# Revisão independente do executor V2

01/11/2026. O pacote permanece restrito ao inventário privado do dump fictício. A V2 troca a expectativa de origem/cliente para **17.11** e conserva diagnósticos mesmo quando a extração falha. Não inicia servidor nem executa SQL.

**Veredito: aprovado para o pacote exato abaixo, sem defeito bloqueante encontrado.** Não foram executados Docker, job remoto, upload, SQL ou conexão privada nesta revisão. Foram executados somente os oito testes leves e consultas públicas de identidade OCI.

## Correção da premissa de versão

A coordenação informou falha `source_version` no primeiro run `41338100692`. A evidência sanitizada `executor/revisoes/cabecalho-dump-20261101.json` registra leitura limitada aos primeiros 512 bytes, magic PGDMP, hash desse prefixo e duas strings **17.11**. O dump continua com os mesmos 505.274 bytes e SHA-256; estes foram reconferidos nesta revisão.

A referência anterior a origem fictícia 17.6 estava errada. Esta revisão substitui essa premissa do parecer V1; não trata a alteração como mudança do dump nem como motivo para remover a guarda. O run V2 deverá confirmar **cliente, versão de origem e pg_dump 17.11** a partir de `version.txt` e dos campos próprios do TOC. Produção é uma referência separada; não se pode usar essa correção para afirmar equivalência de versões ou restauração de produção.

## Identidade exata aprovada

| Arquivo | SHA-256 recalculado |
|---|---|
| `package-manifest.json` | `0ef9542dc690dda39184e4dd9e23cef6ebc4bc1b4bb300e89d183e2c6a864994` |
| `.github/workflows/inventario.yml` | `a5ae9a0d9f4ec7347aa13a4fcccc22433700bbb44cccd9f382faace31fc95720` |
| `inventory.py` | `2f935197b884a938b3bba9043fb403d9777e53c8c29c889ad5ea14ab5b1142e5` |
| `test_inventory.py` | `a9bb6dd73fa155bcedc8ea6d1f1800909df50ada0653ae3e8c5048f1265d98ce` |
| `README.md` | `3daa259cb5cd808b17343348d2dc74727fc4427b71569fcaf975061c84b15df2` |
| `input/ficticio.dump` | `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c` |

Todos existem e conferem. A frase do README de que o sexto arquivo ainda não está copiado descreve uma etapa anterior: nesta revisão `input/ficticio.dump` já está presente e validado. Isso não muda a seleção de upload. Somente esses seis arquivos entram no repositório remoto; os ZIPs e a evidência do cabeçalho permanecem fora dele.

## Isolamento e falhas

- Mantidos evento manual, repositório privado, permissões `contents: read`, concorrência de uma execução e timeout de cinco minutos. Checkout/upload continuam fixados em commits; nenhum secret, cache, dependência instalada, trigger de push, cron ou repetição automática foi acrescentado.
- Mantida a validação de nomes/hashes/tamanho antes do pull. O mesmo dump e as mesmas 812 entradas são exigidos; divergência interrompe.
- Mantidos `--network none`, raiz read-only, usuário não privilegiado, capabilities removidas, `no-new-privileges`, IPC none e limites de CPU/memória/processos. O inspect anterior ao start continua exigindo os dois binds exatos read-only; volume adicional, origem/destino incorretos e mount gravável são recusados.
- Mantido `pg_restore` como entrypoint, sem servidor, `--dbname`, execução do SQL ou supressão de ownership/ACL/comentários. A rede necessária a checkout/pull/upload pertence ao runner, não ao container que interpreta o dump.
- `version.txt` é validado antes do TOC; cliente/origem/pg_dump/contagem são validados antes de extrair `schema.sql`. Erro conhecido de versão deixa evidência e impede a extração seguinte.
- O relatório nasce antes do pull, é atualizado por fase e regravado em `finally`. Em falha contém status, fase, categoria sanitizada, versões estritamente numéricas, contagem e hashes/tamanhos. Não incorpora conteúdo de funções, stderr, credenciais ou texto arbitrário do cabeçalho.
- Arquivo parcial permanece com hash/tamanho, `status=failed` e sem uma execução concluída correspondente; não é promovido a evidência de sucesso. Não houve inclusão de conteúdo sensível nos logs para compensar o diagnóstico perdido na V1.
- `always()` tenta preservar somente os quatro caminhos fixos: report, versão, TOC e esquema. `if-no-files-found: warn` admite ausência anterior à criação de evidência; não transforma uma etapa de extração/testes que falhou em sucesso do job. Retenção continua em um dia.

## Imagem oficial: conferência independente

Foi consultado somente o Registry público Docker, sem iniciar Docker nem baixar layers. Os bytes retornados tiveram seus hashes recalculados:

- Manifesto Linux/amd64: `sha256:2cd2c0f809604aaeff6f0ec8f40aecbd025613107561015c69369a1a7f1d3416`.
- Config: `sha256:99445113a4a19e82dd3713c65bd9f6fb5bf972065ab043df8d1e1c93e957da9a`, 10.132 bytes.
- `PG_VERSION=17.11-1.pgdg12+2`; entrypoint original `docker-entrypoint.sh` e comando `postgres`, sobrescritos pelo executor.
- VOLUME declarado `/var/lib/postgresql/data`, coberto pelo bind vazio read-only já revisado.

Essa conferência identifica a imagem fixada, não comprova execução de `pg_restore`, compatibilidade de extensões Supabase ou comportamento do servidor. A expectativa 17.11 não deve ser relaxada se o runtime retornar outra versão.

## Testes e limites

`python.exe -B -m unittest -v test_inventory.py`: **8 testes passaram em 0,090 s**. Além das guardas anteriores, a suíte cobre extração apenas de versão numérica e seis cenários de relatório: sucesso, cliente divergente, origem divergente, pg_dump divergente, contagem divergente e esquema parcial. Verifica ausência do texto SQL secreto fictício no JSON, hashes dos arquivos e bloqueio do esquema após divergência de TOC/versões. As operações Docker foram substituídas por doubles nos testes.

Não foram comprovados nesta revisão: êxito do job, TOC real atual extraído, conteúdo do esquema, restauração, ownership/ACL efetivamente restaurados, bytes do Storage, UI autenticada ou capacidade Cloudflare. `always()` não garante artefato após término abrupto do runner, timeout total ou falta de espaço; o README registra esse limite. Arquivos/JSON podem ficar incompletos nessas condições e exigem diagnóstico.

Antes do próximo run, a coordenação deve atualizar o workflow pela via autorizada, conferir hashes/commit remoto e adequar as guardas do uploader V1 aos hashes V2; a revisão do uploader antigo não autoriza ignorar suas divergências. Reconferir a franquia e preservar o bloqueio de cobrança. Após o run, arquivar o artefato privado e validar os hashes antes de qualquer uso do SQL extraído.

**Pode seguir com a transferência revisada e um disparo manual do inventário V2; não há autorização ou prova de restauração implícita neste parecer.**
