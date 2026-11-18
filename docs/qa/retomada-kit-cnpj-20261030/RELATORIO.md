# Verificação focal local — documentos e propostas por CNPJ

Executada em 30/10/2026, entre 22:48:59 e 22:49:23 UTC, com Node v24.22.0 do Volta. Nenhum código do produto foi alterado nesta verificação.

## Resultado observado

| Verificação | Resultado novo |
| --- | --- |
| `node --test scripts/kit_documentos_ui.test.js` | 2 testes, 2 passaram, 0 falhas |
| `node docs/qa/retomada-kit-cnpj-20261030/verificar-kit-documentos.cjs` | Exit 0: declaração, proposta, DOCX, revisão, pendências, teclado, troca A→B→A com resposta tardia, fechar/reabrir, temas claro/escuro e largura de 375 px |
| `node docs/qa/verificar-kit-processos.cjs` | Exit 0: logout, troca de usuário explícita/silenciosa, falha após recarga pendente, mesmo usuário e renovação de token |

Os três arquivos de stderr ficaram vazios. Os logs, horários e códigos de saída estão nesta pasta. O teste de UI afirmou zero pedidos externos e zero erros de página. A imagem móvel foi inspecionada: identificação da empresa/processo, formulário, prévia integral e confirmação permanecem legíveis, sem transbordamento horizontal.

O verificador de UI grava quatro artefatos junto ao próprio arquivo. Para preservar as evidências anteriores em `docs/qa`, foi usada uma cópia byte a byte do script nesta pasta, com um helper de uma linha que reexporta o servidor local original. Nenhum assert foi modificado. As novas imagens e o novo DOCX fictício ficaram somente aqui. Os arquivos `baseline.json` e `integridade-final.json` confirmam os mesmos hashes nos 18 arquivos observados, incluindo código pertinente, auxiliares de autenticação/geração e as quatro evidências antigas.

## O que já está integrado no código local

- `processos.html` monta o módulo no dossiê com `empresaId`, `processoId` e sessão. Troca de contexto ou sessão invalida a revisão anterior.
- `kit-documentos-ui.js` chama `/api/kit-documentos` nas operações `consultar`, `preparar` e `exportar`. Mostra o conteúdo integral antes da confirmação e exige nova prévia quando os dados mudam.
- `netlify/functions/kit-documentos.js` valida organização, vínculo do usuário, empresa, processo, identificação confirmada e itens. Recalcula o hash antes de exportar o DOCX.
- O recorte existente gera declaração com modelo informado pelo usuário e proposta de materiais com itens persistidos do processo. Não inclui persistência de rascunhos, biblioteca de modelos, timbrado/logo nem pacote persistente com várias peças.

## Limites desta evidência e do Design System

Esta rodada usou fixtures e servidor em loopback, com handler e geração DOCX do produto. Autenticação e REST foram substituídos pelo harness fictício. O teste de `processos.html` carrega a página real, porém simula eventos e respostas de sessão. Ele não confirma permissões de um banco de produção, validade de tokens reais nem implantação.

O pacote KitProposta v37 analisado antes desta rodada é uma demonstração do Design System: empresas/processos fictícios, geração em memória e download TXT. Não constitui integração com essa API. A coordenação informou nesta rodada que conferiu a UI nativa v38 no ciclo gerar → cancelar → reabrir → confirmar somente a declaração. Essa é evidência separada da coordenação; os três checks locais não certificam a versão atual do artefato nativo nem conectam a demonstração ao backend. A coordenação também informou que a inferência no AI Studio não foi executada, pois o serviço exige aceite ainda pendente do usuário.

Não foi repetida a homologação autenticada anterior, nem iniciado acesso ao PNCP, produção, SMTP ou CNPJ Proprio. Não houve publicação ou alteração do resumo, e-mail, robô de boletins, autenticação ou modelos. O próximo passo de apresentação deve reutilizar o contrato existente e continuar distinguindo interação demonstrativa de recurso persistido.
