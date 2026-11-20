# Correção defensiva das permissões de trigger — 01/11/2026

## Resultado e escopo

Candidato local corrigido e validado em fixture PGlite, sem aplicação remota. A alteração de ACL alcança somente três funções internas de trigger. Não houve mudança de corpos, regras de negócio, policies, autenticação ou permissões das funções utilizadas pelo aplicativo.

SHA-256 do candidato atual `02-delta-operacional.sql`: `1619e78b9155ba9443b6080fa7d082f3c335d8e8b07015d5d894462149df4c94`.

SHA-256 anterior: `7cbe38e48980e9d58f73f95d69e8f926950517d616fe6d00f92dfd091b5502bf`. A cópia anterior, manifesto, SQLs de origem, gerador, teste e evidências estão em `evidencia-anterior-permissao-trigger-20261101/`. Os resultados antigos na pasta principal permanecem intactos. `delta-manifesto.json` identifica o candidato atual, os hashes das fontes e as quatro funções de trigger que devem ter somente o proprietário na ACL.

## Origem e chamadores verificados antes da edição

| Função interna | Chamadores legítimos | Ajuste mínimo |
|---|---|---|
| `invalidar_identificacao_empresa()` | `identificacao_documento_alterado` em documentos; `identificacao_arquivo_alterado` em Storage; `identificacao_cadastro_alterado` em empresas | Acrescentado REVOKE de PUBLIC, anon, authenticated e service_role em `supabase/identificacao_empresa.sql`. |
| `preservar_escopo_operacao()` | BEFORE UPDATE de documentos e processos | Acrescentado service_role à revogação existente em `supabase/seguranca_operacao.sql`. |
| `validar_arquivo_processo_operacao()` | BEFORE INSERT/UPDATE de anexos de processo | Acrescentado service_role à mesma revogação existente. |
| `kit_documento_escopo_imutavel()` | BEFORE UPDATE das peças, inclusive segunda gravação pela RPC | Nenhuma mudança: a ACL do kit já normaliza para somente o proprietário. |

A busca de referências identificou esses chamadores SQL, os catálogos e gates; não encontrou chamada direta dessas funções pelo aplicativo. `gerar-delta-local.cjs` incorpora os trechos declarativos de identificação e segurança; por isso a correção está nas fontes, não somente no arquivo gerado. O gate original `supabase/verificar_kit_prepublicacao.sql` permanece intacto, com hash normalizado `2c4023cb0cac4e9b5fa29afee68398a0b4e402663dee9cd9fa580e7ea19178cf`.

O novo gate posterior no gerador deriva as quatro funções com retorno `trigger` da lista de funções novas. Exige existência/tipo, nenhuma ACL direta para outro papel e ausência de EXECUTE efetivo para anon, authenticated e service_role. Defaults ou herança inesperados abortam o pacote; o gate não altera defaults nem permissões de outros objetos. A revogação ocorre dentro da mesma transação que cria as funções. O executor/proprietário esperado continua `postgres`.

## Validação local

PGlite já instalado, sem rede, serviços ou dependências novos. Comando:

```powershell
$env:VOLTA_HOME = 'C:\Users\harre\AppData\Local\Volta'
node docs/qa/migracoes-capacidade-20261031/testar-delta-local.cjs
```

Resultado final: **595 verificações aprovadas**. Evidências: `delta-testes-permissao-trigger-local.json`, `preservacao-delta-permissao-trigger-local.json` e `permissao-trigger-validacao-snapshot-final.log`.

- O teste de catálogo falhou antes da correção: invalidar_identificacao_empresa tinha EXECUTE de PUBLIC, anon, authenticated e service_role na fixture com defaults permissivos. Registro: `permissao-trigger-red.log`. Nenhuma chamada direta à função de trigger ou demonstração de abuso foi utilizada.
- Após a correção, as quatro funções têm ACL somente do dono, que conserva EXECUTE. anon, authenticated e service_role não têm EXECUTE efetivo. Um grant extra inserido somente na variante SQL em memória foi rejeitado pelo novo gate, com rollback e catálogo preservado.
- Os dois candidatos foram executados na mesma fixture, revertendo integralmente o anterior antes do atual. Foram comparadas 33 funções: todos os campos salvo as três ACLs intencionais permaneceram iguais; as demais ACLs, todos os triggers e todas as policies ficaram idênticos.
- O operador autenticado manteve UPDATE de documentos/processos, INSERT/UPDATE de anexo válido e alterações legítimas de cadastro/documentos/Storage. Os três caminhos da invalidação foram conferidos: cadastro UPDATE; documento UPDATE/DELETE; arquivo UPDATE/DELETE. Cada caso começou com identificação confirmada e terminou com invalidado_em preenchido.
- A segunda gravação da peça pela RPC, usando service_role, incrementou a versão e disparou o trigger do kit. O grant da RPC e seus controles permaneceram intactos.
- Permaneceram aprovados os nove cenários de recusa/rollback, os 488 objetos preexistentes comparados e os hashes dos dados de 18 tabelas imediatamente após o delta. As mutações posteriores pertencem somente aos casos legítimos da fixture.
- Os 20 arquivos protegidos foram iguais ao baseline antes e depois; `integridade-permissao-trigger-20261101.json` registra os hashes, fontes, cópias e evidências conferidos.

Houve um erro do harness durante a comparação entre candidatos: a consulta de catálogo incluía seu próprio COMMIT e encerrava a transação destinada a rollback. A tentativa falhou na guarda de catálogo (`permissao-trigger-green.log`, apesar do nome). Corrigiu-se somente a variante de consulta em memória, removendo BEGIN/COMMIT; a consulta de inventário em disco ficou intacta. O ensaio passou em `permissao-trigger-validacao-02.log`. Depois, o comentário-cabeçalho da fonte foi corrigido para descrever a ACL, gerando o hash final; os logs identificam cada hash. Ajustou-se também a evidência de dados para capturar o instante posterior ao delta, anterior às mutações legítimas. Os JSONs intermediários anteriores a esse ajuste foram preservados com sufixo `-antes-snapshot.json`.

## Limites e próxima revisão

PGlite usa PostgreSQL **18.6**; o inventário remoto registra **17.6**. Auth e Storage na fixture são estruturas de compatibilidade, sem serviços gerenciados, usuários ou arquivos reais. Só o fingerprint esperado foi substituído na string SQL em memória; o candidato em disco conserva o fingerprint remoto original e rejeita ambiente diferente. O ensaio não substitui validação autorizada em PostgreSQL 17.6 com Auth/Storage reais de destino isolado.

Esta frente não executou produção, rede privada, Docker, desktop, suíte global do produto, publicação, push, commit, instalação, billing ou configuração de modelos. Os testes existentes do delta foram mantidos e a extensão ficou restrita a catálogos/grants e disparos legítimos em fixture. A revisão independente do novo hash continua necessária antes de qualquer autorização de aplicação.

Context7 consultado somente com termos públicos de PostgreSQL, sem conteúdo do projeto. A documentação confirma EXECUTE padrão para PUBLIC e recomenda revogação na mesma transação: [privilégios PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-priv.html) e [SECURITY DEFINER](https://www.postgresql.org/docs/17/sql-createfunction.html). A criação do trigger exige EXECUTE do criador: [CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html). A preservação dos disparos sob as ACLs restritas foi comprovada nesta fixture; não é inferida como homologação do serviço remoto.
