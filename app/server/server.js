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
const MAX_MAP_TOKENS = 100;
const MAX_MAP_DRAWINGS = 200;
const MAX_DRAWING_POINTS = 500;
const DND5E_SKILLS = {
  acrobatics: 'dex', animalHandling: 'wis', arcana: 'int', athletics: 'str',
  deception: 'cha', history: 'int', insight: 'wis', intimidation: 'cha',
  investigation: 'int', medicine: 'wis', nature: 'int', perception: 'wis',
  performance: 'cha', persuasion: 'cha', religion: 'int', sleightOfHand: 'dex',
  stealth: 'dex', survival: 'wis'
};

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
      const { id, x, y } = message.payload;
      const token = state.tokens.find(item => item.id === id);
      if (actor && actor.role !== 'gm' && (actor.role !== 'player' || token?.assignedUserId !== actor.id)) {
        return { type: 'ERROR', payload: { message: 'Você só pode mover tokens atribuídos a você.' } };
      }
      if (!token || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) {
        return { type: 'ERROR', payload: { message: 'Movimento inválido.' } };
      }
      token.x = x;
      token.y = y;
      return { type: 'STATE_UPDATE', payload: state };
    }
    case 'ROLL_DICE': {
      if (actor?.role === 'spectator') {
        return { type: 'ERROR', payload: { message: 'Espectadores podem conversar, mas não rolar dados.' } };
      }
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
    case 'ROLL_CHARACTER_CHECK': {
      if (actor?.role === 'spectator') {
        return { type: 'ERROR', payload: { message: 'Espectadores podem conversar, mas não rolar dados.' } };
      }
      const { kind, key } = message.payload;
      const check = rollCharacterCheck(actor?.character, kind, key, randomInt);
      if (!check) return { type: 'ERROR', payload: { message: 'Ficha ou teste D&D 5E inválido.' } };
      const entry = {
        id: `d_${crypto.randomUUID()}`,
        user: username,
        expression: check.expression,
        result: check.result,
        total: check.total,
        time: timestamp,
        createdAt: now.toISOString()
      };
      state.diceRolls.unshift(entry);
      state.diceRolls.length = Math.min(state.diceRolls.length, 50);
      state.messages.unshift({
        id: `m_${crypto.randomUUID()}`,
        user: 'Dados',
        text: `${username} rolou ${check.checkName} (${entry.expression}): ${check.rolls.join(', ')} (total ${check.total})`,
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

function rollCharacterCheck(character, kind, key, randomInt = crypto.randomInt) {
  if (character?.data?.system !== 'dnd5e' || !['ability', 'savingThrow', 'skill'].includes(kind)) return null;
  const skillAbility = kind === 'skill' ? DND5E_SKILLS[key] : key;
  if (!skillAbility || !['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(skillAbility)) return null;
  if (kind === 'skill' && !Object.hasOwn(DND5E_SKILLS, key)) return null;
  const score = character.data.abilities?.[skillAbility];
  const proficiencyBonus = character.data.proficiencyBonus;
  if (!Number.isInteger(score) || score < 1 || score > 30 || !Number.isInteger(proficiencyBonus) || proficiencyBonus < 2 || proficiencyBonus > 6) return null;
  const proficiencies = kind === 'savingThrow'
    ? character.data.proficientSaves
    : character.data.proficientSkills;
  const proficient = Array.isArray(proficiencies) && proficiencies.includes(key);
  const modifier = Math.floor((score - 10) / 2) + (proficient ? proficiencyBonus : 0);
  const dice = rollDice(`1d20${modifier < 0 ? modifier : `+${modifier}`}`, randomInt);
  if (!dice) return null;
  const checkName = kind === 'skill'
    ? key.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)
    : `${kind === 'savingThrow' ? 'teste de resistência' : 'teste de habilidade'} ${skillAbility.toUpperCase()}`;
  return { ...dice, expression: `1d20${modifier < 0 ? modifier : `+${modifier}`}`, checkName };
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
    const ownerUserId = typeof body?.ownerUserId === 'string' ? body.ownerUserId : null;
    const visibility = body?.visibility === 'room' ? 'room' : 'private';
    if (!name || name.length > 60 || !data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (campaignId !== null && typeof campaignId !== 'string') return null;
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 12000) return null;
    if (campaignId) {
      const campaign = await db.getCampaign(campaignId);
      if (!campaign || campaign.roomId !== roomId) return null;
    }
    return { name, data, campaignId, visibility, ownerUserId };
  }

  function parsePublicUrl(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || value.length > 2048) return undefined;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return undefined;
      return url.toString();
    } catch {
      return undefined;
    }
  }

  async function validLibraryFields(body, roomId, currentItem = null) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const parentId = body?.parentId || null;
    const visibility = body?.visibility === 'room' ? 'room' : 'private';
    const itemType = currentItem?.itemType || body?.itemType;
    if (!name || name.length > 80 || !['folder', 'map'].includes(itemType)) return null;
    if (parentId !== null && typeof parentId !== 'string') return null;
    if (parentId) {
      let parent = await db.getLibraryItem(parentId);
      if (!parent || parent.roomId !== roomId || parent.itemType !== 'folder' || parent.id === currentItem?.id) return null;
      let visited = new Set([parent.id]);
      while (parent.parentId) {
        parent = await db.getLibraryItem(parent.parentId);
        if (!parent || visited.has(parent.id) || parent.id === currentItem?.id) return null;
        visited.add(parent.id);
      }
    }
    if (itemType === 'folder') return { itemType, name, parentId, visibility, data: {} };

    const data = body?.data;
    const width = Number(data?.width);
    const height = Number(data?.height);
    const backgroundUrl = parsePublicUrl(data?.backgroundUrl);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100 || height > 100 || width * height > 10000 || backgroundUrl === undefined) return null;
    const rawTokens = data?.tokens === undefined ? [] : data.tokens;
    if (!Array.isArray(rawTokens) || rawTokens.length > 100) return null;
    const tokens = [];
    for (const token of rawTokens) {
      const tokenName = typeof token?.name === 'string' ? token.name.trim() : '';
      const imageUrl = parsePublicUrl(token?.imageUrl);
      const x = Number(token?.x);
      const y = Number(token?.y);
      const assignedUserId = typeof token?.assignedUserId === 'string' ? token.assignedUserId : null;
      if (!tokenName || tokenName.length > 60 || imageUrl === undefined || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) return null;
      if (assignedUserId) {
        const assignedMember = await db.getRoomMembership(roomId, assignedUserId);
        if (!assignedMember || assignedMember.role !== 'player') return null;
      }
      tokens.push({ id: crypto.randomUUID(), name: tokenName, imageUrl, x, y, assignedUserId });
    }
    return { itemType, name, parentId, visibility, data: { width, height, backgroundUrl, tokens } };
  }

  function getMapDimensions(item) {
    const width = Number(item?.data?.width);
    const height = Number(item?.data?.height);
    if (item?.itemType !== 'map' || !Number.isInteger(width) || !Number.isInteger(height)) return null;
    return { width, height };
  }

  async function getVisibleMap(roomId, mapId, role) {
    const item = await db.getLibraryItem(mapId);
    if (!item || item.roomId !== roomId || !getMapDimensions(item)) return null;
    if (role !== 'gm') {
      const visibleItems = filterVisibleLibraryItems(await db.listLibraryItems(roomId), role);
      if (!visibleItems.some(visibleItem => visibleItem.id === item.id)) return null;
    }
    return item;
  }

  async function persistLibraryData(item, data) {
    const updatedAt = new Date().toISOString();
    const updated = await db.updateLibraryItem(item.id, {
      parentId: item.parentId,
      name: item.name,
      visibility: item.visibility,
      data
    }, updatedAt);
    if (!updated) throw new Error('O mapa deixou de existir durante a atualização.');
    return db.getLibraryItem(item.id);
  }

  async function moveMapToken(roomId, actor, payload) {
    if (!payload || typeof payload.mapId !== 'string' || typeof payload.tokenId !== 'string'
      || !Number.isInteger(payload.x) || !Number.isInteger(payload.y)) {
      return { type: 'ERROR', payload: { message: 'Movimento de token inválido.' } };
    }
    const item = await getVisibleMap(roomId, payload.mapId, actor.role);
    const dimensions = getMapDimensions(item);
    const tokens = item?.data?.tokens;
    const token = Array.isArray(tokens) ? tokens.find(candidate => candidate.id === payload.tokenId) : null;
    if (!item || !dimensions || !token) {
      return { type: 'ERROR', payload: { message: 'Mapa ou token não encontrado.' } };
    }
    if (actor.role === 'spectator'
      || (actor.role !== 'gm' && (actor.role !== 'player' || token.assignedUserId !== actor.id))) {
      return { type: 'ERROR', payload: { message: 'Você só pode mover tokens atribuídos a você.' } };
    }
    if (payload.x < 0 || payload.y < 0 || payload.x >= dimensions.width || payload.y >= dimensions.height) {
      return { type: 'ERROR', payload: { message: 'O token precisa permanecer dentro dos limites do mapa.' } };
    }
    const nextToken = { ...token, x: payload.x, y: payload.y };
    const nextData = {
      ...item.data,
      tokens: tokens.map(candidate => candidate.id === nextToken.id ? nextToken : candidate)
    };
    await persistLibraryData(item, nextData);
    return { type: 'MAP_TOKEN_MOVED', payload: { mapId: item.id, token: nextToken } };
  }

  async function validMapToken(body, item) {
    const dimensions = getMapDimensions(item);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const imageUrl = parsePublicUrl(body?.imageUrl);
    const x = body?.x === undefined ? 0 : Number(body.x);
    const y = body?.y === undefined ? 0 : Number(body.y);
    const assignedUserId = typeof body?.assignedUserId === 'string' && body.assignedUserId
      ? body.assignedUserId
      : null;
    const tokens = Array.isArray(item?.data?.tokens) ? item.data.tokens : [];
    if (!dimensions || !name || name.length > 60 || imageUrl === undefined
      || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= dimensions.width || y >= dimensions.height
      || tokens.length >= MAX_MAP_TOKENS) return null;
    if (assignedUserId) {
      const assignedMember = await db.getRoomMembership(item.roomId, assignedUserId);
      if (!assignedMember || assignedMember.role !== 'player') return null;
    }
    return {
      id: crypto.randomUUID(),
      name,
      imageUrl,
      x,
      y,
      assignedUserId
    };
  }

  function validMapDrawing(body, item) {
    const dimensions = getMapDimensions(item);
    const color = typeof body?.color === 'string' ? body.color : '';
    const width = Number(body?.width);
    const rawPoints = body?.points;
    const drawings = Array.isArray(item?.data?.drawings) ? item.data.drawings : [];
    if (!dimensions || drawings.length >= MAX_MAP_DRAWINGS || !/^#[0-9a-f]{6}$/i.test(color)
      || !Number.isFinite(width) || width < 1 || width > 12
      || !Array.isArray(rawPoints) || rawPoints.length < 2 || rawPoints.length > MAX_DRAWING_POINTS) return null;
    const maxX = dimensions.width * 48;
    const maxY = dimensions.height * 48;
    const points = [];
    for (const point of rawPoints) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > maxX || y > maxY) return null;
      points.push({ x, y });
    }
    return { id: crypto.randomUUID(), color, width, points };
  }

  function filterVisibleLibraryItems(items, role) {
    if (role === 'gm') return items;
    if (role !== 'player') return [];
    const byId = new Map(items.map(item => [item.id, item]));
    const isVisible = item => {
      if (item.visibility !== 'room') return false;
      if (!item.parentId) return true;
      const parent = byId.get(item.parentId);
      return Boolean(parent && parent.itemType === 'folder' && isVisible(parent));
    };
    return items.filter(isVisible);
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
    response.json({ user: { id: user.id, username: user.username, email: user.email } });
  }

  app.post('/api/auth/register', rateLimit('register', 5, 60 * 60 * 1000), async (request, response, next) => {
    try {
      const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
      const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(username)) {
        response.status(400).json({ error: 'Nome de usuário: 3–32 caracteres, letras, números, ponto, traço ou sublinhado.' });
        return;
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        response.status(400).json({ error: 'Informe um endereço de e-mail válido.' });
        return;
      }
      if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) {
        response.status(400).json({ error: `A senha deve ter entre ${PASSWORD_MIN_LENGTH} e 128 caracteres.` });
        return;
      }
      if (await db.findUserByUsername(username) || await db.findUserByEmail(email)) {
        response.status(409).json({ error: 'Este e-mail ou nome de usuário já está cadastrado.' });
        return;
      }
      const user = { id: crypto.randomUUID(), username, email, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
      try {
        await db.insertUser(user);
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === '23505') {
          response.status(409).json({ error: 'Este e-mail ou nome de usuário já está cadastrado.' });
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
      const identifier = typeof request.body?.identifier === 'string'
        ? request.body.identifier.trim()
        : typeof request.body?.email === 'string'
          ? request.body.email.trim()
          : typeof request.body?.username === 'string'
            ? request.body.username.trim()
            : '';
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      const user = identifier.includes('@')
        ? await db.findUserByEmail(identifier.toLowerCase())
        : await db.findUserByUsername(identifier);
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
    response.json({ user: user ? { id: user.id, username: user.username, email: user.email } : null });
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
    const accessType = request.body?.accessType === 'password' ? 'password' : 'public';
    const roomPassword = typeof request.body?.password === 'string' ? request.body.password : '';
    if (accessType === 'password' && (roomPassword.length < 6 || roomPassword.length > 128)) {
      response.status(400).json({ error: 'A senha da mesa deve ter entre 6 e 128 caracteres.' });
      return;
    }
    const room = await db.createRoom({
      id: crypto.randomUUID(),
      name,
      gameSystem: gameSystem || 'Sistema próprio',
      description,
      visibility: 'public',
      accessType,
      passwordHash: accessType === 'password' ? await hashPassword(roomPassword) : null,
      ownerId: request.user.id,
      createdAt
    });
    const { passwordHash, ...publicRoom } = room;
    response.status(201).json({ room: publicRoom, membership: await db.getRoomMembership(room.id, request.user.id) });
  }));

  app.post('/api/rooms/:roomId/join', requireAuth, rateLimit('join-room', 10, 5 * 60 * 1000, request => request.user.id), asyncHandler(async (request, response) => {
    const existingMembership = await db.getRoomMembership(request.params.roomId, request.user.id);
    const room = await db.getRoom(request.params.roomId);
    if (!room || room.isDemo) {
      response.status(404).json({ error: 'Sala não encontrada.' });
      return;
    }
    if (!existingMembership && room.accessType === 'password') {
      const password = typeof request.body?.password === 'string' ? request.body.password : '';
      if (!room.passwordHash || !await verifyPassword(password, room.passwordHash)) {
        response.status(401).json({ error: 'Senha da mesa inválida.' });
        return;
      }
    }
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
    const { passwordHash, ...publicRoom } = room;
    response.json({
      room: publicRoom,
      membership,
      members: await db.listRoomMembers(room.id),
      bannedMembers: membership.role === 'gm' ? await db.listRoomBans(room.id) : []
    });
  }));

  app.get('/api/rooms/:roomId/campaigns', requireAuth, asyncHandler(async (request, response) => {
    const membership = await getAuthorizedMembership(request.params.roomId, request.user.id);
    if (!membership || membership.role === 'spectator') {
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
    if (!membership || membership.role === 'spectator') {
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
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode criar e atribuir fichas.' });
      return;
    }
    const fields = await validCharacterFields(request.body, request.params.roomId);
    if (!fields) {
      response.status(400).json({ error: 'Ficha inválida: nome obrigatório, dados limitados a 12 KB e campanha da mesma sala.' });
      return;
    }
    const ownerUserId = fields.ownerUserId || request.user.id;
    const ownerMembership = await db.getRoomMembership(request.params.roomId, ownerUserId);
    if (!ownerMembership || (ownerUserId !== request.user.id && ownerMembership.role !== 'player')) {
      response.status(400).json({ error: 'A ficha precisa ser atribuída ao mestre ou a um jogador desta sala.' });
      return;
    }
    const now = new Date().toISOString();
    const character = await db.createCharacter({
      id: crypto.randomUUID(),
      roomId: request.params.roomId,
      ...fields,
      ownerUserId,
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
    if (membership.role === 'spectator' || (character.ownerUserId !== request.user.id && membership.role !== 'gm')) {
      response.status(403).json({ error: 'Você só pode editar fichas atribuídas a você.' });
      return;
    }
    const fields = await validCharacterFields(request.body, character.roomId);
    if (!fields) {
      response.status(400).json({ error: 'Ficha inválida: nome obrigatório, dados limitados a 12 KB e campanha da mesma sala.' });
      return;
    }
    const ownerUserId = membership.role === 'gm' ? fields.ownerUserId || character.ownerUserId : character.ownerUserId;
    const ownerMembership = await db.getRoomMembership(character.roomId, ownerUserId);
    if (!ownerMembership || (ownerUserId !== membership.userId && ownerMembership.role !== 'player')) {
      response.status(400).json({ error: 'A ficha precisa ser atribuída ao mestre ou a um jogador desta sala.' });
      return;
    }
    const visibility = membership.role === 'gm' ? fields.visibility : character.visibility;
    await db.updateCharacter(character.id, fields.name, fields.data, fields.campaignId, visibility, ownerUserId, new Date().toISOString());
    response.json({ character: await db.getCharacter(character.id) });
  }));

  app.delete('/api/characters/:characterId', requireAuth, asyncHandler(async (request, response) => {
    const character = await db.getCharacter(request.params.characterId);
    const membership = character && await getAuthorizedMembership(character.roomId, request.user.id);
    if (!character || !membership) {
      response.status(404).json({ error: 'Ficha não encontrada.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode excluir fichas.' });
      return;
    }
    await db.deleteCharacter(character.id);
    response.status(204).end();
  }));

  app.get('/api/rooms/:roomId/library', requireAuth, asyncHandler(async (request, response) => {
    const membership = await getAuthorizedMembership(request.params.roomId, request.user.id);
    if (!membership) {
      response.status(403).json({ error: 'Você não tem acesso a esta sala.' });
      return;
    }
    const items = await db.listLibraryItems(request.params.roomId);
    response.json({ items: filterVisibleLibraryItems(items, membership.role) });
  }));

  app.post('/api/rooms/:roomId/library', requireAuth, asyncHandler(async (request, response) => {
    const membership = await getAuthorizedMembership(request.params.roomId, request.user.id);
    if (!membership || membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode criar itens na biblioteca.' });
      return;
    }
    const fields = await validLibraryFields(request.body, request.params.roomId);
    if (!fields) {
      response.status(400).json({ error: 'Item inválido. Confira nome, pasta, URL de imagem e dimensões do mapa (1–100 por eixo).' });
      return;
    }
    const now = new Date().toISOString();
    const item = await db.createLibraryItem({
      id: crypto.randomUUID(),
      roomId: request.params.roomId,
      ownerUserId: request.user.id,
      ...fields,
      createdAt: now,
      updatedAt: now
    });
    response.status(201).json({ item });
  }));

  app.patch('/api/library/:itemId', requireAuth, asyncHandler(async (request, response) => {
    const item = await db.getLibraryItem(request.params.itemId);
    const membership = item && await getAuthorizedMembership(item.roomId, request.user.id);
    if (!item || !membership) {
      response.status(404).json({ error: 'Item não encontrado.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode editar a biblioteca.' });
      return;
    }
    const fields = await validLibraryFields(request.body, item.roomId, item);
    if (!fields) {
      response.status(400).json({ error: 'Item inválido. Confira nome, pasta, URL de imagem e dimensões do mapa (1–100 por eixo).' });
      return;
    }
    await db.updateLibraryItem(item.id, fields, new Date().toISOString());
    response.json({ item: await db.getLibraryItem(item.id) });
  }));

  app.delete('/api/library/:itemId', requireAuth, asyncHandler(async (request, response) => {
    const item = await db.getLibraryItem(request.params.itemId);
    const membership = item && await getAuthorizedMembership(item.roomId, request.user.id);
    if (!item || !membership) {
      response.status(404).json({ error: 'Item não encontrado.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode excluir itens da biblioteca.' });
      return;
    }
    await db.deleteLibraryItem(item.id);
    response.status(204).end();
  }));

  app.post('/api/library/:itemId/tokens', requireAuth, asyncHandler(async (request, response) => {
    const item = await db.getLibraryItem(request.params.itemId);
    const membership = item && await getAuthorizedMembership(item.roomId, request.user.id);
    if (!item || !membership) {
      response.status(404).json({ error: 'Mapa não encontrado.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode criar tokens no mapa.' });
      return;
    }
    const token = await validMapToken(request.body, item);
    if (!token) {
      response.status(400).json({ error: 'Token inválido. Confira nome, URL, posição, atribuição e o limite de tokens.' });
      return;
    }
    const updatedItem = await persistLibraryData(item, {
      ...item.data,
      tokens: [...(Array.isArray(item.data.tokens) ? item.data.tokens : []), token]
    });
    response.status(201).json({ item: updatedItem, token });
  }));

  app.delete('/api/library/:itemId/tokens/:tokenId', requireAuth, asyncHandler(async (request, response) => {
    const item = await db.getLibraryItem(request.params.itemId);
    const membership = item && await getAuthorizedMembership(item.roomId, request.user.id);
    if (!item || !membership) {
      response.status(404).json({ error: 'Mapa não encontrado.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode remover tokens do mapa.' });
      return;
    }
    const tokens = Array.isArray(item.data.tokens) ? item.data.tokens : [];
    if (!tokens.some(token => token.id === request.params.tokenId)) {
      response.status(404).json({ error: 'Token não encontrado.' });
      return;
    }
    const updatedItem = await persistLibraryData(item, {
      ...item.data,
      tokens: tokens.filter(token => token.id !== request.params.tokenId)
    });
    response.json({ item: updatedItem });
  }));

  app.post('/api/library/:itemId/drawings', requireAuth, asyncHandler(async (request, response) => {
    const item = await db.getLibraryItem(request.params.itemId);
    const membership = item && await getAuthorizedMembership(item.roomId, request.user.id);
    if (!item || !membership) {
      response.status(404).json({ error: 'Mapa não encontrado.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode desenhar no mapa.' });
      return;
    }
    const drawing = validMapDrawing(request.body, item);
    if (!drawing) {
      response.status(400).json({ error: 'Desenho inválido ou fora dos limites permitidos.' });
      return;
    }
    const updatedItem = await persistLibraryData(item, {
      ...item.data,
      drawings: [...(Array.isArray(item.data.drawings) ? item.data.drawings : []), drawing]
    });
    response.status(201).json({ item: updatedItem, drawing });
  }));

  app.delete('/api/library/:itemId/drawings/:drawingId', requireAuth, asyncHandler(async (request, response) => {
    const item = await db.getLibraryItem(request.params.itemId);
    const membership = item && await getAuthorizedMembership(item.roomId, request.user.id);
    if (!item || !membership) {
      response.status(404).json({ error: 'Mapa não encontrado.' });
      return;
    }
    if (membership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode remover desenhos do mapa.' });
      return;
    }
    const drawings = Array.isArray(item.data.drawings) ? item.data.drawings : [];
    if (!drawings.some(drawing => drawing.id === request.params.drawingId)) {
      response.status(404).json({ error: 'Desenho não encontrado.' });
      return;
    }
    const updatedItem = await persistLibraryData(item, {
      ...item.data,
      drawings: drawings.filter(drawing => drawing.id !== request.params.drawingId)
    });
    response.json({ item: updatedItem });
  }));

  app.post('/api/rooms/:roomId/members/:targetUserId/role', requireAuth, asyncHandler(async (request, response) => {
    const { roomId, targetUserId } = request.params;
    const actorMembership = await getAuthorizedMembership(roomId, request.user.id);
    const targetMembership = await db.getRoomMembership(roomId, targetUserId);
    const role = request.body?.role;
    if (!actorMembership || actorMembership.role !== 'gm') {
      response.status(403).json({ error: 'Somente o mestre pode alterar os papéis da sala.' });
      return;
    }
    if (!targetMembership || targetUserId === request.user.id || !['player', 'spectator'].includes(role)) {
      response.status(400).json({ error: 'Membro ou papel inválido.' });
      return;
    }
    await db.setRoomMemberRole(roomId, targetUserId, role);
    response.json({ member: await db.getRoomMembership(roomId, targetUserId) });
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
          let actorCharacter = null;
          let incomingMessage;
          try {
            incomingMessage = JSON.parse(rawMessage.toString());
          } catch {
            // processMessage returns the protocol error for malformed JSON.
          }
          if (incomingMessage?.type === 'ROLL_CHARACTER_CHECK') {
            const characterId = incomingMessage.payload?.characterId;
            const character = typeof characterId === 'string' ? await db.getCharacter(characterId) : null;
            if (currentMembership.role === 'spectator') {
              ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Espectadores podem conversar, mas não rolar dados.' } }));
              return;
            }
            if (!character || character.roomId !== room.id || (character.ownerUserId !== user.id && currentMembership.role !== 'gm')) {
              ws.send(JSON.stringify({ type: 'ERROR', payload: { message: 'Ficha não encontrada ou sem permissão para usá-la.' } }));
              return;
            }
            actorCharacter = character;
          }
          if (incomingMessage?.type === 'MOVE_MAP_TOKEN') {
            const result = await moveMapToken(room.id, {
              id: user.id,
              role: currentMembership.role
            }, incomingMessage.payload);
            if (result.type === 'ERROR') {
              ws.send(JSON.stringify(result));
              return;
            }
            const serialized = JSON.stringify(result);
            wss.clients.forEach(client => {
              if (client.roomId === room.id && client.readyState === WebSocket.OPEN) client.send(serialized);
            });
            return;
          }
          const state = await getRoomState(room.id);
          const previousState = structuredClone(state);
          const result = processMessage(rawMessage, state, new Date(), crypto.randomInt, {
            id: user.id,
            username: user.username,
            role: currentMembership.role,
            mutedUntil: currentMembership.mutedUntil,
            character: actorCharacter
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
