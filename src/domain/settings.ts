import type { TabManagerSettings } from "./types";

export const DEFAULT_APP_SEARCH_SHORTCUT = "Mod+K";
export const DEFAULT_GLOBAL_SEARCH_SHORTCUT = "Command+Shift+K";

export const defaultSettings = (): TabManagerSettings => ({
  appSearchShortcut: DEFAULT_APP_SEARCH_SHORTCUT
});

export const normalizeSettings = (value: unknown): TabManagerSettings => {
  if (!value || typeof value !== "object") {
    return defaultSettings();
  }
  const candidate = value as Partial<TabManagerSettings>;
  return {
    appSearchShortcut: normalizeShortcut(candidate.appSearchShortcut) ?? DEFAULT_APP_SEARCH_SHORTCUT
  };
};

export const normalizeShortcut = (shortcut: string | undefined): string | undefined => {
  const parts = shortcut
    ?.split("+")
    .map((part) => normalizeShortcutPart(part))
    .filter(Boolean) ?? [];
  const key = parts.find((part) => !isModifier(part));
  const modifiers = parts.filter(isModifier);

  if (!key || key.length !== 1 || modifiers.length === 0) {
    return undefined;
  }

  return [...dedupeModifiers(modifiers), key.toUpperCase()].join("+");
};

export const shortcutMatchesEvent = (shortcut: string, event: KeyboardEvent): boolean => {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) {
    return false;
  }

  const parts = normalized.split("+");
  const key = parts[parts.length - 1]?.toLowerCase();
  const wantsMod = parts.includes("Mod");
  const wantsCommand = parts.includes("Command");
  const wantsCtrl = parts.includes("Ctrl");
  const wantsAlt = parts.includes("Alt");
  const wantsShift = parts.includes("Shift");
  const modPressed = event.metaKey || event.ctrlKey;

  return (
    event.key.toLowerCase() === key &&
    (!wantsMod || modPressed) &&
    (!wantsCommand || event.metaKey) &&
    (!wantsCtrl || event.ctrlKey) &&
    event.altKey === wantsAlt &&
    event.shiftKey === wantsShift
  );
};

export const shortcutFromEvent = (event: KeyboardEvent): string | undefined => {
  const parts = [
    event.metaKey ? "Command" : "",
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.key.length === 1 ? event.key.toUpperCase() : ""
  ].filter(Boolean);
  return normalizeShortcut(parts.join("+"));
};

export const formatShortcutForPlatform = (shortcut: string, isMac: boolean): string => {
  const normalized = normalizeShortcut(shortcut) ?? DEFAULT_APP_SEARCH_SHORTCUT;
  const displayParts = normalized.split("+").map((part) => {
    if (part === "Mod") {
      return isMac ? "⌘" : "Ctrl";
    }
    if (part === "Command") {
      return isMac ? "⌘" : "Ctrl";
    }
    if (part === "Shift") {
      return isMac ? "⇧" : "Shift";
    }
    if (part === "Alt") {
      return isMac ? "⌥" : "Alt";
    }
    return part;
  });
  return displayParts.join(isMac ? "" : "+");
};

const normalizeShortcutPart = (part: string): string => {
  const trimmed = part.trim().toLowerCase();
  if (["cmd", "command", "meta", "⌘"].includes(trimmed)) {
    return "Command";
  }
  if (["ctrl", "control", "^"].includes(trimmed)) {
    return "Ctrl";
  }
  if (["mod"].includes(trimmed)) {
    return "Mod";
  }
  if (["shift", "⇧"].includes(trimmed)) {
    return "Shift";
  }
  if (["alt", "option", "⌥"].includes(trimmed)) {
    return "Alt";
  }
  return trimmed.length === 1 ? trimmed.toUpperCase() : "";
};

const isModifier = (part: string): boolean => ["Alt", "Command", "Ctrl", "Mod", "Shift"].includes(part);

const dedupeModifiers = (modifiers: string[]): string[] =>
  ["Mod", "Command", "Ctrl", "Alt", "Shift"].filter((modifier) => modifiers.includes(modifier));
