const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIRECTORY = path.join(__dirname, 'migrations');
const DEFAULT_DATABASE_PATH = path.join(__dirname, 'data', 'rrpg.sqlite');
const DEMO_ROOM_ID = 'demo';

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(row => row.name));
  const migrationFiles = fs.readdirSync(MIGRATIONS_DIRECTORY).filter(name => name.endsWith('.sql')).sort();

  for (const name of migrationFiles) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
    })();
  }
}

function createStore(databasePath = DEFAULT_DATABASE_PATH) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function timeLabel(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function loadDemoState(db) {
  return loadRoomState(db, DEMO_ROOM_ID);
}

function loadRoomState(db, roomId) {
  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) throw new Error('A sala não existe no banco local.');
  const tokens = db.prepare(`
    SELECT id, name, x, y, hp, max_hp AS maxHp, color
    FROM tokens WHERE room_id = ? ORDER BY rowid
  `).all(roomId);
  const messages = db.prepare(`
    SELECT id, user_name AS user, text, created_at
    FROM chat_messages WHERE room_id = ? ORDER BY created_at DESC, rowid DESC
  `).all(roomId).map(row => ({ id: row.id, user: row.user, text: row.text, time: timeLabel(row.created_at), createdAt: row.created_at }));
  const diceRolls = db.prepare(`
    SELECT id, user_name AS user, expression, result, total, created_at
    FROM dice_rolls WHERE room_id = ? ORDER BY created_at DESC, rowid DESC
  `).all(roomId).map(row => ({ id: row.id, user: row.user, expression: row.expression, result: row.result, total: row.total, time: timeLabel(row.created_at), createdAt: row.created_at }));

  if (tokens.length === 0 && messages.length === 0 && diceRolls.length === 0) return null;
  return { tokens, messages, diceRolls };
}

function persistDemoState(db, state) {
  persistRoomState(db, DEMO_ROOM_ID, state);
}

function persistRoomState(db, roomId, state) {
  const save = db.transaction(() => {
    db.prepare('DELETE FROM tokens WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM chat_messages WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM dice_rolls WHERE room_id = ?').run(roomId);

    const tokenInsert = db.prepare(`
      INSERT INTO tokens (id, room_id, name, x, y, hp, max_hp, color)
      VALUES (@id, @room_id, @name, @x, @y, @hp, @max_hp, @color)
    `);
    for (const token of state.tokens) {
      tokenInsert.run({ ...token, room_id: roomId, max_hp: token.maxHp });
    }

    const messageInsert = db.prepare(`
      INSERT INTO chat_messages (id, room_id, user_name, text, created_at)
      VALUES (@id, @room_id, @user_name, @text, @created_at)
    `);
    for (const message of [...state.messages].reverse()) {
      messageInsert.run({
        id: message.id,
        room_id: roomId,
        user_name: message.user,
        text: message.text,
        created_at: message.createdAt || new Date().toISOString()
      });
    }

    const rollInsert = db.prepare(`
      INSERT INTO dice_rolls (id, room_id, user_name, expression, result, total, created_at)
      VALUES (@id, @room_id, @user_name, @expression, @result, @total, @created_at)
    `);
    for (const roll of [...state.diceRolls].reverse()) {
      rollInsert.run({
        id: roll.id,
        room_id: roomId,
        user_name: roll.user,
        expression: roll.expression,
        result: roll.result,
        total: roll.total,
        created_at: roll.createdAt || new Date().toISOString()
      });
    }
  });
  save();
}

function findUserByUsername(db, username) {
  return db.prepare('SELECT id, username, email, password_hash AS passwordHash FROM users WHERE username = ? COLLATE NOCASE').get(username);
}

function findUserByEmail(db, email) {
  return db.prepare('SELECT id, username, email, password_hash AS passwordHash FROM users WHERE LOWER(email) = LOWER(?)').get(email);
}

function findUserById(db, userId) {
  return db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(userId);
}

function insertUser(db, user) {
  db.prepare('INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    user.username,
    user.email,
    user.passwordHash,
    user.createdAt
  );
}

function createSession(db, session) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(session.createdAt);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    session.tokenHash,
    session.userId,
    session.createdAt,
    session.expiresAt
  );
}

