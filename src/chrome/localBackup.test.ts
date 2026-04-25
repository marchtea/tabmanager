import { describe, expect, it, vi } from "vitest";
import {
  authorizeBackupDirectory,
  getBackupDirectoryStatus,
  readLatestBackup,
  writeLatestBackup
} from "./localBackup";

const createMemoryStore = () => {
  let handle: FileSystemDirectoryHandle | undefined;
  return {
    get: vi.fn(async () => handle),
    set: vi.fn(async (nextHandle: FileSystemDirectoryHandle) => {
      handle = nextHandle;
    })
  };
};

const createDirectoryHandle = (permission: PermissionState = "granted") => {
  const writes: string[] = [];
  const queryPermission = vi.fn(async () => permission);
  const requestPermission = vi.fn(async () => permission);
  const write = vi.fn(async (content: string) => {
    writes.push(content);
  });
  const close = vi.fn(async () => undefined);
  const getFile = vi.fn(async () => ({ text: async () => "from backup" }));
  const createWritable = vi.fn(async () => ({ write, close }));
  const getFileHandle = vi.fn(async () => ({ createWritable, getFile }));
  const handle = {
    kind: "directory",
    name: "TabDock Backup",
    queryPermission,
    requestPermission,
    getFileHandle
  } as unknown as FileSystemDirectoryHandle;

  return { close, createWritable, getFile, getFileHandle, handle, queryPermission, requestPermission, write, writes };
};

describe("local backup directory adapter", () => {
  it("reports unsupported when directory picker APIs are unavailable", async () => {
    await expect(getBackupDirectoryStatus({ isSupported: false })).resolves.toBe("unsupported");
  });

  it("authorizes and stores a picked directory handle", async () => {
    const store = createMemoryStore();
    const directory = createDirectoryHandle();
    const showDirectoryPicker = vi.fn(async () => directory.handle);

    await expect(authorizeBackupDirectory({ isSupported: true, showDirectoryPicker, store })).resolves.toBe("authorized");

    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(store.set).toHaveBeenCalledWith(directory.handle);
  });

  it("writes latest.json when permission is granted", async () => {
    const store = createMemoryStore();
    const directory = createDirectoryHandle();
    await store.set(directory.handle);

    await expect(writeLatestBackup("backup-content", { store })).resolves.toBe("authorized");

    expect(directory.getFileHandle).toHaveBeenCalledWith("latest.json", { create: true });
    expect(directory.write).toHaveBeenCalledWith("backup-content");
    expect(directory.close).toHaveBeenCalled();
    expect(directory.writes).toEqual(["backup-content"]);
  });

  it("does not write when permission needs to be granted again", async () => {
    const store = createMemoryStore();
    const directory = createDirectoryHandle("prompt");
    await store.set(directory.handle);

    await expect(writeLatestBackup("backup-content", { store })).resolves.toBe("permission-needed");

    expect(directory.getFileHandle).not.toHaveBeenCalled();
  });

  it("reads latest.json from the authorized directory", async () => {
    const store = createMemoryStore();
    const directory = createDirectoryHandle();
    await store.set(directory.handle);

    await expect(readLatestBackup({ store })).resolves.toEqual({ ok: true, content: "from backup" });
    expect(directory.getFileHandle).toHaveBeenCalledWith("latest.json");
  });
});
