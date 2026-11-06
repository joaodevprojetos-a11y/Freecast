# Plano completo — Plataforma web de RPG/VTT

## 1. Objetivo

Construir uma plataforma de RPG de mesa virtual principalmente para navegador, adaptável a celular e desktop e instalável como PWA. A interface deve seguir a direcao visual das referencias fornecidas pelo usuario: tema escuro, cabecalho vinho, detalhes dourados e uma mesa de jogo organizada em biblioteca, mapa, chat e participantes.

O objetivo nao e apenas desenhar uma tela. Salas, fichas, rolagens, chat, campanhas e moderacao devem ter comportamento verificavel. O app desktop Rust/egui existente e os dados atuais devem ser preservados durante a construcao da versao web.

## 2. Estado conhecido do projeto

**Snapshot verificado em 05/11/2026, aproximadamente 22:04 (-03):**

- `app/` contem o app nativo Rust/egui e a implementacao web parcial. Preservar ambos.
- `app/web/` ja tem frontend React + TypeScript + Vite + Tailwind, tela principal em `src/App.tsx` e configuracao npm.
- `npm run build`, executado dentro de `app/web/`, passou: `tsc` e `vite build` finalizaram sem erros; Vite gerou `dist/` com os assets de producao. Isso prova que o frontend compila, nao que os fluxos estejam completos.
- `node --check server.js`, executado dentro de `app/server/`, passou. O pacote do servidor declara somente `npm start`; nao ha script `build` ou testes configurados.
- `app/server/server.js` implementa Express, `/api/health` e WebSocket com `INIT_STATE`, `MOVE_TOKEN`, `ROLL_DICE` e `SEND_CHAT`. O estado e uma unica estrutura em memoria, compartilhada globalmente por todos os clientes; reiniciar o processo perde as alteracoes.
- O frontend tem uma sala/mapa demonstrativos, controles de movimento, chat e rolagem. Usa valores iniciais de exemplo e permite fallback local quando o WebSocket nao esta aberto. A existencia do controle/tela nao comprova um fluxo multiplayer confiavel.
- O servidor aceita os dados de usuario e o resultado de dados enviados pelo cliente sem validacao/autorizacao suficiente; mensagens e alteracoes de mapa sao transmitidas a todos os clientes conectados, sem isolamento por sala ou identidade.
- Nao foram encontrados formularios/rotas/endpoints de autenticacao, banco/migracoes, persistencia, campanhas, fichas completas ou moderacao funcional. Nao ha manifest PWA ou service worker nos caminhos inspecionados.
- A UI ainda nao comprova responsividade: a tela usa paineis de largura fixa e o grid do mapa pode exceder telas estreitas; nao foram executados testes de viewport nem E2E.
- O `craft.json` continua com status `ready`, baseado em build do app Rust, screenshot (cerca de 51% de similaridade com a referencia) e mecanicas. Esses checks nao avaliam a aplicacao web e nao justificam status geral concluido.
- O log recente do Craft tem uma tentativa de build web que falhou com `ENOENT`, mas o build web executado diretamente agora passou. Tambem houve um comando de servidor com falha mascarada por `|| echo`; isso nao e evidencia de build do servidor.
- O pedido original registrado em `craft.json` inclui salas, fichas, rolagem, chat, gerenciamento de campanhas, moderacao, desktop/celular e ausencia de bloqueios artificiais por assinatura.

**Matriz resumida do estado real:**

| Requisito | Estado | Evidencia / lacuna |
|---|---|---|
| Frontend React web | Parcial; build verificado | `app/web/src/App.tsx`; build de producao passa |
| Sala/mapa/chat/dados | Demo funcional localmente, multiplayer nao comprovado | Um estado inicial de exemplo; fallback local; sem teste com dois clientes |
| WebSocket | Parcial, sem isolamento/autorizacao | Todos os clientes recebem o mesmo estado global |
| Autenticacao e usuarios | Nao implementado | Sem UI ou endpoint de auth encontrado |
| Salas, fichas, campanhas | Nao implementado como dados persistidos | Sem CRUD/banco/migracoes encontrados |
| Persistencia | Nao implementada | Estado do servidor mantido em memoria |
| Moderacao | Nao implementada | Sem fluxo/regra de moderacao no servidor |
| Responsividade | Nao verificada e provavelmente incompleta | Sem testes; paineis de largura fixa |
| PWA | Nao implementada/verificada | Sem manifest ou service worker encontrado |
| App Rust / checks do Craft | Independente da web | `Ready` cobre apenas build nativo, screenshot e mecanicas |

