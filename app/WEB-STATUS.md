# Estado da implementação web

Atualizado em 06/11/2026. O aplicativo Rust/egui e seus dados foram preservados. A identidade da interface e da PWA agora é FREECAST. O vídeo fornecido foi usado como referência de composição: lobby com filtros/lista de mesas e sala com biblioteca lateral, área de jogo/chat e participantes/ferramentas. O vídeo não demonstra uma partida no mapa; nenhum código, marca ou asset proprietário foi copiado. OmniRoute/Context7 não estavam disponíveis nesta sessão.

## Fases e matriz de requisitos

| Fase / requisito | Estado | Evidência e limite |
|---|---|---|
| Baseline e inventário | feito | Plano, frontend, Express/WebSocket, migrações e dependências inspecionados. |
| Estabilização da base | feito | `npm run build`, `npm test` e `node --check server.js` passaram nas pastas corretas. |
| UI responsiva e navegação | parcial | FREECAST tem identidade visual grafite/vinho/latão, lobby compacto e navegação para lobby, sala, biblioteca, campanhas e fichas. Playwright mediu `scrollWidth === viewportWidth` na lobby e sala em 360, 390, 430 e 1280 CSS px; a página de fichas também foi medida anteriormente. Console do navegador sem erros na verificação atual. Falta QA visual/acessibilidade de todos os painéis em todas as larguras. |
| Persistência e API | parcial para produção | SQLite local continua persistindo os recursos existentes e os testes reabrem o banco após reinício. Um adapter PostgreSQL e migração isolada no schema `freecast` foram implementados, sem copiar dados locais; ainda falta conexão/validação real com Supabase e reinício do serviço hospedado. Sem paginação de histórico nem multi-instância. |
| Autenticação e isolamento | feito, com escopo limitado | Hash PBKDF2, sessão em cookie HttpOnly, rate limits, validação de origem, associação a salas públicas e broadcast WebSocket isolado; logout/expiração fecham WebSockets. Testes cobrem login/logout, origem hostil, acesso e isolamento. Não há salas privadas, convites, recuperação de senha ou verificação de email. |
| Fichas e rolagens | parcial | Fichas JSON CRUD persistem e são autorizadas por proprietário/mestre. Rolagens são validadas e calculadas no servidor, associadas à sala e persistidas. Falta modelo de ficha específico por sistema e fluxo completo de edição/teste UI das rolagens. |
| Chat e reconexão | feito no escopo atual | Dois contextos Playwright autenticados trocaram mensagem via WebSocket; após reiniciar o backend, o cliente mostrou a falha e reconectou sem repetir automaticamente a última ação. Histórico SQLite é carregado na conexão. |
| Campanhas e notas | feito no escopo atual | CRUD de campanha e notas persistidas; notas são acessíveis apenas ao mestre. Testes API cobrem persistência, edição e autorização; fluxo UI foi criado e exercitado no navegador. |
| Mapa/VTT | parcial | Estado por sala persiste e sincroniza; movimento de token é restrito ao mestre. Não há biblioteca/CRUD de tokens, mapas/imagens, ferramentas de desenho nem UX de arraste/toque. |
| Moderação | feito no escopo atual | Mestre pode silenciar, remover, banir e desbanir; servidor impõe silêncio, banimento, bloqueio de entrada e limite de mensagens. UI foi exercitada com duas contas e o servidor rejeitou chat de usuário silenciado. |
| PWA, instalação e offline | parcial | Manifesto, ícones PNG 192/512 originais e service worker verificados no preview. O shell abriu offline após precache; API não é cacheada e alterações offline não são enfileiradas. Instalação e experiência instalada não foram testadas. |
| Hospedagem/publicação | em andamento, não publicada | O usuário autorizou Supabase Free, uso exclusivo do trial Railway até US$5, push do código ao repositório existente e nenhuma migração de dados locais. O projeto Supabase não tinha schema `freecast` (consulta somente leitura); o código cria um schema separado. A tela Railway mostrava “30 days or $5.00 left” e aviso ativo de bloqueio de rede externa; nenhum serviço foi criado nem código publicado ainda. Não fazer upgrade/pagamento. Não ler/copiar segredos; a conexão `DATABASE_URL` terá de ser inserida pelo usuário como variável secreta no Railway. |
| App Rust/egui e dados existentes | preservado | Nenhum arquivo nativo foi editado. |

