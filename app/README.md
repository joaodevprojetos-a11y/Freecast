# Aplicativo web FREECAST

O frontend React/Vite fica em `web/`; a API Express/WebSocket fica em `server/`. O aplicativo nativo Rust/egui e seus dados continuam separados e não são alterados por estes comandos. O backend requer Node.js 22 ou superior.

## Desenvolvimento local

Abra dois terminais:

```powershell
Set-Location app\server
npm start
```

```powershell
Set-Location app\web
npm run dev
```

O backend escuta em `127.0.0.1:4000`; o Vite usa `http://localhost:3000`. Sem `DATABASE_URL`, as migrações SQLite são aplicadas ao iniciar o backend. O arquivo padrão é `server/data/rrpg.sqlite`; `RRPG_DB_PATH` permite escolher outro caminho persistente. Com `DATABASE_URL`, o servidor usa PostgreSQL e aplica apenas as migrações de esquema; nenhum dado SQLite é importado.

Crie uma conta no servidor com senha de pelo menos 12 caracteres. As salas criadas são públicas. A sala inicial de demonstração é compartilhada e não deve conter dados privados. Fichas ficam visíveis ao dono e ao mestre; notas de campanha são privadas do mestre. Nesta versão, somente o mestre move tokens.

## Verificações

```powershell
Set-Location app\server
npm test
node --check server.js
```

```powershell
Set-Location app\web
npm run build
```

## Servir frontend e backend juntos

O servidor Express existente pode servir `web/dist` em produção, incluindo as rotas da SPA. Gere a pasta antes de iniciar o servidor:

```powershell
Set-Location app\web
npm run build
```

Em produção, configure no ambiente do processo:

- `NODE_ENV=production`
- `DATABASE_URL` como variável secreta, usando a conexão PostgreSQL do banco escolhido
- `WEB_ORIGIN=https://<origem-configurada>` para validar origem e cookies
- `BIND_HOST=0.0.0.0` e `PORT` fornecidos pelo provedor

O mesmo Express atende HTTP e WebSocket em `/ws`; não configure um segundo backend. O armazenamento SQLite é local a um único processo e não é compartilhado entre instâncias.

O repositório inclui um `Dockerfile` para construir o frontend e executar o Express existente. O `.dockerignore` exclui bancos locais, variáveis de ambiente, dependências e o vídeo de referência.

## PWA e offline

O manifest e o service worker ficam em `web/public/`. O shell HTML/CSS/JS pode abrir offline depois de ser carregado uma vez; autenticação, salas, chat, fichas e demais alterações precisam do backend e não são enfileiradas offline. O cache não guarda respostas da API. Instalação foi preparada, mas a instalação em dispositivo/navegador e atualização após publicação ainda precisam de validação.

## Limitações e publicação

Não há salas privadas/invites, recuperação de senha, ficha específica de sistema, biblioteca de tokens/arte de mapas, presença online, nem armazenamento multi-instância. A hospedagem não está configurada. O backend usa SQLite local e requer um caminho de dados persistente; não publique em um filesystem efêmero como se os dados fossem duráveis. Uma publicação com Postgres exige adaptar o armazenamento e aplicar migrações no banco escolhido. Antes de criar serviços ou consumir créditos de hospedagem, confirme o limite de custo e a estratégia de persistência. Não há configuração de deploy ou segredo incluído neste repositório.