Nao foi feita uma analise tecnica verificavel do binario original do Firecast. As capturas fornecidas sao referencias visuais, nao prova do comportamento interno. Hospedagem, dominio, servicos externos e custos continuam pendentes de aprovacao.

Antes de cada fase, reconfirme o estado do repositorio. Nao transforme declaracoes antigas, nomes de arquivos, capturas estaticas, build isolado ou status `Ready` em evidencia de funcionalidade.

## 3. Principios e limites

1. Preservar `app/`, o codigo Rust/egui, arquivos de mecanicas e dados existentes. Nao substituir, renomear ou apagar o app nativo sem aprovacao expressa.
2. Construir a web em `app/web/`; manter frontend e backend web organizados sem misturar artefatos ao app Rust.
3. Nao copiar codigo, marca, textos exclusivos, imagens ou outros assets proprietarios do Firecast. Produzir componentes e assets originais. Usar imagens fornecidas pelo usuario como referencia de layout, nao como assets do produto.
4. Nao executar o binario Firecast, contornar login ou protecoes, nem assumir permissao para acessar contas ou sistemas externos. Se a analise do original for necessaria, primeiro verificar o caminho indicado pelo usuario e explicar o metodo e limites.
5. Nao configurar hospedagem paga, enviar dados para servicos externos, criar contas, usar credenciais ou incorrer em custos sem aprovacao.
6. Diferenciar em toda a interface e documentacao: dados de exemplo, dados locais, dados persistidos e dados compartilhados por um backend.
7. Uma captura de tela comprova apenas o que e visivel nela; um build comprova compilacao; nenhum dos dois, sozinho, comprova fluxos funcionais.
8. Nenhuma fase autoriza marcar o projeto inteiro como concluido enquanto os criterios globais da secao 10 nao forem verificados.

## 4. Arquitetura e estrategia de continuidade

O repositorio ja possui frontend React/Vite e backend Express/WebSocket. A proxima etapa e estabilizar e completar essa base, nao recriar o scaffold nem duplicar o servidor. Manter desenvolvimento local sem custos; nao implantar em servicos externos sem aprovacao. Reutilizar dependencias existentes e propor mudanca de stack somente com justificativa concreta, impacto e aprovacao quando alterar escopo/custo.

### Frontend

- React + TypeScript + Vite dentro de `app/web/`.
- CSS com tokens de design e componentes proprios. Tailwind pode ser usado se ja estiver instalado e configurado de modo funcional; nao depender dele apenas por estar listado no `package.json`.
- React Router ou navegacao equivalente para telas de lobby, sala, personagens, campanhas, dados e moderacao.
- Estado da interface tipado; dados vindos do backend por uma camada de API, sem declarar dados estaticos como reais.
- Vite PWA plugin, manifest e service worker somente na fase PWA, depois que o shell web estiver funcional.
- Icones SVG originais ou biblioteca de icones com licenca adequada. Evitar emojis como substituto de icones de produto.

### Backend

- Continuar a partir de `app/server/server.js` (Express + `ws`) enquanto atender ao escopo. Nao criar outro servidor em paralelo nem migrar automaticamente para Fastify/TypeScript.
- Validacao de entrada no servidor, erros explicitos, autenticacao e autorizacao no servidor, e logs sem tokens ou dados sensiveis.
- Adotar banco local e migracoes somente apos inspecionar compatibilidade e documentar a escolha. A persistencia real deve sobreviver ao reinicio do servidor.
- PostgreSQL apenas se/ quando for aprovada a estrategia de implantacao; nao exigir servico gerenciado pago durante desenvolvimento.
- Esquema e migracoes versionados. Selecionar ORM somente apos verificar suporte, simplicidade, licenca e dependencias existentes.

### Comunicacao em tempo real

- WebSocket autenticado para mensagens e eventos de sala, com autorizacao por sala no servidor.
- Pode-se usar Socket.IO ou WebSocket padrao depois de validar a necessidade. A escolha deve ser documentada; nao implementar simultaneamente duas camadas.
- Se dois navegadores nao conseguem trocar mensagens atraves do backend, o recurso deve continuar marcado como nao funcional.

