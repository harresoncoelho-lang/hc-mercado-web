# Preparação das integrações — LicitaPlena

31/10/2026. Trabalho local e consulta administrativa somente de leitura. **Nada publicado, aplicado ao banco de produção ou enviado por e-mail.**

## Onde estamos

O fluxo de documentos e propostas por CNPJ já tem homologação anterior com banco, autenticação e armazenamento reais em ambiente local de teste. Nesta etapa foram identificados os provedores corretos e as diferenças em produção, corrigidas a seleção pública de arquivos e a leitura empresarial de PDF, e aprovado o percurso completo no Worker compilado. O pacote permanece em pasta privada. **Preparação local validada; implantação e operação em produção ainda dependem dos gates abaixo.**

| Área | Evidência desta etapa | O que ainda limita a liberação |
|---|---|---|
| Hospedagem | Pages `licitaplena`, domínios corretos, branch `main`, build `npm run build:cloudflare`, saída `publico`. | `main` publica automaticamente; as demais branches também geram previews. Nenhum push/merge deve ocorrer durante esta preparação. |
| Rotas do novo módulo | As duas APIs devolvem 404 JSON; os dois scripts novos devolvem HTML de fallback na superfície pública. | O código novo ainda precisa ser implantado. HTTP 200 sozinho não valida asset; conferir MIME, conteúdo e cache após implantação autorizada. |
| Banco | Supabase correspondente ao código, base operacional presente. Tabelas de identificação/kit e novas funções não encontradas nas buscas de metadados. | Comparação completa de colunas, definições, ACLs, RLS e triggers; preparar/aplicar somente os deltas aprovados, sem reaplicar a base antiga. |
| Armazenamento | Bucket `operacao-documentos` privado; quatro policies existentes. | As políticas de escrita observadas usam a condição anterior. Avaliar o delta de segurança e os helpers completos; nome ou papel da policy não certifica isolamento por CNPJ. |
| Configuração | Nome `SUPABASE_SERVICE_ROLE_KEY` presente; flag `IDENTIFICACAO_EMPRESA_LOCAL` não listada em produção. | Valor/vínculo da chave não foram revelados nem certificados. Habilitação do módulo somente depois das migrações e gates. |
| Preview | Sem variáveis listadas; todas as branches não produtivas; interface oferece restrição de acesso. | Não é um ambiente isolado comprovado. Auth e adapters do código atual apontam ao Supabase de produção; não ligar escrita de teste nesse projeto. |
| Capacidade | Workers Free observado; Worker final minificado com 2.798.537 bytes gzip local. | Formalizar a minificação na implantação e medir orçamento real de CPU/inicialização. Tamanho local não prova adequação ao limite de 10 ms de CPU exibido no plano. |
| Recuperação | Interface do Supabase indica backup recente. | Backup dos bytes privados do Storage e ensaio de restauração ainda não comprovados. Backup de banco não inclui esses bytes. |

## Correção aplicada localmente

O builder copiava toda a pasta `data/`, incluindo histórico por destinatário. Foi alterado apenas para selecionar cinco JSON públicos conhecidos. O histórico original e o robô continuam intactos. Arquivos privados futuros e subdiretórios deixam de entrar automaticamente na saída.

Arquivos desta correção: `scripts/montar_publico.js` e teste novo `scripts/montar_publico_dados.test.js`. Não houve alteração de `package.json`, CI, runtime de produção ou configuração dos provedores. A configuração alternativa antiga do Netlify não foi alterada nem certificada por este trabalho.

Reprodução com dados fictícios falhou antes da correção e passou depois. **15 testes direcionados passaram**, incluindo build e regressões CAPAG; revisão independente aprovou a correção. A coordenação reconferiu os mesmos 15 testes e os **20 arquivos protegidos iguais à baseline**. Fonte: `correcao-selecao-publica.md` e `revisao-correcoes.md`.

O ensaio no Worker revelou também uma falha real no novo leitor de PDF: a compilação selecionava um carregador de biblioteca que recursava, levando ao preenchimento manual. A correção ficou restrita a `_empresa_documentos.js` e ao helper novo `_empresa_pdf_leitor.js`, com teste próprio. Usa a porta em memória exportada pelo PDF.js já instalado, sob demanda, preservando limites, extração textual e contrato de sugestões. Não há patch global, alias, troca de dependência ou alteração do leitor do resumo. A revisão comparou três PDFs com a implementação anterior; o teste final no Worker extraiu os quatro campos fictícios com evidências. Detalhes em `diagnostico-pdf-worker.md` e `revisao-leitor-pdf.md`.

