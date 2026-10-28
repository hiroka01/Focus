-- Focus database (SQLite via Cloudflare D1)
-- Every per-user table is keyed by user_id and cascades when the user is removed.
-- `position` keeps the array order the app relies on (newest-first lists).
-- `extra` holds any additional JSON fields the app adds later, so nothing is dropped.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    email         TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE account_deletion_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
    requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_deletion_user_status ON account_deletion_requests (user_id, status);

-- Whether a user's browser data has been transferred to the database yet.
CREATE TABLE sync_state (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    initialized INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE calendar_events (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id       TEXT NOT NULL,
    position INTEGER NOT NULL,
    title    TEXT,
    date     TEXT,            -- YYYY-MM-DD
    time     TEXT,            -- HH:MM or ''
    extra    TEXT,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX idx_calendar_user_date ON calendar_events (user_id, date);

CREATE TABLE tasks (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id        TEXT NOT NULL,
    position  INTEGER NOT NULL,
    title     TEXT,
    priority  TEXT,
    category  TEXT,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    extra     TEXT,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE notes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    position   INTEGER NOT NULL,
    title      TEXT,
    content    TEXT,
    pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    updated_at TEXT,          -- display date string produced by the app
    extra      TEXT,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE journal_entries (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    position   INTEGER NOT NULL,
    text       TEXT,
    mood       TEXT,
    entry_date TEXT,
    extra      TEXT,
    PRIMARY KEY (user_id, id)
);

-- Metadata only. The PDF/EPUB bytes live in the R2 bucket (see wrangler.jsonc).
CREATE TABLE books (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    position   INTEGER NOT NULL,
    title      TEXT,
    format     TEXT,          -- pdf | epub
    created_at TEXT,
    status     TEXT,
    extra      TEXT,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE study_plans (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id        TEXT NOT NULL,
    position  INTEGER NOT NULL,
    subject   TEXT,
    topic     TEXT,
    target    REAL,
    completed REAL,
    deadline  TEXT,
    extra     TEXT,
    PRIMARY KEY (user_id, id)
);

CREATE TABLE results (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id       TEXT NOT NULL,
    position INTEGER NOT NULL,
    subject  TEXT,
    target   REAL,
    actual   REAL,
    extra    TEXT,
    PRIMARY KEY (user_id, id)
);

-- One row per filled timetable cell, e.g. slot_key = 'Mon_08:00'.
CREATE TABLE timetable_slots (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slot_key TEXT NOT NULL,
    value    TEXT NOT NULL,
    PRIMARY KEY (user_id, slot_key)
);

CREATE TABLE pomo_stats (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sessions      INTEGER NOT NULL DEFAULT 0,
    total_minutes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme   TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system'))
);
