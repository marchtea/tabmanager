import { expect, test } from "@playwright/test";

test.describe("Tab Manager newtab MVP", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();
  });

  test("renders the three-column shell and searches open tabs", async ({ page }) => {
    await expect(page.getByTestId("sidebar")).toContainText("Tab Manager");
    await expect(page.getByTestId("workspace")).toContainText("创建第一个 Space");
    await expect(page.getByTestId("open-tabs-panel")).toContainText("React");
    await expect(page.getByTestId("space-section-label")).toHaveText("Spaces");

    await expect.poll(async () =>
      page.getByTestId("sidebar").evaluate((element) => {
        const controls = element.querySelector(".sidebar-controls");
        const settings = element.querySelector("[data-testid='settings-entry']");
        const label = element.querySelector("[data-testid='space-section-label']");

        return {
          controlsDivider: controls ? window.getComputedStyle(controls).borderBottomWidth : "",
          settingsMinHeight: settings ? window.getComputedStyle(settings).minHeight : "",
          labelSize: label ? window.getComputedStyle(label).fontSize : ""
        };
      })
    ).toEqual({
      controlsDivider: "1px",
      settingsMinHeight: "42px",
      labelSize: "12px"
    });

    await page.getByTestId("search-entry").click();
    await expect(page.getByTestId("search-modal")).toBeVisible();
    await page.getByRole("textbox", { name: "搜索 spaces、stacks、tabs、history" }).fill("React");

    await expect(page.getByTestId("search-result")).toContainText("React");
    await expect(page.getByTestId("search-result")).toContainText(
      "The library for web and native user interfaces"
    );

    await expect(page.getByRole("textbox", { name: "搜索 spaces、stacks、tabs、history" })).toHaveCSS(
      "font-size",
      "18px"
    );
  });

  test("collapses and expands an open window block from its title", async ({ page }) => {
    const title = page.getByTestId("open-block-title").filter({ hasText: "Window 1" });
    const block = page.getByTestId("open-block").filter({ has: title });

    await expect(block.getByTestId("open-tab")).toHaveCount(3);
    await expect(title).toHaveAttribute("aria-expanded", "true");

    await title.click();

    await expect(title).toHaveAttribute("aria-expanded", "false");
    await expect(block.getByTestId("open-tab")).toHaveCount(0);

    await title.click();

    await expect(title).toHaveAttribute("aria-expanded", "true");
    await expect(block.getByTestId("open-tab")).toHaveCount(3);
  });

  test("creates a space and stack, then saves an open tab by drag and drop", async ({ page }) => {
    await acceptNextDialog(page, "Research");
    await page.getByTestId("add-space").click();
    await expect(page.getByTestId("workspace")).toContainText("Research");

    await acceptNextDialog(page, "Reading");
    await page.getByTestId("add-stack").click();

    const stack = page.getByTestId("stack-column").filter({ hasText: "Reading" });
    await expect(stack).toBeVisible();

    await page.getByTestId("open-tab").filter({ hasText: "React" }).dragTo(stack);

    await expect(stack.getByTestId("saved-tab")).toContainText("React");
    await expect(stack.getByTestId("saved-tab")).toContainText(
      "The library for web and native user interfaces"
    );
  });

  test("creates a stack from a whole open window block", async ({ page }) => {
    await acceptNextDialog(page, "Window Research");
    await page.getByTestId("add-space").click();

    await acceptNextDialog(page, "Imported Window");
    await page.getByTestId("open-block-title").dragTo(page.getByTestId("workspace"));

    const stack = page.getByTestId("stack-column").filter({ hasText: "Imported Window" });
    await expect(stack).toBeVisible();
    await expect(stack.getByTestId("saved-tab")).toHaveCount(3);
    await expect(stack).toContainText("Chrome Extension Manifest V3");
    await expect(stack).toContainText("React");
    await expect(stack).toContainText("Vite");
  });

  test("moves an existing URL instead of duplicating it inside a space", async ({ page }) => {
    await createSpace(page, "Dedup Research");
    await createStack(page, "Reading");
    await createStack(page, "Done");

    const reading = stackByName(page, "Reading");
    const done = stackByName(page, "Done");
    const reactOpenTab = page.getByTestId("open-tab").filter({ hasText: "React" });

    await reactOpenTab.dragTo(reading);
    await expect(reading.getByTestId("saved-tab")).toHaveCount(1);

    await reactOpenTab.dragTo(done);

    await expect(reading.getByTestId("saved-tab")).toHaveCount(0);
    await expect(done.getByTestId("saved-tab")).toHaveCount(1);
    await expect(done.getByTestId("saved-tab")).toContainText("React");
  });

  test("moves a saved tab between stacks", async ({ page }) => {
    await createSpace(page, "Move Research");
    await createStack(page, "Inbox");
    await createStack(page, "Archive");

    const inbox = stackByName(page, "Inbox");
    const archive = stackByName(page, "Archive");

    await page.getByTestId("open-tab").filter({ hasText: "Vite" }).dragTo(inbox);
    await expect(inbox.getByTestId("saved-tab")).toContainText("Vite");

    await inbox.getByTestId("saved-tab").filter({ hasText: "Vite" }).dragTo(archive);

    await expect(inbox.getByTestId("saved-tab")).toHaveCount(0);
    await expect(archive.getByTestId("saved-tab")).toContainText("Vite");
  });

  test("renames and deletes stacks and spaces with confirmation", async ({ page }) => {
    await createSpace(page, "Ops");
    await renameSpace(page, "Ops", "Ops Renamed");
    await expect(page.getByTestId("workspace")).toContainText("Ops Renamed");

    await createStack(page, "Temporary");
    await renameStack(page, "Temporary", "Resources");
    await expect(stackByName(page, "Resources")).toBeVisible();

    await confirmNextDialog(page, true);
    await stackByName(page, "Resources").getByTestId("delete-stack").click();
    await expect(stackByName(page, "Resources")).toHaveCount(0);

    await confirmNextDialog(page, true);
    await spaceByName(page, "Ops Renamed").getByTestId("delete-space").click();
    await expect(page.getByTestId("workspace")).toContainText("创建第一个 Space");
  });

  test("deletes selected saved tabs from a stack", async ({ page }) => {
    await createSpace(page, "Bulk Delete");
    await createStack(page, "Reading");

    const stack = stackByName(page, "Reading");
    await page.getByTestId("open-tab").filter({ hasText: "Chrome Extension Manifest V3" }).dragTo(stack);
    await page.getByTestId("open-tab").filter({ hasText: "React" }).dragTo(stack);
    await page.getByTestId("open-tab").filter({ hasText: "Vite" }).dragTo(stack);
    await expect(stack.getByTestId("saved-tab")).toHaveCount(3);

    await stack.getByTestId("select-stack-tabs").click();

    const reactSavedTab = stack.getByTestId("saved-tab").filter({ hasText: "React" });
    const viteSavedTab = stack.getByTestId("saved-tab").filter({ hasText: "Vite" });
    await reactSavedTab.click();
    await viteSavedTab.click();

    await expect(reactSavedTab).toHaveAttribute("aria-pressed", "true");
    await expect(viteSavedTab).toHaveAttribute("aria-pressed", "true");

    await stack.getByTestId("delete-selected-tabs").click();

    await expect(stack.getByTestId("saved-tab").filter({ hasText: "React" })).toHaveCount(0);
    await expect(stack.getByTestId("saved-tab").filter({ hasText: "Vite" })).toHaveCount(0);
    await expect(stack.getByTestId("saved-tab").filter({ hasText: "Chrome Extension Manifest V3" })).toHaveCount(1);
  });

  test("reorders stacks by dragging the stack header", async ({ page }) => {
    await createSpace(page, "Sort Research");
    await createStack(page, "Alpha");
    await createStack(page, "Beta");
    await createStack(page, "Gamma");

    await stackByName(page, "Beta").getByTestId("stack-header").dragTo(stackByName(page, "Alpha"));

    await expectStackOrder(page, ["Beta", "Alpha", "Gamma"]);
  });

  test("reorders spaces by dragging the space title", async ({ page }) => {
    await createSpace(page, "Alpha Space");
    await createSpace(page, "Beta Space");
    await createSpace(page, "Gamma Space");

    await spaceByName(page, "Gamma Space").getByTestId("space-title").dragTo(spaceByName(page, "Alpha Space"));

    await expectSpaceOrder(page, ["Gamma Space", "Alpha Space", "Beta Space"]);
  });

  test("renders active space title and stack categories as one integrated group", async ({ page }) => {
    await createSpace(page, "Unified Space");
    await createStack(page, "Category A");

    const group = spaceByName(page, "Unified Space");

    await expect.poll(async () =>
      group.evaluate((element) => {
        const groupStyle = window.getComputedStyle(element);
        const stackTree = element.querySelector(".stack-tree");
        const treeStyle = stackTree ? window.getComputedStyle(stackTree) : null;

        return {
          groupBorderTopWidth: groupStyle.borderTopWidth,
          groupBorderTopStyle: groupStyle.borderTopStyle,
          treeBorderTopWidth: treeStyle?.borderTopWidth ?? "",
          treeBorderTopStyle: treeStyle?.borderTopStyle ?? "",
          treePaddingLeft: treeStyle?.paddingLeft ?? ""
        };
      })
    ).toEqual({
      groupBorderTopWidth: "1px",
      groupBorderTopStyle: "solid",
      treeBorderTopWidth: "1px",
      treeBorderTopStyle: "solid",
      treePaddingLeft: "20px"
    });

    await expect.poll(async () =>
      page.getByTestId("workspace").evaluate((element) => {
        const heading = element.querySelector(".workspace-header h2");
        const summary = element.querySelector(".workspace-summary span");
        const stackHeading = element.querySelector(".stack-header h3");
        const addStack = element.querySelector("[data-testid='add-stack']");
        const summaryRect = summary?.getBoundingClientRect();
        const addStackRect = addStack?.getBoundingClientRect();

        return {
          workspaceTitleSize: heading ? window.getComputedStyle(heading).fontSize : "",
          summarySize: summary ? window.getComputedStyle(summary).fontSize : "",
          stackTitleSize: stackHeading ? window.getComputedStyle(stackHeading).fontSize : "",
          rightControlBottomDelta:
            summaryRect && addStackRect ? Math.abs(summaryRect.bottom - addStackRect.bottom) : null,
          rightControlCenterDelta:
            summaryRect && addStackRect
              ? Math.abs(
                  summaryRect.top + summaryRect.height / 2 - (addStackRect.top + addStackRect.height / 2)
                )
              : null
        };
      })
    ).toEqual({
      workspaceTitleSize: "28px",
      summarySize: "14px",
      stackTitleSize: "20px",
      rightControlBottomDelta: 0,
      rightControlCenterDelta: 1
    });
  });

  test("selects a stack search result with Enter", async ({ page }) => {
    await createSpace(page, "Keyboard Research");
    await createStack(page, "Keyboard Stack");

    await page.getByTestId("search-entry").click();
    await page.getByRole("textbox", { name: "搜索 spaces、stacks、tabs、history" }).fill("Keyboard Stack");
    await expect(page.getByTestId("search-result")).toContainText("Keyboard Stack");

    await page.keyboard.press("Enter");

    await expect(page.getByTestId("search-modal")).toHaveCount(0);
    await expect(page.getByTestId("workspace")).toContainText("Keyboard Research");
    await expect(stackByName(page, "Keyboard Stack")).toBeVisible();
  });

  test("keeps the app shell pinned when selecting a stack from the sidebar", async ({ page }) => {
    await createSpace(page, "Pinned Research");
    await createStack(page, "Primary Reading");
    await createStack(page, "Secondary Reading");

    const before = await page.getByTestId("tab-manager-shell").evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      scrollY: window.scrollY
    }));

    await page
      .getByRole("navigation", { name: "Spaces" })
      .getByRole("button", { name: "Secondary Reading", exact: true })
      .click();

    await expect.poll(async () =>
      page.getByTestId("tab-manager-shell").evaluate((element) => ({
        top: element.getBoundingClientRect().top,
        scrollY: window.scrollY
      }))
    ).toEqual(before);
  });

  test("renders open tabs in a floating, outer-scrolling, compact right panel", async ({ page }) => {
    const panel = page.getByTestId("open-tabs-panel");
    await expect(panel).toBeVisible();

    await expect.poll(async () =>
      panel.evaluate((element) => {
        const panelStyle = window.getComputedStyle(element);
        const blocks = element.querySelector(".open-blocks");
        const block = element.querySelector(".open-block");
        const tab = element.querySelector("[data-testid='open-tab']");

        return {
          panelPosition: panelStyle.position,
          blocksOverflowY: blocks ? window.getComputedStyle(blocks).overflowY : "",
          blockFlex: block ? window.getComputedStyle(block).flex : "",
          blockOverflowY: block ? window.getComputedStyle(block).overflowY : "",
          tabMinHeight: tab ? window.getComputedStyle(tab).minHeight : ""
        };
      })
    ).toEqual({
      panelPosition: "fixed",
      blocksOverflowY: "auto",
      blockFlex: "0 0 auto",
      blockOverflowY: "visible",
      tabMinHeight: "48px"
    });
  });

  test("collapses and expands the open tabs panel", async ({ page }) => {
    const workspace = page.getByTestId("workspace");
    const panel = page.getByTestId("open-tabs-panel");
    const expandedPadding = await workspace.evaluate((element) => window.getComputedStyle(element).paddingRight);

    await page.getByTestId("collapse-open-tabs").click();

    await expect(page.getByTestId("expand-open-tabs")).toBeVisible();
    await expect(panel).toHaveClass(/is-collapsed/);
    await expect.poll(async () => workspace.evaluate((element) => window.getComputedStyle(element).paddingRight)).not.toBe(expandedPadding);

    await page.getByTestId("expand-open-tabs").click();
    await expect(page.getByTestId("collapse-open-tabs")).toBeVisible();
    await expect(panel).not.toHaveClass(/is-collapsed/);
  });

  test("shows settings with app and global shortcuts", async ({ page }) => {
    await page.getByTestId("settings-entry").click();

    await expect(page.getByTestId("settings-modal")).toBeVisible();
    await expect(page.getByTestId("app-search-shortcut")).toHaveValue(/K/);
    await expect(page.getByLabel("全局搜索快捷键", { exact: true })).toHaveValue(/K/);

    await page.getByTestId("app-search-shortcut").press(process.platform === "darwin" ? "Meta+Shift+J" : "Control+Shift+J");
    await expect(page.getByTestId("app-search-shortcut")).toHaveValue(/J/);
  });

  test("keeps short stacks content-sized while long stacks scroll internally", async ({ page }) => {
    await page.addInitScript(() => {
      const tabIds = Array.from({ length: 12 }, (_, index) => `tab-${index}`);
      const overflowStackIds = Array.from({ length: 5 }, (_, index) => `stack-extra-${index}`);
      const now = Date.UTC(2026, 3, 20);
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({
                tabManagerWorkspace: {
                  spaceIds: ["space-1"],
                  activeSpaceId: "space-1",
                  spaces: {
                    "space-1": {
                      id: "space-1",
                      name: "Height Research",
                      stackIds: ["stack-short", "stack-long", ...overflowStackIds],
                      createdAt: now,
                      updatedAt: now
                    }
                  },
                  stacks: {
                    "stack-short": {
                      id: "stack-short",
                      spaceId: "space-1",
                      name: "Short",
                      tabIds: [],
                      createdAt: now,
                      updatedAt: now
                    },
                    "stack-long": {
                      id: "stack-long",
                      spaceId: "space-1",
                      name: "Long",
                      tabIds,
                      createdAt: now,
                      updatedAt: now
                    },
                    ...Object.fromEntries(
                      overflowStackIds.map((id, index) => [
                        id,
                        {
                          id,
                          spaceId: "space-1",
                          name: `Extra ${index}`,
                          tabIds: [],
                          createdAt: now,
                          updatedAt: now
                        }
                      ])
                    )
                  },
                  tabs: Object.fromEntries(
                    tabIds.map((id, index) => [
                      id,
                      {
                        id,
                        spaceId: "space-1",
                        stackId: "stack-long",
                        title: `Long Tab ${index}`,
                        url: `https://long-${index}.test`,
                        source: "manual",
                        createdAt: now,
                        updatedAt: now
                      }
                    ])
                  )
                }
              }),
              set: async () => undefined
            }
          },
          tabs: { query: async () => [] }
        }
      });
    });
    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();

    const shortStack = stackByName(page, "Short");
    const longStack = stackByName(page, "Long");
    const stackBoard = page.locator(".stack-board");
    const longTabList = longStack.locator(".tab-list");
    const boardHeight = await page.getByTestId("workspace").evaluate((element) => element.getBoundingClientRect().height);

    await expect.poll(async () => shortStack.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(boardHeight / 2);

    await expect.poll(async () =>
      longTabList.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: window.getComputedStyle(element).overflowY
      }))
    ).toMatchObject({ overflowY: "auto" });

    await expect(longTabList).not.toHaveClass(/is-scrolling/);
    await longTabList.evaluate((element) => {
      element.scrollTop = 120;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(longTabList).toHaveClass(/is-scrolling/);
    await expect(longTabList).not.toHaveClass(/is-scrolling/, { timeout: 2000 });

    await expect.poll(async () => stackBoard.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await expect(stackBoard).not.toHaveClass(/is-scrolling/);
    await stackBoard.evaluate((element) => {
      element.scrollLeft = 160;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(stackBoard).toHaveClass(/is-scrolling/);
    await expect(stackBoard).not.toHaveClass(/is-scrolling/, { timeout: 2000 });
  });

  test("global search overlay keeps typing events inside the overlay", async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: {
            sendMessage: async () => ({
              groups: {
                spaces: [],
                stacks: [],
                savedTabs: [],
                openTabs: [],
                history: []
              }
            })
          }
        }
      });
      const seenEvents: string[] = [];
      for (const eventName of ["beforeinput", "input", "keydown", "keypress", "keyup"]) {
        window.addEventListener(eventName, () => seenEvents.push(eventName));
      }
      Object.assign(window, { __TAB_MANAGER_SEEN_KEYBOARD_EVENTS__: seenEvents });
    });

    await page.addScriptTag({ url: "/globalSearchOverlay.js" });
    await page.keyboard.type("abc");
    await page.keyboard.press("ArrowDown");

    await expect.poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __TAB_MANAGER_SEEN_KEYBOARD_EVENTS__: string[] }).__TAB_MANAGER_SEEN_KEYBOARD_EVENTS__
      )
    ).toEqual([]);
  });
});

