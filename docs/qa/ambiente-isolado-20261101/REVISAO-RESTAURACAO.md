# Revisão independente da restauração fictícia

Data: 01/11/2026. Escopo desta revisão: contenção do container, workflow, preservação das evidências e uploader. O parecer independente sobre SQL, roles, comparador e atomicidade está a cargo da outra frente de revisão. Nenhum Docker, SQL, upload ou job remoto foi executado nesta revisão.

## Parecer do candidato inicial

**Corrigir a preservação dos diagnósticos antes da rodada.** Não encontrei bloqueio de segurança na contenção declarada nem na lógica do uploader. A correção necessária é focal: uma falha de inicialização ou timeout atualmente pode destruir a única evidência da causa. O candidato corrigido precisa de conferência por diff e novos hashes antes do envio.

### 1. A remoção do container pode apagar a causa da falha

Em `executor/restauracao/restore.py`, `START` redireciona a saída do initdb para `/qa/initdb.log`. A espera de inicialização, nas linhas 196–205 do candidato inicial, lança somente `server_start` ou `server_timeout`; o `finally`, nas linhas 258–269, remove o container e seu tmpfs sem capturar esse arquivo ou `docker logs`. Além disso, a fase permanece `image_pull` durante a inicialização. Assim, uma falha real de initdb/PostgreSQL deixa apenas uma categoria genérica, atribuída à fase errada, e não permite explicar a causa depois da rodada.

Na mesma rotina, `command()`, linhas 169–178, grava stdout/stderr somente depois de `subprocess.run()` retornar. `TimeoutExpired` pula essa gravação, inclusive durante o pg_restore, perdendo a saída parcial que o Python entrega na exceção.

Correção mínima: registrar a fase real; preservar stdout/stderr parciais de timeout; capturar diagnósticos de inicialização limitados, apenas em artefatos privados, antes da remoção. A coleta de diagnóstico deve ser limitada no tempo e não impedir a limpeza. Manter rede, mounts, credenciais, restore e tratamento de erro inalterados; não acrescentar repetição automática. Acrescentar teste de falha/timeout que prove a preservação da evidência.

## Contenção e execução conferidas

- Workflow exclusivamente manual, condicionado a repositório privado, `contents: read`, checkout com SHA fixo e `persist-credentials: false`. Timeout total de dez minutos; mesmo grupo de concorrência do inventário, sem cancelar a execução existente. Não há push trigger, publicação, chave nova ou alteração de cobrança.
- Container com rede `none`, sem porta publicada, filesystem raiz somente leitura, usuário Linux `postgres`, todas as capabilities removidas e `no-new-privileges`. Um único bind de entrada, somente leitura; `/qa` e `/tmp` em tmpfs. Memória, CPU e processos limitados no comando. Sem socket Docker, credenciais ou diretórios do host montados no banco.
- Entry point original substituído: não executa o bootstrap/migrações automáticas da imagem. PostgreSQL escuta somente no Unix socket interno; autenticação de host rejeitada. O trust local fica restrito ao container isolado. O superuser SQL não equivale a root do host.
- Metadados públicos do manifesto e config OCI foram conferidos sem baixar layers. Digest do manifesto: `e85bc10ac5b141223b289e1e8dc8d448cf3df92501917149db0366b9c5aaf053`; config: `c4be96218454e68421a29c712e1a83c7a9fe186208c725d8bb2ebb474e2042f2`. Linux/amd64, **sem VOLUME declarado**, 29 camadas e 367.717.338 bytes comprimidos. `ExposedPorts: 5432/tcp` é metadado da imagem; o comando não publica a porta. A identidade com o image ID histórico local não foi demonstrada e está corretamente limitada no README.
- Arquivos de entrada, dump e baseline têm guardas de identidade e hashes. Relatório inclui hashes/tamanhos dos artefatos produzidos. Upload é somente de `evidence-restore/`, em artefato privado por um dia. Nenhuma senha de role ou credencial de serviço é copiada. Os artefatos de esquema/roles são privados e não devem ser promovidos a materiais públicos.
- Limites de dez minutos, 120 segundos por subprocesso e cleanup não provam duração real nem ausência de custo por si. A coordenação deve reconfirmar franquia e bloqueio de gasto adicional antes do disparo. Um encerramento abrupto do runner pode impedir `finally` e upload; o README declara esse limite. Nenhum teste de capacidade Cloudflare foi feito ou autorizado por este parecer.

## Verificações locais e limites de comparação

