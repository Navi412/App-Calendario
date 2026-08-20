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

export async function getDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  const existingBytes = await loadBytes();
  dbInstance = existingBytes ? new SQL.Database(existingBytes) : new SQL.Database();
  dbInstance.run(SCHEMA_SQL);
  if (!existingBytes) {
    await persist();
  }
  return dbInstance;
}
