# Estado da implementação web

Atualizado em 06/11/2026. O aplicativo Rust/egui e seus dados foram preservados. A identidade da interface e da PWA agora é FREECAST. O vídeo fornecido foi usado como referência de composição: lobby com filtros/lista de mesas e sala com biblioteca lateral, área de jogo/chat e participantes/ferramentas. O vídeo não demonstra uma partida no mapa; nenhum código, marca ou asset proprietário foi copiado. OmniRoute/Context7 não estavam disponíveis nesta sessão.

## Fases e matriz de requisitos

| Fase / requisito | Estado | Evidência e limite |
|---|---|---|
| Baseline e inventário | feito | Plano, frontend, Express/WebSocket, migrações e dependências inspecionados. |
| Estabilização da base | feito | `npm run build`, `npm test` e `node --check server.js` passaram nas pastas corretas. |
| UI responsiva e navegação | parcial | Cadastro/login por e-mail/identificador, lobby com salas reais e indicação de senha, navegação para sala/campanhas/fichas e biblioteca lateral. Playwright local executou cadastro, criação de mesa protegida e criação/abertura de grade 15×27; após reorganizar a sala, `scrollWidth === viewportWidth` em 360, 390, 430 e 1280 CSS px. Em 1280 px, o snapshot com caixas confirmou biblioteca à esquerda, chat central, participantes à direita e composer/rolagens no rodapé; em 390 px, o botão Biblioteca alternou para o painel da biblioteca. Falta QA visual/acessibilidade de todos os painéis e fluxos em todas as larguras. |
| Persistência e API | parcial para produção | SQLite local persiste cadastro, salas, biblioteca, fichas, rolagens e chat; testes reabrem o banco após reinício. Migrações e adapter PostgreSQL existem, mas as novas migrações ainda não foram aplicadas/validadas em Supabase. Sem paginação de histórico nem multi-instância. |
| Autenticação e isolamento | parcial, funcional no ambiente testado | Cadastro exige e-mail; login aceita e-mail ou nome de usuário. Hash PBKDF2, sessão em cookie HttpOnly, rate limits e validação de origem; salas públicas/protegidas por senha; novos membros começam como espectadores e o mestre atribui jogador/espectador. Testes cobrem autenticação, senha, autorização e isolamento. Não há convites, recuperação/verificação de e-mail ou gestão de salas privadas. |
| Fichas e rolagens | parcial | Fichas JSON persistidas, atribuição pelo mestre e edição pelo dono/mestre. Modelo inicial D&D 5E com testes de habilidade/resistência lançados pelo servidor a partir da ficha e histórico persistido; espectadores não podem rolar. Não é uma ficha 5E completa nem possui campos/tabs de todas as regras. |
| Chat e reconexão | feito no escopo atual | Dois contextos Playwright autenticados trocaram mensagem via WebSocket; após reiniciar o backend, o cliente mostrou a falha e reconectou sem repetir automaticamente a última ação. Histórico SQLite é carregado na conexão. |
| Campanhas e notas | feito no escopo atual | CRUD de campanha e notas persistidas; notas são acessíveis apenas ao mestre. Testes API cobrem persistência, edição e autorização; fluxo UI foi criado e exercitado no navegador. |
| Mapa/VTT | parcial | Pastas e mapas persistidos na biblioteca com visibilidade privada/da sala, dimensões configuráveis e URL HTTP(S) de fundo; grade só aparece ao abrir mapa salvo. Tokens, movimentos sincronizados/autorizados e ferramentas de desenho/zoom/pan ainda não estão implementados. |
| Moderação | feito no escopo atual | Mestre pode silenciar, remover, banir e desbanir; servidor impõe silêncio, banimento, bloqueio de entrada e limite de mensagens. UI foi exercitada com duas contas e o servidor rejeitou chat de usuário silenciado. |
| PWA, instalação e offline | parcial | Manifesto, ícones PNG 192/512 originais e service worker verificados no preview. O shell abriu offline após precache; API não é cacheada e alterações offline não são enfileiradas. Instalação e experiência instalada não foram testadas. |
| Hospedagem/publicação | parcial | O usuário autorizou Supabase Free, trial Railway até US$5, push ao repositório e nenhuma migração de dados locais. O deploy atual iniciou o Express em `0.0.0.0:8080`, mas o target port do domínio estava em `4000`, causando HTTP 502. O target port foi corrigido para `8080`. Em 06/11/2026, `/api/health` respondeu HTTP 200 com `status: ok` e `mode: postgres-authenticated-room-server`, o que confirma consulta ao PostgreSQL; `/` carregou a tela de login FREECAST e o console do navegador não mostrou erros. Ainda faltam cadastro/login remoto, persistência após reinício e WebSocket entre computadores. Não fazer upgrade/pagamento nem exceder US$5. |
| App Rust/egui e dados existentes | preservado | Nenhum arquivo nativo foi editado. |

## Verificações executadas

