# Prompt para Goal no VS Code — RRPG Web com OmniRoute primeiro

Copie o texto abaixo para o modo Goal do VS Code. Anexe ou mantenha aberto o projeto `C:\Users\João\Documents\Craft Anything\rrpg` e consulte `PLANO-IMPLEMENTACAO-WEB.md`.

---

## Objetivo

Implemente neste repositorio uma plataforma web de RPG/VTT responsiva para desktop e celular, instalavel como PWA, seguindo as fases e os criterios verificaveis de `PLANO-IMPLEMENTACAO-WEB.md`. O app atual Rust/egui e os dados existentes devem ser preservados. A implementacao web deve ficar isolada em `app/web/`.

Quero um VTT com identidade visual inspirada nas imagens que forneci: fundo escuro, cabecalho vinho, detalhes dourados, lobby de mesas e sala com biblioteca a esquerda, mapa no centro e chat/participantes a direita. Crie interface e assets originais. Nao copie codigo, marca, textos exclusivos ou assets proprietarios do Firecast.

Os recursos desejados sao salas, fichas, rolagens, chat em tempo real, campanhas/notas e moderacao efetiva, sem bloqueios artificiais por assinatura. Esses recursos devem ser reais, persistidos e autorizados no servidor quando aplicavel — nao apenas telas demonstrativas.

## Baseline ja verificado — nao repetir scaffold

O repositorio ja tem `app/web/` com React/TypeScript/Vite/Tailwind, uma sala demonstrativa em `src/App.tsx`, e `app/server/server.js` com Express/WebSocket. Em 05/11/2026, `npm run build` passou quando executado dentro de `app/web/`; `node --check server.js` passou dentro de `app/server/`. O servidor nao tem script `build` nem testes configurados. Repita as checagens antes de alterar codigo, pois o estado pode ter mudado.

Esse baseline nao significa que o produto esteja pronto. O frontend ainda mostra uma sala/mapa, chat e dados com conteudo inicial demonstrativo e fallback local. O WebSocket atual guarda estado apenas em memoria e o compartilha com todos os clientes; nao implementa identidade nem separacao por sala. O servidor aceita valores de dados e mensagens sem validacao/autorizacao suficiente. Nao foram encontrados autenticacao, banco/migracoes, persistencia, CRUD de salas/fichas/campanhas, moderacao ou PWA. A responsividade nao foi testada e ha paineis de largura fixa. Use a matriz e as lacunas de `PLANO-IMPLEMENTACAO-WEB.md` como ponto de partida, mas confirme cada item no codigo atual.

## Regra principal: economizar Copilot sem esconder falhas

Use OmniRoute como provedor preferencial para o trabalho de programacao:

1. Primeiro verifique, pela integracao ja configurada no ambiente, se o OmniRoute esta acessivel e quais modelos estao realmente disponiveis. Nao invente aliases nem presuma que “programador” ou um modelo Gemini especifico existe.
2. Se houver um modelo de programacao adequado no OmniRoute, use-o para as tarefas rotineiras e para implementar as fases.
3. Se houver Gemini autorizado e disponivel pelo OmniRoute, ele pode ser usado para implementacao/revisao conforme capacidade e contexto.
4. Nao altere configuracao, credenciais, contas, provedores ou instalacoes do sistema. Nunca imprima, copie ou registre API keys, tokens ou conteudo de `.env`.
5. Nao envie credenciais, dados pessoais ou codigo privado a um provedor externo sem autorizacao. Se nao souber se o projeto pode ser enviado ao provedor OmniRoute/Gemini configurado, pare antes de transmitir codigo e pergunte.
6. Se uma requisicao OmniRoute falhar, registre apenas categoria e mensagem segura do erro, sem segredo. Tente no maximo uma outra opcao aprovada do OmniRoute.
7. So use Copilot para uma tarefa realmente bloqueante/importante quando os modelos autorizados do OmniRoute nao puderem executa-la ou quando eu pedir. Antes do fallback, explique brevemente qual tarefa esta bloqueada, o erro resumido e por que ela e importante. Nao consuma Copilot repetindo a mesma tentativa.
8. Se todos os provedores falharem, preserve os arquivos, salve o progresso e informe como retomar. Nao declare sucesso por falta de erro visivel.

## Limites e seguranca

- Leia primeiro o plano e verifique o estado real do repositorio. As mensagens antigas do Craft Anything e o status `Ready` nao sao evidencias de que a web esteja feita.
- Nao remova nem substitua `app/`, o Rust/egui, dados, mecanicas ou historico. Nao migre dados nem descontinue o app nativo sem minha aprovacao expressa.
- Trabalhe no escopo web dentro de `app/web/`. Se encontrar arquivos web parciais, inspecione e integre-os sem apagar alteracoes pre-existentes.
- Nao escolha nem configure hospedagem paga, dominio, servicos externos, OAuth, email, armazenamento remoto ou custos sem me perguntar.
- Desenvolvimento local sem custo e o alvo inicial. Nao abra a aplicacao a rede publica.
- Nao execute o binario Firecast, contorne login/protecao, nem afirme que analisou o original sem evidencia observavel e limites documentados. As capturas sao referencias visuais, nao prova de implementacao.
- Nao invente usuarios online, salas reais, mensagens enviadas, conexoes, persistencia ou sucesso de moderacao. Rotule toda seed/demo e dados locais.
- Nao silencie erros com fallback que pareca sucesso. Mostre o erro e registre a acao de recuperacao.

## Execucao por fases

Trabalhe uma fase por vez na ordem do plano:

