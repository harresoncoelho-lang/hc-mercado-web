# Documentos e propostas — homologação com serviços reais locais

27/10/2026, Brasília. **Fluxo testado aprovado no ambiente local. Sem publicação ou alteração de produção.** Evidência estruturada: [homologacao-kit-real-local.json](homologacao-kit-real-local.json).

## Ambiente e preservação

Foi retomado o Compose já existente `licitaplena-qa-real`, com PostgreSQL 17.11, GoTrue, PostgREST 16.4 e Supabase Storage reais. As quatro portas continuam vinculadas exclusivamente a `127.0.0.1`. O servidor de homologação é o existente `servir-identificacao-local.cjs`, acrescido apenas do endpoint `kit-documentos` à lista permitida. Chamadas dos handlers são redirecionadas ao stack local; destinos externos são bloqueados.

O banco continua sendo `licitaplena_qa_ui_v2`, com dados fictícios. Antes da migração foi preservado um backup em `AppData/Local/LicitaPlena/supabase-homologacao/antes-seguranca-operacao-20261027.sql`, fora do repositório e do OneDrive. A migração incremental `seguranca_operacao.sql` foi aplicada duas vezes, com sucesso, pelo proprietário existente `supabase_admin`. A primeira tentativa com `postgres` não tinha CREATE no schema e foi revertida; não se ampliaram seus privilégios.

Os JWT exclusivos da homologação anterior estavam vencidos e o Auth recusou o acesso com 403. Foram renovados por 24 horas usando o mesmo segredo local, os mesmos papéis e sem alterar a configuração de sessões. Os tokens ficam nos arquivos privados existentes, nunca nas evidências. Nenhuma autenticação do SaaS, Claude ou Codex foi alterada.

## Fluxos verificados

- Login e autorização reais: anônimo, cliente pendente, leitor, outra organização, operador restrito a outro CNPJ e processo divergente são bloqueados.
- Gate de segurança aprovado por chamada autenticada real. As projeções `numeric::text` do PostgREST preservam quantidade e preço sem conversão binária prematura.
- Duas empresas da mesma organização geram declarações separadas. Os DOCX contêm somente a empresa/processo escolhidos.
- Exportar exige revisão explícita. Hash adulterado e alteração posterior de preço, identificação ou arquivo de origem bloqueiam a exportação anterior com 409.
- Proposta usa itens persistidos. Quantidade `0,125` × preço `0,12`, somada a `3` × `1,23`, resulta em **R$ 3,71**; mudança do segundo preço para `2,34` exige nova prévia e resulta em **R$ 7,04**. Item de outro processo é rejeitado.
- Escrita direta do leitor é negada por RLS. A RPC de confirmação não pode ser chamada pelo usuário comum.
- Upload, extração de PDF, confirmação de proveniência e download privados usam Storage real. Leitor pode consultar o documento no seu escopo, mas não sobrescrevê-lo. Outra organização não consegue baixá-lo. Substituição autorizada da fonte invalida o documento já preparado.
- Limpeza conferida: quatro usuários de teste, duas organizações e um arquivo criados nesta execução foram removidos; o conteúdo preexistente da homologação foi preservado.

O roteiro anterior `revisar-identificacao-real-local.cjs` também passou seus oito grupos, incluindo fontes/hash, RPC privada, preenchimento manual e isolamento. Os 14 testes unitários focados do kit passaram, e `git diff --check` não apontou erros. `painel.html`, envio do resumo, robô Python e workflow de boletins não têm alterações nesta etapa.

A verificação consolidada final `npm run verify`, após as revisões da recuperação de cobertura e retenção, terminou com **713 testes: 709 aprovados, 4 ignorados e zero falhas**; lint com zero erros e 50 avisos preexistentes. Os quatro casos ignorados continuam sendo o timeout real de página e três cenários de volumes RAR. Saída preservada em `verify-final-homologacao-20261028.log`; os logs das rodadas anteriores foram mantidos separadamente.

## Reproduzir

Com o Compose local ativo e os JWT de teste ainda válidos:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node docs/qa/servir-identificacao-local.cjs
```

Em outro processo, na mesma raiz do worktree:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node docs/qa/revisar-identificacao-real-local.cjs
node docs/qa/homologar-kit-real-local.cjs
```

Os documentos fictícios exportados são `kit-real-declaracao-alfa-ficticia.docx`, `kit-real-declaracao-beta-ficticia.docx` e `kit-real-proposta-alfa-ficticia.docx`. Conteúdo e estrutura foram verificados com Mammoth e assinatura ZIP.

Além do roteiro automatizado, o agente principal abriu diretamente **a proposta Alfa e a declaração Alfa** na interface nativa do Microsoft Word instalado. Ambas abriram sem alerta de reparação ou formato, com texto legível e sem cortes observados. Na proposta, conferiu dois itens, identificação/representante/edital e total de **R$ 3,71** (`0,125 × 0,12 → 0,02`; `3 × 1,23 → 3,69`). Na declaração, conferiu a empresa Alfa e a substituição das variáveis. Nenhum documento foi alterado ou salvo nessa inspeção.

## Limites

O schema-base desse ambiente foi reconstruído em rodadas anteriores; não é cópia autoritativa do banco de produção. Esta aprovação não certifica os grants, policies ou dados legados remotos. Nenhum e-mail, robô, IA, coleta externa ou CNPJ Próprio foi executado. O teste HTTP não substitui a revisão visual no Design System nem comprova todos os estados de interface.

A inspeção no Word ficou restrita aos dois documentos Alfa citados. Não foram inspecionados visualmente o documento Beta nem documentos longos ou com várias páginas.

O stack e o servidor local foram mantidos disponíveis para revisão, preservando os volumes. Tokens de homologação expiram; futuras execuções precisam renová-los somente no ambiente local, sem alterar a autenticação de produção.
