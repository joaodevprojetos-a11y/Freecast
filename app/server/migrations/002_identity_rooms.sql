CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX sessions_expiry ON sessions(expires_at);

ALTER TABLE rooms ADD COLUMN created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE rooms ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));
ALTER TABLE rooms ADD COLUMN game_system TEXT NOT NULL DEFAULT 'Sistema próprio';
ALTER TABLE rooms ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN created_at TEXT NOT NULL DEFAULT '';

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('gm', 'player')),
  muted_until TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE room_bans (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE moderation_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('mute', 'unmute', 'kick', 'ban', 'unban')),
  created_at TEXT NOT NULL
);

CREATE INDEX room_members_user ON room_members(user_id, room_id);
CREATE INDEX room_bans_user ON room_bans(user_id, room_id);