test.describe("Open tabs panel window moves", () => {
  test("moves a dragged open tab into another open window block", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs = [
        { id: 1, windowId: 10, title: "Vite", url: "https://vite.dev" },
        { id: 2, windowId: 10, title: "React", url: "https://react.dev" },
        { id: 3, windowId: 20, title: "Docs", url: "https://docs.test" }
      ];

      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab })),
            move: async (tabId: number, moveProperties: { windowId?: number }) => {
              const tab = tabs.find((item) => item.id === tabId);
              if (!tab || typeof moveProperties.windowId !== "number") {
                return undefined;
              }
              tab.windowId = moveProperties.windowId;
              return { ...tab };
            }
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();

    const source = page.getByTestId("open-block").filter({ hasText: "Window 1" });
    const target = page.getByTestId("open-block").filter({ hasText: "Window 2" });

    await expect(source.getByTestId("open-tab").filter({ hasText: "React" })).toBeVisible();
    await expect(target.getByTestId("open-tab").filter({ hasText: "Docs" })).toBeVisible();

    await source.getByTestId("open-tab").filter({ hasText: "React" }).dragTo(target);

    await expect(source.getByTestId("open-tab").filter({ hasText: "React" })).toHaveCount(0);
    await expect(target.getByTestId("open-tab").filter({ hasText: "React" })).toBeVisible();
    await expect(source.getByTestId("open-block-title")).toContainText("Window 1 · 1 tabs");
    await expect(target.getByTestId("open-block-title")).toContainText("Window 2 · 2 tabs");
  });
});

