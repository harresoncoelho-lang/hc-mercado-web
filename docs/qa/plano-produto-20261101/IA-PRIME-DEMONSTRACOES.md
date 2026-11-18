# Integração com IA — demonstrações e próximo incremento

Consulta: 01/11/2026. Escopo: fontes públicas e registros de evidência já preservados. Nenhuma conta foi conectada, ferramenta instalada, API privada sondada, custo ativado ou dado de cliente transmitido.

## Resposta ao pedido do usuário

A pesquisa foi além dos folders: existe um tutorial oficial de aproximadamente 6min37s, ligado pelo próprio site. A coordenação anterior inspecionou quadros e registrou horários. Esta rodada releu essa evidência; a tentativa adicional de abrir o vídeo pela ferramenta web foi limitada por throttling. **Não houve nova reprodução integral, transcrição disponível ou teste independente da integração.**

O que o concorrente apresenta é o acesso ao Licitante Prime **a partir do ChatGPT/Claude**, usando a conta conectada. Isso é diferente de colocar uma janela genérica de IA dentro do SaaS. O site anuncia busca, detalhes/itens, favoritos, Kanban e relatórios, com login e revogação; declara que o conector não envia propostas nem lances. [Site oficial, seção ChatGPT e Claude](https://licitanteprime.com.br/#ia).

## Evidências e limites

| Evidência | Observação preservada | O que não prova |
| --- | --- | --- |
| [Tutorial oficial](https://www.youtube.com/watch?v=Xa85HQDnnlU), 0:59 | Catálogo Plugins do ChatGPT com Licitante Prime | Implementação interna, protocolo ou disponibilidade para toda conta |
| Mesmo vídeo, 1:09 | Legenda/narração menciona autorização | Scopes, TTL de token, OAuth/PKCE ou efetividade de revogação |
| Mesmo vídeo, 2:38 | Tabela de oportunidades no ChatGPT | Exatidão/completude dos dados ou isolamento entre clientes |
| Mesmo vídeo, 3:57 | Oportunidades/relatório no Claude | Arquitetura MCP específica do concorrente |
| Registro técnico anterior, 5:17 | Pedido de relatório de licitações ganhas por empresa; uso da integração indicado | Resultado validado contra dados originais |

Rastreabilidade local: `C:/Users/harre/AppData/Local/LicitaPlena/re-licitante-prime-20261101/evidence/EV-005-observacoes-videos.md` e `PESQUISA-PRIME-TECNICA.md` nesta pasta. A observação por quadros é atribuída à coordenação, não apresentada como nova inspeção deste pesquisador. O exportador de transcrição anterior informou indisponibilidade. O Instagram é fonte de anúncio, não contrato técnico.

Não foram comprovados endpoint MCP, OAuth scopes, esquema de ferramentas, modelos, fine-tuning, regras internas, armazenamento ou política de tokens do concorrente. **MCP é uma opção própria para o LicitaPlena, não uma descoberta confirmada sobre o Prime.** Não há motivo para inventar rotas de autenticação nem copiar um protocolo não observado.

## Implementação própria proposta

Dois produtos podem compartilhar o mesmo núcleo de domínio:

1. **Conector externo:** o usuário permanece no ChatGPT/Claude e autoriza leitura da sua organização/CNPJs do LicitaPlena. Usa ferramentas que consultam dados autorizados. O assistente escreve a resposta a partir desses resultados.
2. **Assistente dentro do LicitaPlena:** aplica as mesmas regras e fontes na jornada do site. Cobrança de inferência, limites e provedor exigem decisão e medição próprias; a assinatura pessoal Pro não é tratada como autorização de API de produção.

Os conectores remotos personalizados do Claude usam MCP; a conexão parte da infraestrutura Anthropic, então hospedagem acessível e autenticação precisam ser resolvidas antes da homologação. O cadastro de um conector não garante aceitação no diretório. [Documentação oficial Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Configuração a entregar ao cliente: no LicitaPlena, escolher conta/empresas e permissões; no Claude, adicionar o endereço do conector em Conectores, revisar autenticação detectada e conectar; no ChatGPT, disponibilizar a integração com metadados e autenticação para que o cliente reconheça a conta autorizada. Os nomes exatos dos menus e elegibilidade do plano devem ser conferidos no cliente usado durante a homologação. A configuração termina somente quando uma consulta autorizada funciona e outra empresa/revogação são negadas. Não pedir senha do portal nem chave administrativa do banco em conversa.

Custos ainda não medidos: hospedagem, banco/armazenamento, tráfego, manutenção do conector e eventual inferência usada pelo próprio servidor. O uso do assistente externo e a IA interna têm planos e limites distintos. As fontes consultadas não estabelecem preço final nem cobertura por assinatura do usuário; não prometer API gratuita/ilimitada. Não houve ativação de cobrança. A revisão de plano/preço fica pendente antes de publicar ou contratar infraestrutura.

No ChatGPT, ferramentas devem ter schemas, anotações e autorização efetiva no servidor; um rótulo `readOnlyHint` não implementa segurança. Resultados precisam de IDs estáveis e fontes, sem tokens ou dados pessoais desnecessários. [Guia oficial de servidor MCP](https://developers.openai.com/plugins/build/mcp-server). A configuração OAuth por ferramenta e o desafio de autenticação precisam corresponder à verificação real de emissor, destinatário, validade e escopos. [Autenticação oficial](https://developers.openai.com/plugins/build/auth).

Para MCP HTTP, implementar OAuth apropriado, validar destinatário do token e não repassar o token recebido para APIs externas. PKCE protege o fluxo de código; permissões de negócio por organização/CNPJ continuam responsabilidade do nosso servidor. [Especificação de autorização](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [segurança](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations). Essas páginas foram reconferidas via web e Context7 nesta rodada; não foi instalado SDK.

## Como a IA entende licitações

Proposta de engenharia do produto, ainda não implementada nesta pesquisa:

- Instruções de domínio versionadas: vocabulário, fases, distinção entre exigência do edital e sugestão, tratamento de retificação e informação ausente.
- Recuperação de evidência autorizada: edital/anexos/retificações, página, trecho, versão e data da consulta. Resposta sem fonte suficiente deve declarar insuficiência, não completar por imaginação.
- Ferramentas determinísticas para itens, valores, prazos, permissões e estado. A IA não decide quem pode acessar dados nem altera o piso de lance.
- Documentos são conteúdo não confiável: instruções embutidas não podem mudar ferramentas, destinatários, escopos ou ações autorizadas.
- Casos de avaliação revisados pelo licitante: exigência ausente, anexos contraditórios, edital retificado, item de outra empresa, consulta sem acesso, resposta com fonte incorreta. Medir erro e cobertura antes de alegar especialização.

Não é necessário presumir fine-tuning para o primeiro incremento. Conhecimento atualizado, recuperação com fontes, ferramentas delimitadas e avaliações são o trabalho inicial concreto. Uma skill pode explicar o fluxo ao assistente, mas não substitui autorização, dados ou validação de saída. Orientação jurídica gerada deve ser rascunho fundamentado e revisável, sem inventar dispositivos ou precedentes.

**Agentes de desenvolvimento** são os trabalhadores que implementam, testam e revisam o LicitaPlena; seus acessos e agendas não devem ser herdados pelo produto. **Agentes do produto** atuam por solicitação ou rotina autorizada de um cliente, com escopo, limites e trilha próprios. Um prompt especializado ou uma skill não transforma o modelo em um modelo treinado especificamente para licitações; a especialização aqui proposta é do sistema completo e precisa ser demonstrada por avaliação.

## Próximo incremento executável sem credenciais

Construir um núcleo isolado, sem servidor público, sem rede e sem LLM, com catálogo de ferramentas e repositório de fixtures fictícias. O objetivo é provar o contrato e a separação de contas antes de escolher transporte/hosting.

| Ferramenta proposta | Entrada de domínio | Resultado limitado |
| --- | --- | --- |
| `listar_empresas_autorizadas` | Nenhum identificador de usuário fornecido pelo modelo | IDs/nome fictício das empresas vinculadas à identidade validada |
| `buscar_oportunidades` | Empresa autorizada, objeto/filtros, cursor/limite | IDs, dados públicos mínimos e fonte/data |
| `obter_itens` | Empresa, processo, cursor/limite | Itens estruturados e origem/versão |
| `consultar_esteira` | Empresa e filtros de etapa | Processos daquela empresa e estado observado |
| `consultar_evidencia_documental` | Empresa, processo, documento, consulta | Trechos autorizados com página/versão; sem exposição integral automática |

O contexto de segurança vem de um adaptador de identidade confiável, nunca de `user_id`, `tenant_id` ou lista de permissões enviada pelo modelo. No ensaio, esse contexto é uma fixture injetada pelo harness e explicitamente não equivale a OAuth real. O handler deve exigir vínculo e permissão em toda chamada e negar ferramenta desconhecida. Mesma consulta em empresas distintas não pode reutilizar cache privado; IDs inexistentes e sem acesso não devem facilitar enumeração.

Aceitação do incremento:

1. Empresa A não lê documento, processo, resultado ou cursor privado da B, inclusive por troca direta de ID.
2. Permissão retirada, contexto ausente, scope insuficiente e ferramenta desconhecida falham antes de consultar repositório.
3. Documento com instrução maliciosa retorna somente como evidência, nunca dispara outra chamada ou saída de rede.
4. Respostas trazem origem/versão e distinguem vazio, parcial, desatualizado e indisponível. Paginação não afirma cobertura total quando houver cursor restante.
5. Nenhuma ferramenta inicial aprova documentos, aceita declarações, cadastra proposta ou envia lance. Escritas pequenas como favoritar entram depois com autorização específica e idempotência.
6. Nenhuma chave, conta real, token, conexão externa ou alteração nos módulos protegidos.

O resultado será **núcleo testado com fixtures**, não conector publicado. Depois: repositório autorizado de homologação; autenticação real/OAuth e revogação; transporte MCP; teste privado em cada cliente; comparação de respostas por evidência; revisão de privacidade e custos; liberação separada. Não trocar essas etapas por uma tela que diz “conectado”.

## Decisão técnica para a coordenação

Prosseguir pelo núcleo de consultas e evidências com testes de isolamento, em paralelo ao executor da extensão. Cadastro e robô permanecem executores separados; a IA ajuda a preparar e explicar, e não passa a ser autoridade de autenticação ou de lances. A evidência pública é suficiente para orientar a experiência, mas não para alegar que reproduzimos ou auditamos a tecnologia interna do concorrente.
