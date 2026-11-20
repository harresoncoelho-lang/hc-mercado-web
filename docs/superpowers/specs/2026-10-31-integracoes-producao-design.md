# Preparação das integrações de documentos e propostas

## Intenção e autorização

Atender ao pedido de conferir o ambiente de produção e preparar as integrações do módulo homologado, sem publicação, operação do desktop ou alteração de resumo, e-mail e boletins. O usuário já autorizou continuidade, decisões de implementação necessárias e trabalho por especialistas nesta mesma conversa. Não é uma nova escolha de produto ou hospedagem.

## Abordagem escolhida pela coordenação

Preservar Cloudflare Pages, o projeto Supabase atual, as URLs e a autenticação existentes. Conferir produção por leitura e compilar/testar o candidato localmente em uma pasta nova e isolada. Preparar requisitos de configuração, migração e retorno ao estado anterior; não aplicá-los remotamente.

Alternativas descartadas: trocar apenas as URLs dos adapters criaria risco de autenticar num projeto e acessar outro; migrar hospedagem ou refazer autenticação amplia o escopo e ameaça os fluxos protegidos. A preparação usará os pacotes já instalados e manterá os mesmos flags e data de compatibilidade.

## Entregas

1. Matriz de estado observado: superfície pública, projeto/deployment e nomes de configurações acessíveis pelo cliente administrativo nativo; o que não for demonstrável ficará marcado como não comprovado.
2. Artefato local de integração: arquivos estáticos necessários, bundle real completo de Pages Functions, hashes e resultados de verificações de tamanho, inicialização e contratos das duas rotas do módulo.
3. Testes no runtime local de Workers, com serviços externos substituídos por fixtures explícitas e qualquer outra saída de rede bloqueada. Essa prova complementa, sem substituir, a homologação anterior com banco/Auth/Storage reais.
4. Roteiro de implantação futura: inventário SQL, dependências, configurações somente pelos nomes, sequência de verificação e rollback. Nenhum script deve publicar ou aplicar migração automaticamente.

## Preservação obrigatória

- Vinte arquivos protegidos devem conservar os hashes da baseline existente. Não alterar modelo, autenticação, e-mail, resumo, robôs, cliente nativo ou permissões.
- Sem deploy, push, commit, importação, SQL remoto, SMTP, IA externa, PNCP ou CNPJ Proprio. Sem novos acessos OAuth ou instalação de ferramentas.
- Leitura administrativa remota somente com credencial já existente; sem registrar valores de segredos, e-mail ou identidade da conta. Ausência de acesso não comprova ausência de configuração.
- Diretório de saída novo fora de `publico/`; não apagar nem reconstruir a saída do usuário. Preservar todas as evidências anteriores e o worktree sujo.
- Não copiar arquivos privados, brutos ou credenciais para o pacote. Manter saída e logs fora dos caminhos publicados.
- Compilar todas as rotas existentes sem modificar handlers protegidos. Qualquer falha deve ser diagnosticada; não remover funções para obter um build verde.

## Critérios de conclusão

Bundle compilado e verificado no escopo possível, preparação reproduzível sem mutação remota, configuração documentada com evidências, revisão independente e hashes protegidos preservados. O relatório deve distinguir compilação local, simulação do runtime, homologação real anterior e configuração de produção. Nenhuma dessas provas autoriza publicação ou certifica sozinho o SaaS inteiro.