### Qualidade e instalacao

- Testes unitarios para regras e validacao; testes de API para permissoes e persistencia; Playwright para fluxos e responsividade.
- PWA testada em HTTPS/local secure context, incluindo manifest, icones, instalabilidade, atualizacao do service worker e comportamento offline definido.
- O projeto permanece executavel localmente sem conta de nuvem. Deployment e dominio ficam fora do escopo ate aprovacao.

### Decisoes que exigem aprovacao do usuario antes de producao

- Dominio, hospedagem, banco remoto, custo e retencao de dados.
- Fornecedor de e-mail, OAuth, armazenamento de imagens ou notificacoes push.
- Exposicao publica do servidor, politicas de backup e recuperacao.
- Migracao ou descontinuacao do aplicativo Rust.

Enquanto essas decisoes nao forem aprovadas, limitar a implementacao a desenvolvimento local e registrar exatamente o que nao esta disponivel.

## 5. Direcao visual e UX

### Identidade visual

- Fundo grafite/preto, superficies separadas por contraste, cabecalho vinho escuro e acentos dourados/ambar.
- Texto legivel com contraste adequado, hierarquia tipografica clara e estados visuais consistentes.
- Paineis com bordas discretas, densidade apropriada a um VTT e pouco espaco vazio sem funcao.
- Evitar a aparencia padrao de componentes HTML sem estilo, emojis como icones principais e alegacoes de usuarios online ficticios.

### Desktop

- Lobby com navegacao superior ou lateral, perfil/status identificados como reais ou demonstrativos, abas de mesas, busca, filtros e acao de criacao.
- Sala: biblioteca/arvore de conteudo a esquerda, mapa/mesa no centro, chat e participantes a direita, ferramentas de jogo acessiveis.
- Painel redimensionavel quando suportado; estados vazios e carregamento intencionais.

### Celular

- Navegacao compacta e operavel por toque.
- Paineis do VTT em abas/gavetas sem reduzir mapa e chat a colunas ilegiveis.
- Formularios, fichas, modais e controles com alvos de toque adequados.
- Sem overflow horizontal em larguras de 360, 390 e 430 CSS px.

### Acessibilidade

- Semantica HTML, foco visivel, teclado, labels, mensagens de erro compreensiveis e contraste WCAG AA para texto normal quando praticavel.
- Nao comunicar estado apenas por cor.

## 6. Plano de execucao por fases

As fases devem ser executadas uma por vez no VS Code. No fim de cada fase, gerar um registro curto de progresso (arquivos, comandos, resultados, limitacoes e proxima etapa). Manter o estado como incompleto ate os criterios globais serem atendidos.

### Fase 0 — Baseline, inventario e decisoes bloqueantes

**Objetivo:** confirmar o ponto de partida sem alterar arquivos.

**Tarefas:**

1. Inspecionar estrutura, manifestos, codigo Rust, configuracao web, arquivos de mecanicas, estado de build e referencias disponiveis.
2. Verificar se `app/web/src` existe e se contem aplicacao. Verificar scripts, lockfile e comandos realmente executaveis.
3. Confirmar quais requisitos sao atuais e quais estao apenas descritos em mensagens antigas.
4. Verificar o caminho do Firecast somente como arquivo. Nao executar o binario. Registrar se a analise estatica e autorizada e tecnicamente possivel.
5. Listar decisoes de producao que exigem aprovacao e seguir com defaults locais para nao bloquear o prototipo.

**Arquivos previstos:** nenhum alterado. O inventario pode ser apresentado na resposta ou no documento de status depois de iniciada a implementacao.

**Aceite:** baseline com evidencias e lista de lacunas; nenhuma mudanca destrutiva; nenhuma declaracao de Firecast analisado sem evidencias.

### Fase 1 — Estabilizacao da base web existente

**Objetivo:** comprovar a base ja criada, identificar os fluxos demonstrativos e remover as causas de falso sucesso antes de ampliar funcionalidades.

**Tarefas:**