1. Baseline e inventario somente leitura.
2. Estabilizar e testar a base web existente; corrigir/documentar a execucao dos comandos sem reaplicar scaffold.
3. Completar e testar UI responsiva, incluindo navegacao real e estado claro para dados demo/local/remotos.
4. Persistencia e API local, evoluindo o Express/WebSocket existente sem criar um segundo servidor.
5. Autenticacao, salas e autorizacao no servidor, com isolamento real por sala.
6. Fichas e rolagens, calculadas/validadas no servidor e associadas a sala.
7. Chat em tempo real entre dois clientes autenticados, com historico e reconexao.
8. Campanhas e notas persistidas.
9. Completar VTT/mapa com sincronizacao autorizada e UX de toque.
10. Moderacao imposta pelo servidor.
11. PWA, instalacao, acessibilidade e QA final.

Nao implemente funcionalidade baseada apenas em alegacoes anteriores do Craft. Priorize: (1) tornar explicito quando o cliente esta em fallback/demo em vez de aparentar sincronizacao; (2) validar mensagens e entradas no servidor; (3) impedir que clientes escolham resultados de dados; (4) separar estado e permissoes por sala; (5) adicionar persistencia e testes; depois completar os recursos ainda ausentes.

Nao migre automaticamente para outro framework, nao substitua o Express existente e nao crie outro scaffold. Se houver razao tecnica concreta para alterar a arquitetura, registre evidencias, alternativas e impacto e pergunte antes de mudanca que amplie custo ou escopo.

### Portao de fase

No fim de cada fase:

1. Rode apenas os comandos necessarios para validar a fase, a partir da pasta correta.
   - Frontend: `npm run build` a partir de `app/web`.
   - Backend atual: `node --check server.js` e `npm start` somente quando for necessario executar/testar; rode-os a partir de `app/server`.
   - Nao use `npm run build` no pacote do servidor: esse script nao existe. Nao use `|| echo`, `; echo` ou fallback equivalente para transformar falha em sucesso.
2. Verifique a interface/fluxo real quando a fase tiver UI.
3. Registre arquivos alterados, comandos, saida/resumo, testes, falhas, limitacoes, estado demo/local/backend e a proxima fase.
4. Mantenha uma matriz de requisitos atualizada com `feito`, `parcial`, `demo` ou `nao feito` e a evidencia correspondente.
5. Pare e pergunte quando houver uma decisao de usuario bloqueante, especialmente custo/hospedagem, migracao de dados ou envio de codigo a provedor externo.
6. Nao reescreva o plano para fazer um teste antigo passar. Nao marque tarefas como feitas sem cumprir os criterios de aceite da fase.

Se o modo Goal exigir que voce continue sem aguardar entre fases, continue apenas enquanto nao houver decisao bloqueante. Nao reduza o escopo para contornar um bloqueio: registre-o, preserve o progresso e solicite a decisao necessaria.

## Testes obrigatorios por recurso

- UI: abrir em navegador, verificar console, navegacao e larguras de 360, 390, 430 e 1280 CSS px; sem overflow horizontal.
- Persistencia: criar/alterar registro, recarregar pagina e reiniciar backend, confirmando que os dados permanecem.
- Salas/permissoes: testar dois usuarios e uma tentativa nao autorizada.
- Chat: enviar de um navegador e receber em outro atraves do backend, verificar historico e reconexao.
- Dados: verificar entrada, limites, resultado e historico persistido.
- Ficha/campanha: editar, recarregar, verificar persistencia e autorizacao.
- Moderacao: aplicar a acao e demonstrar que o servidor rejeita a operacao proibida; uma lista visual nao basta.
- PWA: validar manifest, instalabilidade, abertura instalada, atualizacao e comportamento offline definido.
- Build nao substitui teste funcional; screenshot nao comprova backend, persistencia ou multiplayer.

## Condicoes para dizer “concluido”

Nao declare concluido quando:

- apenas o frontend web compilar ou o aplicativo Rust compilar/gerar screenshot;
- houver telas e handlers sem persistencia, autorizacao, isolamento de sala ou testes correspondentes;
- dados demo/fallback forem apresentados como enviados/sincronizados;
- plano continuar com tarefas abertas;
- testes tiverem falhado ou nao tiverem sido executados;
- chat for apenas local, sala for ficticia ou moderacao nao for aplicada no servidor;
- PWA nao tiver sido instalada/testada;
- houver requisito pendente, decisao nao aprovada ou fluxo sem evidencia.

No relatorio final, liste requisitos e evidencias individualmente. Se alguma coisa estiver incompleta, diga **incompleto** e explique o bloqueio; nao use “pronto”, “completo”, “totalmente funcional” ou status equivalente como sucesso geral. Nao marque o projeto como Ready por ter passado build, screenshot ou checks de mecanicas.

## Primeira acao

Comece pela Fase 0 do plano: reconfirme os arquivos e comandos existentes sem alterar nada, verifique a disponibilidade e privacidade do OmniRoute antes de transmitir codigo e atualize a matriz de requisitos com evidencias. Nao pare apenas por ja haver scaffold: como o build web e a sintaxe do servidor ja passaram, avance para a Fase 1 e depois para a primeira lacuna implementavel, desde que nao exista decisao bloqueante. Nao refaca componentes funcionais sem necessidade; priorize testes dos fluxos presentes, transparencia dos fallbacks e lacunas de validacao/sincronizacao. Pare e pergunte somente para decisoes realmente bloqueantes, como hospedagem/custos, envio de codigo nao autorizado a provedor externo ou mudanca de escopo.

---