**Suíte geral executada pela coordenação:** `npm run verify`, exit 0; 843 testes, 839 aprovados, quatro ignorados, zero falhas; lint com zero erros e 58 avisos preexistentes. Log `verify-final.log`. Os hashes do código revisado permaneceram os mesmos depois dessa execução.

## Pacote privado e prova de runtime

Candidato validado: `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/rodada-04-leitor-pdf`.

- 44 estáticos: 39 arquivos da raiz e cinco JSON públicos. Histórico por destinatário excluído.
- Worker integral, sem retirar handlers/imports: 8.099.878 bytes brutos; 2.798.537 bytes gzip; SHA-256 `dab78768da8bab84401ed92051cd8dc462e2838df97f3263f9e098a444ba925d`.
- Compatibilidade conservada: `2025-09-01` e `nodejs_compat`.
- Manifesto corrigido registra 430 arquivos reais e as entradas virtuais/temporárias reconhecidas. Os hashes das fontes foram capturados depois da compilação; não representam um snapshot transacional anterior.
- Rodadas 01/02 são evidências privadas e **não publicáveis**, pois incluíam o histórico. Não foram apagadas nem enviadas a serviço externo.

**Smoke aprovado:** `runtime-03/resultado.json` registra exit 0 e 14 verificações completas: habilitação, sessão, usuário aprovado, papel, isolamento do CNPJ, cadastro, PDF com quatro evidências, confirmação, itens, persistência, prévia antes da revisão, revisão, invalidação por preço alterado e duas exportações DOCX válidas. Proposta e declaração foram salvas/reabertas na fixture do mesmo CNPJ; cálculo decimal e seleção de itens foram conferidos.

Auth, REST e Storage neste smoke são **fictícios**. Foram 239 chamadas somente às fixtures; `saidasNaoDeclaradas` e `hostBloqueados` vazios. Isso complementa a homologação real anterior e não substitui SQL/RLS, transações ou credenciais de produção. DOCX teve ZIP, texto e headers validados; não foi renderizado no Word.

Os dois filhos workerd encerraram. A coordenação confirmou resultado, hash do Worker, os 44 hashes estáticos sem divergência, ausência do histórico na saída, **20/20 protegidos iguais** e **zero workerd ativo**. Evidência final de fontes protegidas: `protegidos-depois.json`. Falhas anteriores de configuração e leitura ficaram preservadas; nenhuma foi reclassificada como sucesso.

## Sequência de implantação futura, ainda não executada

1. A prova local do runtime está concluída. Revisar e configurar o mecanismo explícito de minificação do bundle integral na implantação; o build gerenciado remoto não foi alterado nem certificado por essa medida local.
2. Comparar o catálogo completo do banco; obter backup recuperável de banco e Storage e preparar apenas os deltas necessários. Preservar as políticas existentes enquanto o delta não estiver validado.
3. Validar isolamento do ambiente escolhido e credenciais pelo mecanismo apropriado, sem expor valores. Executar os gates de banco e o fluxo autenticado nesse ambiente.
4. Somente com autorização de publicação: implantar artefato aprovado e migrações revistas, conservando a chave de habilitação fechada até os gates passarem.
5. Conferir assets/MIME/cache, escopo por CNPJ, PDF, prévia antes da revisão, persistência, versão/concorrência e DOCX. Abrir o módulo somente depois das validações.
6. Em falha, fechar o novo módulo e retornar ao deployment anterior, preservando documentos, revisões e arquivos. Não usar reset, DROP ou reaplicação de políticas antigas como rollback genérico.

Resumo do edital, envio de e-mail, robô de boletins, autenticação e modelos permaneceram fora das alterações. Não foi executado SMTP, coleta PNCP, IA externa, instalação, Docker ou controle de aplicativo nativo.

## Evidências principais

- `configuracao-banco.md`: dependências, diferenças remotas, gates e reversão.
- `cloudflare-iab-producao.json`, `cloudflare-iab-preview.json`, `supabase-iab-estrutura.json`: observações administrativas sanitizadas.
- `auditoria-publica.md`: rotas, arquivos e DNS observados.
- `PRE-EXECUCAO*.md`, `revisao-pre-runtime.md`, `revisao-correcoes.md`: snapshots e evolução da revisão do harness; o resultado final é a rodada 04/runtime-03 indicada acima.
- `diagnostico-pdf-worker.md`, `revisao-leitor-pdf.md`, `verify-final.log`: correção restrita e validação final.
- `RUNTIME-CLOUDFLARE.md`: resultado final do Worker completo, checks, DOCX, hashes e processos encerrados.
- `comparacao-minificacao.md`: medidas, defaults instalados e limites da conclusão.
- `../homologacao-real-20261031/HOMOLOGACAO.md`: prova anterior com serviços reais de teste, sem repetição desnecessária nesta etapa.
