import { normalizeSettings } from "./settings";
import type { TabManagerSettings, WorkspaceState } from "./types";
import { normalizeWorkspaceState } from "./workspaceStore";

export const LOCAL_STATE_FORMAT = "tabdock.local-state";
export const LOCAL_STATE_SCHEMA_VERSION = 1;

export type TabDockLocalStateV1 = {
  format: typeof LOCAL_STATE_FORMAT;
  schemaVersion: typeof LOCAL_STATE_SCHEMA_VERSION;
  updatedAt: number;
  workspace: WorkspaceState;
  settings: TabManagerSettings;
};

export type LocalStateParseResult =
  | { ok: true; state: TabDockLocalStateV1 }
  | { ok: false; error: string };

export const createLocalState = (
  workspace: WorkspaceState,
  settings: TabManagerSettings,
  clock: () => number
): TabDockLocalStateV1 => ({
  format: LOCAL_STATE_FORMAT,
  schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
  updatedAt: clock(),
  workspace: normalizeWorkspaceState(workspace),
  settings: normalizeSettings(settings)
});

export const serializeLocalState = (state: TabDockLocalStateV1): string => `${JSON.stringify(state, null, 2)}\n`;

export const parseImportedLocalState = (value: string | unknown): LocalStateParseResult => {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return { ok: false, error: "文件不是有效的 JSON。" };
    }
  }

  const state = normalizeLocalState(parsed);
  return state ? { ok: true, state } : { ok: false, error: "文件格式不是 TabDock 备份。" };
};

export const normalizeLocalState = (value: unknown): TabDockLocalStateV1 | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<TabDockLocalStateV1>;
  if (
    candidate.format !== LOCAL_STATE_FORMAT ||
    candidate.schemaVersion !== LOCAL_STATE_SCHEMA_VERSION ||
    typeof candidate.updatedAt !== "number" ||
    !isWorkspaceState(candidate.workspace) ||
    !candidate.settings ||
    typeof candidate.settings !== "object"
  ) {
    return undefined;
  }

  return {
    format: LOCAL_STATE_FORMAT,
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    updatedAt: candidate.updatedAt,
    workspace: normalizeWorkspaceState(candidate.workspace),
    settings: normalizeSettings(candidate.settings)
  };
};

export const isWorkspaceState = (value: unknown): value is WorkspaceState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceState>;
  return (
    Array.isArray(candidate.spaceIds) &&
    typeof candidate.spaces === "object" &&
    candidate.spaces !== null &&
    typeof candidate.stacks === "object" &&
    candidate.stacks !== null &&
    typeof candidate.tabs === "object" &&
    candidate.tabs !== null
  );
};
