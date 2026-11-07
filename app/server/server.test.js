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
  const instance = await createAppServer({ dbPath: databasePath, ...options });
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
    body: JSON.stringify({
      username,
      email: `${username.replace(/[^A-Za-z0-9]/g, '')}@example.test`,
      password: 'a-test-password-long-enough'
    })
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function createTestRoom(runtime, cookie, name, options = {}) {
  const response = await fetch(`${runtime.origin}/api/rooms`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name, gameSystem: 'Sistema de teste', description: 'Sala de teste automatizado', ...options })
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
      body: JSON.stringify({ username: 'bad!', email: 'bad@example.test', password: 'a-test-password-long-enough' })
    });
    assert.equal(invalidUsername.status, 400);
    const invalidPassword = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@example.test`, password: 'short' })
    });
    assert.equal(invalidPassword.status, 400);

    const originRejected = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@example.test`, password: 'a-test-password-long-enough' })
    });
    assert.equal(originRejected.status, 403);

    const registration = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@example.test`, password: 'a-test-password-long-enough' })
    });
    assert.equal(registration.status, 200);
    const registrationCookie = registration.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: registrationCookie } })).json()).user.username, username);

    const duplicate = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: username.toUpperCase(), email: `${username}@example.test`, password: 'a-test-password-long-enough' })
    });
    assert.equal(duplicate.status, 409);
    const fifthRegistrationAttempt = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'also-bad!', email: 'also@example.test', password: 'a-test-password-long-enough' })
    });
    assert.equal(fifthRegistrationAttempt.status, 400);
    const rateLimited = await fetch(`${runtime.origin}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'one-more-bad!', email: 'one-more@example.test', password: 'a-test-password-long-enough' })
    });
    assert.equal(rateLimited.status, 429);
    assert.ok(Number(rateLimited.headers.get('retry-after')) > 0);

    const invalidLogin = await fetch(`${runtime.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: `${username}@example.test`, password: 'wrong-password' })
    });
    assert.equal(invalidLogin.status, 401);
    const login = await fetch(`${runtime.origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: `${username}@example.test`, password: 'a-test-password-long-enough' })
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
    const room = await createTestRoom(runtime, cookie, 'Persistência WebSocket');
    const joinResponse = await joinTestRoom(runtime, cookie, room.id);
    assert.equal(joinResponse.status, 200);
    runtime = { ...runtime, ...(await connectToRoom(runtime, cookie, room.id)) };
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
    const reconnected = await connectToRoom(runtime, authCookie, room.id);
    runtime = { ...runtime, ...reconnected };
    assert.equal(runtime.initialState.payload.messages.some(message => message.text === 'Valid protocol action'), true);
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('demo room messages, tokens, and rolls survive closing and reopening SQLite', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-sqlite-'));
  const databasePath = path.join(directory, 'test.sqlite');
  try {
    const firstDb = await createStore(databasePath);
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

test('map tokens move by authorized room members and persist with drawings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-map-vtt-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let runtime;
  try {
    runtime = await startTestServer(databasePath);
    const gmCookie = await registerTestUser(runtime, `gm-${crypto.randomUUID().slice(0, 8)}`);
    const playerCookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const spectatorCookie = await registerTestUser(runtime, `spectator-${crypto.randomUUID().slice(0, 8)}`);
    const room = await createTestRoom(runtime, gmCookie, 'Mapa sincronizado');
    assert.equal((await joinTestRoom(runtime, playerCookie, room.id)).status, 200);
    assert.equal((await joinTestRoom(runtime, spectatorCookie, room.id)).status, 200);

    const player = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: playerCookie } })).json()).user;
    const spectator = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: spectatorCookie } })).json()).user;
    const promote = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${player.id}/role`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' })
    });
    assert.equal(promote.status, 200);

    const mapResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        itemType: 'map',
        name: 'Grade 15x27',
        visibility: 'room',
        data: { width: 15, height: 27, backgroundUrl: null, tokens: [] }
      })
    });
    assert.equal(mapResponse.status, 201);
    const map = (await mapResponse.json()).item;

    const tokenResponse = await fetch(`${runtime.origin}/api/library/${map.id}/tokens`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Herói', imageUrl: null, x: 2, y: 3, assignedUserId: player.id })
    });
    assert.equal(tokenResponse.status, 201);
    const token = (await tokenResponse.json()).token;
    const otherTokenResponse = await fetch(`${runtime.origin}/api/library/${map.id}/tokens`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'NPC', x: 5, y: 5 })
    });
    assert.equal(otherTokenResponse.status, 201);
    const otherToken = (await otherTokenResponse.json()).token;

    const drawingResponse = await fetch(`${runtime.origin}/api/library/${map.id}/drawings`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ color: '#ff0000', width: 3, points: [{ x: 10, y: 10 }, { x: 80, y: 96 }] })
    });
    assert.equal(drawingResponse.status, 201);
    const drawing = (await drawingResponse.json()).drawing;
    assert.equal((await fetch(`${runtime.origin}/api/library/${map.id}/drawings`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ color: '#00ff00', width: 3, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] })
    })).status, 403);
    assert.equal((await fetch(`${runtime.origin}/api/library/${map.id}/tokens`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized', x: 0, y: 0 })
    })).status, 403);
    assert.equal((await fetch(`${runtime.origin}/api/library/${map.id}/drawings`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ color: '#ff0000', width: 3, points: [{ x: -1, y: 10 }, { x: 20, y: 20 }] })
    })).status, 400);

    const gmSocket = await connectToRoom(runtime, gmCookie, room.id);
    const playerSocket = await connectToRoom(runtime, playerCookie, room.id);
    const spectatorSocket = await connectToRoom(runtime, spectatorCookie, room.id);
    runtime = { ...runtime, sockets: [gmSocket.socket, playerSocket.socket, spectatorSocket.socket] };

    const gmUpdate = nextMessage(gmSocket.socket);
    const playerUpdate = nextMessage(playerSocket.socket);
    playerSocket.socket.send(JSON.stringify({
      type: 'MOVE_MAP_TOKEN',
      payload: { mapId: map.id, tokenId: token.id, x: 14, y: 26 }
    }));
    assert.equal((await playerUpdate).type, 'MAP_TOKEN_MOVED');
    const broadcast = await gmUpdate;
    assert.deepEqual([broadcast.payload.token.x, broadcast.payload.token.y], [14, 26]);

    const unauthorizedMove = nextMessage(playerSocket.socket);
    playerSocket.socket.send(JSON.stringify({
      type: 'MOVE_MAP_TOKEN',
      payload: { mapId: map.id, tokenId: otherToken.id, x: 6, y: 6 }
    }));
    assert.equal((await unauthorizedMove).type, 'ERROR');

    const outOfBoundsMove = nextMessage(playerSocket.socket);
    playerSocket.socket.send(JSON.stringify({
      type: 'MOVE_MAP_TOKEN',
      payload: { mapId: map.id, tokenId: token.id, x: 15, y: 0 }
    }));
    assert.equal((await outOfBoundsMove).type, 'ERROR');

    const spectatorMove = nextMessage(spectatorSocket.socket);
    spectatorSocket.socket.send(JSON.stringify({
      type: 'MOVE_MAP_TOKEN',
      payload: { mapId: map.id, tokenId: token.id, x: 1, y: 1 }
    }));
    assert.equal((await spectatorMove).type, 'ERROR');

    const privateMapResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        itemType: 'map',
        name: 'Mapa privado',
        visibility: 'private',
        data: { width: 4, height: 4, tokens: [{ name: 'Privado', x: 1, y: 1 }] }
      })
    });
    assert.equal(privateMapResponse.status, 201);
    const privateMap = (await privateMapResponse.json()).item;
    const hiddenMapMove = nextMessage(playerSocket.socket);
    playerSocket.socket.send(JSON.stringify({
      type: 'MOVE_MAP_TOKEN',
      payload: { mapId: privateMap.id, tokenId: privateMap.data.tokens[0].id, x: 2, y: 2 }
    }));
    assert.equal((await hiddenMapMove).type, 'ERROR');

    await stopTestServer(runtime);
    runtime = null;
    runtime = await startTestServer(databasePath);
    const restoredResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, { headers: { cookie: gmCookie } });
    assert.equal(restoredResponse.status, 200);
    const restoredMap = (await restoredResponse.json()).items.find(item => item.id === map.id);
    assert.deepEqual([restoredMap.data.tokens.find(item => item.id === token.id).x, restoredMap.data.tokens.find(item => item.id === token.id).y], [14, 26]);
    assert.equal(restoredMap.data.drawings.some(item => item.id === drawing.id), true);

    const deleteDrawing = await fetch(`${runtime.origin}/api/library/${map.id}/drawings/${drawing.id}`, {
      method: 'DELETE',
      headers: { cookie: gmCookie }
    });
    assert.equal(deleteDrawing.status, 200);
    const deleteToken = await fetch(`${runtime.origin}/api/library/${map.id}/tokens/${token.id}`, {
      method: 'DELETE',
      headers: { cookie: gmCookie }
    });
    assert.equal(deleteToken.status, 200);
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
    const playerUser = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: playerCookie } })).json()).user;
    const roleUpdate = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${playerUser.id}/role`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' })
    });

    assert.equal(roleUpdate.status, 200);

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

    const deniedCharacterResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Aventureira', campaignId: campaign.id, data: { attributes: { vigor: 12 }, notes: 'Minha ficha' } })
    });
    assert.equal(deniedCharacterResponse.status, 403);
    const characterResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Aventureira',
        campaignId: campaign.id,
        ownerUserId: playerUser.id,
        visibility: 'room',
        data: { attributes: { vigor: 12 }, notes: 'Minha ficha' }
      })
    });
    assert.equal(characterResponse.status, 201);
    const { character } = await characterResponse.json();
    assert.equal((await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, { headers: { cookie: otherCookie } })).status, 403);
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

