// App data sync. The frontend sends and receives whole "sections"
// (tasks, notes, ...) as JSON. Each section is stored in its own relational
// SQLite table (see migrations/0001_init.sql) and rebuilt into the same JSON on read.
import { HttpError, json, readJson, utf8Length } from './http.js';

const MAX_SECTION_BYTES = 1_500_000; // stays under D1's 2 MB string/row limit
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 5000;
const MAX_ID_LENGTH = 128;
const THEMES = ['light', 'dark', 'system'];

// fields: [jsonKey, column, type]   (type: text | real | bool)
const SECTIONS = {
    calendar: { kind: 'array', table: 'calendar_events', fields: [
        ['title', 'title', 'text'], ['date', 'date', 'text'], ['time', 'time', 'text']] },
    tasks: { kind: 'array', table: 'tasks', fields: [
        ['title', 'title', 'text'], ['priority', 'priority', 'text'],
        ['category', 'category', 'text'], ['completed', 'completed', 'bool']] },
    notes: { kind: 'array', table: 'notes', fields: [
        ['title', 'title', 'text'], ['content', 'content', 'text'],
        ['pinned', 'pinned', 'bool'], ['updatedAt', 'updated_at', 'text']] },
    journals: { kind: 'array', table: 'journal_entries', fields: [
        ['text', 'text', 'text'], ['mood', 'mood', 'text'], ['date', 'entry_date', 'text']] },
    books: { kind: 'array', table: 'books', fields: [
        ['title', 'title', 'text'], ['format', 'format', 'text'],
        ['createdAt', 'created_at', 'text'], ['status', 'status', 'text']] },
    study: { kind: 'array', table: 'study_plans', fields: [
        ['subject', 'subject', 'text'], ['topic', 'topic', 'text'], ['target', 'target', 'real'],
        ['completed', 'completed', 'real'], ['deadline', 'deadline', 'text']] },
    results: { kind: 'array', table: 'results', fields: [
        ['subject', 'subject', 'text'], ['target', 'target', 'real'], ['actual', 'actual', 'real']] },
    timetable: { kind: 'map', table: 'timetable_slots' },
    pomoStats: { kind: 'object', table: 'pomo_stats' },
    preferences: { kind: 'object', table: 'preferences' }
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkField(section, key, type, value) {
    if (value === undefined || value === null) return;
    const ok = type === 'text' ? typeof value === 'string'
        : type === 'real' ? typeof value === 'number' && Number.isFinite(value)
        : typeof value === 'boolean';
    if (!ok) throw new HttpError(400, `Data for ${section} has an invalid "${key}" value.`);
}

// Validates a section and returns the value to store (arrays are de-duplicated by id).
function normalizeSection(section, data) {
    const def = SECTIONS[section];
    const shape = def.kind === 'array' ? 'array' : 'object';
    if (def.kind === 'array' ? !Array.isArray(data) : !isPlainObject(data)) {
        throw new HttpError(400, `Data for ${section} must be a JSON ${shape}.`);
    }
    if (utf8Length(JSON.stringify(data)) > MAX_SECTION_BYTES) {
        throw new HttpError(413, `Data for ${section} is too large.`);
    }

    if (def.kind === 'array') {
        if (data.length > MAX_ITEMS) throw new HttpError(413, `Data for ${section} has too many items.`);
        const byId = new Map();
        for (const item of data) {
            if (!isPlainObject(item) || typeof item.id !== 'string'
                || !item.id || item.id.length > MAX_ID_LENGTH) {
                throw new HttpError(400, `Every item in ${section} needs a text "id" of up to ${MAX_ID_LENGTH} characters.`);
            }
            for (const [key, , type] of def.fields) checkField(section, key, type, item[key]);
            if (section === 'calendar' && item.reminderAt !== undefined) {
                if (typeof item.reminderAt !== 'string'
                    || !Number.isFinite(Date.parse(item.reminderAt))
                    || !Number.isInteger(item.reminderMinutes)
                    || item.reminderMinutes < 1
                    || item.reminderMinutes > 525_600) {
                    throw new HttpError(400, 'Calendar reminder time or duration is invalid.');
                }
            }
            byId.delete(item.id); // a repeated id keeps its last version, at its last position
            byId.set(item.id, item);
        }
        return [...byId.values()];
    }

    if (def.kind === 'map') {
        const entries = Object.entries(data);
        if (entries.length > MAX_ITEMS) throw new HttpError(413, `Data for ${section} has too many items.`);
        for (const [key, value] of entries) {
            if (!key || key.length > 64 || typeof value !== 'string') {
                throw new HttpError(400, `Data for ${section} must map short keys to text.`);
            }
        }
        return data;
    }

    if (section === 'pomoStats') {
        for (const key of ['sessions', 'totalMinutes']) {
            if (data[key] !== undefined && !(Number.isInteger(data[key]) && data[key] >= 0)) {
                throw new HttpError(400, `pomoStats.${key} must be a non-negative whole number.`);
            }
        }
    } else if (data.theme !== undefined && !THEMES.includes(data.theme)) {
        throw new HttpError(400, 'preferences.theme must be light, dark or system.');
    }
    return data;
}

// Builds the statements that replace one user's rows for a section.
function writeStatements(db, userId, section, value) {
    const def = SECTIONS[section];
    const del = db.prepare(`DELETE FROM ${def.table} WHERE user_id = ?1`).bind(userId);

    if (def.kind === 'array') {
        // One INSERT ... SELECT over json_each, so any number of items costs a single query.
        // Table/column names come from the constant config above, never from user input.
        const columns = def.fields.map(f => f[1]).join(', ');
        const extracts = def.fields.map(([key, , type]) => type === 'bool'
            ? `COALESCE(json_extract(value, '$.${key}'), 0)`
            : `json_extract(value, '$.${key}')`).join(', ');
        const known = ['id', ...def.fields.map(f => f[0])].map(k => `'$.${k}'`).join(', ');
        const insert = db.prepare(`
            INSERT INTO ${def.table} (user_id, id, position, ${columns}, extra)
            SELECT ?1, json_extract(value, '$.id'), CAST(key AS INTEGER), ${extracts},
                   NULLIF(json_remove(value, ${known}), '{}')
            FROM json_each(?2)`).bind(userId, JSON.stringify(value));
        if (section !== 'calendar') return [del, insert];

        const deleteReminders = db.prepare('DELETE FROM event_reminders WHERE user_id = ?1').bind(userId);
        const insertReminders = db.prepare(`
            INSERT INTO event_reminders (user_id, event_id, remind_at, title, event_date, event_time, location)
            SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.reminderAt'),
                   json_extract(value, '$.title'), json_extract(value, '$.date'),
                   COALESCE(json_extract(value, '$.time'), ''),
                   COALESCE(json_extract(value, '$.location'), '')
            FROM json_each(?2)
            WHERE json_type(value, '$.reminderAt') = 'text'
                AND json_extract(value, '$.reminderAt') IS NOT NULL`)
            .bind(userId, JSON.stringify(value));
        return [del, insert, deleteReminders, insertReminders];
    }

    if (def.kind === 'map') {
        const insert = db.prepare(`
            INSERT INTO timetable_slots (user_id, slot_key, value)
            SELECT ?1, key, value FROM json_each(?2) WHERE value != ''`)
            .bind(userId, JSON.stringify(value));
        return [del, insert];
    }

    if (section === 'pomoStats') {
        return [db.prepare(`
            INSERT INTO pomo_stats (user_id, sessions, total_minutes) VALUES (?1, ?2, ?3)
            ON CONFLICT (user_id) DO UPDATE SET sessions = excluded.sessions,
                                                total_minutes = excluded.total_minutes`)
            .bind(userId, value.sessions ?? 0, value.totalMinutes ?? 0)];
    }

    return [db.prepare(`
        INSERT INTO preferences (user_id, theme) VALUES (?1, ?2)
        ON CONFLICT (user_id) DO UPDATE SET theme = excluded.theme`)
        .bind(userId, value.theme ?? 'system')];
}

const markInitialized = (db, userId) => db.prepare(`
    INSERT INTO sync_state (user_id, initialized) VALUES (?1, 1)
    ON CONFLICT (user_id) DO UPDATE SET initialized = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .bind(userId);

function rowToItem(def, row) {
    const item = { id: row.id };
    for (const [key, column, type] of def.fields) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        item[key] = type === 'bool' ? value === 1 : value;
    }
    if (row.extra) {
        try { Object.assign(item, JSON.parse(row.extra)); } catch { /* ignore corrupt extras */ }
    }
    return item;
}

async function readAllSections(db, userId) {
    const names = Object.keys(SECTIONS);
    const results = await db.batch([
        db.prepare('SELECT initialized FROM sync_state WHERE user_id = ?1').bind(userId),
        ...names.map(name => {
            const def = SECTIONS[name];
            const order = def.kind === 'array' ? ' ORDER BY position' : '';
            return db.prepare(`SELECT * FROM ${def.table} WHERE user_id = ?1${order}`).bind(userId);
        })
    ]);

    const data = {};
    names.forEach((name, index) => {
        const def = SECTIONS[name];
        const rows = results[index + 1].results;
        if (def.kind === 'array') {
            data[name] = rows.map(row => rowToItem(def, row));
        } else if (def.kind === 'map') {
            data[name] = Object.fromEntries(rows.map(row => [row.slot_key, row.value]));
        } else if (name === 'pomoStats') {
            data[name] = rows[0] ? { sessions: rows[0].sessions, totalMinutes: rows[0].total_minutes } : {};
        } else {
            data[name] = rows[0] ? { theme: rows[0].theme } : {};
        }
    });
    return { initialized: Boolean(results[0].results[0]?.initialized), data };
}

export async function handleData(request, env, userId, pathname) {
    const db = env.DB;

    if (pathname === '/api/data') {
        if (request.method !== 'GET') return json(405, { error: 'Method not allowed.' }, { Allow: 'GET' });
        return json(200, await readAllSections(db, userId));
    }

    if (pathname === '/api/data/bootstrap') {
        if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
        const body = await readJson(request, MAX_BODY_BYTES);
        if (!isPlainObject(body.data)) throw new HttpError(400, 'Request must include a data object.');

        const statements = [];
        for (const section of Object.keys(SECTIONS)) {
            const value = normalizeSection(section, body.data[section]);
            statements.push(...writeStatements(db, userId, section, value));
        }

        // Claim the one-time import atomically so two tabs cannot both run it.
        await db.prepare('INSERT OR IGNORE INTO sync_state (user_id, initialized) VALUES (?1, 0)').bind(userId).run();
        const claim = await db.prepare(`
            UPDATE sync_state SET initialized = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE user_id = ?1 AND initialized = 0`).bind(userId).run();
        if (!claim.meta.changes) throw new HttpError(409, 'App data has already been initialized.');

        try {
            await db.batch(statements); // all sections commit together or not at all
        } catch (error) {
            await db.prepare('UPDATE sync_state SET initialized = 0 WHERE user_id = ?1').bind(userId).run();
            throw error;
        }
        return json(201, { saved: true });
    }

    const match = pathname.match(/^\/api\/data\/([a-zA-Z]+)$/);
    if (!match || !Object.hasOwn(SECTIONS, match[1])) throw new HttpError(404, 'Unknown app data section.');
    if (request.method !== 'PUT') return json(405, { error: 'Method not allowed.' }, { Allow: 'PUT' });

    const section = match[1];
    const body = await readJson(request, MAX_BODY_BYTES);
    const value = normalizeSection(section, body.data);
    await db.batch([...writeStatements(db, userId, section, value), markInitialized(db, userId)]);
    return json(200, { saved: true });
}
