# Aplicativo web RRPG

O frontend React/Vite fica em `web/`; a API Express/WebSocket e o banco SQLite ficam em `server/`. O aplicativo nativo Rust/egui e seus dados continuam separados e não são alterados por estes comandos. O backend requer Node.js 22 ou superior.

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

O backend escuta em `127.0.0.1:4000`; o Vite usa `http://localhost:3000`. As migrações SQLite são aplicadas ao iniciar o backend. O arquivo padrão é `server/data/rrpg.sqlite`; `RRPG_DB_PATH` permite escolher outro caminho persistente.

Crie uma conta local com senha de pelo menos 12 caracteres. As salas criadas são públicas. A sala inicial de demonstração é compartilhada e não deve conter dados privados. Fichas ficam visíveis ao dono e ao mestre; notas de campanha são privadas do mestre. Nesta versão, somente o mestre move tokens.

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

Configure no ambiente do processo:

- `NODE_ENV=production`
- `WEB_ORIGIN=https://<origem-configurada>` para validar origem e cookies
- `IP` e `PORT` fornecidos pelo provedor
- `RRPG_DB_PATH` apontando para um diretório gravável e persistente

O mesmo Express atende HTTP e WebSocket em `/ws`; não configure um segundo backend. O armazenamento SQLite é local a um único processo e não é compartilhado entre instâncias.

## PWA e offline

O manifest e o service worker ficam em `web/public/`. O shell HTML/CSS/JS pode abrir offline depois de ser carregado uma vez; autenticação, salas, chat, fichas e demais alterações precisam do backend e não são enfileiradas offline. O cache não guarda respostas da API. Instalação foi preparada, mas a instalação em dispositivo/navegador e atualização após publicação ainda precisam de validação.

## Limitações e publicação

Não há salas privadas/invites, recuperação de senha, ficha específica de sistema, biblioteca de tokens/arte de mapas, presença online, nem armazenamento multi-instância. O painel Alwaysdata mostra uma assinatura Small de €6/mês e oferece o tipo de site Node.js; ainda não foi confirmado se adicionar o site gera custo incremental ou se serviço contínuo está incluído. Nenhum site/serviço foi criado e não houve publicação nem mudança de plano. Obtenha confirmação explícita antes de criar recursos na conta.
