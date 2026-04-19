import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SEARCH_SHORTCUT,
  defaultSettings,
  formatShortcutForPlatform,
  normalizeSettings,
  normalizeShortcut,
  shortcutFromEvent
} from "./settings";

describe("settings", () => {
  it("normalizes app shortcut settings with safe defaults", () => {
    expect(defaultSettings()).toEqual({ appSearchShortcut: DEFAULT_APP_SEARCH_SHORTCUT });
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings({ appSearchShortcut: "Command+Shift+k" })).toEqual({
      appSearchShortcut: "Command+Shift+K"
    });
    expect(normalizeSettings({ appSearchShortcut: "k" })).toEqual(defaultSettings());
  });

  it("normalizes supported shortcuts and rejects empty or modifier-free input", () => {
    expect(normalizeShortcut("⌘+k")).toBe("Command+K");
    expect(normalizeShortcut("Ctrl+K")).toBe("Ctrl+K");
    expect(normalizeShortcut("Mod + Shift + k")).toBe("Mod+Shift+K");
    expect(normalizeShortcut("")).toBeUndefined();
    expect(normalizeShortcut("K")).toBeUndefined();
    expect(normalizeShortcut("Command+Escape")).toBeUndefined();
  });

  it("formats shortcuts for display", () => {
    expect(formatShortcutForPlatform("Mod+K", true)).toBe("⌘K");
    expect(formatShortcutForPlatform("Mod+K", false)).toBe("Ctrl+K");
    expect(formatShortcutForPlatform("Command+Shift+K", true)).toBe("⌘⇧K");
    expect(formatShortcutForPlatform("Command+Shift+K", false)).toBe("Ctrl+Shift+K");
  });

  it("captures keyboard events as shortcuts", () => {
    expect(shortcutFromEvent({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: true, key: "k" } as KeyboardEvent)).toBe(
      "Command+Shift+K"
    );
    expect(shortcutFromEvent({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "k" } as KeyboardEvent)).toBeUndefined();
  });
});
