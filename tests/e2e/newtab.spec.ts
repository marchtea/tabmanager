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
});

const acceptNextDialog = async (page: import("@playwright/test").Page, value: string) => {
  page.once("dialog", async (dialog) => {
    await dialog.accept(value);
  });
};