1. Inspecionar e preservar `app/web/` e `app/server/`; nao reaplicar scaffold sobre arquivos existentes.
2. Executar `npm run build` no diretorio `app/web`; verificar `node --check server.js` em `app/server`. Nao chamar `npm run build` no servidor, pois o script nao existe.
3. Documentar comandos de desenvolvimento e partida do servidor, corrigindo README somente se houver lacuna real.
4. Conferir os fallbacks locais, os dados de exemplo e o estado de conexao; a UI deve distinguir claramente dados demo, locais e enviados ao servidor.
5. Criar testes basicos para o protocolo WebSocket e a validacao de mensagens, sem alegar multiplayer seguro antes de testar dois clientes.

**Estado inicial verificado:** build web passa e sintaxe do servidor passa; testes funcionais nao foram executados e o servidor nao tem script de teste.

**Aceite:** build e checagens atuais repetiveis; comandos executados a partir da pasta correta; falhas visiveis; estado demonstrativo identificado; Rust permanece intacto; relatorio lista limitacoes sem chamar o produto de completo.

### Fase 2 — Conclusao da UI responsiva

**Objetivo:** evoluir a sala React existente para uma interface de produto navegavel e utilizavel em desktop e celular, sem substituir a base por outra tela demonstrativa.

**Tarefas:**

1. Auditar o layout atual e reaproveitar os componentes uteis; definir tokens de cor, tipografia, foco e breakpoints sem reescrever por preferencia pessoal.
2. Implementar navegacao real entre lobby e sala; nao representar fichas, campanhas ou moderacao por botoes sem fluxo.
3. Refatorar a composicao atual de sala/mapa/chat/participantes para acomodar telas estreitas com abas ou gavetas e alvos de toque adequados.
4. Criar elementos visuais originais; nao afirmar que o Firecast foi analisado caso nao exista essa evidencia.
5. Validar visualmente em desktop e celular, com console/rede e comparacao das referencias.

**Arquivos previstos:** integrar e, se necessario, organizar `app/web/src/`; assets originais em `app/web/public/`. Nao criar pastas/componentes sem necessidade demonstrada.

**Aceite:** navegacao entre telas funciona; nenhum controle principal e decorativo; sem overflow horizontal nas larguras definidas; areas demo claramente rotuladas; testes visuais/capturas registrados.

### Fase 3 — Persistencia e API local

**Objetivo:** transformar o estado em memoria do servidor existente em dados validados e persistidos para desenvolvimento local.

**Tarefas:**

1. Inspecionar o protocolo e o estado atual; definir entidades e relacoes: usuarios, salas, membros/papeis, personagens, campanhas/notas, mensagens e eventos de dados.
2. Definir migracoes e estrategia de identificadores, timestamps, validacao e exclusao.
3. Evoluir o Express/WebSocket existente com validacao e tratamento explicito de erros; nao confiar em valores de dados calculados pelo cliente.
4. Persistir em banco local; documentar tecnologia/caminho, backup e reset de dados de desenvolvimento.
5. Cobrir endpoints com testes e comprovar que os dados sobrevivem ao reinicio do backend.

**Aceite:** migrations executam; CRUD permitido funciona via API; dados persistem apos reinicio; acessos negados sao testados; segredos nao aparecem em logs.

### Fase 4 — Identidade, salas e autorizacao

**Objetivo:** implementar usuarios/sessoes e o ciclo de vida de salas com controles no servidor.

**Tarefas:**

1. Implementar autenticacao adequada ao ambiente local e armazenar senhas usando algoritmo moderno, se houver cadastro por senha.
2. Implementar sessoes com cookies seguros em deployment e configuracao local documentada.
3. Criar, listar, buscar, filtrar, entrar e sair de salas reais persistidas.
4. Implementar papeis minimos (proprietario/mestre/participante) e validar cada operacao no backend.
5. Identificar salas/dados demo e separar dados seed das contas reais.

**Aceite:** dois usuarios de teste conseguem criar/entrar em salas distintas conforme permissao; usuarios nao autorizados nao leem nem alteram dados da sala; testes de API cobrem isolamento.

### Fase 5 — Fichas e rolagem de dados

**Objetivo:** implementar recursos de jogo persistidos e validos.

**Tarefas:**

1. Definir schema de personagem extensivel sem inventar regras proprietarias.
2. Criar, editar, consultar e salvar fichas pertencentes a usuario/campanha.
3. Implementar rolagem no servidor com limites, validacao, resultado e historico associado a sala.
4. Documentar regras de dados. Qualquer regra inferida deve ser sinalizada como estimativa e confirmada pelo usuario.
5. Mostrar loading, sucesso e erros reais na UI.

