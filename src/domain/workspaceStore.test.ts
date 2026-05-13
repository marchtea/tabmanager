import { describe, expect, it } from "vitest";
import {
  createIdGenerator,
  createSpace,
  createStack,
  deleteSavedTabs,
  deleteSpace,
  deleteStack,
  emptyWorkspaceState,
  getActiveSpace,
  getOrderedSpaces,
  mergeWorkspaceStateChanges,
  moveSavedTab,
  moveSpace,
  moveStack,
  normalizeWorkspaceState,
  normalizeUrl,
  renameSpace,
  renameStack,
  saveOpenTabToStack,
  saveOpenWindowAsStack,
  updateSavedTab
} from "./workspaceStore";
import type { WorkspaceState } from "./types";

const clock = () => 1_776_496_200_000;

describe("workspace store", () => {
  it("creates spaces and stacks immutably", () => {
    const initial = emptyWorkspaceState();
    const withSpace = createSpace(initial, "研究", clock, () => "space-1");
    const withStack = createStack(withSpace, "space-1", "资料", clock, () => "stack-1");

    expect(initial.spaces).toEqual({});
    expect(withSpace.spaceIds).toEqual(["space-1"]);
    expect(withSpace.activeSpaceId).toBe("space-1");
    expect(withStack.spaces["space-1"].stackIds).toEqual(["stack-1"]);
    expect(withStack.stacks["stack-1"].name).toBe("资料");
  });

  it("renames and deletes spaces without mutating the prior state", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "旧名称", clock, () => "space-1");
    state = createStack(state, "space-1", "临时", clock, () => "stack-1");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      { id: 1, windowId: 1, title: "Temp", url: "https://temp.test" },
      0,
      clock,
      () => "tab-1"
    );

    const renamed = renameSpace(state, "space-1", "新名称", clock);
    const deleted = deleteSpace(renamed, "space-1");

    expect(state.spaces["space-1"].name).toBe("旧名称");
    expect(renamed.spaces["space-1"].name).toBe("新名称");
    expect(deleted).toEqual({ spaceIds: [], spaces: {}, stacks: {}, tabs: {}, activeSpaceId: undefined });
  });

  it("renames stacks and ignores missing ids", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "研究", clock, () => "space-1");
    state = createStack(state, "space-1", "旧栈", clock, () => "stack-1");

    const renamed = renameStack(state, "stack-1", "新栈", clock);
    const unchanged = renameStack(renamed, "missing", "不会创建", clock);

    expect(renamed.stacks["stack-1"].name).toBe("新栈");
    expect(unchanged).toBe(renamed);
  });

  it("uses default names and ignores invalid write targets", () => {
    const state = emptyWorkspaceState();
    const withSpace = createSpace(state, "   ", clock, () => "space-1");
    const withStack = createStack(withSpace, "space-1", "   ", clock, () => "stack-1");

    expect(withSpace.spaces["space-1"].name).toBe("未命名 Space");
    expect(withStack.stacks["stack-1"].name).toBe("未命名 Stack");
    expect(createStack(withStack, "missing", "Nope", clock, () => "stack-x")).toBe(withStack);
    expect(deleteSpace(withStack, "missing")).toBe(withStack);
    expect(deleteStack(withStack, "space-1", "missing", clock)).toBe(withStack);
    expect(moveSpace(withStack, "missing", 0, clock)).toBe(withStack);
    expect(moveStack(withStack, "space-1", "missing", 0, clock)).toBe(withStack);
    expect(
      saveOpenTabToStack(
        withStack,
        "space-1",
        "missing",
        { id: 1, windowId: 1, title: "", url: "https://missing.test" },
        0,
        clock,
        () => "tab-x"
      )
    ).toBe(withStack);
  });

  it("moves an existing URL within a space instead of creating duplicates", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "研究", clock, () => "space-1");
    state = createStack(state, "space-1", "待读", clock, () => "stack-1");
    state = createStack(state, "space-1", "已读", clock, () => "stack-2");

    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      {
        id: 7,
        windowId: 1,
        title: "Example",
        url: "https://example.com/path#intro",
        description: "A page"
      },
      0,
      clock,
      () => "tab-1"
    );

    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-2",
      {
        id: 8,
        windowId: 1,
        title: "Example updated",
        url: "https://example.com/path",
        description: "Fresh description"
      },
      0,
      clock,
      () => "tab-2"
    );

    expect(Object.keys(state.tabs)).toEqual(["tab-1"]);
    expect(state.stacks["stack-1"].tabIds).toEqual([]);
    expect(state.stacks["stack-2"].tabIds).toEqual(["tab-1"]);
    expect(state.tabs["tab-1"]).toMatchObject({
      title: "Example updated",
      description: "Fresh description",
      stackId: "stack-2"
    });
  });

  it("preserves manual stack and tab ordering", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "写作", clock, () => "space-1");
    state = createStack(state, "space-1", "A", clock, () => "stack-a");
    state = createStack(state, "space-1", "B", clock, () => "stack-b");
    state = moveStack(state, "space-1", "stack-b", 0, clock);

    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-a",
      { id: 1, windowId: 1, title: "One", url: "https://one.test" },
      0,
      clock,
      () => "tab-1"
    );
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-a",
      { id: 2, windowId: 1, title: "Two", url: "https://two.test" },
      1,
      clock,
      () => "tab-2"
    );
    state = moveSavedTab(state, "space-1", "tab-2", "stack-a", 0, clock);

    expect(state.spaces["space-1"].stackIds).toEqual(["stack-b", "stack-a"]);
    expect(state.stacks["stack-a"].tabIds).toEqual(["tab-2", "tab-1"]);
  });

  it("moves saved tabs across stacks and clamps target indexes", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "写作", clock, () => "space-1");
    state = createStack(state, "space-1", "A", clock, () => "stack-a");
    state = createStack(state, "space-1", "B", clock, () => "stack-b");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-a",
      { id: 1, windowId: 1, title: "", url: "https://one.test/" },
      99,
      clock,
      () => "tab-1"
    );

    const moved = moveSavedTab(state, "space-1", "tab-1", "stack-b", -5, clock);

    expect(moved.stacks["stack-a"].tabIds).toEqual([]);
    expect(moved.stacks["stack-b"].tabIds).toEqual(["tab-1"]);
    expect(moved.tabs["tab-1"].title).toBe("https://one.test/");
    expect(moveSavedTab(moved, "space-1", "missing", "stack-b", 0, clock)).toBe(moved);
  });

  it("creates a stack from a whole window and deduplicates within the space", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "窗口收纳", clock, () => "space-1");
    state = createStack(state, "space-1", "旧栈", clock, () => "stack-old");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-old",
      { id: 1, windowId: 1, title: "One", url: "https://one.test" },
      0,
      clock,
      () => "tab-existing"
    );

    state = saveOpenWindowAsStack(
      state,
      "space-1",
      "2026-04-18 15:30",
      [
        { id: 1, windowId: 9, title: "One moved", url: "https://one.test" },
        { id: 2, windowId: 9, title: "Two", url: "https://two.test" }
      ],
      clock,
      (() => {
        const ids = ["stack-new", "tab-new"];
        return () => ids.shift() ?? "fallback";
      })()
    );

    expect(state.spaces["space-1"].stackIds).toEqual(["stack-old", "stack-new"]);
    expect(state.stacks["stack-old"].tabIds).toEqual([]);
    expect(state.stacks["stack-new"].tabIds).toEqual(["tab-existing", "tab-new"]);
    expect(state.tabs["tab-existing"].title).toBe("One moved");
  });

  it("deletes a stack without touching unrelated stacks or real Chrome tabs", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "研究", clock, () => "space-1");
    state = createStack(state, "space-1", "临时", clock, () => "stack-1");
    state = createStack(state, "space-1", "保留", clock, () => "stack-2");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      { id: 1, windowId: 1, title: "Temp", url: "https://temp.test" },
      0,
      clock,
      () => "tab-1"
    );

    const next = deleteStack(state, "space-1", "stack-1", clock);

    expect(next.stacks["stack-1"]).toBeUndefined();
    expect(next.tabs["tab-1"]).toBeUndefined();
    expect(next.spaces["space-1"].stackIds).toEqual(["stack-2"]);
  });

  it("deletes selected saved tabs from one stack immutably", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "Workspace", clock, () => "space-1");
    state = createStack(state, "space-1", "Reading", clock, () => "stack-1");
    state = createStack(state, "space-1", "Archive", clock, () => "stack-2");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      { id: 1, windowId: 1, title: "React", url: "https://react.dev" },
      0,
      clock,
      () => "tab-1"
    );
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      { id: 2, windowId: 1, title: "Vite", url: "https://vite.dev" },
      1,
      clock,
      () => "tab-2"
    );
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-2",
      { id: 3, windowId: 1, title: "TS", url: "https://www.typescriptlang.org" },
      0,
      clock,
      () => "tab-3"
    );
    const before = state;

    const next = deleteSavedTabs(state, "space-1", "stack-1", ["tab-1", "missing"], clock);

    expect(next).not.toBe(before);
    expect(before.stacks["stack-1"].tabIds).toEqual(["tab-1", "tab-2"]);
    expect(next.stacks["stack-1"].tabIds).toEqual(["tab-2"]);
    expect(next.tabs["tab-1"]).toBeUndefined();
    expect(next.tabs["tab-2"]).toBeDefined();
    expect(next.stacks["stack-2"].tabIds).toEqual(["tab-3"]);
    expect(next.tabs["tab-3"]).toBeDefined();

    expect(deleteSavedTabs(next, "space-1", "stack-1", [], clock)).toBe(next);
    expect(deleteSavedTabs(next, "space-1", "stack-1", ["tab-3"], clock)).toBe(next);
    expect(deleteSavedTabs(next, "space-1", "missing", ["tab-2"], clock)).toBe(next);
    expect(deleteSavedTabs(next, "missing", "stack-1", ["tab-2"], clock)).toBe(next);
  });

  it("updates saved tab title and URL without creating duplicate URLs in a space", () => {
    let state = emptyWorkspaceState();
    state = createSpace(state, "Workspace", clock, () => "space-1");
    state = createStack(state, "space-1", "Reading", clock, () => "stack-1");
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      {
        id: 1,
        windowId: 1,
        title: "React",
        url: "https://react.dev",
        description: "React docs"
      },
      0,
      clock,
      () => "tab-1"
    );
    state = saveOpenTabToStack(
      state,
      "space-1",
      "stack-1",
      { id: 2, windowId: 1, title: "Vite", url: "https://vite.dev/" },
      1,
      clock,
      () => "tab-2"
    );

    const updated = updateSavedTab(
      state,
      "space-1",
      "tab-1",
      { title: "React Reference", url: "https://react.dev/reference" },
      () => 1_776_496_300_000
    );
    const duplicate = updateSavedTab(
      updated,
      "space-1",
      "tab-1",
      { title: "Duplicate", url: "https://vite.dev/#intro" },
      clock
    );

    expect(updated).not.toBe(state);
    expect(state.tabs["tab-1"].title).toBe("React");
    expect(updated.tabs["tab-1"]).toMatchObject({
      title: "React Reference",
      url: "https://react.dev/reference",
      description: "React docs",
      updatedAt: 1_776_496_300_000
    });
    expect(duplicate).toBe(updated);
    expect(updateSavedTab(updated, "space-1", "tab-1", { title: "No URL", url: "   " }, clock)).toBe(updated);
    expect(updateSavedTab(updated, "missing", "tab-1", { title: "Nope", url: "https://nope.test" }, clock)).toBe(updated);
    expect(updateSavedTab(updated, "space-1", "missing", { title: "Nope", url: "https://nope.test" }, clock)).toBe(updated);
  });

  it("returns the active space fallback and stable generated ids", () => {
    const generator = createIdGenerator("item");
    let state = emptyWorkspaceState();
    state = createSpace(state, "A", clock, () => "space-a");
    state = createSpace(state, "B", clock, () => "space-b");

    expect(getActiveSpace(state)?.id).toBe("space-b");
    expect(getActiveSpace({ ...state, activeSpaceId: "missing" })?.id).toBe("space-a");
    expect(generator()).toMatch(/^item-/);
    expect(generator()).not.toEqual(generator());
  });

  it("normalizes legacy workspaces and preserves explicit space ordering", () => {
    const legacyState = {
      spaces: {
        "space-a": { id: "space-a", name: "A", stackIds: [], createdAt: 1, updatedAt: 1 },
        "space-b": { id: "space-b", name: "B", stackIds: [], createdAt: 2, updatedAt: 2 },
        "space-c": { id: "space-c", name: "C", stackIds: [], createdAt: 3, updatedAt: 3 }
      },
      stacks: {},
      tabs: {},
      activeSpaceId: "space-b"
    } as unknown as WorkspaceState;

    const normalized = normalizeWorkspaceState({
      ...legacyState,
      spaceIds: ["space-c", "missing", "space-a"]
    });
    const moved = moveSpace(normalized, "space-a", 0, clock);

    expect(normalizeWorkspaceState(legacyState).spaceIds).toEqual(["space-a", "space-b", "space-c"]);
    expect(normalized.spaceIds).toEqual(["space-c", "space-a", "space-b"]);
    expect(moved.spaceIds).toEqual(["space-a", "space-c", "space-b"]);
    expect(getOrderedSpaces(moved).map((space) => space.name)).toEqual(["A", "C", "B"]);
    expect(normalized.spaceIds).toEqual(["space-c", "space-a", "space-b"]);
  });

  it("merges concurrent workspace additions from multiple TabDock pages", () => {
    const base = emptyWorkspaceState();
    const local = createSpace(base, "Local", () => 10, () => "space-local");
    const remote = createSpace(base, "Remote", () => 20, () => "space-remote");

    const merged = mergeWorkspaceStateChanges(base, local, remote);

    expect(merged.spaceIds).toEqual(["space-local", "space-remote"]);
    expect(merged.spaces["space-local"].name).toBe("Local");
    expect(merged.spaces["space-remote"].name).toBe("Remote");
    expect(merged.activeSpaceId).toBe("space-local");
  });

  it("merges concurrent stacks and tabs without dropping remote records", () => {
    let base = emptyWorkspaceState();
    base = createSpace(base, "Research", () => 1, () => "space-1");

    let local = createStack(base, "space-1", "Local Stack", () => 10, () => "stack-local");
    local = saveOpenTabToStack(
      local,
      "space-1",
      "stack-local",
      { id: 1, windowId: 1, title: "Local Tab", url: "https://local.test" },
      0,
      () => 11,
      () => "tab-local"
    );

    let remote = createStack(base, "space-1", "Remote Stack", () => 20, () => "stack-remote");
    remote = saveOpenTabToStack(
      remote,
      "space-1",
      "stack-remote",
      { id: 2, windowId: 1, title: "Remote Tab", url: "https://remote.test" },
      0,
      () => 21,
      () => "tab-remote"
    );

    const merged = mergeWorkspaceStateChanges(base, local, remote);

    expect(merged.spaces["space-1"].stackIds).toEqual(["stack-local", "stack-remote"]);
    expect(merged.stacks["stack-local"].tabIds).toEqual(["tab-local"]);
    expect(merged.stacks["stack-remote"].tabIds).toEqual(["tab-remote"]);
    expect(merged.tabs["tab-local"].title).toBe("Local Tab");
    expect(merged.tabs["tab-remote"].title).toBe("Remote Tab");
  });

  it("normalizes browser and fallback URLs", () => {
    expect(normalizeUrl("https://example.com/path/#intro")).toBe("https://example.com/path");
    expect(normalizeUrl(" NOT A URL/#Hash/ ")).toBe("not a url");
  });

  it("removes common tracking query parameters while preserving content parameters", () => {
    expect(normalizeUrl("https://t.bilibili.com/?spm_id_from=333.1007.0.0")).toBe("https://t.bilibili.com");
    expect(normalizeUrl("https://t.bilibili.com/?tab=video&spm_id_from=333.1007.0.0")).toBe(
      "https://t.bilibili.com/?tab=video"
    );
    expect(normalizeUrl("https://example.com/read?utm_source=x&utm_medium=y&id=42&fbclid=abc&_gl=ga")).toBe(
      "https://example.com/read?id=42"
    );
    expect(normalizeUrl("https://www.bilibili.com/video/BV1xx?vd_source=abc&from_spmid=main&p=2")).toBe(
      "https://www.bilibili.com/video/BV1xx?p=2"
    );
    expect(normalizeUrl("https://youtu.be/abc123?si=share&feature=shared&t=30")).toBe(
      "https://youtu.be/abc123?t=30"
    );
    expect(normalizeUrl("https://example.com/read?si=content&s=search&t=topic")).toBe(
      "https://example.com/read?si=content&s=search&t=topic"
    );
  });
});