test('password rooms, library visibility, and library persistence are enforced', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-library-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let runtime;
  try {
    runtime = await startTestServer(databasePath);
    const gmCookie = await registerTestUser(runtime, `gm-${crypto.randomUUID().slice(0, 8)}`);
    const playerCookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const room = await createTestRoom(runtime, gmCookie, 'Mesa com senha', { accessType: 'password', password: 'senha-segura-123' });

    const roomList = await (await fetch(`${runtime.origin}/api/rooms`, { headers: { cookie: playerCookie } })).json();
    assert.equal(roomList.rooms.find(item => item.id === room.id).requiresPassword, true);
    assert.equal(Object.hasOwn(roomList.rooms.find(item => item.id === room.id), 'passwordHash'), false);
    assert.equal((await joinTestRoom(runtime, playerCookie, room.id)).status, 401);
    const wrongPassword = await fetch(`${runtime.origin}/api/rooms/${room.id}/join`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'senha-errada' })
    });
    assert.equal(wrongPassword.status, 401);
    const joined = await fetch(`${runtime.origin}/api/rooms/${room.id}/join`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'senha-segura-123' })
    });
    assert.equal(joined.status, 200);
    assert.equal((await joined.json()).membership.role, 'spectator');
    const playerUser = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: playerCookie } })).json()).user;
    const playerRole = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${playerUser.id}/role`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' })
    });
    assert.equal(playerRole.status, 200);

    const deniedCreate = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, {
      method: 'POST',
      headers: { cookie: playerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemType: 'folder', name: 'Não autorizado' })
    });
    assert.equal(deniedCreate.status, 403);

    const folderResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemType: 'folder', name: 'Mapas', visibility: 'room' })
    });
    assert.equal(folderResponse.status, 201);
    const folder = (await folderResponse.json()).item;
    const mapResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        itemType: 'map',
        parentId: folder.id,
        name: 'Ruínas',
        visibility: 'room',
        data: { width: 15, height: 27, backgroundUrl: 'https://example.test/ruins.png', tokens: [] }
      })
    });
    assert.equal(mapResponse.status, 201);
    const map = (await mapResponse.json()).item;
    assert.deepEqual([map.data.width, map.data.height], [15, 27]);

    const visibleItems = await (await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, { headers: { cookie: playerCookie } })).json();
    assert.deepEqual(visibleItems.items.map(item => item.name).sort(), ['Mapas', 'Ruínas']);
    const invalidUrl = await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ itemType: 'map', name: 'URL inválida', data: { width: 12, height: 12, backgroundUrl: 'javascript:alert(1)' } })
    });
    assert.equal(invalidUrl.status, 400);

    await stopTestServer(runtime);
    runtime = null;
    runtime = await startTestServer(databasePath);
    const persisted = await (await fetch(`${runtime.origin}/api/rooms/${room.id}/library`, { headers: { cookie: gmCookie } })).json();
    assert.equal(persisted.items.find(item => item.id === map.id).data.height, 27);
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('D&D 5E checks are rolled by the server for assigned characters only', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rrpg-dnd-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let runtime;
  try {
    runtime = await startTestServer(databasePath);
    const gmCookie = await registerTestUser(runtime, `gm-${crypto.randomUUID().slice(0, 8)}`);
    const playerCookie = await registerTestUser(runtime, `player-${crypto.randomUUID().slice(0, 8)}`);
    const spectatorCookie = await registerTestUser(runtime, `spectator-${crypto.randomUUID().slice(0, 8)}`);
    const room = await createTestRoom(runtime, gmCookie, 'D&D 5E');
    await joinTestRoom(runtime, playerCookie, room.id);
    await joinTestRoom(runtime, spectatorCookie, room.id);
    const player = (await (await fetch(`${runtime.origin}/api/me`, { headers: { cookie: playerCookie } })).json()).user;
    const roleResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/members/${player.id}/role`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' })
    });
    assert.equal(roleResponse.status, 200);
    const characterResponse = await fetch(`${runtime.origin}/api/rooms/${room.id}/characters`, {
      method: 'POST',
      headers: { cookie: gmCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Aventureira',
        ownerUserId: player.id,
        data: {
          system: 'dnd5e',
          abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          proficiencyBonus: 2,
          proficientSaves: ['str'],
          proficientSkills: []
        }
      })
    });
    assert.equal(characterResponse.status, 201);
    const { character } = await characterResponse.json();
    const playerClient = await connectToRoom(runtime, playerCookie, room.id);
    const spectatorClient = await connectToRoom(runtime, spectatorCookie, room.id);
    runtime = { ...runtime, sockets: [playerClient.socket, spectatorClient.socket] };

    const playerUpdate = nextMessage(playerClient.socket);
    const spectatorUpdate = nextMessage(spectatorClient.socket);
    playerClient.socket.send(JSON.stringify({
      type: 'ROLL_CHARACTER_CHECK',
      payload: { characterId: character.id, kind: 'savingThrow', key: 'str', result: 999, total: 999 }
    }));
    const update = await playerUpdate;
    await spectatorUpdate;
    assert.equal(update.type, 'STATE_UPDATE');
    assert.equal(update.payload.diceRolls[0].expression, '1d20+5');
    assert.ok(update.payload.diceRolls[0].total >= 6 && update.payload.diceRolls[0].total <= 25);

    const deniedRoll = nextMessage(spectatorClient.socket);
    spectatorClient.socket.send(JSON.stringify({
      type: 'ROLL_CHARACTER_CHECK',
      payload: { characterId: character.id, kind: 'ability', key: 'str' }
    }));
    assert.equal((await deniedRoll).type, 'ERROR');
    await stopTestServer(runtime);
    runtime = null;
    runtime = await startTestServer(databasePath);
    const restored = await connectToRoom(runtime, playerCookie, room.id);
    runtime = { ...runtime, socket: restored.socket };
    assert.equal(restored.initialState.payload.diceRolls[0].expression, '1d20+5');
  } finally {
    if (runtime) await stopTestServer(runtime);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