## Verificações executadas

- `app/web`: `npm run build` — TypeScript e Vite passaram.
- `app/server`: `npm test` — 14 testes passaram; incluem autenticação, rate limits, WebSocket, isolamento, moderação, CRUD/autorização/persistência e serving da SPA pelo Express.
- `app/server`: `node --check server.js` — passou.
- `app/server`: `node --check postgres-store.js` — passou; o adapter aguarda teste com conexão PostgreSQL real.
- `app/server`: `npm audit --omit=dev` — 0 vulnerabilidades.
- `app/web`: `npm run build` — passou com o nome FREECAST e os assets atuais.
- `railway.json` — JSON válido. A imagem Docker não foi construída localmente porque o daemon Docker não está iniciado.
- Playwright: cadastro, criação/entrada de sala, campanha, nota privada, ficha, dois usuários em contextos isolados, chat cruzado e moderação server-side; o cliente reconectou depois do reinício do backend.
- Playwright: `scrollWidth === viewportWidth` em 360, 390, 430 e 1280 CSS px na página de fichas.
- Playwright: lobby e sala sem overflow horizontal em 360, 390, 430 e 1280 CSS px; console atual com zero erros.
- `app/web`: `npm run build` após as alterações de FREECAST — passou (TypeScript e Vite).
- Conta e sala temporárias da revisão visual foram removidas do SQLite local; o banco confirmou que não restaram registros com o nome da conta de teste.
- A consulta somente leitura do Supabase confirmou que ainda não existe o schema `freecast`; a migração será aplicada pelo backend ao conectar.
- Playwright: manifesto, dimensões 192×192/512×512, service worker ativo e cache do shell/assets; com o preview parado, a shell carregou offline e indicou erro de backend. Instalação real não testada.
- REA já examinou estaticamente `C:\RRPG\rrpg.exe` e `rrpgcpp32.dll` em etapa anterior; os recursos do EXE não foram lidos devido ao limite de 64 MiB. Nenhum asset foi extraído.
- Alwaysdata: painel autenticado consultado sem submeter formulários; assinatura Small de €6/mês observada na página de assinaturas. O formulário de site permite selecionar Node.js. Documentação oficial consultada sobre ofertas, Node, WebSocket, configuração de sites e tempo ocioso. Não foi possível confirmar pelo painel se a criação de site adiciona cobrança, nem se serviço contínuo está incluído.

## Análise visual e alterações da etapa FREECAST

O vídeo mostra uma lobby com filtros e mesas em lista e uma sala com biblioteca à esquerda, área de jogo/chat ao centro, participantes/mestres à direita e ferramentas inferiores. A interface foi aproximada com composição compacta e paleta original; o material de referência não mostra um mapa em partida. Marca e ícones FREECAST foram criados localmente. Playwright verificou as larguras e a compilação, mas isso não valida multiplayer hospedado.

## Pendências para publicação e conclusão

Não declarar concluído. Aguardar a recuperação do acesso à rede do Railway; depois publicar somente após enviar o commit autorizado e configurar `DATABASE_URL` sem expor o segredo ao agente. Verificar o consumo do trial e parar antes de exceder US$5 ou exigir pagamento/upgrade. Validar migrações e persistência real no Supabase, HTTPS/origem/cookies e WebSocket entre dois computadores. Depois, executar instalação PWA real e QA final de teclado/leitor de tela, larguras/painéis da sala e fluxos de erro. Netlify estático não substitui este backend Express/WebSocket.