Cinco testes estáticos passaram (`python.exe -B -m unittest discover -s restauracao -p test_restore.py -v`, 0,003 s), sem inicializar Docker ou banco. Foram conferidos o bloqueio fora do runner, baseline, roles sem senha, diferenças de esquema/ACL e guardas de contenção.

Foi reproduzida a normalização a partir exclusivamente de `antes-correcao-acl-20261031T022043Z.json`, SHA256 `f7a111357f7db4af3e849c8ffdba69e6e63ef409cee98c403e2ff70b87b95419`: os 40 fingerprints, roles, memberships por nomes, default ACLs e kit são iguais à baseline candidata. O esquema do inventário validado contém 744 seções e 68 funções. Isso verifica a derivação da baseline, não a restauração ainda não executada. A revisão aprofundada do SQL está separada.

Permanecem explícitos: sem baseline de dados das 27 tabelas Auth; sem restauração dos bytes de Storage; sem Auth/Storage HTTP, login da aplicação, SMTP ou integrações de produção. A rodada não comprova backup completo de produção, RPO/RTO, capacidade comercial ou SaaS homologado.

## Uploader

`enviar-restauracao-privada.ps1` foi comparado estruturalmente com o uploader V2 anteriormente aprovado. Parser PowerShell: zero erros. Não foi executado.

A lógica mantém token apenas no processo, restaura o ambiente, valida conta/repositório privado e permissões existentes, faz guarda de HEAD, confere blobs imutáveis e atualiza a referência sem force. Só quatro payloads novos são enviados; o resultado exige exatamente onze arquivos e preserva sete objetos já remotos, inclusive o workflow criado separadamente pela UI. O HEAD placeholder bloqueia antes da autenticação. Não dispara o workflow nem amplia permissões.

**Sem bloqueio encontrado no uploader revisado.** A substituição do placeholder pelo commit UI real e os hashes decorrentes da correção de diagnóstico ainda precisam de conferência antes de usá-lo. Não se aprova envio de um candidato alterado apenas com base neste hash anterior.

## Identidades examinadas

| Arquivo | SHA256 do candidato inicial |
| --- | --- |
| `executor/.github/workflows/restauracao.yml` | `2b2e01c82652e4f5ea868ee688946a42c3c31800621d21605f570f093baef08f` |
| `executor/restauracao/restore.py` | `fdcba16657de03b7189866c47cd7398d22ae4bd9a04a0e10c9eec979a985321b` |
| `executor/restauracao/test_restore.py` | `86b0d42e33c2a12c2b6c3ac07ce1e465dee833517ef67dc02b5371f9612359dd` |
| `executor/restauracao/baseline.json` | `43b87aceb61497dd9f1f28ac8538d7d4e93752f8415c60ea47f3100dca0485e0` |
| `executor/restauracao/README.md` | `395e37600028e2cc501ed0b9045ccf89e5bbb59c032342928204ce63291722cd` |
| `enviar-restauracao-privada.ps1` | `490c224db0758207b5d8b9fd50936db3467226ba2b1562f13ffeeb556bf33374` |

