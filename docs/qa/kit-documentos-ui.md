# Kit de documentos — demonstração local fictícia

Na raiz do projeto, em PowerShell:

```powershell
$env:VOLTA_HOME='C:\Users\harre\AppData\Local\Volta'
node docs/qa/servir-kit-documentos-local.cjs
```

Abra http://127.0.0.1:8793. O servidor só escuta em `127.0.0.1`, aceita Host local e serve quatro rotas de arquivos explicitamente permitidas. Não publica pastas, `.git`, configurações ou arquivos privados. Pare com Ctrl+C.

Os dois CNPJs, empresas, representantes e processos são inventados e sinalizados como FICTÍCIOS. A UI é `kit-documentos-ui.js`, a mesma usada no dossiê de `processos.html`. Consulta, prévia e download passam pelo handler real de `kit-documentos`, incluindo controle de revisão e produção do DOCX pelo helper existente. Apenas Auth/REST são simulados com fixtures; toda tentativa não prevista de fetch do handler é bloqueada. Nenhuma credencial de sessão real ou conexão externa é usada. O gate local é definido somente durante a chamada fictícia e restaurado em seguida; produção permanece inalterada.

1. Clique em **Preencher exemplo fictício** ou informe título e texto da declaração, por exemplo `A empresa {{razao_social}}, CNPJ {{cnpj}}, apresenta este exemplo ao {{orgao}}.` O botão só existe na demonstração e nunca marca revisão.
2. Prepare a prévia, leia o texto integral, marque a revisão e baixe DOCX.
3. Altere qualquer campo: o download fica bloqueado até preparar e revisar novamente.
4. Selecione proposta, item e unidade manual; informe validade, entrega e pagamento. Prepare, confira e baixe.
5. Troque empresa/processo, feche e reabra a seção: campos e revisão anteriores são descartados.
6. Alterne o tema e reduza a janela a 375 px para verificar apresentação móvel.

Automação sem rede externa:

```powershell
node --test scripts/kit_documentos_ui.test.js
node docs/qa/verificar-kit-documentos.cjs
```

O QA abre Edge headless instalado, limita rede ao servidor efêmero local, confere o texto XML dentro do DOCX e produz `kit-escuro.png`, `kit-claro.png`, `kit-mobile.png` e `kit-exemplo-ficticio.docx`. Inclui teclado, pendências, alteração da revisão, troca A→B→A com resposta tardia e fechamento/reabertura. As capturas são evidência local; não comprovam implantação ou homologação remota. Não há persistência de rascunhos, assinatura ou envio.