function getSessionUser(db, tokenHash, now = new Date().toISOString()) {
  return db.prepare(`
    SELECT users.id, users.username, users.email, sessions.expires_at AS expiresAt
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, now);
}

function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

function listRoomsForUser(db, userId) {
  return db.prepare(`
    SELECT rooms.id, rooms.name, rooms.description, rooms.game_system AS gameSystem,
      rooms.visibility, rooms.is_demo AS isDemo, rooms.created_by_user_id AS createdByUserId,
      rooms.created_at AS createdAt, rooms.access_type AS accessType,
      (rooms.access_type = 'password') AS requiresPassword, room_members.role,
      (SELECT COUNT(*) FROM room_members counts WHERE counts.room_id = rooms.id) AS memberCount
    FROM rooms
    LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
    WHERE rooms.is_demo = 0 AND (rooms.access_type != 'private' OR room_members.user_id IS NOT NULL)
    ORDER BY rooms.is_demo, rooms.created_at DESC, rooms.name COLLATE NOCASE
  `).all(userId).map(room => ({
    ...room,
    isDemo: Boolean(room.isDemo),
    requiresPassword: Boolean(room.requiresPassword)
  }));
}

function getRoom(db, roomId) {
  const room = db.prepare(`
    SELECT id, name, description, game_system AS gameSystem, visibility,
      is_demo AS isDemo, created_by_user_id AS createdByUserId, created_at AS createdAt,
      access_type AS accessType, room_password_hash AS passwordHash
    FROM rooms WHERE id = ?
  `).get(roomId);
  return room ? { ...room, isDemo: Boolean(room.isDemo) } : null;
}

function createRoom(db, room) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO rooms (id, name, is_demo, created_by_user_id, visibility, game_system, description, created_at, access_type, room_password_hash)
      VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(room.id, room.name, room.ownerId, room.visibility, room.gameSystem, room.description, room.createdAt, room.accessType || 'public', room.passwordHash || null);
    db.prepare(`
      INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'gm', ?)
    `).run(room.id, room.ownerId, room.createdAt);
  })();
  return getRoom(db, room.id);
}

function getRoomMembership(db, roomId, userId) {
  return db.prepare(`
    SELECT room_id AS roomId, user_id AS userId, role, muted_until AS mutedUntil, joined_at AS joinedAt
    FROM room_members WHERE room_id = ? AND user_id = ?
  `).get(roomId, userId);
}

function joinRoom(db, roomId, userId, joinedAt) {
  const room = getRoom(db, roomId);
  if (!room) return { error: 'Sala não encontrada.' };
  if (db.prepare('SELECT 1 FROM room_bans WHERE room_id = ? AND user_id = ?').get(roomId, userId)) {
    return { error: 'Você não tem permissão para entrar nesta sala.' };
  }
  if (room.accessType === 'private' && !getRoomMembership(db, roomId, userId)) {
    return { error: 'Você não tem permissão para entrar nesta sala.' };
  }
  db.prepare(`
    INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'spectator', ?)
  `).run(roomId, userId, joinedAt);
  return { room: getRoom(db, roomId), membership: getRoomMembership(db, roomId, userId) };
}

function listRoomMembers(db, roomId) {
  return db.prepare(`
    SELECT users.id, users.username, room_members.role, room_members.muted_until AS mutedUntil,
      room_members.joined_at AS joinedAt
    FROM room_members JOIN users ON users.id = room_members.user_id
    WHERE room_members.room_id = ? ORDER BY CASE room_members.role WHEN 'gm' THEN 0 WHEN 'player' THEN 1 ELSE 2 END, users.username COLLATE NOCASE
  `).all(roomId);
}

function setRoomMemberRole(db, roomId, targetUserId, role) {
  return db.prepare('UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?').run(role, roomId, targetUserId).changes > 0;
}

function mapLibraryItem(item) {
  if (!item) return null;
  const { dataJson, ...fields } = item;
  return { ...fields, data: JSON.parse(dataJson) };
}

function listLibraryItems(db, roomId) {
  return db.prepare(`
    SELECT id, room_id AS roomId, parent_id AS parentId, owner_user_id AS ownerUserId,
      item_type AS itemType, name, visibility, data_json AS dataJson,
      created_at AS createdAt, updated_at AS updatedAt
    FROM library_items WHERE room_id = ? ORDER BY item_type, name COLLATE NOCASE
  `).all(roomId).map(mapLibraryItem);
}

function getLibraryItem(db, itemId) {
  const item = db.prepare(`
    SELECT id, room_id AS roomId, parent_id AS parentId, owner_user_id AS ownerUserId,
      item_type AS itemType, name, visibility, data_json AS dataJson,
      created_at AS createdAt, updated_at AS updatedAt
    FROM library_items WHERE id = ?
  `).get(itemId);
  return mapLibraryItem(item);
}

function createLibraryItem(db, item) {
  db.prepare(`
    INSERT INTO library_items (id, room_id, parent_id, owner_user_id, item_type, name, visibility, data_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item.id, item.roomId, item.parentId, item.ownerUserId, item.itemType, item.name, item.visibility, JSON.stringify(item.data), item.createdAt, item.updatedAt);
  return getLibraryItem(db, item.id);
}

