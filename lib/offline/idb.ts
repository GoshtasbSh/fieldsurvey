/**
 * Minimal IndexedDB wrapper for the offline outbox.
 * Schema (db: fieldsurvey-offline, version 1):
 *   - outbox_points  : keyPath=client_id  { project_id, status_id, lat, lon, accuracy_m, address, notes, collected_at, photo_blob_ids[], attempts, last_error }
 *   - outbox_photos  : keyPath=id         { blob: Blob, mime: string }
 *   - cached_points  : keyPath=id         (last-known server state for instant render)
 *
 * Ported from keystone_field_web/index.html outbox patterns.
 */

const DB_NAME = "fieldsurvey-offline";
const DB_VERSION = 1;

export type OutboxPointRow = {
  client_id: string;
  project_id: string;
  status_id: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  address: string | null;
  notes: string | null;
  collected_at: string;
  photo_blob_ids: string[];
  attempts: number;
  last_error: string | null;
  created_at: number;
};

export type OutboxPhotoRow = {
  id: string;
  blob: Blob;
  mime: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("outbox_points")) db.createObjectStore("outbox_points", { keyPath: "client_id" });
      if (!db.objectStoreNames.contains("outbox_photos")) db.createObjectStore("outbox_photos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("cached_points")) db.createObjectStore("cached_points", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result: T;
    Promise.resolve(fn(s))
      .then((r) => (result = r))
      .catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function asyncify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── outbox_points ────────────────────────────────────────────────
export async function putOutboxPoint(row: OutboxPointRow) {
  await tx("outbox_points", "readwrite", (s) => asyncify(s.put(row)));
}

export async function listOutboxPoints(projectId?: string): Promise<OutboxPointRow[]> {
  return tx("outbox_points", "readonly", async (s) => {
    const rows = await asyncify(s.getAll() as IDBRequest<OutboxPointRow[]>);
    return projectId ? rows.filter((r) => r.project_id === projectId) : rows;
  });
}

export async function deleteOutboxPoint(clientId: string) {
  await tx("outbox_points", "readwrite", (s) => asyncify(s.delete(clientId)));
}

// ── outbox_photos ────────────────────────────────────────────────
export async function putOutboxPhoto(row: OutboxPhotoRow) {
  await tx("outbox_photos", "readwrite", (s) => asyncify(s.put(row)));
}

export async function getOutboxPhoto(id: string): Promise<OutboxPhotoRow | undefined> {
  return tx("outbox_photos", "readonly", (s) => asyncify(s.get(id) as IDBRequest<OutboxPhotoRow | undefined>));
}

export async function deleteOutboxPhoto(id: string) {
  await tx("outbox_photos", "readwrite", (s) => asyncify(s.delete(id)));
}

// ── cached_points (optional snapshot for offline render) ─────────
export async function putCachedPoints(points: Array<{ id: string; [k: string]: unknown }>) {
  await tx("cached_points", "readwrite", async (s) => {
    await Promise.all(points.map((p) => asyncify(s.put(p))));
  });
}

export async function clearCachedPoints() {
  await tx("cached_points", "readwrite", (s) => asyncify(s.clear()));
}
