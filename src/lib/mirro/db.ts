import type { MediaRef, MirroState } from "./types";

const DB_NAME = "mirro-local";
const DB_VERSION = 1;
const META_STORE = "meta";
const MEDIA_STORE = "media";
const STATE_KEY = "state";

const EMPTY_STATE: MirroState = { profile: null, garments: [], optics: null };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento local."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no armazenamento local."));
  });
}

export async function loadState(): Promise<MirroState> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const result = await requestResult(tx.objectStore(META_STORE).get(STATE_KEY));
    const loaded = result as MirroState | undefined;
    return loaded
      ? {
          ...EMPTY_STATE,
          ...loaded,
          optics: loaded.optics ?? null,
        }
      : EMPTY_STATE;
  } finally {
    db.close();
  }
}

export async function saveState(state: MirroState): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(state, STATE_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao salvar dados."));
      tx.onabort = () => reject(tx.error ?? new Error("Salvamento cancelado."));
    });
  } finally {
    db.close();
  }
}

export async function saveMedia(file: Blob, ref: MediaRef): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(MEDIA_STORE, "readwrite");
    tx.objectStore(MEDIA_STORE).put(file, ref.key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao salvar imagem."));
      tx.onabort = () => reject(tx.error ?? new Error("Salvamento da imagem cancelado."));
    });
  } finally {
    db.close();
  }
}

export async function loadMedia(key: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(MEDIA_STORE, "readonly");
    const blob = await requestResult(tx.objectStore(MEDIA_STORE).get(key));
    return (blob as Blob | undefined) ?? null;
  } finally {
    db.close();
  }
}

export async function deleteMedia(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(MEDIA_STORE, "readwrite");
    for (const key of keys) tx.objectStore(MEDIA_STORE).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao remover imagem."));
      tx.onabort = () => reject(tx.error ?? new Error("Remoção cancelada."));
    });
  } finally {
    db.close();
  }
}
