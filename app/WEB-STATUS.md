# Estado da implementação web

Atualizado em 06/11/2026. O trabalho continua restrito a `app/web/` e `app/server/`; o aplicativo Rust/egui e seus dados foram preservados. OmniRoute/Context7 não estavam disponíveis nesta sessão. O usuário autorizou uso do fallback local; nenhum código foi enviado a um provedor externo. Os assets são originais e não foram copiados de `C:\RRPG`.

## Fases e matriz de requisitos

| Fase / requisito | Estado | Evidência e limite |
|---|---|---|
| Baseline e inventário | feito | Plano, frontend, Express/WebSocket, migrações e dependências inspecionados. |
| Estabilização da base | feito | `npm run build`, `npm test` e `node --check server.js` passaram nas pastas corretas. |
| UI responsiva e navegação | parcial | Lobby, sala, campanhas, fichas e membros são navegáveis. Playwright mediu sem overflow em 360, 390, 430 e 1280 CSS px nas páginas de sala e fichas; navegação móvel para membros também foi exercitada. Falta QA visual/acessibilidade de todos os painéis em todas as larguras. |
| Persistência e API | feito para recursos existentes | SQLite persiste contas, sessões, salas, membros, moderação, fichas, campanhas, notas, tokens, mensagens e dados. Testes reabrem o SQLite após reinício do backend. Sem paginação de histórico nem multi-instância. |
| Autenticação e isolamento | feito, com escopo limitado | Hash PBKDF2, sessão em cookie HttpOnly, rate limits, validação de origem, associação a salas públicas e broadcast WebSocket isolado; logout/expiração fecham WebSockets. Testes cobrem login/logout, origem hostil, acesso e isolamento. Não há salas privadas, convites, recuperação de senha ou verificação de email. |
| Fichas e rolagens | parcial | Fichas JSON CRUD persistem e são autorizadas por proprietário/mestre. Rolagens são validadas e calculadas no servidor, associadas à sala e persistidas. Falta modelo de ficha específico por sistema e fluxo completo de edição/teste UI das rolagens. |
| Chat e reconexão | feito no escopo atual | Dois contextos Playwright autenticados trocaram mensagem via WebSocket; após reiniciar o backend, o cliente mostrou a falha e reconectou sem repetir automaticamente a última ação. Histórico SQLite é carregado na conexão. |
| Campanhas e notas | feito no escopo atual | CRUD de campanha e notas persistidas; notas são acessíveis apenas ao mestre. Testes API cobrem persistência, edição e autorização; fluxo UI foi criado e exercitado no navegador. |
| Mapa/VTT | parcial | Estado por sala persiste e sincroniza; movimento de token é restrito ao mestre. Não há biblioteca/CRUD de tokens, mapas/imagens, ferramentas de desenho nem UX de arraste/toque. |
| Moderação | feito no escopo atual | Mestre pode silenciar, remover, banir e desbanir; servidor impõe silêncio, banimento, bloqueio de entrada e limite de mensagens. UI foi exercitada com duas contas e o servidor rejeitou chat de usuário silenciado. |
| PWA, instalação e offline | parcial | Manifesto, ícones PNG 192/512 originais e service worker verificados no preview. O shell abriu offline após precache; API não é cacheada e alterações offline não são enfileiradas. Instalação e experiência instalada não foram testadas. |
| Hospedagem/publicação | não feito | O painel autenticado mostra uma assinatura Small para a conta `freecast`, com 50 GB, 1 GB RAM, 1 CPU e preço exibido de €6/mês. O formulário de novo site oferece Node.js; a documentação oficial lista Node.js até a versão 24 e cita WebSocket como compatível. A documentação também alerta que processos de site podem parar mesmo com tempo ocioso configurado como zero. O painel não confirmou se adicionar este site causa custo incremental nem se há elegibilidade para serviço contínuo. O formulário não foi enviado; nenhum site/serviço foi criado e nada foi publicado. Aguardar confirmação explícita do usuário antes de criar recursos na conta paga. |
| App Rust/egui e dados existentes | preservado | Nenhum arquivo nativo foi editado. |

## Verificações executadas

- `app/web`: `npm run build` — TypeScript e Vite passaram.
- `app/server`: `npm test` — 14 testes passaram; incluem autenticação, rate limits, WebSocket, isolamento, moderação, CRUD/autorização/persistência e serving da SPA pelo Express.
- `app/server`: `node --check server.js` — passou.
- Playwright: cadastro, criação/entrada de sala, campanha, nota privada, ficha, dois usuários em contextos isolados, chat cruzado e moderação server-side; o cliente reconectou depois do reinício do backend.
- Playwright: `scrollWidth === viewportWidth` em 360, 390, 430 e 1280 CSS px na página de fichas.
- Playwright: manifesto, dimensões 192×192/512×512, service worker ativo e cache do shell/assets; com o preview parado, a shell carregou offline e indicou erro de backend. Instalação real não testada.
- REA já examinou estaticamente `C:\RRPG\rrpg.exe` e `rrpgcpp32.dll` em etapa anterior; os recursos do EXE não foram lidos devido ao limite de 64 MiB. Nenhum asset foi extraído.
- Alwaysdata: painel autenticado consultado sem submeter formulários; assinatura Small de €6/mês observada na página de assinaturas. O formulário de site permite selecionar Node.js. Documentação oficial consultada sobre ofertas, Node, WebSocket, configuração de sites e tempo ocioso. Não foi possível confirmar pelo painel se a criação de site adiciona cobrança, nem se serviço contínuo está incluído.

## Pendências para publicação e conclusão

Não declarar concluído. Aguardar autorização explícita para usar a assinatura existente de €6/mês, após confirmar que adicionar o site não incorrerá em cobrança incremental; se não for possível confirmar, não publicar. Antes de abrir a aplicação à Internet, também é necessário definir HTTPS/origem/cookies e verificar o armazenamento persistente no provedor. Depois, executar instalação PWA real e QA final de teclado/leitor de tela, larguras/painéis da sala e fluxos de erro. Netlify estático não substitui este backend Express/WebSocket persistente.
