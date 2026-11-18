# Rodada-02 — homologação real do kit e cadastro

**Execução aprovada no ambiente local:** exit 0, 13 grupos concluídos, incluindo quatro grupos de UI real. Conclusão em `2026-10-31T02:37:26.136Z`. Não houve publicação ou acesso à produção. Os hashes aprovados de harness, UI e servidor foram conferidos antes de iniciar.

## Cobertura efetivamente executada

- PostgreSQL, GoTrue, PostgREST e Storage reais, com bindings exclusivamente em `127.0.0.1`. Quatro usuários fictícios, empresas A/B na mesma organização e empresa externa em outra organização. Anônimo, pendente, leitor, operador restrito e cruzamento de empresa/processo receberam as recusas esperadas. Leitura direta do leitor no próprio escopo permaneceu permitida; escrita direta e RPC privada foram negadas.
- Salvar/listar/reabrir após novo login, repetição idempotente, versões e conflito concorrente com uma resposta 200 e outra 409. Revisão exigida por peça, versão e usuário; hash adulterado, edição, alteração de preço, identificação ou fonte bloquearam exportação anterior.
- Upload, extração, proveniência e download privados reais. Outra organização não baixou a fonte e leitor não a sobrescreveu. Restaurar o PDF manteve a identificação pendente e `preparar` retornou 422; confirmação explícita pelo endpoint real restaurou a prontidão.
- Cadastro B persistiu após recarga e prevaleceu sobre a preferência local A. Atalho e retorno mantiveram o rascunho. A→B→A e reabertura exigiram nova revisão. Duas abas produziram 409 sem perder o rascunho local. A proposta foi salva em versão 2 com pagamento de 45 dias e reaberta corretamente.
- **Oito DOCX:** seis via API e dois baixados pela UI. Assinatura ZIP e texto extraído foram conferidos: CNPJ exato, ausência da outra empresa/CNPJ, presença dos dois itens selecionados e ausência do terceiro item válido deixado fora da seleção. Totais de R$ 3,71 e R$ 7,04 preservados. A declaração da UI incluiu o marcador final da prévia integral.
- UI com SDK e Auth reais, JWT recém-emitido validado e contexto headless efêmero. **Zero erros JavaScript e zero pedidos externos.** Cinco capturas incluem cadastro/kit em 375 e 1280 px e conflito entre abas.

## Limpeza e evidências

O `finally` removeu os quatro usuários, duas organizações, cinco peças e um arquivo desta execução. As empresas e demais registros dependentes seguiram a cascata esperada. A ausência dos IDs foi conferida pelo harness; `limpezaErros` está vazio. As **33 tabelas** voltaram às mesmas contagens e hashes, e `baseline-dados.json` e `final-dados.json` são idênticos byte a byte.

- Resultado geral: `homologacao-kit-real-local.json`; UI e ações/status: `ui-real.json`.
- Logs: `harness.stdout.log`, `harness.stderr.log` (vazio) e `rede-servidor.json`.
- Propriedade das fixtures: `fixtures.jsonl`, somente tipo/UUID/timestamp.
- SHA-256 das fontes e de todos os artefatos: `manifesto-resultados.json`. A checagem textual não encontrou JWT nos relatórios/logs.
- Preservação dos 20 arquivos protegidos registrada pela coordenação em `../protegidos-final.json`; hashes de fontes em `../fontes-final.json`.

Comando executado, usando o servidor já iniciado pela coordenação:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
$env:QA_EXECUTAR_REAL='1'
$env:QA_EXECUCAO='rodada-02'
$env:QA_HTTP_PORT='8792'
node docs/qa/homologar-kit-real-local.cjs
```

## Limites

Auth por credenciais fictícias/token real/SDK não equivale a testar recuperação de senha, hCaptcha ou todo o formulário de login. DOCX foi validado por assinatura e conteúdo; não houve renderização no Word nesta rodada. A UI cobre os percursos listados, não todos os estados, temas, tamanhos ou acessibilidade completa. Logs fictícios nativos de auditoria Auth podem permanecer; a baseline cobre tabelas `public`, `auth.users`, `storage.objects` e `storage.buckets`.

O schema local reconstruído não certifica produção. Gate SQL e migração têm evidências separadas da coordenação. A falha e a recuperação da rodada-01 permanecem preservadas. Esta aprovação vale somente para o escopo testado; servidor e containers foram mantidos para revisão final e encerramento pela coordenação.
