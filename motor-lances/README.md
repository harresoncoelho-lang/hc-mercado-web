# Motor local de decisões candidatas

Núcleo determinístico isolado. **Não envia lances**, não acessa portal/rede/armazenamento, não importa IA, não instala extensão e não altera o SaaS. A palavra `aplicado` na resolução é um resultado fornecido pelo chamador confiável (ou fixture), não uma confirmação obtida por este módulo.

## Contrato

`createMotor(policy, config)` recebe política confiável imutável por CNPJ numérico válido, compra e item. Aceita exclusivamente `criterion: 'menor_preco_unitario'` e `mode: 'simulado'`. Desconto, grupos e qualquer modo real/desconhecido são negados. Não representa regras oficiais do ComprasGOV.

- Valores são strings canônicas positivas `12.3456`, exatamente quatro casas e no máximo 12 dígitos inteiros; `BigInt` evita arredondamento binário. Limite do protótipo, não do portal. Decremento e piso são escolhidos por pessoa autorizada, nunca pela IA.
- `config` fixa fonte e idade máxima do snapshot. Fonte textual não autentica origem: o adaptador futuro precisa comprová-la. Snapshot exige CNPJ/compra/item/critério/modo iguais, fonte esperada, instante recente não futuro, sessão ativa, item aberto, liderança booleana, melhor preço e preço próprio conhecidos. Dados faltantes bloqueiam.
- `authorize(auth, now)` recebe autorização já validada pelo chamador, com ID novo, `policyKey`, início e expiração. `policyKey` compara o conteúdo inteiro da política, **não é assinatura ou segredo**. Nenhum dado do snapshot cria autorização.
- `decide(snapshot, now)` retorna `candidata` ou `bloqueado`. Candidata é melhor preço menos decremento, respeitando piso e melhoria sobre próprio preço/última confirmação. Se já líder, não propõe. Sempre retorna `sent: false` e reserva pendência antes de retornar.
- `resolve({decisionId, outcome, price?}, now)` é entrada **confiável separada**: `aplicado` requer valor exato da candidata; divergência mantém incerto. `desconhecido` bloqueia nova candidata; `rejeitado` conhecido libera pendência. Não aceite essa função diretamente de DOM/modelo/cliente remoto sem validação de origem, escopo e evidência.
- `pause()` remove autorização e impede novas candidatas, preservando pendência. Retomar exige ID de autorização novo. `revoke()` é terminal para a instância. Expiração remove autorização. `status(now)` expõe somente estado e presença de pendência.
- O relógio inteiro em milissegundos é injetado pelo chamador confiável em todas as ações temporais; não vem do documento/modelo. Regressão temporal é negada. O módulo não conhece horário oficial do portal.

## Estado e concorrência

Reserva síncrona impede duas candidatas pendentes **na mesma instância JavaScript**. Não existe exclusividade entre abas, processos ou usuários, persistência, retomada após reload, fila de transporte, autenticação ou autorização real. IDs de decisão são locais; não são chave global de idempotência. Criar outra instância não é estratégia de reconciliação.

A autorização não é persistida. Toda nova instância começa não autorizada. Observação válida de fonte/contexto/tempo avança a referência temporal mesmo se item fechado, líder ou preço impedir candidata; observação anterior não volta a habilitar decisão. Mudança explícita de CNPJ/compra/item ou sessão expirada/desconectada/revogada em envelope fresco da fonte esperada pausa e remove autorização, mesmo durante pendência; esta permanece para conciliação. Retornar ao contexto exige autorização nova. Envelope inválido/fonte errada apenas bloqueia aquela leitura, sem revogar autorização.

Snapshot já consumido não é reutilizado; a próxima decisão exige observação posterior e novo ID. Uma rejeição conhecida permite considerar um novo snapshot, mas uma resposta incerta nunca é reclassificada automaticamente como rejeição.

## Validação

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node --test motor-lances/motor.test.mjs
```

Testes cobrem precisão extrema, piso, liderança, conteúdo da política, expiração, pausa/revogação, fonte/contexto, antiguidade/futuro, concorrência de chamadas na mesma instância, resolução incerta/divergente, replay e isolamento de entradas/estado. Fixtures não homologam portal ou robô operacional. A integração com execução real exige ainda exclusividade distribuída, fonte autenticada, evidência de aplicação e regras oficiais verificadas.

## Onde mora e quem usa

O código está em `motor-lances.js` (raiz, script clássico com `module.exports`) para o navegador carregar com `<script src>` em `sistema.html`; `motor-lances/motor.mjs` só reexporta. `robo-lances.js` usa o cérebro no simulador da tela "Robô de lances" (modo assistido, contexto fictício `mode: 'simulado'`) e acrescenta as regras de tempo (20 s entre lances próprios, 3 s após o melhor de outro) e de valor (diferença mínima do edital, lance igual ao melhor recusado), que o cérebro não conhece.