- `app/web`: `npm run build` — TypeScript e Vite passaram.
- `app/server`: `npm test` — 18 testes passaram; incluem autenticação por e-mail, salas com senha, WebSocket, isolamento, moderação, CRUD/autorização/persistência de ficha e biblioteca, rolagens D&D 5E server-side e serving da SPA pelo Express.
- `app/server`: `node --check server.js` — passou.
- `app/server`: `node --check postgres-store.js` — passou; o adapter aguarda teste com conexão PostgreSQL real.
- `app/server`: `npm audit --omit=dev` — 0 vulnerabilidades.
- `app/web`: `npm run build` — passou com o nome FREECAST e os assets atuais.
- `railway.json` — JSON válido. A imagem Docker não foi construída localmente porque o daemon Docker não está iniciado.
- Docker/Railway: o build do commit `9c9eec1` falhou em `npm ci --omit=dev`; o Dockerfile foi ajustado para compilar dependências nativas numa etapa com `python3`, `make` e `g++`. O build remoto do commit `6b362c0` passou, incluindo `npm ci --omit=dev` e o build Vite. Um `npm ci --omit=dev` isolado também passou localmente, com 0 vulnerabilidades; isso não substitui a validação do container, feita pelo Railway.
- Railway (histórico): deploy do commit `6b362c0` falhou antes da configuração das variáveis; depois, os logs exibiram `SELF_SIGNED_CERT_IN_CHAIN`. O adapter passou a exigir e carregar `DATABASE_SSL_CA_CERT` para Supabase, mantendo validação TLS.
- Railway (06/11/2026): logs do processo confirmaram inicialização em `0.0.0.0:8080`; o target port do domínio estava em `4000` e foi corrigido para `8080`. `/api/health` retornou HTTP 200 (`status: ok`, modo PostgreSQL); `/` carregou FREECAST, com zero erros no console. Essa checagem confirma a conexão PostgreSQL, mas não substitui testes autenticados de criação/edição, persistência após reiniciar o serviço ou chat entre dois computadores.
- Playwright: cadastro, criação/entrada de sala, campanha, nota privada, ficha, dois usuários em contextos isolados, chat cruzado e moderação server-side; o cliente reconectou depois do reinício do backend.
- Playwright: `scrollWidth === viewportWidth` em 360, 390, 430 e 1280 CSS px na página de fichas.
- Playwright: lobby e sala sem overflow horizontal em 360, 390, 430 e 1280 CSS px; console atual com zero erros.
- Playwright local: cadastro com e-mail, criação de sala protegida e criação/abertura de mapa persistido 15×27 passaram; não houve overflow horizontal nos quatro viewports na lobby e na sala. O único erro de console após a criação do mapa veio da URL de teste `https://example.test/map.png` (hostname intencionalmente inexistente), não de erro JavaScript.
- Playwright local (06/11/2026): após a última reorganização, a sala não apresentou overflow horizontal em 360, 390, 430 e 1280 CSS px. Snapshot com caixas em 1280 px confirmou a composição de três colunas e o footer; em 390 px, selecionar Biblioteca exibiu o painel correspondente. Console: zero erros. Captura de screenshot expirou no limite da ferramenta enquanto aguardava fontes; verificação visual ficou restrita ao snapshot/acessibilidade e às caixas de layout.
- `app/server`: após adicionar email, papéis, biblioteca/mapas e checagens D&D 5E, `node --check server.js` e `npm test` passaram; testes verificam senha incorreta/correta, visibilidade e persistência de mapa, autorização de rolamento e persistência de resultado após reinício.
- `app/web`: `npm run build` após as alterações de FREECAST — passou (TypeScript e Vite).
- Conta e sala temporárias da revisão visual foram removidas do SQLite local; o banco confirmou que não restaram registros com o nome da conta de teste.
- A consulta somente leitura do Supabase confirmou que ainda não existe o schema `freecast`; a migração será aplicada pelo backend ao conectar.
- Playwright: manifesto, dimensões 192×192/512×512, service worker ativo e cache do shell/assets; com o preview parado, a shell carregou offline e indicou erro de backend. Instalação real não testada.
- REA já examinou estaticamente `C:\RRPG\rrpg.exe` e `rrpgcpp32.dll` em etapa anterior; os recursos do EXE não foram lidos devido ao limite de 64 MiB. Nenhum asset foi extraído.
- Alwaysdata: painel autenticado consultado sem submeter formulários; assinatura Small de €6/mês observada na página de assinaturas. O formulário de site permite selecionar Node.js. Documentação oficial consultada sobre ofertas, Node, WebSocket, configuração de sites e tempo ocioso. Não foi possível confirmar pelo painel se a criação de site adiciona cobrança, nem se serviço contínuo está incluído.

## Análise visual e alterações da etapa FREECAST

O vídeo mostra uma lobby com filtros e mesas em lista e uma sala com biblioteca à esquerda, área de jogo/chat ao centro, participantes/mestres à direita e ferramentas inferiores. A interface foi aproximada com composição compacta e paleta original; o material de referência não mostra um mapa em partida. Marca e ícones FREECAST foram criados localmente. Playwright verificou as larguras e a compilação, mas isso não valida multiplayer hospedado.

## Pendências para publicação e conclusão

Não declarar concluído. A publicação responde no domínio público e o health check validou uma consulta PostgreSQL, mas faltam testes remotos de cadastro/login, autorização, persistência após reinício, WebSocket entre dois computadores, instalação PWA real e QA final de teclado/leitor de tela, larguras/painéis da sala e fluxos de erro. Confirmar também as tabelas no schema `freecast` no Supabase. Acompanhar o trial e parar antes de exceder US$5 ou exigir pagamento/upgrade. Netlify estático não substitui este backend Express/WebSocket.
