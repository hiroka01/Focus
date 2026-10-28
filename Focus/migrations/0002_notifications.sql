CREATE TABLE push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh      TEXT NOT NULL,
    auth_secret TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);

CREATE TABLE notification_preferences (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    event_reminders INTEGER NOT NULL DEFAULT 1 CHECK (event_reminders IN (0, 1)),
    timer_alerts    INTEGER NOT NULL DEFAULT 1 CHECK (timer_alerts IN (0, 1))
);

CREATE TABLE event_reminders (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id    TEXT NOT NULL,
    remind_at   TEXT NOT NULL,
    title       TEXT NOT NULL,
    event_date  TEXT NOT NULL,
    event_time  TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL DEFAULT '',
    claimed_at  TEXT,
    sent_at     TEXT,
    PRIMARY KEY (user_id, event_id)
);
CREATE INDEX idx_event_reminders_due ON event_reminders (remind_at, sent_at, claimed_at);

CREATE TABLE timer_notifications (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ends_at    TEXT NOT NULL,
    mode       TEXT NOT NULL CHECK (mode IN ('focus', 'short', 'long')),
    claimed_at TEXT,
    sent_at    TEXT
);
CREATE INDEX idx_timer_notifications_due ON timer_notifications (ends_at, sent_at, claimed_at);
