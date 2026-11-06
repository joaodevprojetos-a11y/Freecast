ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email_ci ON users (LOWER(email)) WHERE email IS NOT NULL AND email <> '';

ALTER TABLE rooms ADD COLUMN access_type TEXT NOT NULL DEFAULT 'public'
  CHECK (access_type IN ('public', 'password', 'private'));
ALTER TABLE rooms ADD COLUMN room_password_hash TEXT;
UPDATE rooms SET access_type = 'private' WHERE visibility = 'private';
ALTER TABLE characters ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'room'));

ALTER TABLE room_members DROP CONSTRAINT room_members_role_check;
ALTER TABLE room_members ADD CONSTRAINT room_members_role_check
  CHECK (role IN ('gm', 'player', 'spectator'));

CREATE TABLE library_items (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES library_items(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('folder', 'map')),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'room')),
  data_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX library_items_room_parent ON library_items(room_id, parent_id, item_type);
