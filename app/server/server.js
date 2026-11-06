const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const { createSqliteStore } = require('./store');
const { createPostgresStore } = require('./postgres-store');
const {
  clearSessionCookie,
  hashPassword,
  hashSessionToken,
  newSessionRecord,
  readSessionToken,
  sessionCookie,
  verifyPassword
} = require('./auth');

const GRID_SIZE = 12;
const MAX_CHAT_LENGTH = 500;
const MAX_DICE_COUNT = 20;
const MAX_DIE_SIDES = 1000;
const MAX_MODIFIER = 100;
const DEMO_ROOM_ID = 'demo';
const PASSWORD_MIN_LENGTH = 12;
const MAX_WEBSOCKET_MESSAGES = 50;
const WEBSOCKET_MESSAGE_WINDOW_MS = 10000;

function createEmptyRoomState() {
  return { tokens: [], messages: [], diceRolls: [] };
}

function createInitialState() {
  return {
    tokens: [
      { id: '1', name: 'Arin, Sentinel', x: 4, y: 4, hp: 32, maxHp: 32, color: '#D4AF37' },
      { id: '2', name: 'Mira, Wayfinder', x: 6, y: 4, hp: 24, maxHp: 24, color: '#58111A' },
      { id: '3', name: 'Cave Warden', x: 2, y: 2, hp: 10, maxHp: 10, color: '#8B0000' }
    ],
    messages: [
      {
        id: 'm1',
        user: 'Demonstração',
        text: 'Sala de demonstração pública. Não use para compartilhar conteúdo privado.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        createdAt: new Date().toISOString()
      }
    ],
    diceRolls: []
  };
}

function parseDiceExpression(expression) {
  if (typeof expression !== 'string' || expression.length > 32) return null;
  const match = /^([1-9]\d?)d([1-9]\d{0,3})([+-]\d{1,3})?$/i.exec(expression.trim());
  if (!match) return null;

  const count = Number(match[1]);
  const sides = Number(match[2]);
  const modifier = Number(match[3] || 0);
  if (count > MAX_DICE_COUNT || sides > MAX_DIE_SIDES || Math.abs(modifier) > MAX_MODIFIER) return null;
  return { count, sides, modifier };
}

function rollDice(expression, randomInt = crypto.randomInt) {
  const parsed = parseDiceExpression(expression);
  if (!parsed) return null;

  const rolls = Array.from({ length: parsed.count }, () => randomInt(1, parsed.sides + 1));
  const result = rolls.reduce((sum, value) => sum + value, 0);
  return { rolls, result, total: result + parsed.modifier };
}

function asyncHandler(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function processMessage(rawMessage, state, now = new Date(), randomInt = crypto.randomInt, actor = null) {
  let message;
  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    return { type: 'ERROR', payload: { message: 'Mensagem inválida: use JSON.' } };
  }

  if (!message || typeof message !== 'object' || Array.isArray(message) || !message.payload || typeof message.payload !== 'object') {
    return { type: 'ERROR', payload: { message: 'Mensagem inválida.' } };
  }

  const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const username = actor?.username || 'Convidado (sem autenticação)';
  switch (message.type) {
    case 'MOVE_TOKEN': {
      if (actor && actor.role !== 'gm') {
        return { type: 'ERROR', payload: { message: 'Somente o mestre pode mover tokens nesta versão.' } };
      }
      const { id, x, y } = message.payload;
      const token = state.tokens.find(item => item.id === id);
      if (!token || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) {
        return { type: 'ERROR', payload: { message: 'Movimento inválido.' } };
      }
      token.x = x;
      token.y = y;
      return { type: 'STATE_UPDATE', payload: state };
    }
    case 'ROLL_DICE': {
      const { expression } = message.payload;
      const roll = rollDice(expression, randomInt);
      if (!roll) return { type: 'ERROR', payload: { message: 'Expressão de dados inválida ou fora dos limites.' } };
      const entry = {
        id: `d_${crypto.randomUUID()}`,
        user: username,
        expression: expression.trim(),
        result: roll.result,
        total: roll.total,
        time: timestamp,
        createdAt: now.toISOString()
      };
      state.diceRolls.unshift(entry);
      state.diceRolls.length = Math.min(state.diceRolls.length, 50);
      state.messages.unshift({
        id: `m_${crypto.randomUUID()}`,
        user: 'Dados',
        text: `${username} rolou ${entry.expression}: ${roll.rolls.join(', ')} (total ${roll.total})`,
        time: timestamp,
        createdAt: now.toISOString()
      });
      state.messages.length = Math.min(state.messages.length, 100);
      return { type: 'STATE_UPDATE', payload: state };
    }
    case 'SEND_CHAT': {
      if (actor?.mutedUntil && actor.mutedUntil > now.toISOString()) {
        return { type: 'ERROR', payload: { message: 'Você está silenciado nesta sala.' } };
      }
      const text = typeof message.payload.text === 'string' ? message.payload.text.trim() : '';
      if (!text || text.length > MAX_CHAT_LENGTH) {
        return { type: 'ERROR', payload: { message: `A mensagem deve ter entre 1 e ${MAX_CHAT_LENGTH} caracteres.` } };
      }
      state.messages.unshift({
        id: `m_${crypto.randomUUID()}`,
        user: username,
        text,
        time: timestamp,
        createdAt: now.toISOString()
      });
      state.messages.length = Math.min(state.messages.length, 100);
      return { type: 'STATE_UPDATE', payload: state };
    }
    default:
      return { type: 'ERROR', payload: { message: 'Ação desconhecida.' } };
  }
}