test.describe("Open tabs panel duplicate cleanup", () => {
  test("closes duplicate open URLs from the floating panel", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs = [
        { id: 1, windowId: 10, title: "React", url: "https://react.dev/" },
        { id: 2, windowId: 10, title: "Vite", url: "https://vite.dev" },
        { id: 3, windowId: 20, title: "React Duplicate", url: "https://react.dev/#docs" },
        { id: 4, windowId: 20, title: "Docs", url: "https://docs.test" },
        { id: 5, windowId: 30, title: "Vite Duplicate", url: "https://vite.dev/" }
      ];

      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab })),
            remove: async (tabIds: number | number[]) => {
              const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
              for (const id of ids) {
                const index = tabs.findIndex((tab) => tab.id === id);
                if (index >= 0) {
                  tabs.splice(index, 1);
                }
              }
            }
          },
          windows: {
            getAll: async () => [
              { id: 10, tabs: tabs.filter((tab) => tab.windowId === 10).map((tab) => ({ ...tab })) },
              { id: 20, tabs: tabs.filter((tab) => tab.windowId === 20).map((tab) => ({ ...tab })) },
              { id: 30, tabs: tabs.filter((tab) => tab.windowId === 30).map((tab) => ({ ...tab })) }
            ]
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();
    await expect(page.getByTestId("open-tab")).toHaveCount(5);

    await page.getByTestId("dedupe-open-tabs").click();

    await expect(page.getByTestId("open-tab")).toHaveCount(3);
    await expect(page.getByTestId("dedupe-open-tabs-status")).toHaveText("已关闭 2 个重复 Tab");
    await expect(page.getByTestId("open-tabs-panel")).toContainText("React");
    await expect(page.getByTestId("open-tabs-panel")).toContainText("Vite");
    await expect(page.getByTestId("open-tabs-panel")).not.toContainText("React Duplicate");
    await expect(page.getByTestId("open-tabs-panel")).not.toContainText("Vite Duplicate");
  });
});