function updateLibraryItem(db, itemId, fields, updatedAt) {
  const result = db.prepare(`
    UPDATE library_items SET parent_id = ?, name = ?, visibility = ?, data_json = ?, updated_at = ?
    WHERE id = ?
  `).run(fields.parentId, fields.name, fields.visibility, JSON.stringify(fields.data), updatedAt, itemId);
  return result.changes > 0;
}

function deleteLibraryItem(db, itemId) {
  return db.prepare('DELETE FROM library_items WHERE id = ?').run(itemId).changes > 0;
}

function listRoomBans(db, roomId) {
  return db.prepare(`
    SELECT users.id, users.username, room_bans.reason, room_bans.created_at AS createdAt
    FROM room_bans JOIN users ON users.id = room_bans.user_id
    WHERE room_bans.room_id = ? ORDER BY room_bans.created_at DESC
  `).all(roomId);
}

function getRoomBannedUser(db, roomId, userId) {
  return db.prepare('SELECT user_id FROM room_bans WHERE room_id = ? AND user_id = ?').get(roomId, userId);
}

function setRoomMute(db, roomId, targetUserId, mutedUntil) {
  return db.prepare('UPDATE room_members SET muted_until = ? WHERE room_id = ? AND user_id = ?').run(mutedUntil, roomId, targetUserId).changes > 0;
}

function removeRoomMember(db, roomId, targetUserId) {
  return db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, targetUserId).changes > 0;
}

function addRoomBan(db, roomId, targetUserId, actorUserId, reason, createdAt) {
  db.transaction(() => {
    db.prepare(`
      INSERT INTO room_bans (room_id, user_id, reason, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(room_id, user_id) DO UPDATE SET reason = excluded.reason, created_by_user_id = excluded.created_by_user_id, created_at = excluded.created_at
    `).run(roomId, targetUserId, reason, actorUserId, createdAt);
    removeRoomMember(db, roomId, targetUserId);
  })();
}

function removeRoomBan(db, roomId, targetUserId) {
  return db.prepare('DELETE FROM room_bans WHERE room_id = ? AND user_id = ?').run(roomId, targetUserId).changes > 0;
}

