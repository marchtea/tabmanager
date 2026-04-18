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

    await page.getByTestId("search-entry").click();
    await expect(page.getByTestId("search-modal")).toBeVisible();
    await page.getByRole("textbox", { name: "搜索 spaces、stacks、tabs、history" }).fill("React");

    await expect(page.getByTestId("search-result")).toContainText("React");
    await expect(page.getByTestId("search-result")).toContainText(
      "The library for web and native user interfaces"
    );
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
