# Proposta revisada → lote operacional

Adaptador **server-side isolado**, sem endpoint novo, rede, portal, alteração no kit ou integração instalada. Reaproveita `preparar`, `decimal` e `totalItem` de `_kit_documentos.js`, `validateContext` e `validarLote`. Não converte revisão de DOCX em autorização de cadastro/lance: resultado conserva `writeAuthorized:false` e `portalAuthorizationRequired:true`.

## Entrada real e fronteira de confiança

`propostaParaLote(abertura, snapshotPortal, confiavel)`:

- `abertura`: shape real da ação `abrir` do endpoint `kit-documentos`: `{documento, revisaoVigente}`. Documento público tem `id`, `tipo`, `versao`, `empresaId`, `processoId`, `organizacaoId`, `revisadoPor`, `dados.proposta` e `revisao:{hash,versao,revisadoPor,...}`.
- `confiavel.contextoKit`: contexto **atual obtido no servidor após autenticação, autorização e verificação de fontes**, no shape de `carregarEscopo`/`preparar`: `userId`, `empresa`, `processo`, `perfil`, `itens`. Valores de itens vêm de `quantidade` e `valor_unitario_proposta` em texto. Não passar payload do navegador/modelo como contexto confiável.
- `confiavel.vinculo`: `{empresaId,processoId,organizacaoId,contextoPortal:{cnpj,uasg,number,year,purchaseId}}`, associação explícita e verificada entre processo do kit e compra do portal. Não inferida do número textual do edital.
- `confiavel.catalogo`: contrato de `validarLote`, com ID oficial, quantidade, grupo e exigências. `confiavel.mapeamento`: array `{itemKitId,itemPortalId}` com ligação UUID interno → ID oficial verificada. Posição, `identificador` textual ou ordem da planilha nunca substituem o mapeamento.
- `snapshotPortal`: evidência do coletor de contexto, ainda sujeita aos limites documentados da extensão. Este adaptador não autentica essa fonte e não homologa o rótulo fornecedor no portal.

Confere escopo/revisor/versão, recalcula a prévia pelo helper existente e compara revisão do documento salvo. O envelope `{documentoId,versao,revisaoHashLegado}` reproduz exclusivamente a linha de `prepararPeca` do endpoint, que não é exportada. Teste usa **o handler real** para gerar hash/shape de `preparar`/`abrir`, com transporte Supabase/Auth fictício, e depois alimenta o adaptador. Não há canonização paralela do conteúdo do kit. Se o envelope do endpoint mudar, o teste deve detectar a incompatibilidade; não alterar o endpoint protegido nesta fase.

Hash é integridade, não credencial. O adaptador não substitui autorização de membro/RLS, validação de fonte privada nem reconsulta do backend. A integração futura deve fazê-las antes da chamada e novamente antes de qualquer efeito externo. O resultado não deve ser considerado autorização persistente.

## Dados e precisão

Somente campos permitidos são levados ao lote: ID oficial, quantidade, unitário, marca/modelo e grupo/exigências do catálogo. Não propaga custo, margem, observações internas ou metadados adicionais. O kit atual não entrega fabricante; se o catálogo o exigir, o lote bloqueia em vez de inventar ou aceitar um campo não revisado.

Preço de duas casas é preenchido até quatro sem alterar valor (`12.50 → 12.5000`); quantidade de até três casas conserva o valor. O kit arredonda subtotal para centavos. Quando esse subtotal diverge do total decimal exato operacional, o adaptador bloqueia `precisao_divergente`; não muda preço nem apresenta a revisão documental como suficiente.

O contrato local candidato do kit foi ampliado, com autorização da coordenação, de **50 para até 1000 itens por peça**, sujeito também ao orçamento de tamanho. A baseline de 50 foi superada; testes preparam e revisam genuinamente 51, 200 e 1000 itens pelo handler real, passam pela factory e executam no motor fictício. O handler rejeita 1001, e alterações posteriores à revisão bloqueiam a composição. Isso é capacidade local candidata, não homologação remota ou prova de capacidade do portal. Grupos vêm do catálogo completo e precisam passar na validação de completude; associação oficial desse catálogo ainda depende da integração real.

## Testes

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node --test operacao-assistida/proposta-para-lote.test.mjs
node --test operacao-assistida/proposta-cadastro.test.mjs
```

Os testes executam handler/helper reais, mas usam `fetch` fictício interceptado e dados fictícios. Não são homologação de banco, portal ou UI. Nenhuma migração, proposta, lance, e-mail ou publicação faz parte deste módulo.

## Preparação autenticada na API existente

`kit-documentos.js` aceita `prepararOperacao` somente com empresaId/processoId/documentoId/versaoEsperada. A ação reutiliza Auth, papel operador/gestor, RLS/escopo, peça persistida, identificação, itens atuais, origem e revisão recalculada. Dados operacionais do navegador são recusados. Não cria motor nem envia proposta: devolve somente lote validado, `writeAuthorized:false`.

O handler padrão não possui leitor de vínculo Compras.gov e retorna409 `vinculo_portal_indisponivel` mesmo com proposta válida e origem PNCP. `criarHandler({carregarEvidenciaPortal})` é composição servidor para um futuro leitor confiável, hoje exercitado exclusivamente com doubles rotulados. Não há env/global para habilitar fonte nem certificado fabricado. O leitor deve verificar vigência/revogação/versionamento e origem antes de retornar snapshot/vínculo/catálogo/mapeamento; campos tipo/vigente são contrato interno, não autenticação criptográfica ou prova oficial. Contexto do kit sempre vem do próprio handler, nunca substituído pela fonte.

Caller integrado na UI existente: `Preparar cadastro` aparece somente após confirmar revisão de proposta nesta abertura. Envia apenas seletores; mostra CNPJ/processo/versão e bloqueio específico de vínculo, ou itens para conferência. Não inicia motor nem envia. Mudança de conteúdo/tipo/contexto/versão invalida o resultado; resposta tardia é descartada. Bloqueio de vínculo não invalida um DOCX já revisado. Outros erros exigem nova revisão.

Depois de aguardar evidência, handler revalida sessão/permissão, documento/versão, identificação, origem e hash antes de produzir lote. Isso detecta mudanças observáveis durante a espera; não afirma snapshot transacional nem autorização de escrita.

Build Cloudflare local real com Wrangler4.151.1, compatibility2025-09-01/nodejs_compat, rede bloqueada e ambiente sem segredos: pasta externa `C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031/preparacao-operacional-ui-20261102`. Exit0, bundle inclui helper/ponte/validadores ESM; import literal vira `Promise.resolve().then(init_preparar_operacao)` interno, sem busca de módulo em runtime. Não foi necessário duplicar núcleo nem conversão CJS paralela. Compilação não prova orçamento CPU ou runtime remoto. Loader VM do harness positivo não foi ampliado; serviço ativo intacto, caminho padrão permanece fechado por falta de fonte.

Teste UI usa script canônico em DOM mínimo simulado, handler real para abrir/preparar/prepararOperacao e doubles para metadados/listagem/confirmação. Prova ligação e invalidação, não aparência visual. Testes backend usam Auth/REST fictícios; não há portal real. Próximo gate: inspeção visual no navegador interno e produtor confiável de vínculo/catálogo do portal.