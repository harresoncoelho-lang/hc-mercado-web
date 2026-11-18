# Revisão estática do envio privado

01/11/2026. O script envia cinco payloads já aprovados para o repositório privado de homologação e mantém intacto o workflow previamente criado pela interface. Não dispara o workflow nem publica o site.

**Veredito: aprovado no escopo exato revisado; nenhum defeito bloqueante encontrado.** Não executar com arquivos, hash, destino ou HEAD diferentes sem nova conferência. Esta revisão não executou o uploader, não leu tokens e não consultou endpoints privados.

## Identidade

- Script: `enviar-inventario-privado.ps1`, 9.422 bytes.
- SHA-256 recalculado: `b8774d94b2e20a5a3c60ba97a1ca32b409a17b28e96b143ab4a84f59a71aaeb4`.
- Destino fixo: `harresoncoelho-lang/licitaplena-homologacao`.
- HEAD exigido: `d106c24da9d9a49456d47192b049d2d44668cc72`, informado pela coordenação como revisto na interface.
- Manifesto fixado: `61012be856b4b1d9b5ccba2cce2103e7e380cea13eb47b665b45c5e7bf63446f`.
- Workflow fixado: `38089712999ae1c6f9a59a8e8b1a9ad32578306fc0c06f437f8610753d2fa490`.

As fontes locais listadas no manifesto foram reconferidas e correspondem aos hashes aprovados. O dump agora está presente em `executor/input/ficticio.dump`: 505.274 bytes e SHA-256 `30456520f2b52f3e72ed79f57a7c3fea9f51b688ecd1753b504309393f47144c`. O parser PowerShell retornou zero erros; parsing não executa o script.

## Controles confirmados

- **Conteúdo limitado:** lê somente os seis nomes fixos, valida SHA-256 de cada um, tamanho do dump, nomes/valores do manifesto e tipo dos arquivos. Transmite cinco blobs, excluindo explicitamente o workflow. ZIP, relatórios, credenciais e arquivos extras não são enumerados ou enviados.
- **Destino e identidade:** após selecionar a conta nominal já armazenada, confirma login exato, nome completo do repositório, privacidade e permissão administrativa. Não chama `auth login`, `auth switch`, `auth refresh` ou atualização de escopos. `GH_TOKEN` é temporário no processo e seu valor anterior é restaurado em `finally`; a conta padrão global não é trocada. A CLI documenta a seleção nominal por `--user` e `--hostname`. [gh auth token](https://cli.github.com/manual/gh_auth_token).
- **Workflow intacto:** exige presença remota e SHA-256 exato do workflow antes do primeiro POST. O commit novo reutiliza seu blob sem alteração e a árvore final volta a conferir seu hash Git. Não solicita permissão de workflow nem tenta modificar seu conteúdo.
- **Árvore fechada:** rejeita árvore truncada, diretório inesperado, symlink/submodule, arquivo fora da lista ou modo diferente de `100644`. Antes do commit exige exatamente os seis arquivos finais e seus blobs correspondentes aos bytes locais validados.
- **Sem sobrescrita forçada:** exige o HEAD revisado antes dos uploads, cria commit com esse pai, reconfere HEAD antes de atualizar e usa `force=false`. A API exige fast-forward nessa condição; avanço concorrente incompatível falha em vez de substituir trabalho. Faz leitura final do HEAD e não repete automaticamente. [GitHub — update a reference](https://docs.github.com/en/rest/git/refs#update-a-reference).
- **Sem segredo em log/evidência:** token é capturado em variável e ambiente de processo, não vai para corpo, linha de comando ou evidência. Stderr da CLI é suprimido e falhas expõem somente fase/tipo. Evidência registra nomes, hashes, commit e status; não inclui conteúdo do dump, blobs base64, respostas de identidade ou credenciais.
- **Escopo restrito:** não há disparo Actions, criação de release, publicação Pages, execução de SQL, Docker, implantação ou alteração de cobrança.

## Limites operacionais

Em falha após os POSTs podem permanecer blobs/commit sem referência no repositório privado; a evidência registra o que já foi criado. Não retomar cegamente nem apagar objetos para simular ausência de envio. Se houver falha depois do PATCH, conferir o HEAD e a evidência antes de nova ação.

O script usa APIs .NET presentes no PowerShell 7 desta sessão; executar pelo mesmo runtime revisado, não presumir compatibilidade com Windows PowerShell 5.1. Validade/escopos do token e estado remoto não foram testados por este revisor. As próprias guardas devem interromper se divergirem; eventual 403 não autoriza ampliar autenticação ou permissões.

Esta aprovação cobre o envio privado do pacote conhecido. O disparo manual do inventário e sua análise continuam etapas separadas, com a franquia de custo e as restrições descritas em `REVISAO-EXECUTOR.md`.

## Adendo — uploader V2, 01/11/2026

**Aprovado sem bloqueio:** `enviar-inventario-privado-v2.ps1`, 9.422 bytes, SHA-256 `c2156f8abde089861198b71eacc242c54f4c6481b155ef422cad6a222d689985`. Parser PowerShell: zero erros. A comparação ordinal integral confirmou exatamente seis substituições de literais sobre a V1 aprovada: HEAD e os hashes de workflow, inventory, testes, README e manifesto. Todo o restante do texto/lógica permanece idêntico, inclusive a identidade do dump, seleção de cinco payloads, preservação da conta global, guardas de destino/árvore e atualização sem força.

O HEAD agora exigido é `e850f39c9a52bd74f5b31906b03803ea8478539b`, com workflow V2 `a5ae9a0d9f4ec7347aa13a4fcccc22433700bbb44cccd9f382faace31fc95720`; ambos informados pela coordenação como conferidos na interface/remoto. Os novos hashes correspondem ao pacote aprovado em `REVISAO-EXECUTOR-V2.md`, manifesto `0ef9542dc690dda39184e4dd9e23cef6ebc4bc1b4bb300e89d183e2c6a864994`.

Este adendo autoriza tecnicamente a mesma transferência privada delimitada, agora da V2. Não executou o script nem fez consulta privada. Permanecem PowerShell 7, interrupção diante de divergência e nenhuma repetição cega após falha; o job é etapa manual posterior.
