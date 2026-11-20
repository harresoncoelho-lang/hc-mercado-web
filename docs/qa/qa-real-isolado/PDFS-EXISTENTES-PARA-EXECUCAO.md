# PDFs existentes — inventário local, sem upload

Leitura em 01/11/2026 pelos leitores canônicos `_empresa_pdf_leitor.lerPaginasPdf` e `_empresa_documentos.extrairDocumento`, sem IA/rede. Nenhum PDF criado, alterado ou enviado. Objetivo: selecionar arquivo já existente para as empresas sem adaptar silenciosamente a identidade do cadastro.

Empresas semeadas pela coordenação: **QA UI A FICTÍCIA / 11222333000181** e **QA UI B FICTÍCIA / 12345678000195**. Nenhum dos seis PDFs locais encontrados corresponde integralmente a essas identidades.

| Arquivo relativo ao worktree | Bytes | Resultado útil / bloqueio |
|---|---:|---|
| `docs/qa/fixtures/identificacao-cartao-ficticio.pdf` | 1476 | Nome EMPRESA FICTICIA QA; sem CNPJ textual. Endereço Rua de Teste 123, Pessoa Ficticia, Administradora. Extrator produz os quatro campos, mas nome diverge de A/B e UI rejeita sugestões. |
| `docs/qa/fixtures/identificacao-preview-ficticio.pdf` | 1637 | CNPJ A, nome EMPRESA FICTÍCIA DE HOMOLOGAÇÃO LTDA. Endereço Rua Ficticia de Homologacao, 123 — Manaus/AM, Pessoa Ficticia de Teste, Administradora. Nome diverge: não usar como identidade A. |
| `docs/qa/fixtures/identificacao-upload-final-ficticio.pdf` | 1637 | Bytes idênticos ao preview; mesmo bloqueio. |
| `docs/qa/ai-studio-leitura-20261030/alfa-identificacao-texto.pdf` | 77359 | CNPJ A, nome Alfa Ficticia Homologacao. Endereço/cargo extraídos; representante e razão não reconhecidos pelos rótulos atuais. Mesmo que a UI não reconheça a divergência, o documento pertence a outro nome de fixture: não considerar compatível. |
| `docs/qa/ai-studio-leitura-20261030/alfa-identificacao-escaneado.pdf` | 251386 | Leitor devolveu texto vazio e extrator modo manual. Sem inspeção visual nesta tarefa; não usar como prova de campos/CNPJ. |
| `docs/qa/ai-studio-leitura-20261030/beta-proposta-cnpj-divergente.pdf` | 75919 | Beta Ficticia Homologacao, CNPJ 11222333000262, diferente de B. Sem sugestões de identificação. Contém instrução adversarial marcada como teste, sem autoridade; não executada. Adequado apenas a negativa de divergência. |

Nos PDFs textuais aparecem nomes explicitamente fictícios, sem CPF real, assinatura ou identificação de pessoa real; essa observação é limitada ao texto extraído, não certificação de metadados/imagens. Não fiz inspeção visual dos seis nem alego isso.

## SHA-256

| Arquivo | SHA-256 |
|---|---|
| identificacao-cartao-ficticio.pdf | ab510b9b7778401c7ff13ee7a06a740a1d9db3d6c4bb82cb176933bfb94a4070 |
| identificacao-preview-ficticio.pdf | 6f39f96d09f90b6e5643d8b1dd94efc145407d1d923ccb99c4eeb91d03bdf35f |
| identificacao-upload-final-ficticio.pdf | 6f39f96d09f90b6e5643d8b1dd94efc145407d1d923ccb99c4eeb91d03bdf35f |
| alfa-identificacao-texto.pdf | bc8dfda1beeda1e15e6ee7402550eb1572c6bc220cd799af818ef8d9b202e586 |
| alfa-identificacao-escaneado.pdf | 3830ae2cad053b7d0c11ba1c93f42ace8590c48822dc3423357dd0fafa7c61fb |
| beta-proposta-cnpj-divergente.pdf | 7ea54b29ea7a6f1da49263491138a814fcec789b053f53911aa8a998a9d3c8b5 |

## Material ainda necessário

Preparar dois PDFs textuais exclusivamente fictícios, com identidade exata A/B, avisos de teste/sem validade e rótulos `NOME EMPRESARIAL`, `CNPJ`, `ENDERECO`, `REPRESENTANTE LEGAL`, `CARGO`. Cada campo exigido deve aparecer uma única vez para não gerar ambiguidade no extrator. Endereço e representante devem ser claramente inventados, sem CPF, dados bancários, assinatura, selo ou alegação de documento oficial. Não renomear os arquivos antigos como se resolvesse o conteúdo, nem mudar empresas já semeadas para satisfazer um PDF antigo.

Executar extração canônica e revisão visual antes de disponibilizar os novos PDFs à UI. O extrator atual não produz sugestão de CNPJ: conferir visualmente o CNPJ do arquivo contra o cadastro, sem alegar validação automática desse campo. Escolher cada sugestão com evidência para formar proveniência dos três campos; não usar confirmação vazia de arquivo como atalho. Registrar novo hash local e, após upload real autorizado, UUID/caminho de Storage no diário da rodada.

## Fixtures exatas preparadas depois, por autorização da coordenação

Gerador `gerar-pdfs-identificacao.py` reutiliza funções de tipografia/layout do corpus existente, sem modificar os PDFs anteriores. Dois PDFs de uma página foram criados em `pdfs-identificacao/`, renderizados com Poppler a 110 dpi e ambas as PNGs inspecionadas: sem cortes, sobreposição ou problemas de acentuação. Cada página identifica FICTÍCIO / TESTE SEM VALIDADE, sem assinatura/selo ou alegação oficial.

| Arquivo novo | SHA-256 | Bytes |
|---|---|---:|
| identificacao-qa-ui-a-ficticia.pdf | e36e4886b84f6bafd61cd5cbf41b9b4921b03c5c333d5520724e5a396ad022fa | 75450 |
| identificacao-qa-ui-b-ficticia.pdf | c0505565fac27108ba24ab033b738bd17b76f7ce625cf761509ad4c8fb4326eb | 75453 |

Nome exato QA UI A FICTÍCIA / QA UI B FICTÍCIA; CNPJs 11.222.333/0001-81 e 12.345.678/0001-95. Endereços Rua Ficticia A/B, 100 - Cidade Exemplo; representantes Pessoa Ficticia A/B; cargo Representante de Teste. Leitura canônica confirmou quatro sugestões (nome/endereço/representante/cargo) e uma evidência por campo na página 1. CNPJ foi conferido no texto e imagem, não extraído automaticamente. Manifesto e `validacao-canonica.json` registram dados, paths/hashes e resultado.

Nenhum upload, rede, SQL ou confirmação de cadastro foi executado. Para o percurso, selecionar cada sugestão de endereço/representante/cargo e conferir proveniência antes de confirmar, sem apresentar este material sintético como contrato social/cartão oficial.