**Aceite:** ficha permanece apos reload; usuarios sem permissao nao editam ficha alheia; rolagem validada gera historico no backend; testes cobrem limites e autorizacao.

### Fase 6 — Chat em tempo real e presenca

**Objetivo:** habilitar comunicacao compartilhada entre clientes.

**Tarefas:**

1. Implementar WebSocket autenticado, associado a sala e membro autorizado.
2. Persistir mensagens e carregar historico paginado.
3. Implementar envio, recepcao, reconexao e estados de conexao sem fingir sucesso.
4. Implementar presenca somente se houver heartbeat/estado confiavel; senao omitir ou marcar como indisponivel.
5. Testar com dois contextos de navegador independentes.

**Aceite:** uma mensagem enviada em um cliente aparece no outro atraves do servidor e continua no historico apos reinicio; usuario nao membro e rejeitado; falhas de rede sao exibidas.

### Fase 7 — Campanhas e notas

**Objetivo:** persistir organizacao de campanha e material do mestre.

**Tarefas:** CRUD de campanhas/notas; relacao com sala e papeis; validacao, busca simples e confirmacao de salvamento.

**Aceite:** alteracoes persistem apos reload/restart; acesso e edicao respeitam papeis; testes de API e interface.

### Fase 8 — VTT/mapa e ferramentas

**Objetivo:** implementar interacao de mapa proporcional ao escopo acordado.

**Tarefas:**

1. Definir formato e origem de assets de mapa; permitir assets do usuario ou assets originais/licenciados.
2. Implementar visualizacao, zoom/pan acessiveis, grade e marcadores com estado persistido ou compartilhado.
3. Compartilhar eventos entre participantes autorizados, com validacao no servidor.
4. Identificar claramente controles implementados versus planejados.

**Aceite:** mapa pode ser usado em desktop e celular; eventos de marcadores sincronizam entre dois clientes quando conectados; limites de arquivos e tipos sao aplicados.

### Fase 9 — Moderacao aplicada no servidor

**Objetivo:** tornar a moderacao efetiva e auditavel, nao apenas visual.

**Tarefas:** definir politicas; implementar silenciar, remover/bloquear membro ou banir somente conforme papeis aprovados; aplicar restricoes no chat e endpoints; permitir reversao autorizada; registrar auditoria sem dados excessivos.

**Aceite:** testes mostram que acao de moderacao muda de fato as permissoes e e aplicada por todas as rotas relevantes; usuario comum nao consegue elevar privilegios; interface mostra sucesso/erro vindo do servidor.

### Fase 10 — PWA e comportamento offline

**Objetivo:** oferecer instalacao suportada pelo navegador sem prometer sincronizacao offline inexistente.

**Tarefas:** configurar manifest, icones originais, nome/cores, service worker e estrategia de cache; definir quais paginas/recursos funcionam offline; evitar cache indevido de respostas privadas; testar atualizacao e instalacao.

**Aceite:** navegador reconhece a PWA como instalavel em ambiente compativel; app instalado abre; paginas estaticas suportadas abrem offline; dados privados nao vazam via cache compartilhado; limitacoes de plataforma documentadas.

### Fase 11 — Hardening, acessibilidade e QA

**Objetivo:** preparar uma entrega local demonstravel e uma base de implantacao segura, sem publicar sem aprovacao.

**Tarefas:** testes unitarios, API, E2E e responsividade; teclado/foco/contraste; tratamento de falhas; seguranca de autenticacao e papeis; revisao de dependencias e licencas; backup/migracao documentados; instrucoes de execucao.

**Aceite:** suites passam; E2E cobre fluxos principais; teste com duas sessoes cobre sala/chat; console limpo de erros bloqueantes; build de producao funciona; nenhuma implantacao ou custo nao aprovado.

## 7. Plano de testes ponta a ponta

Os seguintes fluxos devem ser executados, nao apenas descritos:

