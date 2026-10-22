# Fixtures de extração

`anexos-ocr.json` contém exemplos sintéticos de PDF textual, PDF só imagem e PNG. Texto esperado: entrega em 20 dias (textual) e 15 dias (digitalizados). Sem dados pessoais.

`anexos-rar.json` contém arquivos públicos de teste do projeto [rarfile](https://github.com/markokr/rarfile/tree/master/test/files): rar3-subdirs.rar, rar5-subdirs.rar, rar5-psw.rar. Licença ISC preservada em rarfile-LICENSE.txt. Arquivos usados só para testar o leitor, nunca executados.

A suíte gera Word antigo, planilhas XLS/XLSX/ODS e 7z localmente com conversores instalados. Executar via Dockerfile.anexos e TESTAR_CONVERSORES=1, em contêiner sem rede, credenciais, privilégios ou escrita no código-fonte.

`anexos-rar-volumes.json`: nove volumes binários reais do mesmo corpus rarfile (RAR3 part1–3, RAR5 part1–3 e RAR antigo .rar/.r00/.r01), codificados com zlib/base64. A suíte verifica conjuntos completos, incompletos, corrupção, nomes ambíguos e agrupamento dentro de ZIP e 7z.
