// Minimal stand-ins for Cloudflare's D1 and R2 bindings, backed by Node's built-in SQLite,
// so the Worker can be tested without Wrangler or network access.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

class Statement {
    constructor(db, sql, params = []) {
        this.db = db; this.sql = sql; this.params = params;
    }
    bind(...params) {
        for (const p of params) if (p === undefined) throw new Error('D1_TYPE_ERROR: undefined is not allowed');
        return new Statement(this.db, this.sql, params);
    }
    _execute() {
        const stmt = this.db.prepare(this.sql);
        if (stmt.columns().length > 0) {
            return { results: stmt.all(...this.params), meta: { changes: 0 }, success: true };
        }
        const info = stmt.run(...this.params);
        return {
            results: [],
            meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
            success: true
        };
    }
    async run() { return this._execute(); }
    async all() { return this._execute(); }
    async first() { return this._execute().results[0] ?? null; }
}

export class FakeD1 {
    constructor(migrationsDir) {
        this.db = new DatabaseSync(':memory:');
        this.db.exec('PRAGMA foreign_keys = ON');
        for (const file of readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()) {
            this.db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
        }
    }
    prepare(sql) { return new Statement(this.db, sql); }
    // D1 batches are atomic: everything commits, or nothing does.
    async batch(statements) {
        this.db.exec('BEGIN');
        try {
            const out = statements.map(s => s._execute());
            this.db.exec('COMMIT');
            return out;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    query(sql, ...params) { return this.db.prepare(sql).all(...params); }
}

export class FakeR2 {
    constructor() { this.objects = new Map(); }
    async put(key, value, options = {}) {
        this.objects.set(key, { bytes: new Uint8Array(value), httpMetadata: options.httpMetadata || {} });
    }
    async get(key) {
        const entry = this.objects.get(key);
        if (!entry) return null;
        return { body: new Blob([entry.bytes]).stream(), size: entry.bytes.length, httpMetadata: entry.httpMetadata };
    }
    async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
    }
    async list({ prefix, cursor, limit = 1000 }) {
        const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort();
        const start = cursor ? keys.findIndex(key => key > cursor) : 0;
        const objects = keys.slice(Math.max(start, 0), Math.max(start, 0) + limit).map(key => ({ key }));
        const truncated = Math.max(start, 0) + objects.length < keys.length;
        return {
            objects,
            truncated,
            cursor: truncated ? objects.at(-1).key : undefined
        };
    }
}