1. Iniciar backend e frontend com comandos documentados e sem mascarar erros. Para o estado atual, `npm run build` e executado em `app/web`; o servidor tem `npm start`, mas nao `npm run build`.
2. Criar duas contas de teste ou dois usuarios de teste conforme mecanismo aprovado.
3. Criar sala com o primeiro usuario; entrar com o segundo; recusar acesso de um terceiro nao autorizado.
4. Editar ficha e verificar persistencia apos reload e reinicio do backend.
5. Rolar dados e verificar resultado/historico guardados no servidor.
6. Enviar mensagem em um navegador e receber no outro; testar reconexao e historico.
7. Editar notas da campanha, recarregar e verificar persistencia.
8. Aplicar moderacao como mestre e confirmar que o participante afetado nao consegue realizar a acao proibida.
9. Navegar no lobby e sala em desktop e em larguras 360, 390, 430 e 1280 CSS px.
10. Instalar a PWA num navegador compativel e validar o estado offline explicitamente definido.

Se um teste nao puder ser executado por falta de browser, backend, configuracao ou decisao do usuario, registrar como **nao verificado** e explicar o bloqueio.

## 8. Estrategia de uso de modelos via OmniRoute

O agente no VS Code deve economizar chamadas pagas do Copilot sem ocultar falhas:

1. Antes de trabalhar, verificar se o OmniRoute esta disponivel e quais modelos estao realmente listados na integracao local. Nao presumir que um alias Gemini ou “programador” existe.
2. Selecionar, se disponivel e autorizado, um modelo de programacao via OmniRoute para leitura do repositorio, scaffold, componentes, testes rotineiros e documentacao.
3. Usar modelo Gemini via OmniRoute se estiver disponivel e autorizado; escolher modelo por capacidades e contexto, nao apenas pelo nome.
4. Nao incluir tokens, senhas, arquivos `.env`, chaves, dados pessoais ou dados privados nas mensagens. Nao enviar codigo sensivel a provedor externo sem autorizacao.
5. Se chamada ao modelo falhar, capturar categoria do erro sem revelar credenciais e tentar no maximo uma alternativa aprovada do OmniRoute.
6. Usar Copilot apenas quando: (a) nenhum modelo autorizado do OmniRoute conseguir executar uma tarefa bloqueante importante; (b) a revisao exigir capacidade indisponivel; ou (c) o usuario pedir. Antes de fallback, informar a tarefa, o erro resumido e por que e importante.
7. Nao insistir em repeticoes que consumam quota; guardar progresso em arquivos/status e retomar da ultima etapa validada.
8. O modelo nao deve alterar provedores, instalar ferramentas, alterar credenciais ou mudar dados pessoais sem aprovacao.

## 9. Acompanhamento e formato do relatorio por fase

Ao fim de cada fase, apresentar:

- Fase e objetivo.
- Arquivos criados/alterados.
- Funcionalidade real implementada.
- Comandos executados e resultados completos/resumidos sem omitir falhas.
- Testes executados e o que cada um comprova.
- O que permanece demonstrativo, local, sem backend, sem persistencia ou nao verificado.
- Decisoes/insumos pendentes do usuario.
- Proxima fase sugerida.

Manter um estado de projeto equivalente a `in_progress` enquanto houver requisito global pendente. Nao redefinir escopo, criterios de aceite ou plano sem registrar a mudanca e obter aprovacao para reducoes de escopo.

## 10. Criterios globais de conclusao

O produto so pode ser descrito como concluido quando houver evidencia de todos os itens aplicaveis:

- App web executavel e responsivo; app Rust e dados antigos preservados ou migracao explicitamente aprovada. Build do frontend, sozinho, nao satisfaz este item.
- Instalabilidade PWA demonstrada em navegador compativel.
- Salas reais persistidas com autorizacao validada no servidor.
- Fichas persistidas e protegidas por permissao.
- Rolagens validadas e historico verificavel.
- Chat real entre dois clientes pelo backend; nao apenas eco local.
- Campanhas/notas persistidas.
- Moderacao aplicada e imposta no servidor.
- Testes automatizados e manuais representativos aprovados; falhas restantes declaradas.
- Configuracao de producao/custos aprovada, ou produto claramente limitado a ambiente local.
- Todos os requisitos classificados em matriz com evidencias; nenhum item pendente escondido por um status `Ready`.

# Prompt de execucao

Use o arquivo `PROMPT-GOAL-OMNIROUTE.md` como prompt de Goal no VS Code. O plano e uma proposta de trabalho; decisoes de custo, hospedagem e migracao permanecem com o usuario.
