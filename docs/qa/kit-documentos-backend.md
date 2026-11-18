# Kit de documentos — verificação local do backend

O endpoint `POST /api/kit-documentos` implementa o contrato em `docs/superpowers/plans/2026-10-27-kit-contrato.md`. Permanece fechado sem `IDENTIFICACAO_EMPRESA_LOCAL=1`, sessão válida, cliente aprovado e RPC de identificação verdadeira. Nenhuma credencial, serviço de IA, cobrança, migração ou persistência de rascunho foi adicionada.

Cada chamada lê empresa ativa, membro, processo, itens e identificação com o JWT da sessão. Além das políticas RLS, o servidor confronta usuário, papel gestor/operador, organização, restrição empresarial do membro e vínculos empresa/processo/item. Leitura não autoriza geração. As consultas de itens projetam os campos numeric como texto no PostgREST; o cálculo nunca passa por Number nem aceita preço do navegador ou total legado como unitário.

Consulta retorna pendências de identificação. Preparação exige identificação completa, proveniência válida e hashes atuais dos documentos privados. Exportação repete as leituras, recompõe o texto e compara o SHA-256 canônico com usuário, empresa, processo, perfil/versão, itens selecionados ordenados e campos manuais. Identificação ou preenchimento que deixam de ser válidos após uma revisão com hash também invalidam a exportação com 409. O hash vincula conteúdo; não comprova que a pessoa leu. As leituras não constituem snapshot transacional entre serviços.

Quantidade em milésimos e preço em centavos usam BigInt; arredondamento metade para cima ocorre por item antes da soma. Limites numeric(15,3)/(15,2), positivos, formatos e precisão são verificados. Lotes, unitário ausente, duplicatas, condições ou unidade ausentes bloqueiam a proposta. Marca/modelo ausentes são apresentados para revisão, sem valores inventados. Requisitos são os documentos exigidos já persistidos no processo e continuam sujeitos à conferência do edital.

Declaração aceita somente as sete variáveis documentadas. Título/texto são obrigatórios, texto limitado a 20 mil caracteres e XML inválido é recusado. A referência fornecida é identificada na prévia como informação do usuário não verificada. O DOCX usa a implementação existente de `montarDocx`, agora com exportação pública e título opcional; o kit preserva linhas vazias, enquanto os padrões do checklist e da minuta legada permanecem iguais.

Execute, na raiz do worktree, após definir `VOLTA_HOME=C:\Users\harre\AppData\Local\Volta`:

```powershell
node --test scripts/kit_documentos.test.js netlify/functions/__tests__/kit-documentos.test.js netlify/functions/__tests__/empresa-identificacao.test.js scripts/empresa-identificacao.test.js netlify/functions/__tests__/gerar-checklist.test.js netlify/functions/__tests__/minuta-exportacao.test.js scripts/checklist_fonte.test.js
```

Os testes usam funções de produção e simulam Auth/REST/Storage somente na fronteira fetch. Cobrem papel, empresa/processo/item cruzados, pendências, substituição de PDF, nova leitura dos hashes, revisão obsoleta, cálculo, variáveis e XML. O pacote DOCX é inspecionado com AdmZip e lido pelo Mammoth instalado; ambos recuperam o conteúdo empresarial e monetário esperado.

Não comprova implantação, políticas remotas, snapshot transacional, nem a apresentação final no Word/LibreOffice. A suíte SQL local e a demonstração visual integrada são verificações separadas do controlador. Nenhuma chamada de produção, coleta, e-mail ou CNPJ Proprio foi executada.
