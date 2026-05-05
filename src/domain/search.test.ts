import { describe, expect, it } from "vitest";
import { createSpace, createStack, emptyWorkspaceState, saveOpenTabToStack } from "./workspaceStore";
import { buildSearchGroups, emptySearchGroups, filterRecentHistory } from "./search";
import type { HistoryEntry, OpenTabBlock } from "./types";

const now = Date.UTC(2026, 3, 18, 8, 0, 0);
const clock = () => now;

describe("search", () => {
  it("groups matches across saved data, open tabs, and recent history", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "AI 研究", clock, () => "space-1");
    state = createStack(state, "space-1", "论文", clock, () => "stack-1");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      {
        id: 1,
        windowId: 1,
        title: "Agent Paper",
        url: "https://example.com/agent",
        description: "Multi agent workspace"
      },
      0,
      clock,
      () => "tab-1"
    );

    const openBlocks: OpenTabBlock[] = [
      {
        windowId: 2,
        label: "Window 1 · 1 tabs",
        tabs: [{ id: 9, windowId: 2, title: "Agent Console", url: "https://console.test" }]
      }
    ];
    const history: HistoryEntry[] = [
      { id: "h1", title: "Agent History", url: "https://history.test", lastVisitTime: now }
    ];

    const groups = buildSearchGroups("agent", state, openBlocks, history, now);

    expect(groups.spaces).toHaveLength(0);
    expect(groups.stacks).toHaveLength(0);
    expect(groups.savedTabs.map((item) => item.title)).toEqual(["Agent Paper"]);
    expect(groups.openTabs.map((item) => item.title)).toEqual(["Agent Console"]);
    expect(groups.history.map((item) => item.title)).toEqual(["Agent History"]);
  });

  it("matches space and stack names with Chinese queries", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "AI 研究", clock, () => "space-1");
    state = createStack(state, "space-1", "论文", clock, () => "stack-1");

    const groups = buildSearchGroups("论文", state, [], [], now);

    expect(groups.spaces).toHaveLength(0);
    expect(groups.stacks).toMatchObject([{ title: "论文", spaceId: "space-1" }]);
  });

  it("matches every space-delimited query term across searchable fields", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "Frontend Work", clock, () => "space-1");
    state = createStack(state, "space-1", "Reading", clock, () => "stack-1");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      {
        id: 1,
        windowId: 1,
        title: "React Patterns",
        url: "https://example.com/react",
        description: "Vite app notes"
      },
      0,
      clock,
      () => "tab-1"
    );

    const groups = buildSearchGroups("react vite", state, [], [], now);

    expect(groups.savedTabs.map((item) => item.title)).toEqual(["React Patterns"]);
    expect(buildSearchGroups("react missing", state, [], [], now).savedTabs).toHaveLength(0);
  });

  it("returns empty groups for blank queries and falls back to URLs for missing titles", () => {
    const state = {
      spaceIds: [],
      spaces: {},
      stacks: {},
      tabs: {
        tab1: {
          id: "tab1",
          spaceId: "space-1",
          stackId: "stack-1",
          title: "Untitled",
          url: "https://untitled.test",
          source: "manual" as const,
          createdAt: now,
          updatedAt: now
        }
      }
    };

    expect(buildSearchGroups("   ", state, [], [], now)).toEqual(emptySearchGroups());
    const groups = buildSearchGroups(
      "fallback",
      state,
      [{ windowId: 1, label: "Window 1 · 1 tabs", tabs: [{ id: 1, windowId: 1, title: "", url: "https://fallback-open.test" }] }],
      [{ id: "h1", title: "", url: "https://fallback-history.test", lastVisitTime: now }],
      now
    );

    expect(groups.openTabs[0].subtitle).toBe("https://fallback-open.test");
    expect(groups.history[0].title).toBe("https://fallback-history.test");
  });

  it("deduplicates history results by cleaned URLs", () => {
    const state = emptyWorkspaceState();
    const history: HistoryEntry[] = [
      {
        id: "h1",
        title: "Bilibili Video",
        url: "https://www.bilibili.com/video/BV1xx?vd_source=abc&spm_id_from=333.1007.0.0",
        lastVisitTime: now
      },
      {
        id: "h2",
        title: "Bilibili Video",
        url: "https://www.bilibili.com/video/BV1xx?vd_source=def",
        lastVisitTime: now
      },
      {
        id: "h3",
        title: "Bilibili Video Page",
        url: "https://www.bilibili.com/video/BV1xx?p=2&vd_source=abc",
        lastVisitTime: now
      }
    ];

    const groups = buildSearchGroups("bilibili", state, [], history, now);

    expect(groups.history.map((item) => item.url)).toEqual([
      "https://www.bilibili.com/video/BV1xx",
      "https://www.bilibili.com/video/BV1xx?p=2"
    ]);
    expect(groups.history.map((item) => item.subtitle)).toEqual(groups.history.map((item) => item.url));
  });

  it("filters Chrome history to the latest 90 days", () => {
    const entries: HistoryEntry[] = [
      { id: "recent", title: "Recent", url: "https://recent.test", lastVisitTime: now - 89 * 24 * 60 * 60 * 1000 },
      { id: "old", title: "Old", url: "https://old.test", lastVisitTime: now - 91 * 24 * 60 * 60 * 1000 }
    ];

    expect(filterRecentHistory(entries, now).map((entry) => entry.id)).toEqual(["recent"]);
  });
});
