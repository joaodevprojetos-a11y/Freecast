const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const MIGRATIONS_DIRECTORY = path.join(__dirname, 'postgres-migrations');

function getPostgresSslConfig(connectionString, caCertificate) {
  const hostname = new URL(connectionString).hostname;
  const isSupabase = hostname.endsWith('.supabase.co') || hostname.endsWith('.pooler.supabase.com');
  if (!isSupabase) return undefined;
  if (!caCertificate?.includes('-----BEGIN CERTIFICATE-----')) {
    const error = new Error('Configure DATABASE_SSL_CA_CERT com o certificado raiz baixado nas configurações SSL do Supabase.');
    error.code = 'SUPABASE_CA_CERT_REQUIRED';
    throw error;
  }
  return { rejectUnauthorized: true, ca: caCertificate };
}

function timeLabel(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function mapCharacter(character) {
  if (!character) return null;
  const { dataJson, ...fields } = character;
  return { ...fields, data: typeof dataJson === 'string' ? JSON.parse(dataJson) : dataJson };
}

function mapLibraryItem(item) {
  if (!item) return null;
  const { dataJson, ...fields } = item;
  return { ...fields, data: typeof dataJson === 'string' ? JSON.parse(dataJson) : dataJson };
}

async function getRoomFrom(queryable, roomId) {
  const result = await queryable.query(`
    SELECT id, name, description, game_system AS "gameSystem", visibility,
      is_demo AS "isDemo", created_by_user_id AS "createdByUserId", created_at AS "createdAt",
      access_type AS "accessType", room_password_hash AS "passwordHash"
    FROM rooms WHERE id = $1
  `, [roomId]);
  return result.rows[0] || null;
}

async function getRoomMembershipFrom(queryable, roomId, userId) {
  const result = await queryable.query(`
    SELECT room_id AS "roomId", user_id AS "userId", role,
      muted_until AS "mutedUntil", joined_at AS "joinedAt"
    FROM room_members WHERE room_id = $1 AND user_id = $2
  `, [roomId, userId]);
  return result.rows[0] || null;
}

async function getRoomBannedUserFrom(queryable, roomId, userId) {
  const result = await queryable.query(
    'SELECT user_id AS "userId" FROM room_bans WHERE room_id = $1 AND user_id = $2',
    [roomId, userId]
  );
  return result.rows[0] || null;
}

async function createPostgresStore(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL não foi configurada.');
  const ssl = getPostgresSslConfig(connectionString, process.env.DATABASE_SSL_CA_CERT);
  const pool = new Pool({
    connectionString,
    options: '-c search_path=freecast,public',
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ...(ssl ? { ssl } : {})
  });
  pool.on('error', error => {
    console.error('PostgreSQL pool error:', error.code || 'unknown error');
  });

  const store = {
    kind: 'postgres',
    close: () => pool.end(),
    health: async () => {
      await pool.query('SELECT 1');
      return true;
    },
    async loadRoomState(roomId) {
      const room = await getRoomFrom(pool, roomId);
      if (!room) throw new Error('A sala não existe no banco PostgreSQL.');
      const [tokens, messages, diceRolls] = await Promise.all([
        pool.query(`
          SELECT id, name, x, y, hp, max_hp AS "maxHp", color
          FROM tokens WHERE room_id = $1 ORDER BY id
        `, [roomId]),
        pool.query(`
          SELECT id, user_name AS "user", text, created_at AS "createdAt"
          FROM chat_messages WHERE room_id = $1 ORDER BY created_at DESC, id DESC
        `, [roomId]),
        pool.query(`
          SELECT id, user_name AS "user", expression, result, total, created_at AS "createdAt"
          FROM dice_rolls WHERE room_id = $1 ORDER BY created_at DESC, id DESC
        `, [roomId])
      ]);
      if (tokens.rows.length === 0 && messages.rows.length === 0 && diceRolls.rows.length === 0) return null;
      return {
        tokens: tokens.rows,
        messages: messages.rows.map(row => ({ ...row, time: timeLabel(row.createdAt) })),
        diceRolls: diceRolls.rows.map(row => ({ ...row, time: timeLabel(row.createdAt) }))
      };
    },
    async persistRoomState(roomId, state) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM tokens WHERE room_id = $1', [roomId]);
        await client.query('DELETE FROM chat_messages WHERE room_id = $1', [roomId]);
        await client.query('DELETE FROM dice_rolls WHERE room_id = $1', [roomId]);
        for (const token of state.tokens) {
          await client.query(`
            INSERT INTO tokens (id, room_id, name, x, y, hp, max_hp, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [token.id, roomId, token.name, token.x, token.y, token.hp, token.maxHp, token.color]);
        }
        for (const message of [...state.messages].reverse()) {
          await client.query(`
            INSERT INTO chat_messages (id, room_id, user_name, text, created_at)
            VALUES ($1, $2, $3, $4, $5)
          `, [message.id, roomId, message.user, message.text, message.createdAt || new Date().toISOString()]);
        }
        for (const roll of [...state.diceRolls].reverse()) {
          await client.query(`
            INSERT INTO dice_rolls (id, room_id, user_name, expression, result, total, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [roll.id, roomId, roll.user, roll.expression, roll.result, roll.total, roll.createdAt || new Date().toISOString()]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async findUserByUsername(username) {
      const result = await pool.query(`
        SELECT id, username, email, password_hash AS "passwordHash"
        FROM users WHERE LOWER(username) = LOWER($1)
      `, [username]);
      return result.rows[0] || null;
    },
    async findUserByEmail(email) {
      const result = await pool.query(`
        SELECT id, username, email, password_hash AS "passwordHash"
        FROM users WHERE LOWER(email) = LOWER($1)
      `, [email]);
      return result.rows[0] || null;
    },
    async findUserById(userId) {
      const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [userId]);
      return result.rows[0] || null;
    },
    async insertUser(user) {
      await pool.query(`
        INSERT INTO users (id, username, email, password_hash, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [user.id, user.username, user.email, user.passwordHash, user.createdAt]);
    },
    async createSession(session) {
      await pool.query('DELETE FROM sessions WHERE expires_at <= $1', [session.createdAt]);
      await pool.query(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4)
      `, [session.tokenHash, session.userId, session.createdAt, session.expiresAt]);
    },
    async getSessionUser(tokenHash, now = new Date().toISOString()) {
      const result = await pool.query(`
        SELECT users.id, users.username, users.email, sessions.expires_at AS "expiresAt"
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = $1 AND sessions.expires_at > $2
      `, [tokenHash, now]);
      return result.rows[0] || null;
    },
    async deleteSession(tokenHash) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    },
    async listRoomsForUser(userId) {
      const result = await pool.query(`
        SELECT rooms.id, rooms.name, rooms.description, rooms.game_system AS "gameSystem",
          rooms.visibility, rooms.is_demo AS "isDemo", rooms.created_by_user_id AS "createdByUserId",
          rooms.created_at AS "createdAt", rooms.access_type AS "accessType",
          (rooms.access_type = 'password') AS "requiresPassword", room_members.role,
          (SELECT COUNT(*)::INTEGER FROM room_members counts WHERE counts.room_id = rooms.id) AS "memberCount"
        FROM rooms
        LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = $1
        WHERE rooms.is_demo = FALSE AND (rooms.access_type != 'private' OR room_members.user_id IS NOT NULL)
        ORDER BY rooms.is_demo, rooms.created_at DESC, LOWER(rooms.name)
      `, [userId]);
      return result.rows;
    },
    getRoom: roomId => getRoomFrom(pool, roomId),
    async createRoom(room) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          INSERT INTO rooms (id, name, is_demo, created_by_user_id, visibility, game_system, description, created_at, access_type, room_password_hash)
          VALUES ($1, $2, FALSE, $3, $4, $5, $6, $7, $8, $9)
        `, [room.id, room.name, room.ownerId, room.visibility, room.gameSystem, room.description, room.createdAt, room.accessType || 'public', room.passwordHash || null]);
        await client.query(`
          INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES ($1, $2, 'gm', $3)
        `, [room.id, room.ownerId, room.createdAt]);
        await client.query('COMMIT');
        return await getRoomFrom(pool, room.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    getRoomMembership: (roomId, userId) => getRoomMembershipFrom(pool, roomId, userId),
    async joinRoom(roomId, userId, joinedAt) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const room = await getRoomFrom(client, roomId);
        if (!room) {
          await client.query('ROLLBACK');
          return { error: 'Sala não encontrada.' };
        }
        if (await getRoomBannedUserFrom(client, roomId, userId)) {
          await client.query('ROLLBACK');
          return { error: 'Você não tem permissão para entrar nesta sala.' };
        }
        if (room.accessType === 'private' && !await getRoomMembershipFrom(client, roomId, userId)) {
          await client.query('ROLLBACK');
          return { error: 'Você não tem permissão para entrar nesta sala.' };
        }
        await client.query(`
          INSERT INTO room_members (room_id, user_id, role, joined_at)
          VALUES ($1, $2, 'spectator', $3) ON CONFLICT (room_id, user_id) DO NOTHING
        `, [roomId, userId, joinedAt]);
        const membership = await getRoomMembershipFrom(client, roomId, userId);
        await client.query('COMMIT');
        return { room, membership };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async listRoomMembers(roomId) {
      const result = await pool.query(`
        SELECT users.id, users.username, room_members.role,
          room_members.muted_until AS "mutedUntil", room_members.joined_at AS "joinedAt"
        FROM room_members JOIN users ON users.id = room_members.user_id
        WHERE room_members.room_id = $1
        ORDER BY CASE room_members.role WHEN 'gm' THEN 0 WHEN 'player' THEN 1 ELSE 2 END, LOWER(users.username)
      `, [roomId]);
      return result.rows;
    },
    async setRoomMemberRole(roomId, targetUserId, role) {
      const result = await pool.query(
        'UPDATE room_members SET role = $1 WHERE room_id = $2 AND user_id = $3',
        [role, roomId, targetUserId]
      );
      return result.rowCount > 0;
    },
    async listRoomBans(roomId) {
      const result = await pool.query(`
        SELECT users.id, users.username, room_bans.reason, room_bans.created_at AS "createdAt"
        FROM room_bans JOIN users ON users.id = room_bans.user_id
        WHERE room_bans.room_id = $1 ORDER BY room_bans.created_at DESC
      `, [roomId]);
      return result.rows;
    },
    getRoomBannedUser: (roomId, userId) => getRoomBannedUserFrom(pool, roomId, userId),
    async setRoomMute(roomId, targetUserId, mutedUntil) {
      const result = await pool.query(
        'UPDATE room_members SET muted_until = $1 WHERE room_id = $2 AND user_id = $3',
        [mutedUntil, roomId, targetUserId]
      );
      return result.rowCount > 0;
    },
    async removeRoomMember(roomId, targetUserId) {
      const result = await pool.query(
        'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, targetUserId]
      );
      return result.rowCount > 0;
    },
    async addRoomBan(roomId, targetUserId, actorUserId, reason, createdAt) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          INSERT INTO room_bans (room_id, user_id, reason, created_by_user_id, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (room_id, user_id) DO UPDATE SET
            reason = EXCLUDED.reason, created_by_user_id = EXCLUDED.created_by_user_id, created_at = EXCLUDED.created_at
        `, [roomId, targetUserId, reason, actorUserId, createdAt]);
        await client.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [roomId, targetUserId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async removeRoomBan(roomId, targetUserId) {
      const result = await pool.query('DELETE FROM room_bans WHERE room_id = $1 AND user_id = $2', [roomId, targetUserId]);
      return result.rowCount > 0;
    },
    async insertModerationEvent(event) {
      await pool.query(`
        INSERT INTO moderation_events (id, room_id, actor_user_id, target_user_id, action, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [event.id, event.roomId, event.actorUserId, event.targetUserId, event.action, event.createdAt]);
    },
    async listCampaigns(roomId) {
      const result = await pool.query(`
        SELECT id, room_id AS "roomId", name, description,
          created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM campaigns WHERE room_id = $1 ORDER BY updated_at DESC
      `, [roomId]);
      return result.rows;
    },
    async getCampaign(campaignId) {
      const result = await pool.query(`
        SELECT id, room_id AS "roomId", name, description,
          created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM campaigns WHERE id = $1
      `, [campaignId]);
      return result.rows[0] || null;
    },
    async createCampaign(campaign) {
      await pool.query(`
        INSERT INTO campaigns (id, room_id, name, description, created_by_user_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [campaign.id, campaign.roomId, campaign.name, campaign.description, campaign.createdByUserId, campaign.createdAt, campaign.updatedAt]);
      return store.getCampaign(campaign.id);
    },
    async updateCampaign(campaignId, name, description, updatedAt) {
      const result = await pool.query(
        'UPDATE campaigns SET name = $1, description = $2, updated_at = $3 WHERE id = $4',
        [name, description, updatedAt, campaignId]
      );
      return result.rowCount > 0;
    },
    async deleteCampaign(campaignId) {
      const result = await pool.query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
      return result.rowCount > 0;
    },
    async listCampaignNotes(campaignId) {
      const result = await pool.query(`
        SELECT id, campaign_id AS "campaignId", title, content,
          created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM campaign_notes WHERE campaign_id = $1 ORDER BY updated_at DESC
      `, [campaignId]);
      return result.rows;
    },
    async getCampaignNote(noteId) {
      const result = await pool.query(`
        SELECT id, campaign_id AS "campaignId", title, content,
          created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM campaign_notes WHERE id = $1
      `, [noteId]);
      return result.rows[0] || null;
    },
    async createCampaignNote(note) {
      await pool.query(`
        INSERT INTO campaign_notes (id, campaign_id, title, content, created_by_user_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [note.id, note.campaignId, note.title, note.content, note.createdByUserId, note.createdAt, note.updatedAt]);
      return store.getCampaignNote(note.id);
    },
    async updateCampaignNote(noteId, title, content, updatedAt) {
      const result = await pool.query(
        'UPDATE campaign_notes SET title = $1, content = $2, updated_at = $3 WHERE id = $4',
        [title, content, updatedAt, noteId]
      );
      return result.rowCount > 0;
    },
    async deleteCampaignNote(noteId) {
      const result = await pool.query('DELETE FROM campaign_notes WHERE id = $1', [noteId]);
      return result.rowCount > 0;
    },
    async listCharacters(roomId, userId, canViewAll) {
      const result = await pool.query(`
        SELECT id, room_id AS "roomId", campaign_id AS "campaignId",
          owner_user_id AS "ownerUserId", name, visibility, data_json AS "dataJson",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM characters WHERE room_id = $1 AND ($2::BOOLEAN OR owner_user_id = $3 OR visibility = 'room')
        ORDER BY updated_at DESC
      `, [roomId, canViewAll, userId]);
      return result.rows.map(mapCharacter);
    },
    async getCharacter(characterId) {
      const result = await pool.query(`
        SELECT id, room_id AS "roomId", campaign_id AS "campaignId",
          owner_user_id AS "ownerUserId", name, visibility, data_json AS "dataJson",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM characters WHERE id = $1
      `, [characterId]);
      return mapCharacter(result.rows[0] || null);
    },
    async createCharacter(character) {
      await pool.query(`
        INSERT INTO characters (id, room_id, campaign_id, owner_user_id, name, visibility, data_json, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, $8, $9)
      `, [character.id, character.roomId, character.campaignId, character.ownerUserId, character.name, character.visibility || 'private', JSON.stringify(character.data), character.createdAt, character.updatedAt]);
      return store.getCharacter(character.id);
    },
    async updateCharacter(characterId, name, data, campaignId, visibility, ownerUserId, updatedAt) {
      const result = await pool.query(`
        UPDATE characters SET name = $1, data_json = $2::JSONB, campaign_id = $3,
          visibility = $4, owner_user_id = $5, updated_at = $6
        WHERE id = $7
      `, [name, JSON.stringify(data), campaignId, visibility, ownerUserId, updatedAt, characterId]);
      return result.rowCount > 0;
    },
    async deleteCharacter(characterId) {
      const result = await pool.query('DELETE FROM characters WHERE id = $1', [characterId]);
      return result.rowCount > 0;
    },
    async listLibraryItems(roomId) {
      const result = await pool.query(`
        SELECT id, room_id AS "roomId", parent_id AS "parentId", owner_user_id AS "ownerUserId",
          item_type AS "itemType", name, visibility, data_json AS "dataJson",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM library_items WHERE room_id = $1 ORDER BY item_type, LOWER(name)
      `, [roomId]);
      return result.rows.map(mapLibraryItem);
    },
    async getLibraryItem(itemId) {
      const result = await pool.query(`
        SELECT id, room_id AS "roomId", parent_id AS "parentId", owner_user_id AS "ownerUserId",
          item_type AS "itemType", name, visibility, data_json AS "dataJson",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM library_items WHERE id = $1
      `, [itemId]);
      return mapLibraryItem(result.rows[0] || null);
    },
    async createLibraryItem(item) {
      await pool.query(`
        INSERT INTO library_items (id, room_id, parent_id, owner_user_id, item_type, name, visibility, data_json, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB, $9, $10)
      `, [item.id, item.roomId, item.parentId, item.ownerUserId, item.itemType, item.name, item.visibility, JSON.stringify(item.data), item.createdAt, item.updatedAt]);
      return store.getLibraryItem(item.id);
    },
    async updateLibraryItem(itemId, fields, updatedAt) {
      const result = await pool.query(`
        UPDATE library_items SET parent_id = $1, name = $2, visibility = $3,
          data_json = $4::JSONB, updated_at = $5
        WHERE id = $6
      `, [fields.parentId, fields.name, fields.visibility, JSON.stringify(fields.data), updatedAt, itemId]);
      return result.rowCount > 0;
    },
    async deleteLibraryItem(itemId) {
      const result = await pool.query('DELETE FROM library_items WHERE id = $1', [itemId]);
      return result.rowCount > 0;
    }
  };

  try {
    await pool.query('SELECT 1');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('freecast-schema-migrations'))");
      await client.query('CREATE SCHEMA IF NOT EXISTS freecast');
      await client.query('SET LOCAL search_path TO freecast, public');
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(row => row.name));
      const migrations = fs.readdirSync(MIGRATIONS_DIRECTORY).filter(name => name.endsWith('.sql')).sort();
      for (const name of migrations) {
        if (applied.has(name)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, name), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)', [name, new Date().toISOString()]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const schema = await pool.query('SELECT current_schema() AS schema');
    if (schema.rows[0]?.schema !== 'freecast') {
      throw new Error('A conexão PostgreSQL não selecionou o schema FREECAST.');
    }
  } catch (error) {
    await pool.end();
    throw error;
  }

  return store;
}

module.exports = { createPostgresStore, getPostgresSslConfig };
