import { describe, expect, it } from "vitest";
import {
  createIdGenerator,
  createSpace,
  createStack,
  deleteSpace,
  deleteStack,
  emptyWorkspaceState,
  getActiveSpace,
  moveSavedTab,
  moveStack,
  normalizeUrl,
  renameSpace,
  renameStack,
  saveOpenTabToStack,
  saveOpenWindowAsStack
} from "./workspaceStore";

const clock = () => 1_776_496_200_000;

describe("workspace store", () => {
  it("creates spaces and stacks immutably", () => {
    const initial = emptyWorkspaceState();
    const withSpace = createSpace(initial, "研究", clock, () => "space-1");
    const withStack = createStack(withSpace, "space-1", "资料", clock, () => "stack-1");

    expect(initial.spaces).toEqual({});
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
    expect(deleted).toEqual({ spaces: {}, stacks: {}, tabs: {}, activeSpaceId: undefined });
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

  it("normalizes browser and fallback URLs", () => {
    expect(normalizeUrl("https://example.com/path/#intro")).toBe("https://example.com/path");
    expect(normalizeUrl(" NOT A URL/#Hash/ ")).toBe("not a url");
  });

  it("removes common tracking query parameters while preserving content parameters", () => {
    expect(normalizeUrl("https://t.bilibili.com/?spm_id_from=333.1007.0.0")).toBe("https://t.bilibili.com");
    expect(normalizeUrl("https://t.bilibili.com/?tab=video&spm_id_from=333.1007.0.0")).toBe(
      "https://t.bilibili.com/?tab=video"
    );
    expect(normalizeUrl("https://example.com/read?utm_source=x&utm_medium=y&id=42&fbclid=abc")).toBe(
      "https://example.com/read?id=42"
    );
  });
});
