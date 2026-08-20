import initSqlJs, { type Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { SCHEMA_SQL } from "./schema.js";

const IDB_NAME = "app-calendario";
const IDB_STORE = "sqlite";
const IDB_KEY = "db-bytes";

let dbInstance: Database | null = null;

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Persiste el estado completo de la base en IndexedDB. sql.js no tiene
 * escritura incremental a disco (vive enteramente en memoria), así que se
 * serializa entera tras cada mutación. Para el tamaño de datos de un
 * calendario personal esto es aceptable; si se vuelve un cuello de botella,
 * el candidato de reemplazo es wa-sqlite con VFS de OPFS (ver DESIGN.md,
 * punto a discutir #2).
 */
export async function persist(): Promise<void> {
  if (!dbInstance) return;
  await saveBytes(dbInstance.export());
}

/**
 * Columnas añadidas después de la creación inicial de la tabla. `CREATE
 * TABLE IF NOT EXISTS` no las añade a una base ya existente en el
 * IndexedDB de un usuario, así que se intentan una por una; SQLite lanza
 * si la columna ya existe, y ese error concreto se ignora a propósito.
 */
function runMigrations(db: Database): void {
  const migrations = [
    "ALTER TABLE events ADD COLUMN color TEXT NOT NULL DEFAULT 'blue'",
    "ALTER TABLE events ADD COLUMN calendar_id TEXT",
  ];
  for (const migration of migrations) {
    try {
      db.run(migration);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("duplicate column name")) throw err;
    }
  }
  // Solo ahora se garantiza que calendar_id existe en cualquier base, nueva o migrada.
  db.run("CREATE INDEX IF NOT EXISTS idx_events_calendar ON events (calendar_id)");
}

/**
 * Garantiza el invariante "siempre hay al menos un calendario y ningún
 * evento se queda sin calendar_id" -- necesario tanto en una base nueva
 * (nunca hubo calendarios) como en una que se actualiza desde antes de que
 * existiera esta tabla (sus eventos tienen calendar_id NULL tras la
 * migración de arriba).
 */
function ensureDefaultCalendar(db: Database): void {
  const rows = db.exec("SELECT id FROM calendars ORDER BY created_at ASC LIMIT 1");
  const existingId = rows[0]?.values[0]?.[0] as string | undefined;
  const defaultId = existingId ?? crypto.randomUUID();

  if (!existingId) {
    const now = new Date().toISOString();
    db.run("INSERT INTO calendars (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      defaultId,
      "Mi calendario",
      "blue",
      now,
      now,
    ]);
  }

  db.run("UPDATE events SET calendar_id = ? WHERE calendar_id IS NULL", [defaultId]);
}

/**
 * Deja una `Database` (nueva o cargada desde bytes existentes) al día:
 * esquema, migraciones de columnas y el invariante del calendario por
 * defecto. Aislado de `getDb()` (que además carga/guarda en IndexedDB, solo
 * disponible en el navegador) para poder probarlo contra una base sql.js en
 * memoria sin depender de IndexedDB -- ver sqlite.test.ts, que simula
 * justamente una base creada antes de que existiera `calendar_id`.
 */
export function bootstrapSchema(db: Database): void {
  db.run(SCHEMA_SQL);
  runMigrations(db);
  ensureDefaultCalendar(db);
}

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const existingBytes = await loadBytes();
  const db = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
  bootstrapSchema(db);
  dbInstance = db;
  // Persiste siempre (no solo en base nueva): tanto la migración de
  // calendar_id como el backfill del calendario por defecto pueden mutar
  // una base ya existente en IndexedDB.
  await persist();
  return dbInstance;
}
