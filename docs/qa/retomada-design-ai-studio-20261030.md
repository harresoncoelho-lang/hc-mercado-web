# Retomada — documentos por CNPJ e leitura no AI Studio

30/10/2026. Escopo autorizado: continuar documentos/propostas no mesmo Design System privado do Claude e testar leitura de documentos no Google AI Studio. Sem publicar SaaS, importar dados, enviar SMTP ou alterar resumo, e-mail, robô de boletins, autenticação ou modelos do produto. A recuperação PNCP permanece pausada; este pedido não a retomou.

## Design System: v38 conferida

Artefato canônico: https://claude.ai/code/artifact/2c37c3c7-4bb3-474d-85e2-24267a3e1435 — mesmo cadastro privado, “Apenas você”. Conversa nativa/modelo Haiku 5.5 Manual preservados. O principal conferiu a versão já entregue; não criou outro Design System.

ZIP recebido pela interface: `C:/Users/harre/Downloads/revisao_pacote_kitproposta_v38_final.zip`, 293.473 bytes, SHA-256 `41d3c261f81966aac9eff0849c0beb8e978229bfbb203e55719cce74c372b6a2`. Extração nova, com contenção dos caminhos e limite de tamanho, em `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v38-20261030`.

Revisão independente: [revisao-kitproposta-v38-20261030.md](revisao-kitproposta-v38-20261030.md). Foram conferidas 20/20 entradas do manifesto e sete arquivos protegidos, iguais à baseline e aos hashes anteriores. A suíte principal passou em **162/162 asserções, exit 0**, em Edge headless local com rede bloqueada. Regressão R1: v37 apresenta a peça mas desabilita a confirmação após cancelar/reabrir; v38 apresenta a peça, habilita e confirma. Essa execução é independente dos logs fornecidos pelo Claude.

O principal repetiu o fluxo na interface nativa do mesmo Design System: confirmou cadastro fictício de Empresa Exemplo, anexou/confirmou adequação do atestado simulado, abriu o pacote e gerou a declaração. A prévia mostrou timbrado de exemplo, empresa/CNPJ, processo, representante, fonte/versão e texto integral. Cancelar manteve a declaração pendente. Reabrir a mesma peça mostrou novamente o documento completo e permitiu confirmar. A declaração passou para atendida; a proposta permaneceu pendente. Nenhum arquivo de cliente foi enviado e nenhuma aprovação real foi feita.

O defeito de empacotamento foi corrigido na mesma conversa Claude: `run_tests.sh` agora aponta para `t_pacote_v38.js`, e `t_repro_v34.js` resolve o CSS na própria pasta. Pacote recebido pela interface em `C:/Users/harre/Downloads/revisao_pacote_kitproposta_v38_evidencias_corrigidas.zip`, 322.825 bytes, SHA-256 `be1cc4245c76d1593196d0fbc3f65f364da494370e55bd76d5869a6d3bea2d9f`. Extração separada com contenção de caminhos em `C:/Users/harre/AppData/Local/LicitaPlena/revisao-kitproposta-v38-evidencias-corrigidas-20261030`; todos os pacotes anteriores preservados.

Revisão independente final: 64 arquivos, 63 hashes válidos no inventário, excluindo somente o próprio manifesto. Nenhum arquivo anterior removido. Apenas LEIA-ME geral e os dois scripts anteriores mudaram; HTML/README do componente, teste principal, baseline, readback e protegidos permaneceram idênticos. Os logs fornecidos da extração limpa registram 162/0, exit 0, e controle negativo 162/1, exit 1; foram conferidos, sem repetir a suíte independente já aprovada para os mesmos bytes. P2 de caminhos encerrado; nenhum novo bloqueador no empacotamento. Detalhes no adendo do parecer independente.

## Integração existente: limites

O código local já monta o kit no dossiê por empresa/processo e oferece `consultar/preparar/exportar` com declaração e proposta DOCX básicas. O pacote de várias peças, timbrado/logo e formação de preço vistos no Design System são demonstrações fictícias separadas. Não houve nova integração do backend nesta retomada, nem autorização para apresentar a demonstração TXT como pacote DOCX produtivo.

