export type BackupDirectoryStatus =
  | "unsupported"
  | "not-configured"
  | "authorized"
  | "permission-needed"
  | "failed";

export type BackupHandleStore = {
  get: () => Promise<FileSystemDirectoryHandle | undefined>;
  set: (handle: FileSystemDirectoryHandle) => Promise<void>;
};

export type BackupDirectoryReadResult =
  | { ok: true; content: string }
  | { ok: false; status: BackupDirectoryStatus; error?: string };

type FileSystemPermissionDescriptor = { mode: "readwrite" };

type PermissionAwareDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: FileSystemPermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor: FileSystemPermissionDescriptor) => Promise<PermissionState>;
};

type DirectoryPicker = (options: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle>;

const BACKUP_DATABASE_NAME = "tabdock-backup";
const BACKUP_DATABASE_VERSION = 1;
const BACKUP_STORE_NAME = "handles";
const BACKUP_DIRECTORY_KEY = "backup-directory";
const BACKUP_FILE_NAME = "latest.json";
const readWriteDescriptor: FileSystemPermissionDescriptor = { mode: "readwrite" };

let runtimeBackupDirectoryHandle: FileSystemDirectoryHandle | undefined;

export const authorizeBackupDirectory = async ({
  isSupported = isFileSystemAccessSupported(),
  showDirectoryPicker = getDirectoryPicker(),
  store = createIndexedDbBackupHandleStore()
}: {
  isSupported?: boolean;
  showDirectoryPicker?: DirectoryPicker;
  store?: BackupHandleStore;
} = {}): Promise<BackupDirectoryStatus> => {
  if (!isSupported || !showDirectoryPicker) {
    return "unsupported";
  }

  try {
    const handle = await showDirectoryPicker({ mode: "readwrite" });
    runtimeBackupDirectoryHandle = handle;
    try {
      await store.set(handle);
    } catch {
      // Some test doubles and older browser implementations may not structured-clone
      // handles; the current session can still use the selected handle.
    }
    return "authorized";
  } catch (error) {
    return isAbortError(error) ? "not-configured" : "failed";
  }
};

export const getBackupDirectoryStatus = async ({
  isSupported = isFileSystemAccessSupported(),
  store = createIndexedDbBackupHandleStore()
}: {
  isSupported?: boolean;
  store?: BackupHandleStore;
} = {}): Promise<BackupDirectoryStatus> => {
  if (!isSupported) {
    return "unsupported";
  }

  const handle = await getBackupDirectoryHandle(store);
  if (!handle) {
    return "not-configured";
  }

  return getHandlePermissionStatus(handle);
};

export const writeLatestBackup = async (
  content: string,
  {
    store = createIndexedDbBackupHandleStore()
  }: {
    store?: BackupHandleStore;
  } = {}
): Promise<BackupDirectoryStatus> => {
  const handle = await getBackupDirectoryHandle(store);
  if (!handle) {
    return "not-configured";
  }

  const status = await getHandlePermissionStatus(handle);
  if (status !== "authorized") {
    return status;
  }

  try {
    const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return "authorized";
  } catch {
    return "failed";
  }
};

export const readLatestBackup = async ({
  store = createIndexedDbBackupHandleStore()
}: {
  store?: BackupHandleStore;
} = {}): Promise<BackupDirectoryReadResult> => {
  const handle = await getBackupDirectoryHandle(store);
  if (!handle) {
    return { ok: false, status: "not-configured" };
  }

  const status = await getHandlePermissionStatus(handle);
  if (status !== "authorized") {
    return { ok: false, status };
  }

  try {
    const fileHandle = await handle.getFileHandle(BACKUP_FILE_NAME);
    const file = await fileHandle.getFile();
    return { ok: true, content: await file.text() };
  } catch {
    return { ok: false, status: "failed", error: "无法读取 latest.json。" };
  }
};

export const createIndexedDbBackupHandleStore = (
  databaseFactory: IDBFactory | undefined = globalThis.indexedDB
): BackupHandleStore => ({
  async get() {
    if (!databaseFactory) {
      return undefined;
    }
    const database = await openBackupDatabase(databaseFactory);
    return new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const transaction = database.transaction(BACKUP_STORE_NAME, "readonly");
      const request = transaction.objectStore(BACKUP_STORE_NAME).get(BACKUP_DIRECTORY_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
    });
  },
  async set(handle) {
    if (!databaseFactory) {
      runtimeBackupDirectoryHandle = handle;
      return;
    }
    const database = await openBackupDatabase(databaseFactory);
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(BACKUP_STORE_NAME, "readwrite");
      const request = transaction.objectStore(BACKUP_STORE_NAME).put(handle, BACKUP_DIRECTORY_KEY);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    });
  }
});

const getBackupDirectoryHandle = async (
  store: BackupHandleStore
): Promise<FileSystemDirectoryHandle | undefined> => {
  try {
    const storedHandle = await store.get();
    runtimeBackupDirectoryHandle = storedHandle ?? runtimeBackupDirectoryHandle;
    return storedHandle ?? runtimeBackupDirectoryHandle;
  } catch {
    return runtimeBackupDirectoryHandle;
  }
};

const getHandlePermissionStatus = async (
  handle: FileSystemDirectoryHandle
): Promise<BackupDirectoryStatus> => {
  const permissionAwareHandle = handle as PermissionAwareDirectoryHandle;
  if (!permissionAwareHandle.queryPermission) {
    return "authorized";
  }

  try {
    const permission = await permissionAwareHandle.queryPermission(readWriteDescriptor);
    return permission === "granted" ? "authorized" : "permission-needed";
  } catch {
    return "failed";
  }
};

const isFileSystemAccessSupported = (): boolean =>
  typeof window !== "undefined" && typeof getDirectoryPicker() === "function";

const getDirectoryPicker = (): DirectoryPicker | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
};

const openBackupDatabase = (databaseFactory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = databaseFactory.open(BACKUP_DATABASE_NAME, BACKUP_DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        database.createObjectStore(BACKUP_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === "AbortError" : false;
