import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { type SqliteRemoteDatabase, drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

export type CajaDatabase = SqliteRemoteDatabase<typeof schema>;

export interface DatabaseContext {
  sqlite: DatabaseSync;
  db: CajaDatabase;
}

const MIGRATION_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    stock INTEGER NOT NULL CHECK (stock >= 0),
    min_stock INTEGER NOT NULL DEFAULT 5,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    receipt_number TEXT NOT NULL UNIQUE,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'transfer')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided')),
    subtotal_cents INTEGER NOT NULL,
    tax_cents INTEGER NOT NULL,
    total_cents INTEGER NOT NULL,
    profit_cents INTEGER NOT NULL,
    created_offline_at TEXT,
    voided_at TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL,
    unit_cost_cents INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment', 'return')),
    reference_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    description TEXT NOT NULL,
    reference_id TEXT,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id)",
  "CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON ledger_entries(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(product_id, created_at DESC)",
];

export function runMigrations(sqlite: DatabaseSync): void {
  sqlite.exec("PRAGMA foreign_keys = ON;");
  for (const stmt of MIGRATION_STATEMENTS) {
    sqlite.exec(stmt);
  }

  // Safely upgrade pre-existing SQLite DBs lacking append-only void columns.
  const salesCols = sqlite.prepare("PRAGMA table_info(sales)").all() as Array<{
    name: string;
  }>;
  const colNames = new Set(salesCols.map((c) => c.name));
  if (!colNames.has("status")) {
    sqlite.exec(
      "ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'",
    );
  }
  if (!colNames.has("voided_at")) {
    sqlite.exec("ALTER TABLE sales ADD COLUMN voided_at TEXT");
  }
  if (!colNames.has("void_reason")) {
    sqlite.exec("ALTER TABLE sales ADD COLUMN void_reason TEXT");
  }

  const movSchema = sqlite
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_movements'",
    )
    .get() as { sql?: string } | undefined;
  if (movSchema?.sql && !movSchema.sql.includes("'return'")) {
    sqlite.exec(`
      BEGIN IMMEDIATE TRANSACTION;
      CREATE TABLE inventory_movements_new (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment', 'return')),
        reference_id TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO inventory_movements_new SELECT * FROM inventory_movements;
      DROP TABLE inventory_movements;
      ALTER TABLE inventory_movements_new RENAME TO inventory_movements;
      CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements(product_id, created_at DESC);
      COMMIT;
    `);
  }
}

function toSqlParams(params: unknown[]): SQLInputValue[] {
  return params.map((value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    return String(value);
  });
}

export function createDatabase(dbPath: string): DatabaseContext {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const sqlite = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL;");
  }
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(sqlite);

  const db = drizzle(
    async (sqlText, params, method) => {
      const stmt = sqlite.prepare(sqlText);
      const bound = toSqlParams(params);

      if (method === "run") {
        stmt.run(...bound);
        return { rows: [] };
      }

      stmt.setReturnArrays(true);
      if (method === "get") {
        const row = stmt.get(...bound);
        return { rows: (row ?? undefined) as unknown as unknown[] };
      }

      return { rows: stmt.all(...bound) as unknown as unknown[][] };
    },
    { schema },
  );

  return { sqlite, db };
}

function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw || raw.startsWith("postgres")) {
    return path.resolve(process.cwd(), "data", "cajaledger.db");
  }
  if (raw === ":memory:") return raw;
  const cleaned = raw.startsWith("file:") ? raw.slice(5) : raw;
  return path.isAbsolute(cleaned)
    ? cleaned
    : path.resolve(process.cwd(), cleaned);
}

const globalForDb = globalThis as unknown as { __cajaDbCtx?: DatabaseContext };

export function getDbContext(): DatabaseContext {
  if (!globalForDb.__cajaDbCtx) {
    globalForDb.__cajaDbCtx = createDatabase(resolveDbPath());
  }
  return globalForDb.__cajaDbCtx;
}
