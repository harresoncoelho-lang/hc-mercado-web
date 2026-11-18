# Inventário do banco de produção (T0) — 18/11/2026

Só leitura, SQL Editor do projeto lsqjamqvmrcyrvowndiu (conta licitaplena.site).

- `operacao_itens_resultado` já tem `marca`, `modelo`, `valor_unitario_proposta`, `valor_unitario_homologado` → os SQL de marca/modelo e valores unitários não mudam nada (são `if not exists`).
- `storage.objects`: só as 4 policies `operacao_arquivos_{leitura,envio,atualizacao,exclusao}`; um bucket, `operacao-documentos`, privado.
- `operacao_membros`: 1 linha, papel `gestor`. Ninguém perde escrita com `seguranca_operacao.sql`.
- Funções existentes: `pode_acessar_empresa_operacao` (convites aplicado), `incrementar_uso`, `selecionar_sicaf_para_enriquecimento`.
  Ausentes: `identificacao_empresa_habilitada`, `gravar_kit_documento`, `confirmar_identificacao_empresa`.
- Checagens de "escopo legado inconsistente" de `seguranca_operacao.sql`: todas 0 (documentos 2, processos 4, itens 1, anexos 0, objetos no bucket 2; caminhos dos documentos batem com organização/empresa).
- Tabelas `operacao_*`: organizacoes, membros, empresas, tipos_documento, documentos, renovacoes_documento, agenda, prazos_processo, empenhos, processos, itens_resultado, ocorrencias, contratos, anexos_processo, limites_cnpj, convites_empresa.

Conclusão: base pequena e consistente; aplicar identificacao_empresa → seguranca_operacao → kit_documentos → kit_documentos_escala_proposta → verificar_kit_prepublicacao tem risco baixo de abortar. Fazer backup antes, mesmo assim. Variáveis de ambiente do Cloudflare não conferidas.