async function createAppServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const railwayOrigin = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null;
  const webServerOrigin = options.webOrigin || process.env.WEB_ORIGIN || railwayOrigin || 'http://127.0.0.1:3000';
  const allowedOrigins = new Set([webServerOrigin]);
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://127.0.0.1:3000');
  }
  app.set('trust proxy', 1);
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use((request, response, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.headers.origin && !allowedOrigins.has(request.headers.origin)) {
      response.status(403).json({ error: 'Origem não autorizada.' });
      return;
    }
    next();
  });

  const connectionString = options.databaseUrl || process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' && !connectionString) {
    throw new Error('DATABASE_URL é obrigatória em produção.');
  }
  const db = connectionString
    ? await createPostgresStore(connectionString)
    : createSqliteStore(options.dbPath);
  const rateLimitBuckets = new Map();
  if (!await db.loadRoomState(DEMO_ROOM_ID)) await db.persistRoomState(DEMO_ROOM_ID, createInitialState());
  const roomStates = new Map();
  const roomQueues = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const secureCookies = process.env.NODE_ENV === 'production' || options.secureCookies === true;

  async function getAuthenticatedUser(request) {
    const token = readSessionToken(request);
    if (!token) return null;
    return db.getSessionUser(hashSessionToken(token));
  }

  async function requireAuth(request, response, next) {
    try {
      const user = await getAuthenticatedUser(request);
      if (!user) {
        response.status(401).json({ error: 'Autenticação necessária.' });
        return;
      }
      request.user = user;
      next();
    } catch (error) {
      next(error);
    }
  }

  function rateLimit(keyPrefix, limit, windowMs, keySelector = request => request.ip) {
    return (request, response, next) => {
      const now = Date.now();
      for (const [key, bucket] of rateLimitBuckets) {
        if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
      }
      const key = `${keyPrefix}:${keySelector(request) || 'unknown'}`;
      const bucket = rateLimitBuckets.get(key);
      if (bucket && bucket.count >= limit) {
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
        response.status(429).json({ error: 'Muitas solicitações. Aguarde antes de tentar novamente.' });
        return;
      }
      if (bucket) bucket.count += 1;
      else rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      while (rateLimitBuckets.size > 5000) rateLimitBuckets.delete(rateLimitBuckets.keys().next().value);
      next();
    };
  }

  async function getAuthorizedMembership(roomId, userId) {
    if (!await db.getRoom(roomId) || await db.getRoomBannedUser(roomId, userId)) return null;
    return await db.getRoomMembership(roomId, userId) || null;
  }

  function validCampaignFields(body) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    if (!name || name.length > 100 || description.length > 1000) return null;
    return { name, description };
  }

  async function validCharacterFields(body, roomId) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const data = body?.data === undefined ? {} : body.data;
    const campaignId = body?.campaignId || null;
    if (!name || name.length > 60 || !data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (campaignId !== null && typeof campaignId !== 'string') return null;
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 12000) return null;
    if (campaignId) {
      const campaign = await db.getCampaign(campaignId);
      if (!campaign || campaign.roomId !== roomId) return null;
    }
    return { name, data, campaignId };
  }

  async function getRoomState(roomId) {
    if (!roomStates.has(roomId)) {
      roomStates.set(roomId, await db.loadRoomState(roomId) || createEmptyRoomState());
    }
    return roomStates.get(roomId);
  }

  async function enqueueRoomMutation(roomId, operation) {
    const previous = roomQueues.get(roomId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    roomQueues.set(roomId, current);
    try {
      return await current;
    } finally {
      if (roomQueues.get(roomId) === current) roomQueues.delete(roomId);
    }
  }

  async function sendSession(user, request, response) {
    const session = newSessionRecord(user.id);
    await db.createSession(session);
    response.setHeader('Set-Cookie', sessionCookie(session.token, secureCookies || request.secure));
    response.json({ user: { id: user.id, username: user.username } });
  }

  app.post('/api/auth/register', rateLimit('register', 5, 60 * 60 * 1000), async (request, response, next) => {
    try {
      const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(username)) {
        response.status(400).json({ error: 'Nome de usuário: 3–32 caracteres, letras, números, ponto, traço ou sublinhado.' });
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) {
        response.status(400).json({ error: `A senha deve ter entre ${PASSWORD_MIN_LENGTH} e 128 caracteres.` });
        return;
      }
      if (await db.findUserByUsername(username)) {
        response.status(409).json({ error: 'Este nome de usuário já está em uso.' });
        return;
      }
      const user = { id: crypto.randomUUID(), username, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
      try {
        await db.insertUser(user);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
          response.status(409).json({ error: 'Este nome de usuário já está em uso.' });
          return;
        }
        throw error;
      }
      await sendSession(user, request, response);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', rateLimit('login', 10, 15 * 60 * 1000), async (request, response, next) => {
    try {
      const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const user = await db.findUserByUsername(username);
      if (password.length > 128) {
        response.status(401).json({ error: 'Nome de usuário ou senha inválidos.' });
        return;
      }
      const passwordValid = await verifyPassword(password, user?.passwordHash);
      if (!user || !passwordValid) {
        response.status(401).json({ error: 'Nome de usuário ou senha inválidos.' });
        return;
      }
      await sendSession(user, request, response);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', asyncHandler(async (request, response) => {
    const token = readSessionToken(request);
    if (token) {
      const tokenHash = hashSessionToken(token);
      await db.deleteSession(tokenHash);
      wss.clients.forEach(client => {
        if (client.sessionTokenHash === tokenHash) client.close(4001, 'Sessão encerrada');
      });
    }
    response.setHeader('Set-Cookie', clearSessionCookie(secureCookies || request.secure));
    response.status(204).end();
  }));

  app.get('/api/me', asyncHandler(async (request, response) => {
    const user = await getAuthenticatedUser(request);
    response.json({ user: user ? { id: user.id, username: user.username } : null });
  }));

  app.get('/api/rooms', requireAuth, asyncHandler(async (request, response) => {
    response.json({ rooms: await db.listRoomsForUser(request.user.id) });
  }));

  app.post('/api/rooms', requireAuth, rateLimit('create-room', 10, 60 * 60 * 1000, request => request.user.id), asyncHandler(async (request, response) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const gameSystem = typeof request.body?.gameSystem === 'string' ? request.body.gameSystem.trim() : 'Sistema próprio';
    const description = typeof request.body?.description === 'string' ? request.body.description.trim() : '';
    if (!name || name.length > 80 || gameSystem.length > 60 || description.length > 500) {
      response.status(400).json({ error: 'Confira o nome (1–80), sistema (até 60) e descrição (até 500 caracteres).' });
      return;
    }
    const createdAt = new Date().toISOString();
    const room = await db.createRoom({
      id: crypto.randomUUID(),
      name,
      gameSystem: gameSystem || 'Sistema próprio',
      description,
      visibility: 'public',
      ownerId: request.user.id,
      createdAt
    });
    response.status(201).json({ room, membership: await db.getRoomMembership(room.id, request.user.id) });
  }));

  app.post('/api/rooms/:roomId/join', requireAuth, asyncHandler(async (request, response) => {
    const result = await db.joinRoom(request.params.roomId, request.user.id, new Date().toISOString());
    if (result.error) {
      const status = await db.getRoom(request.params.roomId) ? 403 : 404;
      response.status(status).json({ error: result.error });
      return;
    }
    response.json(result);
  }));

  app.get('/api/rooms/:roomId', requireAuth, asyncHandler(async (request, response) => {
    const room = await db.getRoom(request.params.roomId);
    const membership = room && await db.getRoomMembership(room.id, request.user.id);
    if (!room || !membership || await db.getRoomBannedUser(room.id, request.user.id)) {
      response.status(404).json({ error: 'Sala não encontrada.' });
      return;
    }
    response.json({
      room,
      membership,
      members: await db.listRoomMembers(room.id),
      bannedMembers: membership.role === 'gm' ? await db.listRoomBans(room.id) : []
    });
  }));

  app.get('/api/rooms/:roomId/campaigns', requireAuth, asyncHandler(async (request, response) => {
    if (!await getAuthorizedMembership(request.params.roomId, request.user.id)) {
      response.status(403).json({ error: 'Você não tem acesso a esta sala.' });
      return;
    }
    response.json({ campaigns: await db.listCampaigns(request.params.roomId) });
  }));

  app.post('/api/rooms/:roomId/campaigns', requireAuth, asyncHandler(async (request, response) => {
    const membership = await getAuthorizedMembership(request.params.roomId, request.user.id);
    if (!membership || membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode criar campanhas.' });
      return;
    }
    const fields = validCampaignFields(request.body);
    if (!fields) {
      response.status(400).json({ error: 'Informe um nome (até 100 caracteres) e descrição (até 1000 caracteres) válidos.' });
      return;
    }
    const now = new Date().toISOString();
    const campaign = await db.createCampaign({
      id: crypto.randomUUID(),
      roomId: request.params.roomId,
      ...fields,
      createdByUserId: request.user.id,
      createdAt: now,
      updatedAt: now
    });
    response.status(201).json({ campaign });
  }));

  app.patch('/api/campaigns/:campaignId', requireAuth, asyncHandler(async (request, response) => {
    const campaign = await db.getCampaign(request.params.campaignId);
    const membership = campaign && await getAuthorizedMembership(campaign.roomId, request.user.id);
    if (!campaign || !membership) {
      response.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode editar campanhas.' });
      return;
    }
    const fields = validCampaignFields(request.body);
    if (!fields) {
      response.status(400).json({ error: 'Informe um nome (até 100 caracteres) e descrição (até 1000 caracteres) válidos.' });
      return;
    }
    await db.updateCampaign(campaign.id, fields.name, fields.description, new Date().toISOString());
    response.json({ campaign: await db.getCampaign(campaign.id) });
  }));

  app.delete('/api/campaigns/:campaignId', requireAuth, asyncHandler(async (request, response) => {
    const campaign = await db.getCampaign(request.params.campaignId);
    const membership = campaign && await getAuthorizedMembership(campaign.roomId, request.user.id);
    if (!campaign || !membership) {
      response.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode excluir campanhas.' });
      return;
    }
    await db.deleteCampaign(campaign.id);
    response.status(204).end();
  }));

  app.get('/api/campaigns/:campaignId/notes', requireAuth, asyncHandler(async (request, response) => {
    const campaign = await db.getCampaign(request.params.campaignId);
    const membership = campaign && await getAuthorizedMembership(campaign.roomId, request.user.id);
    if (!campaign || !membership) {
      response.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'As notas da campanha são privadas do mestre.' });
      return;
    }
    response.json({ notes: await db.listCampaignNotes(campaign.id) });
  }));

  app.post('/api/campaigns/:campaignId/notes', requireAuth, asyncHandler(async (request, response) => {
    const campaign = await db.getCampaign(request.params.campaignId);
    const membership = campaign && await getAuthorizedMembership(campaign.roomId, request.user.id);
    if (!campaign || !membership) {
      response.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode criar notas.' });
      return;
    }
    const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
    const content = typeof request.body?.content === 'string' ? request.body.content : '';
    if (!title || title.length > 120 || content.length > 10000) {
      response.status(400).json({ error: 'Informe um título (até 120 caracteres) e conteúdo (até 10000 caracteres) válidos.' });
      return;
    }
    const now = new Date().toISOString();
    const note = await db.createCampaignNote({
      id: crypto.randomUUID(),
      campaignId: campaign.id,
      title,
      content,
      createdByUserId: request.user.id,
      createdAt: now,
      updatedAt: now
    });
    response.status(201).json({ note });
  }));

  app.patch('/api/campaign-notes/:noteId', requireAuth, asyncHandler(async (request, response) => {
    const note = await db.getCampaignNote(request.params.noteId);
    const campaign = note && await db.getCampaign(note.campaignId);
    const membership = campaign && await getAuthorizedMembership(campaign.roomId, request.user.id);
    if (!note || !membership) {
      response.status(404).json({ error: 'Nota não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode editar notas.' });
      return;
    }
    const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
    const content = typeof request.body?.content === 'string' ? request.body.content : '';
    if (!title || title.length > 120 || content.length > 10000) {
      response.status(400).json({ error: 'Informe um título (até 120 caracteres) e conteúdo (até 10000 caracteres) válidos.' });
      return;
    }
    await db.updateCampaignNote(note.id, title, content, new Date().toISOString());
    response.json({ note: await db.getCampaignNote(note.id) });
  }));

  app.delete('/api/campaign-notes/:noteId', requireAuth, asyncHandler(async (request, response) => {
    const note = await db.getCampaignNote(request.params.noteId);
    const campaign = note && await db.getCampaign(note.campaignId);
    const membership = campaign && await getAuthorizedMembership(campaign.roomId, request.user.id);
    if (!note || !membership) {
      response.status(404).json({ error: 'Nota não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode excluir notas.' });
      return;
    }
    await db.deleteCampaignNote(note.id);
    response.status(204).end();
  }));

  app.get('/api/rooms/:roomId/characters', requireAuth, asyncHandler(async (request, response) => {
    const membership = await getAuthorizedMembership(request.params.roomId, request.user.id);
    if (!membership) {
      response.status(403).json({ error: 'Você não tem acesso a esta sala.' });
      return;
    }
    response.json({ characters: await db.listCharacters(request.params.roomId, request.user.id, membership.role === 'gm') });
  }));

  app.post('/api/rooms/:roomId/characters', requireAuth, asyncHandler(async (request, response) => {
    const membership = await getAuthorizedMembership(request.params.roomId, request.user.id);
    if (!membership) {
      response.status(403).json({ error: 'Você não tem acesso a esta sala.' });
      return;
    }
    const fields = await validCharacterFields(request.body, request.params.roomId);
    if (!fields) {
      response.status(400).json({ error: 'Ficha inválida: nome obrigatório, dados limitados a 12 KB e campanha da mesma sala.' });
      return;
    }
    const now = new Date().toISOString();
    const character = await db.createCharacter({
      id: crypto.randomUUID(),
      roomId: request.params.roomId,
      ownerUserId: request.user.id,
      ...fields,
      createdAt: now,
      updatedAt: now
    });
    response.status(201).json({ character });
  }));

  app.patch('/api/characters/:characterId', requireAuth, asyncHandler(async (request, response) => {
    const character = await db.getCharacter(request.params.characterId);
    const membership = character && await getAuthorizedMembership(character.roomId, request.user.id);
    if (!character || !membership) {
      response.status(404).json({ error: 'Ficha não encontrada.' });
      return;
    }
    if (character.ownerUserId !== request.user.id && membership.role !== 'gm') {
      response.status(403).json({ error: 'Você só pode editar suas próprias fichas.' });
      return;
    }
    const fields = await validCharacterFields(request.body, character.roomId);
    if (!fields) {
      response.status(400).json({ error: 'Ficha inválida: nome obrigatório, dados limitados a 12 KB e campanha da mesma sala.' });
      return;
    }
    await db.updateCharacter(character.id, fields.name, fields.data, fields.campaignId, new Date().toISOString());
    response.json({ character: await db.getCharacter(character.id) });
  }));

  app.delete('/api/characters/:characterId', requireAuth, asyncHandler(async (request, response) => {
    const character = await db.getCharacter(request.params.characterId);
    const membership = character && await getAuthorizedMembership(character.roomId, request.user.id);
    if (!character || !membership) {
      response.status(404).json({ error: 'Ficha não encontrada.' });
      return;
    }
    if (character.ownerUserId !== request.user.id && membership.role !== 'gm') {
      response.status(403).json({ error: 'Você só pode excluir suas próprias fichas.' });
      return;
    }
    await db.deleteCharacter(character.id);
    response.status(204).end();
  }));

  app.post('/api/rooms/:roomId/members/:targetUserId/moderation', requireAuth, asyncHandler(async (request, response) => {
    const { roomId, targetUserId } = request.params;
    await enqueueRoomMutation(roomId, async () => {
      const actorMembership = await db.getRoomMembership(roomId, request.user.id);
      const targetMembership = await db.getRoomMembership(roomId, targetUserId);
      if (!actorMembership || actorMembership.role !== 'gm') {
        response.status(403).json({ error: 'Somente o mestre pode moderar esta sala.' });
        return;
      }
      const targetUser = await db.findUserById(targetUserId);
      if (!targetUser || targetUserId === request.user.id || (request.body?.action !== 'unban' && (!targetMembership || targetMembership.role === 'gm'))) {
        response.status(400).json({ error: 'Membro alvo inválido para moderação.' });
        return;
      }

      const action = request.body?.action;
      const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 200) : '';
      const now = new Date();
      let success = false;
      switch (action) {
        case 'mute': {
          const durationMinutes = request.body?.durationMinutes;
          if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
            response.status(400).json({ error: 'A duração do silêncio deve ser de 1 a 1440 minutos.' });
            return;
          }
          success = await db.setRoomMute(roomId, targetUserId, new Date(now.getTime() + durationMinutes * 60000).toISOString());
          break;
        }
        case 'unmute':
          success = await db.setRoomMute(roomId, targetUserId, null);
          break;
        case 'kick':
          success = await db.removeRoomMember(roomId, targetUserId);
          break;
        case 'ban':
          await db.addRoomBan(roomId, targetUserId, request.user.id, reason, now.toISOString());
          success = true;
          break;
        case 'unban':
          success = Boolean(await db.getRoomBannedUser(roomId, targetUserId)) && await db.removeRoomBan(roomId, targetUserId);
          break;
        default:
          response.status(400).json({ error: 'Ação de moderação inválida.' });
          return;
      }
      if (!success) {
        response.status(404).json({ error: 'Não foi possível aplicar a ação ao membro.' });
        return;
      }
      await db.insertModerationEvent({
        id: crypto.randomUUID(),
        roomId,
        actorUserId: request.user.id,
        targetUserId,
        action,
        createdAt: now.toISOString()
      });
      if (action === 'kick' || action === 'ban') {
        wss.clients.forEach(client => {
          if (client.roomId === roomId && client.userId === targetUserId) client.close(4003, 'Acesso à sala removido');
        });
      }
      response.json({ ok: true, action, member: await db.getRoomMembership(roomId, targetUserId) || null });
    });
  }));

  const webRoot = options.webRoot || path.resolve(__dirname, '../web/dist');
  if (options.webRoot || process.env.NODE_ENV === 'production') {
    app.use(express.static(webRoot));
    app.get('*', (request, response, next) => {
      if (request.path.startsWith('/api/') || request.path === '/ws') {
        next();
        return;
      }
      response.sendFile(path.join(webRoot, 'index.html'), error => {
        if (error) next(error);
      });
    });
  }

  app.get('/api/health', asyncHandler(async (request, response) => {
    try {
      await db.health();
    } catch (error) {
      console.error('Health check failed:', error.code || 'unknown error');
      response.status(503).json({ status: 'unavailable', service: 'freecast-server' });
      return;
    }
    response.json({
      status: 'ok',
      service: 'freecast-server',
      mode: `${db.kind}-authenticated-room-server`,
      timestamp: new Date().toISOString()
    });
  }));

  function sendUpgradeError(socket, statusCode, message) {
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      sendUpgradeError(socket, 400, 'Bad Request');
      return;
    }
    if (url.pathname !== '/ws') {
      sendUpgradeError(socket, 404, 'Not Found');
      return;
    }
    if (!allowedOrigins.has(request.headers.origin)) {
      sendUpgradeError(socket, 403, 'Forbidden');
      return;
    }
    const sessionToken = readSessionToken(request);
    const sessionTokenHash = sessionToken ? hashSessionToken(sessionToken) : null;
    const user = sessionTokenHash ? await db.getSessionUser(sessionTokenHash) : null;
    if (!user || !sessionTokenHash) {
      sendUpgradeError(socket, 401, 'Unauthorized');
      return;
    }
    const roomId = url.searchParams.get('roomId');
    const room = roomId && await db.getRoom(roomId);
    const membership = room && await db.getRoomMembership(room.id, user.id);
    if (!room || !membership || await db.getRoomBannedUser(room.id, user.id)) {
      sendUpgradeError(socket, 403, 'Forbidden');
      return;
    }
    const initialState = await getRoomState(room.id);

    wss.handleUpgrade(request, socket, head, ws => {
      ws.roomId = room.id;
      ws.userId = user.id;
      ws.username = user.username;
      ws.sessionTokenHash = sessionTokenHash;
      const expiryTimer = setTimeout(() => ws.close(4001, 'Sessão expirada'), Math.max(0, Date.parse(user.expiresAt) - Date.now()));
      ws.on('close', () => clearTimeout(expiryTimer));
      ws.send(JSON.stringify({ type: 'INIT_STATE', payload: initialState }));
      ws.on('message', rawMessage => {
        void enqueueRoomMutation(room.id, async () => {
          if (!await db.getSessionUser(ws.sessionTokenHash)) {
            ws.close(4001, 'Sessão encerrada ou expirada');
            return;
          }
          const now = Date.now();
          if (now - ws.messageWindowStartedAt >= WEBSOCKET_MESSAGE_WINDOW_MS) {
            ws.messageWindowStartedAt = now;
            ws.messageCount = 0;
          }
          ws.messageCount += 1;
          if (ws.messageCount > MAX_WEBSOCKET_MESSAGES) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Limite de mensagens atingido. Aguarde alguns segundos.' } }));
            return;
          }
          const currentMembership = await db.getRoomMembership(room.id, user.id);
          if (!currentMembership || await db.getRoomBannedUser(room.id, user.id)) {
            ws.close(4003, 'Acesso à sala removido');
            return;
          }
          const state = await getRoomState(room.id);
          const previousState = structuredClone(state);
          const result = processMessage(rawMessage, state, new Date(), crypto.randomInt, {
            id: user.id,
            username: user.username,
            role: currentMembership.role,
            mutedUntil: currentMembership.mutedUntil
          });
          if (result.type !== 'STATE_UPDATE') {
            ws.send(JSON.stringify(result));
            return;
          }
          try {
            await db.persistRoomState(room.id, state);
            const serialized = JSON.stringify(result);
            wss.clients.forEach(client => {
              if (client.roomId === room.id && client.readyState === WebSocket.OPEN) client.send(serialized);
            });
          } catch (error) {
            roomStates.set(room.id, previousState);
            console.error('Room state persistence failed:', error.code || 'unknown error');
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'A alteração não foi salva no armazenamento remoto.' } }));
          }
        }).catch(error => {
          console.error('WebSocket request failed:', error.code || 'unknown error');
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Não foi possível concluir a solicitação.' } }));
          }
        });
      });
    });
    })().catch(error => {
      console.error('WebSocket upgrade failed:', error.code || 'unknown error');
      if (socket.writable) sendUpgradeError(socket, 503, 'Service Unavailable');
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Corpo JSON inválido.' });
      return;
    }
    console.error('Request failed:', error.code || 'unknown error');
    response.status(500).json({ error: 'Não foi possível concluir a solicitação.' });
  });

  server.on('close', () => {
    Promise.resolve(db.close()).catch(error => {
      console.error('Database shutdown failed:', error.code || 'unknown error');
    });
  });
  return { app, server, wss, db, roomStates };
}

if (require.main === module) {
  createAppServer({ dbPath: process.env.RRPG_DB_PATH, databaseUrl: process.env.DATABASE_URL })
    .then(({ server }) => {
      const port = process.env.PORT || 4000;
      const host = process.env.BIND_HOST || '127.0.0.1';
      server.listen(port, host, () => {
        console.log(`FREECAST backend listening at http://${host}:${port}`);
      });
    })
    .catch(error => {
      console.error('FREECAST server startup failed:', error.code || 'unknown error');
      process.exitCode = 1;
    });
}

module.exports = {
  createAppServer,
  createEmptyRoomState,
  createInitialState,
  parseDiceExpression,
  processMessage,
  rollDice
};
