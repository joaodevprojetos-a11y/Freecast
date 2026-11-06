ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email_ci ON users(LOWER(email)) WHERE email IS NOT NULL AND email <> '';

ALTER TABLE rooms ADD COLUMN access_type TEXT NOT NULL DEFAULT 'public' CHECK (access_type IN ('public', 'password', 'private'));
ALTER TABLE rooms ADD COLUMN room_password_hash TEXT;
UPDATE rooms SET access_type = 'private' WHERE visibility = 'private';
ALTER TABLE characters ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'room'));

DROP INDEX room_members_user;
CREATE TABLE room_members_new (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('gm', 'player', 'spectator')),
  muted_until TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
INSERT INTO room_members_new (room_id, user_id, role, muted_until, joined_at)
SELECT room_id, user_id, role, muted_until, joined_at FROM room_members;
DROP TABLE room_members;
ALTER TABLE room_members_new RENAME TO room_members;
CREATE INDEX room_members_user ON room_members(user_id, room_id);

CREATE TABLE library_items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES library_items(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('folder', 'map')),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'room')),
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX library_items_room_parent ON library_items(room_id, parent_id, item_type);
