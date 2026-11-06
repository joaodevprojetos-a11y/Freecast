const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createAppServer, createInitialState, parseDiceExpression, processMessage, rollDice } = require('./server');
const { createStore, loadDemoState, persistDemoState } = require('./store');

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once('message', raw => resolve(JSON.parse(raw.toString())));
    socket.once('error', reject);
  });
}

async function startTestServer(databasePath, options = {}) {
  const instance = createAppServer({ dbPath: databasePath, ...options });
  await new Promise((resolve, reject) => {
    instance.server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
  const address = instance.server.address();
  return { ...instance, origin: `http://127.0.0.1:${address.port}`, wsUrl: `ws://127.0.0.1:${address.port}` };
}

async function registerTestUser(runtime, username) {
  const response = await fetch(`${runtime.origin}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'a-test-password-long-enough' })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function createTestRoom(runtime, cookie, name) {
  const response = await fetch(`${runtime.origin}/api/rooms`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name, gameSystem: 'Sistema de teste', description: 'Sala de teste automatizado' })
  });
  assert.equal(response.status, 201);
  return (await response.json()).room;
}

async function joinTestRoom(runtime, cookie, roomId) {
  return fetch(`${runtime.origin}/api/rooms/${roomId}/join`, { method: 'POST', headers: { cookie } });
}

async function connectToRoom(runtime, cookie, roomId) {
  const socket = new WebSocket(`${runtime.wsUrl}/ws?roomId=${encodeURIComponent(roomId)}`, {
    headers: { origin: 'http://127.0.0.1:3000', cookie }
  });
  const initialMessage = nextMessage(socket);
  await once(socket, 'open');
  return { socket, initialState: await initialMessage };
}

async function stopTestServer(runtime) {
  const sockets = runtime.sockets || (runtime.socket ? [runtime.socket] : []);
  for (const socket of sockets) {
    if (socket.readyState !== WebSocket.CLOSED) {
      const closed = once(socket, 'close');
      socket.close();
      await closed;
    }
  }
  await new Promise(resolve => runtime.wss.close(() => runtime.server.close(resolve)));
}

test('authentication validates accounts, rotates sessions, logs out, and rejects hostile origins', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-auth-'));
  let runtime;
  let authenticatedSocket;
  try {
    runtime = await startTestServer(path.join(directory, 'test.sqlite'));
    const username = `auth-${crypto.randomUUID().slice(0, 8)}`;
    const invalidUsername = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bad!', password: 'a-test-password-long-enough' })
    });
    assert.equal(invalidUsername.status, 400);
    const invalidPassword = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'short' })
    });
    assert.equal(invalidPassword.status, 400);

    const originRejected = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'a-test-password-long-enough' })
    });
    assert.equal(originRejected.status, 403);

    const registration = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'a-test-password-long-enough' })
    });
    assert.equal(registration.status, 200);
    const registrationCookie = registration.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: registrationCookie } })).json()).user.username, username);

    const duplicate = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.toUpperCase(), password: 'a-test-password-long-enough' })
    });
    assert.equal(duplicate.status, 409);
    const fifthRegistrationAttempt = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'also-bad!', password: 'a-test-password-long-enough' })
    });
    assert.equal(fifthRegistrationAttempt.status, 400);
    const rateLimited = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'one-more-bad!', password: 'a-test-password-long-enough' })
    });
    assert.equal(rateLimited.status, 429);
    assert.ok(Number(rateLimited.headers.get('retry-after')) > 0);

    const invalidLogin = await fetch(`${runtime.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong-password' })
    });
    assert.equal(invalidLogin.status, 401);
    const login = await fetch(`${runtime.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'a-test-password-long-enough' })
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie').split(';')[0];
    const room = await createTestRoom(runtime, loginCookie, 'Logout socket test');
    authenticatedSocket = await connectToRoom(runtime, loginCookie, room.id);
    runtime = { ...runtime, socket: authenticatedSocket.socket };

    assert.equal((await fetch(`${runtime.origin}/api/me`)).status, 200);
    assert.equal((await (await fetch(`${runtime.origin}/api/me`)).json()).user, null);
    const unauthorizedWebSocket = new WebSocket(`${runtime.wsUrl}/ws?roomId=demo`, {
      headers: { origin: 'http://127.0.0.1:3000' }
    });
    const upgradeStatus = await new Promise((resolve, reject) => {
      unauthorizedWebSocket.once('unexpected-response', (_request, response) => resolve(response.statusCode));
      unauthorizedWebSocket.once('open', () => reject(new Error('Unauthenticated WebSocket unexpectedly opened.')));
      unauthorizedWebSocket.once('error', reject);
    });
    assert.equal(upgradeStatus, 401);

    const socketClosed = once(authenticatedSocket.socket, 'close');
    const logout = await fetch(`${runtime.origin}/api/auth/logout`, { method: 'POST', headers: { cookie: loginCookie } });
    assert.equal(logout.status, 204);
    assert.equal((await socketClosed)[0], 4001);
    assert.equal((await fetch(`${runtime.origin}/api/me`, { headers: { cookie: loginCookie } })).status, 200);
    assert.equal((await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: loginCookie } })).json()).user, null);
    assert.equal((await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: registrationCookie } })).json()).user.username, username);
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('production mode can serve the built SPA from the existing Express server', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-static-'));
  const webRoot = path.join(directory, 'web');
  fs.mkdirSync(path.join(webRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>RRPG web</title>');
  fs.writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'console.log("RRPG");');
  let runtime;
  try {
    runtime = await startTestServer(path.join(directory, 'test.sqlite'), { webRoot });
    const root = await fetch(runtime.origin);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /RRPG web/);
    const route = await fetch(`${runtime.origin}/characters`);
    assert.equal(route.status, 200);
    assert.match(await route.text(), /RRPG web/);
    const asset = await fetch(`${runtime.origin}/assets/app.js`);
    assert.equal(await asset.text(), 'console.log("RRPG");');
    const health = await fetch(`${runtime.origin}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).mode, 'sqlite-authenticated-room-server');
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('dice expressions enforce syntax and resource limits', () => {
  assert.deepEqual(parseDiceExpression('2d6+3'), { count: 2, sides: 6, modifier: 3 });
  assert.deepEqual(parseDiceExpression('1d20-5'), { count: 1, sides: 20, modifier: -5 });
  assert.equal(parseDiceExpression('21d6'), null);
  assert.equal(parseDiceExpression('1d1001'), null);
  assert.equal(parseDiceExpression('1d20+101'), null);
  assert.equal(parseDiceExpression('1d20; DROP TABLE'), null);
});

test('server rolls dice and ignores client-supplied results and identity', () => {
  const state = createInitialState();
  const response = processMessage(JSON.stringify({
    type: 'ROLL_DICE',
    payload: { user: 'Moderator', expression: '2d6+3', result: 1, total: 4 }
  }), state, new Date('2026-01-01T12:00:00Z'), (min, max) => max - 1);

  assert.equal(response.type, 'STATE_UPDATE');
  assert.equal(state.diceRolls[0].result, 12);
  assert.equal(state.diceRolls[0].total, 15);
  assert.equal(state.diceRolls[0].user, 'Convidado (sem autenticação)');
});

test('invalid actions are rejected without changing state', () => {
  const state = createInitialState();
  const initialMessageCount = state.messages.length;
  const response = processMessage(JSON.stringify({
    type: 'MOVE_TOKEN',
    payload: { id: '1', x: 100, y: 1 }
  }), state);

  assert.equal(response.type, 'ERROR');
  assert.equal(state.tokens[0].x, 4);
  assert.equal(state.messages.length, initialMessageCount);
});

test('authenticated players cannot move tokens owned by the game master', () => {
  const state = createInitialState();
  const response = processMessage(JSON.stringify({
    type: 'MOVE_TOKEN',
    payload: { id: '1', x: 8, y: 7 }
  }), state, new Date(), crypto.randomInt, { id: 'player', username: 'Player', role: 'player' });

  assert.equal(response.type, 'ERROR');
  assert.deepEqual([state.tokens[0].x, state.tokens[0].y], [4, 4]);
});

test('chat messages are trimmed, bounded, and do not accept client identity', () => {
  const state = createInitialState();
  const valid = processMessage(JSON.stringify({
    type: 'SEND_CHAT',
    payload: { user: 'Game Master', text: '  Hello table  ' }
  }), state);
  assert.equal(valid.type, 'STATE_UPDATE');
  assert.equal(state.messages[0].text, 'Hello table');
  assert.equal(state.messages[0].user, 'Convidado (sem autenticação)');

  const invalid = processMessage(JSON.stringify({
    type: 'SEND_CHAT',
    payload: { text: 'x'.repeat(501) }
  }), state);
  assert.equal(invalid.type, 'ERROR');
  assert.equal(state.messages.length, 2);
});

test('malformed and unknown messages return explicit errors', () => {
  const state = createInitialState();
  assert.equal(processMessage('{', state).type, 'ERROR');
  assert.equal(processMessage(JSON.stringify({ type: 'UNKNOWN', payload: {} }), state).type, 'ERROR');
});

test('rollDice uses the supplied random source', () => {
  assert.deepEqual(rollDice('2d4-1', (min, max) => min), {
    rolls: [1, 1],
    result: 2,
    total: 1
  });
});

test('WebSocket validates actions and state survives a backend restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-ws-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let runtime;
  try {
    runtime = await startTestServer(databasePath);
    const cookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const joinResponse = await fetch(`${runtime.origin}/api/rooms/demo/join`, {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal(joinResponse.status, 200);
    runtime = { ...runtime, ...(await connectToRoom(runtime, cookie, 'demo')) };
    assert.equal(runtime.initialState.type, 'INIT_STATE');

    const invalidMessage = nextMessage(runtime.socket);
    runtime.socket.send(JSON.stringify({ type: 'MOVE_TOKEN', payload: { id: '1', x: -1, y: 0 } }));
    assert.equal((await invalidMessage).type, 'ERROR');

    const validMessage = nextMessage(runtime.socket);
    runtime.socket.send(JSON.stringify({ type: 'SEND_CHAT', payload: { text: 'Valid protocol action' } }));
    const update = await validMessage;
    assert.equal(update.type, 'STATE_UPDATE');
    assert.equal(update.payload.messages[0].text, 'Valid protocol action');
    const authCookie = cookie;
    await stopTestServer(runtime);
    runtime = null;
    runtime = await startTestServer(databasePath);
    const reconnected = await connectToRoom(runtime, authCookie, 'demo');
    runtime = { ...runtime, ...reconnected };
    assert.equal(runtime.initialState.payload.messages.some(message => message.text === 'Valid protocol action'), true);
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('demo room messages, tokens, and rolls survive closing and reopening SQLite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-sqlite-'));
  const databasePath = path.join(directory, 'test.sqlite');
  try {
    const firstDb = createStore(databasePath);
    const state = createInitialState();
    processMessage(JSON.stringify({ type: 'SEND_CHAT', payload: { text: 'Persisted message' } }), state);
    processMessage(JSON.stringify({ type: 'MOVE_TOKEN', payload: { id: '1', x: 8, y: 7 } }), state);
    processMessage(JSON.stringify({ type: 'ROLL_DICE', payload: { expression: '1d20' } }), state, new Date(), (min, max) => min);
    persistDemoState(firstDb, state);
    firstDb.close();

    const secondDb = createStore(databasePath);
    const restored = loadDemoState(secondDb);
    secondDb.close();

    assert.equal(restored.messages[0].text.includes('1d20'), true);
    assert.equal(restored.messages.some(message => message.text === 'Persisted message'), true);
    assert.deepEqual([restored.tokens[0].x, restored.tokens[0].y], [8, 7]);
    assert.equal(restored.diceRolls.length, 1);
    assert.equal(restored.diceRolls[0].total, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('accounts, room membership, and WebSocket broadcasts remain isolated by room', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-isolation-'));
  let runtime;
  try {
    runtime = await startTestServer(path.join(directory, 'test.sqlite'));
    const ownerCookie = await registerTestUser(runtime, `owner-${crypto.randomUUID().slice(0, 8)}`);
    const secondCookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const roomOne = await createTestRoom(runtime, ownerCookie, 'Sala Um');
    const roomTwo = await createTestRoom(runtime, secondCookie, 'Sala Dois');

    assert.equal((await fetch(`${runtime.origin}/api/rooms/${roomOne.id}`, { headers: { cookie: secondCookie } })).status, 404);
    assert.equal((await joinTestRoom(runtime, secondCookie, roomOne.id)).status, 200);
    assert.equal((await fetch(`${runtime.origin}/api/rooms/${roomOne.id}`, { headers: { cookie: secondCookie } })).status, 200);

    const firstClient = await connectToRoom(runtime, ownerCookie, roomOne.id);
    const secondRoomClient = await connectToRoom(runtime, secondCookie, roomTwo.id);
    assert.equal(firstClient.initialState.payload.messages.length, 0);
    assert.equal(secondRoomClient.initialState.payload.messages.length, 0);

    const isolatedRoomMessage = nextMessage(secondRoomClient.socket);
    const firstClientNoMessage = new Promise(resolve => {
      firstClient.socket.once('message', raw => resolve(JSON.parse(raw.toString())));
      setTimeout(() => resolve(null), 150);
    });
    secondRoomClient.socket.send(JSON.stringify({ type: 'SEND_CHAT', payload: { text: 'Somente na sala dois' } }));
    assert.equal((await isolatedRoomMessage).payload.messages[0].text, 'Somente na sala dois');
    assert.equal(await firstClientNoMessage, null);
    await stopTestServer({ ...runtime, sockets: [firstClient.socket, secondRoomClient.socket] });
    runtime = null;
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('moderation is enforced for chat and public room re-entry', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-moderation-'));
  let runtime;
  try {
    runtime = await startTestServer(path.join(directory, 'test.sqlite'));
    const ownerCookie = await registerTestUser(runtime, `gm-${crypto.randomUUID().slice(0, 8)}`);
    const playerCookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const room = await createTestRoom(runtime, ownerCookie, 'Sala Moderada');
    assert.equal((await joinTestRoom(runtime, playerCookie, room.id)).status, 200);

    const gm = await connectToRoom(runtime, ownerCookie, room.id);
    const player = await connectToRoom(runtime, playerCookie, room.id);
    const gmUser = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: ownerCookie } })).json()).user;
    const playerUser = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: playerCookie } })).json()).user;

    const deniedModeration = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${gmUser.id}/moderation`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mute', durationMinutes: 5 })
    });
    assert.equal(deniedModeration.status, 403);

    const muted = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${playerUser.id}/moderation`, {
      method: 'POST',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mute', durationMinutes: 5 })
    });
    assert.equal(muted.status, 200);
    const muteError = nextMessage(player.socket);
    player.socket.send(JSON.stringify({ type: 'SEND_CHAT', payload: { text: 'Não deve ser publicada' } }));
    assert.equal((await muteError).type, 'ERROR');
    const history = await (await fetch(`${runtime.origin}/api/rooms/${room.id}`, { headers: { cookie: ownerCookie } })).json();
    assert.equal(history.members.find(member => member.id === playerUser.id).mutedUntil !== null, true);

    const ban = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${playerUser.id}/moderation`, {
      method: 'POST',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ban', reason: 'Teste' })
    });
    assert.equal(ban.status, 200);
    assert.equal((await joinTestRoom(runtime, playerCookie, room.id)).status, 403);
    const unban = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${playerUser.id}/moderation`, {
      method: 'POST',
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unban' })
    });
    assert.equal(unban.status, 200);
    assert.equal((await joinTestRoom(runtime, playerCookie, room.id)).status, 200);

    await stopTestServer({ ...runtime, sockets: [gm.socket, player.socket] });
    runtime = null;
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('campaigns, private notes, and characters persist with room and owner authorization', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-campaigns-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let runtime;
  try {
    runtime = await startTestServer(databasePath);
    const gmCookie = await registerTestUser(runtime, `gm-${crypto.randomUUID().slice(0, 8)}`);
    const playerCookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const otherCookie = await registerTestUser(runtime, `other-${crypto.randomUUID().slice(0, 8)}`);
    const room = await createTestRoom(runtime, gmCookie, 'Campanha e fichas');
    await joinTestRoom(runtime, playerCookie, room.id);
    await joinTestRoom(runtime, otherCookie, room.id);

    const deniedCampaign = await fetch(`${runtime.origin}/api/rooms/${room.id}/campaigns`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Campanha indevida' })
    });
    assert.equal(deniedCampaign.status, 403);

    const campaignResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/campaigns`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A Crônica', description: 'Uma aventura persistente' })
    });
    assert.equal(campaignResponse.status, 201);
    const { campaign } = await campaignResponse.json();
    assert.equal((await (await fetch(`${runtime.origin}/api/rooms/${room.id}/campaigns`, { headers: { cookie: playerCookie } })).json()).campaigns.length, 1);

    const noteResponse = await fetch(`${runtime.origin}/api/campaigns/${campaign.id}/notes`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Segredo', content: 'Uma pista reservada ao mestre.' })
    });
    assert.equal(noteResponse.status, 201);
    const { note } = await noteResponse.json();
    assert.equal((await fetch(`${runtime.origin}/api/campaigns/${campaign.id}/notes`, { headers: { cookie: playerCookie } })).status, 403);

    const characterResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Aventureira', campaignId: campaign.id, data: { attributes: { vigor: 12 }, notes: 'Minha ficha' } })
    });
    assert.equal(characterResponse.status, 201);
    const { character } = await characterResponse.json();
    const otherCharacters = await (await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, { headers: { cookie: otherCookie } })).json();
    assert.equal(otherCharacters.characters.length, 0);
    const gmCharacters = await (await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, { headers: { cookie: gmCookie } })).json();
    assert.equal(gmCharacters.characters[0].name, 'Aventureira');

    const deniedEdit = await fetch(`${runtime.origin}/api/characters/${character.id}`, {
      method: 'PATCH',
      headers: { cookie: otherCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ficha tomada', data: {} })
    });
    assert.equal(deniedEdit.status, 403);

    const edited = await fetch(`${runtime.origin}/api/characters/${character.id}`, {
      method: 'PATCH',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Aventureira editada', campaignId: campaign.id, data: { attributes: { vigor: 15 } } })
    });
    assert.equal(edited.status, 200);
    await stopTestServer(runtime);
    runtime = null;
    runtime = await startTestServer(databasePath);
    const persistedCharacter = await (await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, { headers: { cookie: playerCookie } })).json();
    assert.equal(persistedCharacter.characters[0].name, 'Aventureira editada');
    const persistedNote = await (await fetch(`${runtime.origin}/api/campaigns/${campaign.id}/notes`, { headers: { cookie: gmCookie } })).json();
    assert.equal(persistedNote.notes[0].content, note.content);
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
