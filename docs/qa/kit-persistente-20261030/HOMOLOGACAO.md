# Homologação — documentos e propostas por CNPJ

## Resultado desta etapa

Concluída a revisão delimitada do KitProposta no Design System privado do Claude e do fluxo funcional local de peças salvas. Não é uma declaração de que o SaaS inteiro está pronto para comercialização.

O mesmo catálogo e chat foram preservados. Entrega identificada pelo Claude como catálogo 41 / build 40. A operação foi feita pelo navegador interno e terminal em segundo plano, sem mouse, teclado ou janelas nativas. Não houve publicação, implantação, migração em produção, SMTP, PNCP ou acesso ao CNPJ Proprio.

## Design System do Claude

As quatro falhas da revisão anterior foram corrigidas: gravação antiga após voltar ao mesmo contexto; botão ocupado após trocar modelo; gravação após perder permissão de edição; aba focada fora da área visível. Revisão independente aprovada: teste novo 29/29, verificações adicionais 9/9, documentos 41/41 e pacote 162/162, todos com código zero. Não houve pedidos externos nem erros de página nesses testes.

O ZIP novo não foi obtido pelo navegador interno. Os diffs exatos e os testes foram lidos da resposta do mesmo Claude, preservados e aplicados estritamente a uma cópia isolada da entrega anterior. O HTML resultante tem exatamente o SHA-256 informado para a versão final: `c8f44a4de6c4dbb1b94854a050d21c15a8260dd92ff379579a942ab13744cb47`. Isso valida os bytes reconstruídos do KitProposta, não o manifesto inteiro do ZIP nem o readback de todos os componentes. PerfilDocumentos tem apenas hash declarado nesta entrega. Detalhamento: `ds-v40-independente/RELATORIO.md`.

Na prévia ao vivo do mesmo catálogo, o navegador interno confirmou:

- End seleciona Peças salvas e desloca a barra horizontal para expor o rótulo. Diferença de borda de 0,406 px é arredondamento; não há rótulo oculto.
- Um rascunho salvo na Empresa Exemplo não aparece na Comercial Modelo; ao retornar, a peça pode ser reaberta no contexto correto.
- Abrir a peça informa que é necessário gerar e confirmar uma nova prévia antes de baixar.
- A declaração integral aparece com empresa, CNPJ fictício, processo, fonte e versão. A pendência do atestado mantém a aprovação bloqueada.

A prévia do catálogo é uma demonstração em memória, com TXT fictício. Não representa banco persistente, upload ou DOCX real. Imagem da verificação: `ds-v40-independente/validacao-iab-design-system.png`.

## Fluxo funcional local, separado da demonstração

Backend e interface local receberam revisão independente T1/T3 já registrada no ledger. O teste pela aba interna usou o handler real com autenticação e armazenamento simulados em memória; não usou Supabase de produção. Seis cenários aprovados em `validacao-iab-fluxo.json`:

1. Declaração da Aurora: prévia integral e confirmação atual liberam DOCX.
2. Horizonte não herda documento nem aprovação da Aurora.
3. Proposta da Horizonte com itens e condições: prévia revisada libera DOCX.
4. Mudar pagamento para 45 dias invalida revisão e download; salvar cria versão 2.
5. A→B→A e reabertura exigem nova revisão.
6. Horizonte reabre versão 2 com pagamento de 45 dias e total R$ 25,00.

O clique de download não foi repetido no navegador interno nesta rodada. A geração e o conteúdo DOCX real já foram verificados pelo harness local, com dois downloads e zero erros de JavaScript. A migração foi exercitada em PGlite, não aplicada a um ambiente real. Evidência visual local: `validacao-iab-proposta.png`.

## Verificações e preservação

- Último gate geral após a correção da listagem: 814 testes, 810 aprovados, 4 skips preexistentes, zero falhas; lint sem erros, 58 avisos; Biome verificou 184 arquivos. Log: `verify-completo-apos-correcao.log`. Não houve nova edição de produto depois desse gate nem repetição desnecessária da suíte geral.
- Comparação final nesta rodada: **20/20 arquivos protegidos idênticos** à baseline, em `protegidos-final.json`. Inclui resumo, envio por e-mail, robô de boletins e autenticação.
- O catálogo continua privado. Não houve alteração de modelo, autenticação, permissão, proxy ou cobrança API.

## Limite para a próxima etapa

O incremento está validado localmente e no comportamento visual delimitado. Antes de disponibilizá-lo a clientes ainda é necessária homologação em ambiente isolado com banco real, migração controlada, contas e permissões por organização/CNPJ e conferência dos arquivos exportados nesse ambiente. A publicação permanece proibida pelo usuário. O histórico PNCP e as demais etapas comerciais não foram tratados nesta rodada.