test.describe("Open tabs panel live updates and close actions", () => {
  test("refreshes the open tabs list when Chrome tab create and remove events fire", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs = [
        { id: 1, windowId: 10, title: "React", url: "https://react.dev" }
      ];
      const createdListeners: Array<(tab: unknown) => void> = [];
      const removedListeners: Array<(tabId: number, removeInfo: unknown) => void> = [];

      Object.assign(window, {
        __TAB_MANAGER_TEST__: { tabs, createdListeners, removedListeners }
      });
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab })),
            onCreated: {
              addListener: (listener: (tab: unknown) => void) => createdListeners.push(listener),
              removeListener: (listener: (tab: unknown) => void) => {
                const index = createdListeners.indexOf(listener);
                if (index >= 0) {
                  createdListeners.splice(index, 1);
                }
              }
            },
            onRemoved: {
              addListener: (listener: (tabId: number, removeInfo: unknown) => void) => removedListeners.push(listener),
              removeListener: (listener: (tabId: number, removeInfo: unknown) => void) => {
                const index = removedListeners.indexOf(listener);
                if (index >= 0) {
                  removedListeners.splice(index, 1);
                }
              }
            }
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();
    await expect(page.getByTestId("open-tab")).toHaveCount(1);

    await page.evaluate(() => {
      const state = (window as unknown as {
        __TAB_MANAGER_TEST__: {
          tabs: Array<{ id: number; windowId: number; title: string; url: string }>;
          createdListeners: Array<(tab: unknown) => void>;
          removedListeners: Array<(tabId: number, removeInfo: unknown) => void>;
        };
      }).__TAB_MANAGER_TEST__;
      const tab = { id: 2, windowId: 10, title: "Vite", url: "https://vite.dev" };
      state.tabs.push(tab);
      for (const listener of state.createdListeners) {
        listener(tab);
      }
    });

    await expect(page.getByTestId("open-tab")).toHaveCount(2);
    await expect(page.getByTestId("open-tabs-panel")).toContainText("Vite");

    await page.evaluate(() => {
      const state = (window as unknown as {
        __TAB_MANAGER_TEST__: {
          tabs: Array<{ id: number; windowId: number; title: string; url: string }>;
          removedListeners: Array<(tabId: number, removeInfo: unknown) => void>;
        };
      }).__TAB_MANAGER_TEST__;
      state.tabs.splice(state.tabs.findIndex((tab) => tab.id === 1), 1);
      for (const listener of state.removedListeners) {
        listener(1, { windowId: 10, isWindowClosing: false });
      }
    });

    await expect(page.getByTestId("open-tab")).toHaveCount(1);
    await expect(page.getByTestId("open-tabs-panel")).not.toContainText("React");
  });

  test("refreshes a newly opened tab after Chrome fills in its URL", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs: Array<{ id: number; windowId: number; title?: string; url?: string }> = [
        { id: 1, windowId: 10, title: "React", url: "https://react.dev" }
      ];
      const createdListeners: Array<(tab: unknown) => void> = [];
      const updatedListeners: Array<(tabId: number, changeInfo: unknown, tab: unknown) => void> = [];

      Object.assign(window, {
        __TAB_MANAGER_TEST__: { tabs, createdListeners, updatedListeners }
      });
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab })),
            onCreated: {
              addListener: (listener: (tab: unknown) => void) => createdListeners.push(listener),
              removeListener: (listener: (tab: unknown) => void) => {
                const index = createdListeners.indexOf(listener);
                if (index >= 0) {
                  createdListeners.splice(index, 1);
                }
              }
            },
            onUpdated: {
              addListener: (listener: (tabId: number, changeInfo: unknown, tab: unknown) => void) =>
                updatedListeners.push(listener),
              removeListener: (listener: (tabId: number, changeInfo: unknown, tab: unknown) => void) => {
                const index = updatedListeners.indexOf(listener);
                if (index >= 0) {
                  updatedListeners.splice(index, 1);
                }
              }
            }
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();
    await expect(page.getByTestId("open-tab")).toHaveCount(1);

    await page.evaluate(() => {
      const state = (window as unknown as {
        __TAB_MANAGER_TEST__: {
          tabs: Array<{ id: number; windowId: number; title?: string; url?: string }>;
          createdListeners: Array<(tab: unknown) => void>;
        };
      }).__TAB_MANAGER_TEST__;
      const pendingTab = { id: 2, windowId: 10 };
      state.tabs.push(pendingTab);
      for (const listener of state.createdListeners) {
        listener(pendingTab);
      }
    });

    await expect(page.getByTestId("open-tab")).toHaveCount(1);

    await page.evaluate(() => {
      const state = (window as unknown as {
        __TAB_MANAGER_TEST__: {
          tabs: Array<{ id: number; windowId: number; title?: string; url?: string }>;
          updatedListeners: Array<(tabId: number, changeInfo: unknown, tab: unknown) => void>;
        };
      }).__TAB_MANAGER_TEST__;
      const tab = state.tabs.find((item) => item.id === 2);
      if (!tab) {
        return;
      }
      tab.title = "Docs";
      tab.url = "https://docs.test";
      for (const listener of state.updatedListeners) {
        listener(2, { title: "Docs", url: "https://docs.test" }, { ...tab });
      }
    });

    await expect(page.getByTestId("open-tab")).toHaveCount(2);
    await expect(page.getByTestId("open-tabs-panel")).toContainText("Docs");
  });

  test("closes a hovered open tab without opening it", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs = [
        { id: 1, windowId: 10, title: "React", url: "https://react.dev" },
        { id: 2, windowId: 10, title: "Vite", url: "https://vite.dev" }
      ];
      const openedUrls: string[] = [];

      Object.assign(window, { __TAB_MANAGER_TEST__: { tabs, openedUrls } });
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab })),
            update: async (_tabId: number, updateProperties: { url?: string }) => {
              if (updateProperties.url) {
                openedUrls.push(updateProperties.url);
              }
              return {};
            },
            create: async ({ url }: { url: string }) => {
              openedUrls.push(url);
              return {};
            },
            remove: async (tabIds: number | number[]) => {
              const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
              for (const id of ids) {
                const index = tabs.findIndex((tab) => tab.id === id);
                if (index >= 0) {
                  tabs.splice(index, 1);
                }
              }
            }
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();

    const reactTab = page.getByTestId("open-tab").filter({ hasText: "React" });
    await reactTab.hover();
    await expect(reactTab.getByTestId("close-open-tab")).toBeVisible();
    await reactTab.getByTestId("close-open-tab").click();

    await expect(page.getByTestId("open-tabs-panel")).not.toContainText("React");
    await expect(page.getByTestId("open-tabs-panel")).toContainText("Vite");
    await expect.poll(async () =>
      page.evaluate(() =>
        (window as unknown as { __TAB_MANAGER_TEST__: { openedUrls: string[] } }).__TAB_MANAGER_TEST__.openedUrls
      )
    ).toEqual([]);
  });

  test("closes a hovered open window block", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs = [
        { id: 1, windowId: 10, title: "React", url: "https://react.dev" },
        { id: 2, windowId: 10, title: "Vite", url: "https://vite.dev" },
        { id: 3, windowId: 20, title: "Docs", url: "https://docs.test" }
      ];

      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab }))
          },
          windows: {
            remove: async (windowId: number) => {
              for (let index = tabs.length - 1; index >= 0; index -= 1) {
                if (tabs[index].windowId === windowId) {
                  tabs.splice(index, 1);
                }
              }
            }
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();

    const firstWindow = page.getByTestId("open-block").filter({ hasText: "Window 1" });
    await firstWindow.getByTestId("open-block-title").hover();
    await expect(firstWindow.getByTestId("close-open-window")).toBeVisible();
    await firstWindow.getByTestId("close-open-window").click();

    await expect(page.getByTestId("open-block")).toHaveCount(1);
    await expect(page.getByTestId("open-tabs-panel")).not.toContainText("React");
    await expect(page.getByTestId("open-tabs-panel")).not.toContainText("Vite");
    await expect(page.getByTestId("open-tabs-panel")).toContainText("Docs");
  });

  test("keeps sticky open window titles readable while the open tabs list scrolls", async ({ page }) => {
    await page.addInitScript(() => {
      const tabs = Array.from({ length: 18 }, (_, index) => ({
        id: index + 1,
        windowId: index < 9 ? 10 : 20,
        title: `Scrollable Tab ${index + 1}`,
        url: `https://scroll-${index + 1}.test`
      }));

      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: {
          runtime: { id: "abc" },
          storage: {
            local: {
              get: async () => ({}),
              set: async () => undefined
            }
          },
          tabs: {
            query: async () => tabs.map((tab) => ({ ...tab }))
          }
        }
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("tab-manager-shell")).toBeVisible();
    await page.locator(".open-blocks").evaluate((element) => {
      element.scrollTop = 160;
    });

    await expect.poll(async () =>
      page.getByTestId("open-block-title").first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          position: style.position
        };
      })
    ).toEqual({
      backgroundColor: "rgb(252, 251, 248)",
      position: "sticky"
    });
  });
});