Não transportar hashes/comparações de estado do protótipo como autorização do servidor. A revisão independente registrou que o hash do conjunto não abrange todos os metadados dinâmicos necessários à futura integração. A revalidação no backend e a persistência por CNPJ continuam contratos distintos do design visual.

Verificação focal nova encerrada às 22:49:23 UTC: unitário 2/2; fluxo UI com declaração/proposta, revisão e DOCX exit 0; página `processos.html` em seis cenários de sessão/contexto exit 0. Zero pedidos externos/erros de página e 18 hashes observados preservados. Autenticação/REST simulados, handler e geração DOCX do produto, somente loopback. Relatório e logs novos em [retomada-kit-cnpj-20261030/RELATORIO.md](retomada-kit-cnpj-20261030/RELATORIO.md). Não foi repetida a homologação autenticada anterior e não houve alteração de código de produto.

## AI Studio: três testes executados após o aceite

O controle do navegador interno ficou disponível nesta retomada. Foi aberto `https://aistudio.google.com/`, redirecionado para `/prompts/new_chat`, na sessão `harreson.coelho@gmail.com`, com indicador **PRO**. A interface mostrou **Gemini 3.8 Flash (`gemini-3.8-flash`)**, nível de pensamento Medium e **No API key selected**. O modelo foi preservado. Grounding com Google Search foi desligado apenas no novo teste, para limitar a leitura aos anexos; nenhuma configuração do SaaS foi modificada.

Corpus em [ai-studio-leitura-20261030/LEIA-ME.md](ai-studio-leitura-20261030/LEIA-ME.md): ficha textual Alfa de duas páginas, cópia escaneada sem camada textual e proposta Beta com outro CNPJ. São dados inteiramente fictícios, com gabarito separado que não foi enviado ao modelo. A verificação local de integridade/extração/renderização foi seguida pelos três ensaios reais na interface.

A seleção do primeiro PDF abriu o diálogo **Start creating with media in Google AI Studio**. O usuário respondeu explicitamente **“Sim, aceitar para os testes fictícios”** à confirmação sobre direitos e uso dos uploads. O botão de aceite foi então acionado e os testes T1, T2 e T3 foram executados em conversas separadas do AI Studio, na mesma aba interna e com o mesmo prompt. Nenhuma chave foi criada ou cobrança habilitada. Os metadados e URLs privadas de cada execução estão em [execucao-ui.json](ai-studio-leitura-20261030/resultados/execucao-ui.json).

Os três resultados foram capturados integralmente e passam em JSON.parse. T1/T2 vieram de blocos de código; T3 foi lido no editor da resposta, sem digitação ou alteração, porque a renderização interpretou alguns valores R$ como fórmulas. Comprimentos e fingerprints calculados nas strings da UI coincidem com os arquivos locais; SHA-256 adicional registrado. Um erro de transcrição local no fechamento de T1/T2 foi detectado e corrigido contra a UI, com as capturas incorretas preservadas; ele não foi um erro do modelo. Ver [fidelidade-capturas.json](ai-studio-leitura-20261030/resultados/fidelidade-capturas.json).

Resultado observado: conteúdo e ausências da Alfa preservados, inclusive no escaneado; T3 separou a proposta Beta e sinalizou a instrução adversarial sem usar seus dados bancários na Alfa. Achado comum: nomes de arquivo genéricos (`documento.pdf`, `documento_1.pdf`, `documento_2.pdf`), em vez dos nomes reais. A leitura precisa de vínculo de origem controlado pela aplicação antes de integrar sugestões ao cadastro. A forma da validade variou entre texto e número; o prompt não exigia tipo numérico. Comparação detalhada e limites em [RELATORIO.md](ai-studio-leitura-20261030/resultados/RELATORIO.md).

Este é um piloto de três casos fictícios. Não comprova precisão geral, robustez contra outros ataques, custo de API ou prontidão de produção. A leitura não foi integrada ao backend, nenhum dado de cliente real foi enviado e o Design System não recebeu alterações adicionais nesta etapa de ensaio. A recuperação PNCP segue pausada.
