import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings";
import type { WorkspaceState } from "./types";
import {
  createLocalState,
  normalizeLocalState,
  parseImportedLocalState,
  serializeLocalState
} from "./persistence";

const workspace: WorkspaceState = {
  spaceIds: ["space-1"],
  activeSpaceId: "space-1",
  spaces: {
    "space-1": {
      id: "space-1",
      name: "Research",
      stackIds: ["stack-1"],
      createdAt: 1,
      updatedAt: 1
    }
  },
  stacks: {
    "stack-1": {
      id: "stack-1",
      spaceId: "space-1",
      name: "Docs",
      tabIds: ["tab-1"],
      createdAt: 1,
      updatedAt: 1
    }
  },
  tabs: {
    "tab-1": {
      id: "tab-1",
      spaceId: "space-1",
      stackId: "stack-1",
      title: "Example",
      url: "https://example.test",
      source: "manual",
      createdAt: 1,
      updatedAt: 1
    }
  }
};

describe("local persistence envelope", () => {
  it("creates, serializes, and parses a versioned local state", () => {
    const state = createLocalState(workspace, { appSearchShortcut: "Ctrl+K" }, () => 123);
    const serialized = serializeLocalState(state);
    const parsed = parseImportedLocalState(serialized);

    expect(state).toEqual({
      format: "tabdock.local-state",
      schemaVersion: 1,
      updatedAt: 123,
      workspace,
      settings: { appSearchShortcut: "Ctrl+K" }
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.state : undefined).toEqual(state);
  });

  it("normalizes settings and workspace ordering when importing", () => {
    const parsed = parseImportedLocalState({
      format: "tabdock.local-state",
      schemaVersion: 1,
      updatedAt: 456,
      workspace: {
        spaceIds: [],
        activeSpaceId: "space-1",
        spaces: workspace.spaces,
        stacks: workspace.stacks,
        tabs: workspace.tabs
      },
      settings: { appSearchShortcut: "bad" }
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.state.workspace.spaceIds : []).toEqual(["space-1"]);
    expect(parsed.ok ? parsed.state.settings : undefined).toEqual(defaultSettings());
  });

  it("rejects invalid import payloads without producing state", () => {
    expect(parseImportedLocalState("{bad json").ok).toBe(false);
    expect(normalizeLocalState({ format: "wrong" })).toBeUndefined();
    expect(
      normalizeLocalState({
        format: "tabdock.local-state",
        schemaVersion: 1,
        updatedAt: 1,
        workspace,
        settings: undefined
      })
    ).toBeUndefined();
  });
});
