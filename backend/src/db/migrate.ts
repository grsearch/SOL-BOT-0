import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(path.resolve(process.cwd(), config.DATABASE_PATH));
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('synchronous = NORMAL');
  }
  return _db;
}

export function migrate(): void {
  const db = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // 兼容性 ALTER：v0 版本 DB 升级路径（CREATE IF NOT EXISTS 不会改老表）
  ensureColumn(db, 'trades', 'realized_pnl_sol', 'REAL');

  logger.info('数据库迁移完成');
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    logger.info({ table, column }, '已添加 DB 列（兼容旧版）');
  }
}

// CLI: tsx src/db/migrate.ts
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate();
  console.log('✅ DB ready at', config.DATABASE_PATH);
}
