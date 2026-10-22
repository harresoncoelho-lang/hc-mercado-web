# Leitura antecipada de anexos

O worker de dossiês usa conversores locais em contêiner isolado. A leitura interativa continua com os leitores existentes. Não muda provedores, cotas de IA, banco ou boletins por e-mail.

| Cenário | Tratamento |
|---|---|
| PDF textual | Texto com referência por página |
| PDF digitalizado ou página com imagem | Renderização e OCR por página, português e inglês |
| PNG/JPEG/TIFF/BMP/WebP | OCR local |
| DOCX | Texto, tabelas, cabeçalhos, rodapés, notas e OCR de imagens incorporadas |
| DOC/RTF/ODT | Conversão local para PDF e mesma leitura por página |
| XLS/XLSX/ODS | Células e todas as abas, inclusive ocultas; sem recorte de impressão |
| Planilha com fórmula sem resultado | Pendência interna; não inventa valor |
| Objetos/imagens incorporados | OCR quando reconhecidos; pendência se não recuperados |
| TXT/CSV/TSV | Texto e colunas, UTF-8/UTF-16/Windows-1252 |
| ZIP/RAR3/RAR5/7z | Entradas verificadas individualmente; compactados aninhados até 4 níveis |
| Senha, corrupção, volume faltante | Pendência interna; não executa nem adivinha o conteúdo |
| DOCX com altChunk | Pendência interna explícita: fragmento ainda não interpretado |
| Multipartes em anexos separados | Não combina volumes nesta versão; mantém pendência |
| Fonte original ausente | OCR de uma retificação não substitui o edital original |

Limites: 64 MiB de orçamento, 200 entradas, 100 páginas, 200 mil células, 600 mil caracteres e 90 segundos por anexo. Limite atingido mantém cobertura parcial. Não marca um pacote completo só porque uma entrada pôde ser lida. OCR pode errar caracteres; não representa garantia de correção jurídica nem leitura de 100% dos formatos existentes.

Segurança: contêiner sem rede, sem credenciais, sem privilégios, código-fonte e entrada somente leitura, 1 GiB de memória, 1 CPU e temporários limitados a 256 MiB. Macros desabilitadas. Nunca executa os anexos. Falha do conversor preserva a leitura nativa e registra cobertura parcial.

Validação reproduzível: construir scripts/Dockerfile.anexos; executar scripts/test_extrair_anexo.py dentro da imagem com TESTAR_CONVERSORES=1 e os mesmos limites do workflow. Fixtures sintéticas e RAR com licença ficam em scripts/fixtures. O workflow testa os conversores antes de gerar dossiês. Reversão: remover LEITURA_MULTIFORMATO=1 do workflow, preservando leitores e dados existentes.