Fontes públicas consultadas para a imagem: [Dockerfile da versão](https://github.com/supabase/postgres/blob/17.11.0.004/Dockerfile-17) e metadados OCI do registro público ECR. Sem consulta a outro backup ou alteração de candidatos.

## Adendo — V2 e uploader com HEAD real

**Aprovado no escopo desta revisão. O bloqueio de diagnóstico foi resolvido.** A execução permanece com a coordenação, após conferir a franquia/bloqueio de custo e o parecer SQL separado; este adendo não afirma que a restauração já ocorreu.

Conferido o diff focal `executor/revisoes/restauracao-v1-v2-diagnostico.diff`, SHA256 `0fb6508006054f22d65b1dbcd45edc0b55d4434d8b03d2f1188d10573707b477`, e os arquivos reais contra a V1 preservada no ZIP local. `create_command`, `verify_container`, funções SQL e comparadores permanecem byte a byte iguais. O comando de inicialização acrescenta somente a emissão do log do initdb ao stderr do container quando o initdb falha, antes da saída. Isso preserva a causa nos logs Docker mesmo se o processo já terminou e perdeu seu tmpfs.

`run_captured()` grava stdout/stderr parcial em `TimeoutExpired` e registra que a captura é incompleta. `capture_diagnostics()` recolhe logs Docker e initdb antes da remoção: até 100 linhas do log Docker, no máximo 65.536 bytes salvos por stream e timeout de dez segundos para cada tentativa. Erro/timeout de diagnóstico é registrado e não impede tentar o diagnóstico seguinte ou executar o cleanup. As fases de criação, inspeção, inicialização e prontidão agora estão explícitas. Não há retry, mudança de rede/mounts, senha, publicação ou flexibilização do restore.

Os oito testes estáticos passaram nesta revisão (0,029 s), incluindo saída parcial em timeout, initdb falho com container parado e continuidade da coleta de diagnóstico após timeout. Nenhum Docker ou SQL foi executado. O README real está em UTF-8 legível, mantém os limites de Auth/Storage e acrescenta a ausência de comparação do valor da sequência Auth; o diff textual salvo apresenta caracteres mal decodificados apenas na representação do README, por isso a conferência usou também os bytes reais.

| Arquivo final | SHA256 |
| --- | --- |
| `executor/restauracao/restore.py` | `61c63c53a6ba71dfbd2139ab7d5aaecb4474fd0cd0ccb43700b1c6906510678f` |
| `executor/restauracao/test_restore.py` | `acc22af0b0912a04dcafdb0d5d1abded2711dbb3987f70174bf02122a830daad` |
| `executor/restauracao/README.md` | `a0da1b7fe7dee75e8ed1832976eb6816f3e8496ee19149d47423fe1738b3f964` |
| `enviar-restauracao-privada.ps1` | `193b3c763e52829b71de1057b5832c8024e0262bd22ce48f3bee7080d445b120` |

Workflow e baseline conservam os hashes da tabela inicial. O uploader final foi conferido por diff direto com a V1 preservada: somente os três hashes dos arquivos alterados e `$expectedHeadSha` mudaram. O HEAD agora é `0196a317f0828a560a1f47d880cf5ad9e8ee08dd`, informado pela coordenação como commit UI do workflow; a guarda remota antes da escrita continua obrigatória. Parser PowerShell: zero erros. Mantidos quatro payloads, onze arquivos finais, sete objetos imutáveis, token restrito ao processo, nova conferência de HEAD e atualização sem force. Não executado nesta revisão.

## Adendo — V3: bibliotecas pelo carregador real

**Guarda V3 aprovada.** Revisão focal após a rodada `41341452270`, que, conforme evidências entregues pela coordenação, iniciou PostgreSQL 17.11, parou antes do restore no teste de arquivo baseado em `pg_config --pkglibdir` e removeu o container. A falha anterior não identificava qual dos dois arquivos não estava no caminho testado; não demonstra ausência das bibliotecas na imagem.

A [fonte oficial da mesma tag](https://github.com/supabase/postgres/blob/17.11.0.004/nix/postgresql/generic.nix#L323) foi conferida nesta revisão: `pg_config` é copiado, enquanto somente o servidor recebe o wrapper com `NIX_PGLIBDIR`. A configuração também inclui o patch de diretório de biblioteca em runtime. Portanto, a V2 assumia uma equivalência de caminhos que não estava demonstrada.

A V3 preserva a exigência funcional e a torna mais direta: duas sessões novas de `psql`, cada uma com `ON_ERROR_STOP=1`, executam respectivamente `LOAD 'supautils'` e `LOAD 'safeupdate'` no servidor. Cada prova exige retorno zero e o marcador exato produzido somente depois de LOAD. Retorno não zero, marcador divergente, erro de execução ou timeout interrompem antes da preparação de roles e da restauração. A lista de bibliotecas é fixa; não há parâmetro livre, stub, tentativa alternativa ou bypass.

A sondagem de dois diretórios imprime apenas caminho e legibilidade dos dois arquivos, com limite de 4.096 bytes salvos por stream. Esses booleans servem ao diagnóstico; não substituem LOAD nem aprovam uma biblioteca inexistente. stdout/stderr de cada sessão têm arquivo próprio e o relatório registra a fase e o retorno. A verificação posterior da sessão `authenticator` foi preservada. Este parecer aprova a guarda; não afirma que LOAD já teve sucesso na imagem remota.

Comparação direta com a V2 preservada em `executor/revisoes/restauracao-v2-run-41341452270.zip`: imagem, START, criação/verificação do container, captura de logs, SQL de roles e comparadores estão inalterados. Workflow e baseline são byte a byte iguais. Dez testes estáticos passaram nesta revisão (0,029 s), inclusive marcadores falsos, retorno não zero e rejeição de biblioteca fora da lista. Nenhum Docker, SQL, upload ou job remoto foi executado pelo revisor.

| Arquivo V3 | SHA256 |
| --- | --- |
| `executor/restauracao/restore.py` | `6e6d588d8a9ec0598002f3e4cc76607605f541b850e1a6de1c61cc689ec967f5` |
| `executor/restauracao/test_restore.py` | `e17889fe2cb66f0abf27b037751da8205a8b6cbe0e9dc17db3bfd9810633e78a` |
| `executor/restauracao/README.md` | `ced775f10a668be00351a40080fb2a299ec4cf1a7132acb600306f95521acc3f` |

### Uploader V3

**Aprovado:** `enviar-restauracao-privada-v3.ps1`, SHA256 `45dd0fa17c4f55683011d76762f8e5db99ce05f3ecdf158863ac4e02dc372cbd`. Parser PowerShell sem erros. O diff conjunto V2–V3, SHA256 `1ad67c2ec274597a405a4599256c2da98d2934d3b096d237dfee539405f15236`, também foi identificado; a avaliação usou os arquivos reais e a V2 arquivada, não apenas o texto do diff.

O script exige o HEAD `702663b5af7551896551eef253a7f425d144bc5d` e confere a lista exata dos onze blobs antigos antes de qualquer escrita. Recalculei independentemente as onze identidades Git a partir dos arquivos conservados do inventário e dos bytes da V2 arquivada: todas coincidem com `$previousGitBlobs`. A checagem de hash do workflow remoto também permanece. São enviados somente `restore.py`, `test_restore.py` e `restauracao/README.md`; baseline, dump, workflows e inventário ficam imutáveis. O resultado exige os mesmos onze arquivos e confere cada blob contra os bytes locais com SHA256 aprovado.

Guardas de conta/repositório privado, token somente no processo e restauração do ambiente, novo exame do HEAD antes de atualizar, atualização sem force e ausência de retry permanecem. O script não dispara job nem altera cobrança. HEAD remoto e franquia ainda devem ser conferidos pela coordenação na execução, sem presumir que uma leitura anterior garanta o estado futuro. Nenhum upload foi feito nesta revisão. Não há bloqueio adicional encontrado para a V3 dentro deste escopo.

## Adendo — V4: uploader e preservação do runtime

**Aprovado neste escopo.** A lógica SQL e a normalização de default ACLs têm revisão independente separada. Este adendo verifica exclusivamente a preservação do workflow/isolamento/fluxo de restore e o uploader V4, sem repetir a auditoria SQL.

Comparação direta com `executor/revisoes/restauracao-v3-run-41342288411.zip`: `main()` inteiro, criação/verificação do container, loader real, captura de evidências e demais helpers de runtime estão byte a byte iguais. Workflow e baseline também são iguais. As mudanças de código se restringem a `role_sql`, `canonical_schema` e à função nova `canonical_default_acl`, encaminhadas ao outro revisor. Portanto esta V4 não modifica rede, mounts, imagem, START, limites de runtime, comandos de pg_restore, cleanup ou gatilhos de execução.

Identidades conferidas:

| Arquivo V4 | SHA256 |
| --- | --- |
| `executor/restauracao/restore.py` | `fd0caa76421b27e25402cc1d4be34419faaf2a5ce30972b335398957b602e10e` |
| `executor/restauracao/test_restore.py` | `ef4c905a0bdf9b72c644509b8ccba1a80688257a6b6bf369ecc6567002f214f9` |
| `executor/restauracao/README.md` | `f649a1803f882a3f083ce06805638711800c9068b7b761c879e7fb17bd126e6a` |
| `enviar-restauracao-privada-v4.ps1` | `b1a35fc5c43b5c3944a165648112a57dc0ea65e353cc74e01eca3fa3bd099057` |

Uploader: 11.982 bytes, parser PowerShell sem erros. Comparei o arquivo real com a V3 arquivada; exceto hashes/HEAD, comentário de versão e mensagem de commit, a lógica é idêntica. Recalculei os onze Git blob SHAs antigos pelos bytes da V3 e dos arquivos de inventário preservados: onze correspondências, nenhuma divergência. O HEAD exigido é `a0a9c7e4b66ac36a564f4f9eafd97646bc6efbf1`; o script envia somente os três arquivos alterados em `restauracao/`, preserva os outros oito e exige a árvore final com exatamente onze arquivos.

Mantidos os bloqueios por identidade/HEAD divergente, checagem antes de qualquer escrita, token restrito ao processo, atualização sem force, nova leitura da referência e ausência de retry ou disparo de workflow. Nenhum upload, Docker, SQL ou job foi executado nesta revisão. A autorização técnica depende também do parecer SQL separado e da conferência operacional de franquia; não significa restauração concluída.