const acceptNextDialog = async (page: import("@playwright/test").Page, value: string) => {
  page.once("dialog", async (dialog) => {
    await dialog.accept(value);
  });
};

const confirmNextDialog = async (page: import("@playwright/test").Page, accept: boolean) => {
  page.once("dialog", async (dialog) => {
    if (accept) {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });
};

const createSpace = async (page: import("@playwright/test").Page, name: string) => {
  await acceptNextDialog(page, name);
  await page.getByTestId("add-space").click();
  await expect(page.getByTestId("workspace")).toContainText(name);
};

const createStack = async (page: import("@playwright/test").Page, name: string) => {
  await acceptNextDialog(page, name);
  await page.getByTestId("add-stack").click();
  await expect(stackByName(page, name)).toBeVisible();
};

const renameSpace = async (
  page: import("@playwright/test").Page,
  currentName: string,
  nextName: string
) => {
  await acceptNextDialog(page, nextName);
  await spaceByName(page, currentName).getByTestId("rename-space").click();
  await expect(spaceByName(page, nextName)).toBeVisible();
};

const renameStack = async (
  page: import("@playwright/test").Page,
  currentName: string,
  nextName: string
) => {
  await acceptNextDialog(page, nextName);
  await stackByName(page, currentName).getByTestId("rename-stack").click();
  await expect(stackByName(page, nextName)).toBeVisible();
};

const stackByName = (page: import("@playwright/test").Page, name: string) =>
  page.getByTestId("stack-column").filter({
    has: page.getByRole("heading", { name })
  });

const spaceByName = (page: import("@playwright/test").Page, name: string) =>
  page.getByTestId("space-group").filter({
    has: page.getByRole("button", { name, exact: true })
  });

const expectStackOrder = async (page: import("@playwright/test").Page, names: string[]) => {
  await expect.poll(async () => {
    const headings = await page
      .getByTestId("stack-column")
      .locator("h3")
      .allTextContents();
    return headings.slice(0, names.length);
  }).toEqual(names);
};

const expectSpaceOrder = async (page: import("@playwright/test").Page, names: string[]) => {
  await expect.poll(async () => {
    const labels = await page
      .getByTestId("space-group")
      .getByTestId("space-title")
      .allTextContents();
    return labels.slice(0, names.length);
  }).toEqual(names);
};
