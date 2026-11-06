CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 1 CHECK (is_demo IN (0, 1))
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  x INTEGER NOT NULL CHECK (x BETWEEN 0 AND 11),
  y INTEGER NOT NULL CHECK (y BETWEEN 0 AND 11),
  hp INTEGER NOT NULL CHECK (hp >= 0),
  max_hp INTEGER NOT NULL CHECK (max_hp > 0),
  color TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE dice_rolls (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  expression TEXT NOT NULL,
  result INTEGER NOT NULL,
  total INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX chat_messages_room_time ON chat_messages(room_id, created_at);
CREATE INDEX dice_rolls_room_time ON dice_rolls(room_id, created_at);

INSERT OR IGNORE INTO rooms (id, name, is_demo)
VALUES ('demo', 'O Salão das Lanternas', 1);
