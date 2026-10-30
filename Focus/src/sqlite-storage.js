import { DatabaseSync } from 'node:sqlite';
import { createReadStream, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';

class SQLiteStatement {
    constructor(database, sql, params = []) {
        this.database = database;
        this.sql = sql;
        this.params = params;
    }

    bind(...params) {
        if (params.some(value => value === undefined)) {
            throw new Error('D1_TYPE_ERROR: undefined is not allowed');
        }
        return new SQLiteStatement(this.database, this.sql, params);
    }

    execute() {
        const statement = this.database.prepare(this.sql);
        if (statement.columns().length) {
            return { results: statement.all(...this.params), meta: { changes: 0 }, success: true };
        }
        const result = statement.run(...this.params);
        return {
            results: [],
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
            success: true
        };
    }

    async run() {
        return this.execute();
    }

    async all() {
        return this.execute();
    }

    async first() {
        return this.execute().results[0] ?? null;
    }
}

export class SQLiteDatabase {
    constructor(filename, migrationsDirectory) {
        mkdirSync(dirname(filename), { recursive: true });
        this.database = new DatabaseSync(filename);
        this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        this.applyMigrations(migrationsDirectory);
    }

    applyMigrations(migrationsDirectory) {
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
        `);

        const applied = new Set(this.database.prepare('SELECT name FROM schema_migrations').all().map(row => row.name));
        const migrations = readdirSync(migrationsDirectory).filter(file => file.endsWith('.sql')).sort();
        for (const name of migrations) {
            if (applied.has(name)) continue;
            const sql = readFileSync(join(migrationsDirectory, name), 'utf8');
            this.database.exec('BEGIN');
            try {
                this.database.exec(sql);
                this.database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
                this.database.exec('COMMIT');
            } catch (error) {
                this.database.exec('ROLLBACK');
                throw new Error(`Failed to apply database migration ${name}.`, { cause: error });
            }
        }
    }

    prepare(sql) {
        return new SQLiteStatement(this.database, sql);
    }

    async batch(statements) {
        this.database.exec('BEGIN');
        try {
            const results = statements.map(statement => statement.execute());
            this.database.exec('COMMIT');
            return results;
        } catch (error) {
            this.database.exec('ROLLBACK');
            throw error;
        }
    }

    close() {
        this.database.close();
    }
}

function checkedKey(key) {
    if (typeof key !== 'string' || !/^\d+\/book_[A-Za-z0-9_-]{1,120}$/.test(key)) {
        throw new Error('Invalid book storage key.');
    }
    return key;
}

export class FileBookStorage {
    constructor(directory) {
        this.directory = resolve(directory);
    }

    paths(key) {
        const safeKey = checkedKey(key);
        const file = resolve(this.directory, `${safeKey}.book`);
        if (!file.startsWith(`${this.directory}${process.platform === 'win32' ? '\\' : '/'}`)) {
            throw new Error('Invalid book storage path.');
        }
        return { file, metadata: `${file}.json` };
    }

    async put(key, value, options = {}) {
        const paths = this.paths(key);
        await mkdir(dirname(paths.file), { recursive: true });
        await writeFile(paths.file, value);
        await writeFile(paths.metadata, JSON.stringify({
            contentType: options.httpMetadata?.contentType || 'application/octet-stream'
        }));
    }

    async get(key) {
        const paths = this.paths(key);
        let fileStats;
        try {
            fileStats = await stat(paths.file);
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
        const metadata = await readFile(paths.metadata, 'utf8');
        const { contentType } = JSON.parse(metadata);
        return {
            body: Readable.toWeb(createReadStream(paths.file)),
            size: fileStats.size,
            httpMetadata: { contentType }
        };
    }

    async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            const paths = this.paths(key);
            for (const file of [paths.file, paths.metadata]) {
                try {
                    await unlink(file);
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        }
    }

    async list({ prefix, cursor, limit = 1000 }) {
        if (!/^\d+\/$/.test(prefix)) throw new Error('Invalid book storage prefix.');
        const userDirectory = resolve(this.directory, prefix.slice(0, -1));
        if (!userDirectory.startsWith(`${this.directory}${process.platform === 'win32' ? '\\' : '/'}`)) {
            throw new Error('Invalid book storage path.');
        }

        let names;
        try {
            names = await readdir(userDirectory);
        } catch (error) {
            if (error.code === 'ENOENT') return { objects: [], truncated: false };
            throw error;
        }
        const keys = names.filter(name => /^book_[A-Za-z0-9_-]{1,120}\.book$/.test(name))
            .map(name => `${prefix}${name.slice(0, -5)}`)
            .sort()
            .filter(key => !cursor || key > cursor);
        const page = keys.slice(0, limit);
        const truncated = keys.length > page.length;
        return {
            objects: page.map(key => ({ key })),
            truncated,
            cursor: truncated ? page.at(-1) : undefined
        };
    }
}