function insertModerationEvent(db, event) {
  db.prepare(`
    INSERT INTO moderation_events (id, room_id, actor_user_id, target_user_id, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(event.id, event.roomId, event.actorUserId, event.targetUserId, event.action, event.createdAt);
}

function listCampaigns(db, roomId) {
  return db.prepare(`
    SELECT id, room_id AS roomId, name, description, created_by_user_id AS createdByUserId,
      created_at AS createdAt, updated_at AS updatedAt
    FROM campaigns WHERE room_id = ? ORDER BY updated_at DESC
  `).all(roomId);
}

function getCampaign(db, campaignId) {
  return db.prepare(`
    SELECT id, room_id AS roomId, name, description, created_by_user_id AS createdByUserId,
      created_at AS createdAt, updated_at AS updatedAt
    FROM campaigns WHERE id = ?
  `).get(campaignId);
}

function createCampaign(db, campaign) {
  db.prepare(`
    INSERT INTO campaigns (id, room_id, name, description, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(campaign.id, campaign.roomId, campaign.name, campaign.description, campaign.createdByUserId, campaign.createdAt, campaign.updatedAt);
  return getCampaign(db, campaign.id);
}

function updateCampaign(db, campaignId, name, description, updatedAt) {
  return db.prepare('UPDATE campaigns SET name = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(name, description, updatedAt, campaignId).changes > 0;
}

function deleteCampaign(db, campaignId) {
  return db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId).changes > 0;
}

function listCampaignNotes(db, campaignId) {
  return db.prepare(`
    SELECT id, campaign_id AS campaignId, title, content,
      created_by_user_id AS createdByUserId, created_at AS createdAt, updated_at AS updatedAt
    FROM campaign_notes WHERE campaign_id = ? ORDER BY updated_at DESC
  `).all(campaignId);
}

function getCampaignNote(db, noteId) {
  return db.prepare(`
    SELECT id, campaign_id AS campaignId, title, content,
      created_by_user_id AS createdByUserId, created_at AS createdAt, updated_at AS updatedAt
    FROM campaign_notes WHERE id = ?
  `).get(noteId);
}

function createCampaignNote(db, note) {
  db.prepare(`
    INSERT INTO campaign_notes (id, campaign_id, title, content, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(note.id, note.campaignId, note.title, note.content, note.createdByUserId, note.createdAt, note.updatedAt);
  return getCampaignNote(db, note.id);
}

function updateCampaignNote(db, noteId, title, content, updatedAt) {
  return db.prepare('UPDATE campaign_notes SET title = ?, content = ?, updated_at = ? WHERE id = ?')
    .run(title, content, updatedAt, noteId).changes > 0;
}

function deleteCampaignNote(db, noteId) {
  return db.prepare('DELETE FROM campaign_notes WHERE id = ?').run(noteId).changes > 0;
}

function listCharacters(db, roomId, userId, canViewAll) {
  return db.prepare(`
    SELECT id, room_id AS roomId, campaign_id AS campaignId, owner_user_id AS ownerUserId,
      name, visibility, data_json AS dataJson, created_at AS createdAt, updated_at AS updatedAt
    FROM characters WHERE room_id = ? AND (? = 1 OR owner_user_id = ? OR visibility = 'room')
    ORDER BY updated_at DESC
  `).all(roomId, canViewAll ? 1 : 0, userId).map(({ dataJson, ...character }) => ({
    ...character,
    data: JSON.parse(dataJson)
  }));
}

function getCharacter(db, characterId) {
  const character = db.prepare(`
    SELECT id, room_id AS roomId, campaign_id AS campaignId, owner_user_id AS ownerUserId,
      name, visibility, data_json AS dataJson, created_at AS createdAt, updated_at AS updatedAt
    FROM characters WHERE id = ?
  `).get(characterId);
  return character ? { ...character, data: JSON.parse(character.dataJson) } : null;
}

function createCharacter(db, character) {
  db.prepare(`
    INSERT INTO characters (id, room_id, campaign_id, owner_user_id, name, visibility, data_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(character.id, character.roomId, character.campaignId, character.ownerUserId, character.name, character.visibility || 'private', JSON.stringify(character.data), character.createdAt, character.updatedAt);
  return getCharacter(db, character.id);
}

function updateCharacter(db, characterId, name, data, campaignId, visibility, ownerUserId, updatedAt) {
  return db.prepare(`
    UPDATE characters SET name = ?, data_json = ?, campaign_id = ?, visibility = ?, owner_user_id = ?, updated_at = ? WHERE id = ?
  `).run(name, JSON.stringify(data), campaignId, visibility, ownerUserId, updatedAt, characterId).changes > 0;
}

function deleteCharacter(db, characterId) {
  return db.prepare('DELETE FROM characters WHERE id = ?').run(characterId).changes > 0;
}

function createSqliteStore(databasePath = DEFAULT_DATABASE_PATH) {
  const database = createStore(databasePath);
  const store = {
    kind: 'sqlite',
    close: () => database.close(),
    health: () => {
      database.prepare('SELECT 1').get();
      return true;
    }
  };
  const methods = [
    'addRoomBan',
    'createCampaign',
    'createCampaignNote',
    'createCharacter',
    'createLibraryItem',
    'createRoom',
    'createSession',
    'deleteSession',
    'deleteCampaign',
    'deleteCampaignNote',
    'deleteCharacter',
    'deleteLibraryItem',
    'getCampaign',
    'getCampaignNote',
    'getCharacter',
    'findUserById',
    'findUserByEmail',
    'findUserByUsername',
    'getLibraryItem',
    'getRoom',
    'getRoomBannedUser',
    'getRoomMembership',
    'getSessionUser',
    'insertModerationEvent',
    'insertUser',
    'joinRoom',
    'listRoomMembers',
    'listRoomBans',
    'listCampaignNotes',
    'listCampaigns',
    'listCharacters',
    'listLibraryItems',
    'listRoomsForUser',
    'loadRoomState',
    'persistRoomState',
    'removeRoomBan',
    'removeRoomMember',
    'setRoomMute',
    'setRoomMemberRole',
    'updateCampaign',
    'updateCampaignNote',
    'updateCharacter',
    'updateLibraryItem'
  ];
  for (const method of methods) {
    store[method] = (...args) => module.exports[method](database, ...args);
  }
  return store;
}

module.exports = {
  addRoomBan,
  createCampaign,
  createCampaignNote,
  createCharacter,
  createLibraryItem,
  createRoom,
  createSession,
  createStore,
  deleteSession,
  deleteCampaign,
  deleteCampaignNote,
  deleteCharacter,
  deleteLibraryItem,
  getCampaign,
  getCampaignNote,
  getCharacter,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  getLibraryItem,
  getRoom,
  getRoomBannedUser,
  getRoomMembership,
  getSessionUser,
  insertModerationEvent,
  insertUser,
  joinRoom,
  listRoomMembers,
  listRoomBans,
  listCampaignNotes,
  listCampaigns,
  listCharacters,
  listLibraryItems,
  listRoomsForUser,
  loadDemoState,
  loadRoomState,
  persistDemoState,
  persistRoomState,
  removeRoomBan,
  removeRoomMember,
  setRoomMute,
  setRoomMemberRole,
  updateCampaign,
  updateCampaignNote,
  updateCharacter,
  updateLibraryItem,
  createSqliteStore
};
