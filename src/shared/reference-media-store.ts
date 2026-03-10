/**
 * Persistent mapping:
 *   (projectId + assetHash) -> Flow media UUID
 *
 * This lets us reuse already-uploaded reference images from the Flow resource
 * panel across tasks/sessions, instead of re-uploading every time.
 *
 * Storage growth is controlled by:
 *  - TTL eviction (stale entries)
 *  - Per-project cap
 *  - Global cap
 */

const DB_NAME = "flowauto-reference-media";
const DB_VERSION = 1;
const STORE_NAME = "hash-media-map";

const STALE_MS = 45 * 24 * 60 * 60 * 1000; // 45 days
const MAX_ENTRIES = 1200;
const MAX_PER_PROJECT = 250;
const MAX_UUID_CANDIDATES = 4;
const MAX_FILENAME_HINTS = 4;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // at most once per 30 min

let lastCleanupAt = 0;

export interface ReferenceMediaEntry {
  id: string; // `${projectId}::${assetHash}`
  projectId: string;
  assetHash: string;
  preferredUuid: string;
  uuidCandidates: string[];
  filenameHints: string[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  hitCount: number;
}

export interface ReferenceMediaCleanupResult {
  removed: number;
  total: number;
}

function now(): number {
  return Date.now();
}

function makeId(projectId: string, assetHash: string): string {
  return `${projectId}::${assetHash}`;
}

function dedupeHead(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllEntries(db: IDBDatabase): Promise<ReferenceMediaEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result ?? []) as ReferenceMediaEntry[]);
    req.onerror = () => reject(req.error);
  });
}

async function getEntry(
  db: IDBDatabase,
  projectId: string,
  assetHash: string,
): Promise<ReferenceMediaEntry | null> {
  const id = makeId(projectId, assetHash);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve((req.result as ReferenceMediaEntry) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function putEntry(
  db: IDBDatabase,
  entry: ReferenceMediaEntry,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteEntriesById(
  db: IDBDatabase,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stale(entry: ReferenceMediaEntry, nowTs: number): boolean {
  return (
    nowTs - (entry.lastUsedAt || entry.updatedAt || entry.createdAt) > STALE_MS
  );
}

function collectOverflowByProject(entries: ReferenceMediaEntry[]): string[] {
  const ids: string[] = [];
  const byProject = new Map<string, ReferenceMediaEntry[]>();
  for (const e of entries) {
    const arr = byProject.get(e.projectId) ?? [];
    arr.push(e);
    byProject.set(e.projectId, arr);
  }
  for (const arr of byProject.values()) {
    if (arr.length <= MAX_PER_PROJECT) continue;
    arr.sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
    for (const extra of arr.slice(MAX_PER_PROJECT)) ids.push(extra.id);
  }
  return ids;
}

function collectOverflowGlobal(entries: ReferenceMediaEntry[]): string[] {
  if (entries.length <= MAX_ENTRIES) return [];
  const sorted = [...entries].sort(
    (a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0),
  );
  return sorted.slice(0, entries.length - MAX_ENTRIES).map((e) => e.id);
}

export async function cleanupReferenceMediaStore(
  force = false,
): Promise<ReferenceMediaCleanupResult> {
  if (!force && now() - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    const db = await openDB();
    try {
      const total = (await getAllEntries(db)).length;
      return { removed: 0, total };
    } finally {
      db.close();
    }
  }

  const db = await openDB();
  try {
    const entries = await getAllEntries(db);
    const nowTs = now();
    const staleIds = entries.filter((e) => stale(e, nowTs)).map((e) => e.id);
    const staleSet = new Set(staleIds);
    const survivorsAfterStale = entries.filter((e) => !staleSet.has(e.id));

    const projectOverflow = collectOverflowByProject(survivorsAfterStale);
    const projectOverflowSet = new Set(projectOverflow);
    const survivorsAfterProject = survivorsAfterStale.filter(
      (e) => !projectOverflowSet.has(e.id),
    );

    const globalOverflow = collectOverflowGlobal(survivorsAfterProject);

    const allToDelete = dedupeHead(
      [...staleIds, ...projectOverflow, ...globalOverflow],
      Number.MAX_SAFE_INTEGER,
    );

    if (allToDelete.length) {
      await deleteEntriesById(db, allToDelete);
    }

    lastCleanupAt = nowTs;
    const total = entries.length - allToDelete.length;
    return { removed: allToDelete.length, total: Math.max(0, total) };
  } finally {
    db.close();
  }
}

export async function lookupReferenceMediaUuid(
  projectId: string,
  assetHash: string,
): Promise<string | undefined> {
  const db = await openDB();
  try {
    const entry = await getEntry(db, projectId, assetHash);
    if (!entry) return undefined;
    if (stale(entry, now())) {
      await deleteEntriesById(db, [entry.id]);
      return undefined;
    }
    return entry.preferredUuid;
  } finally {
    db.close();
  }
}

export async function upsertReferenceMediaUuid(input: {
  projectId: string;
  assetHash: string;
  mediaUuid: string;
  filename?: string;
}): Promise<void> {
  const { projectId, assetHash, mediaUuid, filename } = input;
  const db = await openDB();
  try {
    const old = await getEntry(db, projectId, assetHash);
    const ts = now();
    const entry: ReferenceMediaEntry = old
      ? {
          ...old,
          preferredUuid: mediaUuid,
          uuidCandidates: dedupeHead(
            [mediaUuid, ...(old.uuidCandidates ?? [])],
            MAX_UUID_CANDIDATES,
          ),
          filenameHints: dedupeHead(
            filename
              ? [filename, ...(old.filenameHints ?? [])]
              : (old.filenameHints ?? []),
            MAX_FILENAME_HINTS,
          ),
          updatedAt: ts,
          lastUsedAt: ts,
          hitCount: (old.hitCount ?? 0) + 1,
        }
      : {
          id: makeId(projectId, assetHash),
          projectId,
          assetHash,
          preferredUuid: mediaUuid,
          uuidCandidates: [mediaUuid],
          filenameHints: filename ? [filename] : [],
          createdAt: ts,
          updatedAt: ts,
          lastUsedAt: ts,
          hitCount: 1,
        };

    await putEntry(db, entry);
  } finally {
    db.close();
  }

  // Best-effort cleanup with throttling.
  void cleanupReferenceMediaStore(false).catch(() => {});
}
