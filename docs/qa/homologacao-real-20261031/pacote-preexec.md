# Pacote do harness para revisão antes de executar

Implementado; execução real ainda não autorizada. Nenhuma ação Docker, DB, HTTP ou navegador foi executada por este especialista. O bloqueio atual do gate PostgreSQL, comunicado pelo coordenador, permanece fora destas alterações.

## Arquivos

- `docs/qa/homologar-kit-real-local.cjs`: preserva os cenários legados; acrescenta peças salvas, versão/idempotência/CAS, revisão explícita e por usuário, JWT novo emitido pelo Auth, RLS/RPC/DML diretos, fonte alterada em peça salva e invocação da UI real.
- `docs/qa/homologacao-real-20261031/verificar-ui-real.cjs`: SDK/Auth reais, cadastro B, retorno do cadastro, salvar/reabrir/A→B→A, DOCX, conflito entre abas e proposta versão 2. Edge headless, contexto efêmero; nenhuma resposta simulada.
- `docs/qa/servir-identificacao-local.cjs`: somente portas QA e destino dos registros. Padrões alinhados a `runtime-publico.json`: HTTP 8792, REST 56321, Auth 56324, Storage 56325. Todas as URLs continuam em `127.0.0.1`.

Os dois arquivos existentes foram copiados antes da edição, sem sobrescrever destino, para `C:/Users/harre/AppData/Local/LicitaPlena/homologacao-real-baseline-20261031/`. SHA-256 das cópias:

| Arquivo anterior | SHA-256 |
|---|---|
| homologar-kit-real-local.cjs | `38ceb16aac3047ed2a6cc0e87101bb760ca3c17a06696b8ebcca6a1f132091be` |
| servir-identificacao-local.cjs | `e57c5deb4d4fbaf279c264f793c1b4c1d69ed0d087f74e39de1c2fd81752ca7f` |

## Contenção e limpeza

1. Sem `QA_EXECUTAR_REAL=1`, o harness termina antes de ler o arquivo privado ou acessar serviços. Esse é um anteparo operacional; a liberação explícita continua necessária.
2. Antes de criar fixtures: valida nome do banco, bindings loopback e tira baseline de contagens/hashes. O conjunto é todas as tabelas regulares de `public`, `auth.users`, `storage.objects` e `storage.buckets`. Os artefatos contêm somente nome da tabela, contagem e hash.
3. O cliente HTTP usa origem fixa loopback e `redirect: 'error'`. O servidor conserva o redirecionamento estrito do Supabase conhecido para os três serviços locais, CSP sem rede externa e lista de APIs restrita. O navegador aborta destinos fora da origem; sucesso exige zero saídas externas e erros JavaScript.
4. Credenciais privadas são lidas apenas pelo runtime. E-mail/senha fictícios, JWT e refresh token ficam em memória. O navegador não exporta `storageState`; logs de rede contêm só rota, ação, status e IDs fictícios. Erros passam por remoção dos segredos conhecidos e do formato JWT.
5. A limpeza só seleciona organizações cujo UUID está na lista desta execução, com prefixo de nome QA e owner UUID próprio. Primeiro remove peças dessas organizações, depois arquivos próprios, organizações e usuários criados pelo Auth.
6. A limpeza tenta todas as etapas mesmo quando uma falha. Em seguida exige ausência dos IDs e igualdade integral da baseline. Qualquer falha impede `aprovado: true`.
7. Auth pode conservar logs de auditoria da atividade fictícia. A baseline não inclui `auth.audit_log_entries`, sessões ou refresh tokens; usuários são apagados via Auth e as sessões dependentes devem seguir a cascata nativa. Nenhum registro de auditoria preexistente é removido.
8. Cada execução recebe uma subpasta nova. `execucao-iniciada.json`, relatórios, DOCX e registro inicial de rede usam criação exclusiva (`wx`); repetir o mesmo identificador interrompe, sem substituir evidências anteriores.

## Verificações offline executadas

- `node --check` nos três arquivos: exit 0.
- `node docs/qa/homologar-kit-real-local.cjs --self-test`: exit 0. Assertions de origem loopback, sanitização, escopo de limpeza e rejeição de UUID externo/entrada inválida.
- Execução sem `QA_EXECUTAR_REAL`: exit 1 esperado, antes de credenciais e DB.
- `git diff --check` no escopo: exit 0. Arquivos novos são não rastreados e a verificação de sintaxe cobre seu conteúdo; o diff Git sozinho não os valida.

SHA-256 do pacote revisável:

| Arquivo atual | SHA-256 |
|---|---|
| homologar-kit-real-local.cjs | `89b7408607bea6e38da91f57d2e498699ffd6932e1ce9cdbd2839f22d097dd60` |
| servir-identificacao-local.cjs | `b2951f7a07556a4e45b5a38cf7ac06dcfd3ac08449b10cb3653924f0b4f1b8cb` |
| verificar-ui-real.cjs | `d19c374eef3baf59e1f4395ab2fb84c6e39ea371932a5bc0f42355f896ddda2d` |

## Comandos após liberação explícita

Escolher um identificador novo para cada rodada e usar o mesmo nos dois processos. As variáveis são somente do shell filho. O coordenador deve ter terminado backup, migração, gate e revisão independente primeiro.

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
$env:QA_EXECUCAO='rodada-01'
$env:QA_HTTP_PORT='8792'
$env:QA_AUTH_PORT='56324'
$env:QA_REST_PORT='56321'
$env:QA_STORAGE_PORT='56325'
node docs/qa/servir-identificacao-local.cjs
```

Em outro processo, na mesma raiz do worktree:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
$env:QA_EXECUCAO='rodada-01'
$env:QA_HTTP_PORT='8792'
$env:QA_EXECUTAR_REAL='1'
node docs/qa/homologar-kit-real-local.cjs
```

Não é necessário executar o roteiro antigo separado de identificação: este harness mantém a parte útil do fluxo legado. O roteiro antigo separado grava evidências em destinos históricos; não o executar sem adaptar antes esse destino.

## Pendências de runtime

Ainda não estão comprovados login/UI, defaults/grants reais, gate, RLS, CAS, Storage, DOCX ou limpeza desta versão. Os checks offline não aprovam esses comportamentos. Falha de produto será reportada antes de qualquer edição fora dos harnesses.
