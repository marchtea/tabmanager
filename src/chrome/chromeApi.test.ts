import { describe, expect, it, vi } from "vitest";
import {
  focusOrCreateTab,
  getChrome,
  getMetaDescription,
  loadWorkspace,
  groupOpenTabs,
  isTabManagerUrl,
  saveWorkspace,
  searchRecentHistory
} from "./chromeApi";
import type { ChromeLike } from "./chromeTypes";

describe("chrome api adapter", () => {
  it("groups open tabs by window and excludes the Tab Manager page itself", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, windowId: 10, title: "Manager", url: "chrome-extension://abc/index.html" },
          { id: 2, windowId: 10, title: "Docs", url: "https://docs.test", favIconUrl: "https://docs.test/icon.png" },
          { id: 3, windowId: 11, title: "Mail", url: "https://mail.test" }
        ])
      },
      runtime: { id: "abc" }
    } satisfies ChromeLike;

    const blocks = await groupOpenTabs(chrome);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ windowId: 10, label: "Window 1 · 1 tabs" });
    expect(blocks[0].tabs[0]).toMatchObject({ id: 2, title: "Docs", faviconUrl: "https://docs.test/icon.png" });
  });

  it("handles missing or partial Chrome tab APIs", async () => {
    await expect(groupOpenTabs({})).resolves.toEqual([]);
    await expect(
      groupOpenTabs({
        tabs: {
          query: vi.fn().mockResolvedValue([{ id: 1, windowId: 1 }, { windowId: 1, url: "https://missing-id.test" }])
        }
      })
    ).resolves.toEqual([]);
  });

  it("focuses an existing open tab for the same URL before creating a new tab", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 4, windowId: 12, url: "https://example.com/path#section" }]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      },
      windows: {
        update: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrCreateTab(chrome, "https://example.com/path");

    expect(chrome.windows.update).toHaveBeenCalledWith(12, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("creates a new tab when no open tab has the URL", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrCreateTab(chrome, "https://new.test");

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: "https://new.test" });
  });

  it("activates a tab even when window focusing is unavailable", async () => {
    const chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 4, url: "https://example.com/path" }]),
        update: vi.fn().mockResolvedValue({})
      }
    } satisfies ChromeLike;

    await focusOrCreateTab(chrome, "https://example.com/path");

    expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
  });

  it("returns undefined when meta description injection fails", async () => {
    const chrome = {
      scripting: {
        executeScript: vi.fn().mockRejectedValue(new Error("Cannot access page"))
      }
    } satisfies ChromeLike;

    await expect(getMetaDescription(chrome, 99)).resolves.toBeUndefined();
  });

  it("reads meta description when injection succeeds", async () => {
    const chrome = {
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: "  Useful summary  " }])
      }
    } satisfies ChromeLike;

    await expect(getMetaDescription(chrome, 99)).resolves.toBe("Useful summary");
  });

  it("returns undefined when meta description is empty or scripting is unavailable", async () => {
    await expect(getMetaDescription({}, 1)).resolves.toBeUndefined();
    await expect(
      getMetaDescription(
        { scripting: { executeScript: vi.fn().mockResolvedValue([{ result: "   " }]) } },
        1
      )
    ).resolves.toBeUndefined();
  });

  it("searches recent history through Chrome", async () => {
    const now = Date.UTC(2026, 3, 18);
    const chrome = {
      history: {
        search: vi.fn().mockResolvedValue([
          { id: "h1", title: "Docs", url: "https://docs.test", lastVisitTime: now }
        ])
      }
    } satisfies ChromeLike;

    const result = await searchRecentHistory(chrome, "docs", now, 10);

    expect(chrome.history.search).toHaveBeenCalledWith({
      text: "docs",
      startTime: now - 90 * 24 * 60 * 60 * 1000,
      maxResults: 10
    });
    expect(result).toEqual([
      { id: "h1", title: "Docs", url: "https://docs.test", lastVisitTime: now }
    ]);
  });

  it("handles missing and incomplete history records", async () => {
    const chrome = {
      history: {
        search: vi.fn().mockResolvedValue([
          { id: "skip", title: "Skip" },
          { url: "https://fallback.test" }
        ])
      }
    } satisfies ChromeLike;

    await expect(searchRecentHistory(chrome, "", 1000)).resolves.toEqual([
      {
        id: "https://fallback.test",
        title: "https://fallback.test",
        url: "https://fallback.test",
        lastVisitTime: 0
      }
    ]);
    await expect(searchRecentHistory({}, "", 1000)).resolves.toEqual([]);
  });

  it("loads and saves workspace state with local storage fallback", async () => {
    const state = { spaces: {}, stacks: {}, tabs: {}, activeSpaceId: undefined };
    const chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ tabManagerWorkspace: state }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      }
    } satisfies ChromeLike;

    await expect(loadWorkspace(chrome)).resolves.toBe(state);
    await saveWorkspace(chrome, state);
    await expect(loadWorkspace(undefined)).resolves.toEqual({ spaces: {}, stacks: {}, tabs: {} });
    await expect(loadWorkspace({ storage: { local: { get: vi.fn().mockResolvedValue({ tabManagerWorkspace: null }) } } })).resolves.toEqual({
      spaces: {},
      stacks: {},
      tabs: {}
    });
    await expect(saveWorkspace(undefined, state)).resolves.toBeUndefined();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ tabManagerWorkspace: state });
  });

  it("identifies the extension newtab page", () => {
    expect(isTabManagerUrl("chrome-extension://abc/index.html", "abc")).toBe(true);
    expect(isTabManagerUrl("https://example.test", "abc")).toBe(false);
    expect(isTabManagerUrl(undefined, "abc")).toBe(false);
    expect(isTabManagerUrl("chrome-extension://abc/index.html", undefined)).toBe(false);
  });

  it("detects the runtime Chrome object when present", () => {
    expect(getChrome()).toBeUndefined();
    vi.stubGlobal("chrome", { runtime: { id: "abc" } });
    expect(getChrome()).toBeUndefined();
    vi.stubGlobal("chrome", { runtime: { id: "abc" }, storage: { local: {} } });
    expect(getChrome()).toEqual({ runtime: { id: "abc" }, storage: { local: {} } });
    vi.unstubAllGlobals();
  });
});
