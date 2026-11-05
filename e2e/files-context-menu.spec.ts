import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	FILE_ACTIONS_PROTOCOL_VERSION,
	WS_CHANNELS,
	type WsClientMessage,
} from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { E2E_EDITOR_LOG, E2E_FIXTURE_REPO } from "./fixtures/paths";

test("Files All offers ordered host actions for files and compact folders", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.emulateMedia({ colorScheme: "light" });
	await page.setViewportSize({ width: 1600, height: 1000 });
	await openFixtureProject(page);
	const deepFolder = join(E2E_FIXTURE_REPO, "src", "only", "deep");
	mkdirSync(deepFolder, { recursive: true });
	const filePath = join(deepFolder, "Hej från Windows.txt");
	writeFileSync(filePath, "safe context-menu fixture\n");
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");

	const activeTab = page.locator('[data-testid="editor-tab"][data-active="true"]');
	const activeTabBefore = (await activeTab.count()) > 0 ? await activeTab.textContent() : null;
	const compactFolder = page
		.locator('[data-testid="file-node"][data-kind="dir"]')
		.filter({ hasText: /^src\/only\/deep$/ });
	await expect(compactFolder).toBeVisible();
	await compactFolder.click({ button: "right" });
	const menu = page.getByTestId("file-actions");
	await expect(menu).toBeVisible();
	const revealLabel = /Reveal in (Windows Explorer|File Manager)/;
	await expect(menu.locator('[role="menuitem"]')).toHaveText([
		"Open in VS Code",
		"Open with Default App",
		revealLabel,
		"Copy Absolute Path",
	]);
	await menu.getByTestId("file-menu-copy-path").click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(deepFolder);
	if (activeTabBefore === null) await expect(activeTab).toHaveCount(0);
	else await expect(activeTab).toHaveText(activeTabBefore);

	await compactFolder.click();
	const file = page
		.locator('[data-testid="file-node"][data-kind="file"]')
		.filter({ hasText: /^Hej från Windows\.txt/ });
	await expect(file).toBeVisible();
	await file.click({ button: "right" });
	await expect(menu).toBeVisible();
	await expect(menu.locator('[role="menuitem"]')).toHaveText([
		"Open in VS Code",
		"Open with Default App",
		revealLabel,
		"Copy Absolute Path",
	]);
	await page.keyboard.press("Escape");
	await expect(file).toBeFocused();
	if (activeTabBefore === null) await expect(activeTab).toHaveCount(0);
	else await expect(activeTab).toHaveText(activeTabBefore);

	await file.press("Shift+F10");
	await expect(menu).toBeVisible();
	const vscode = menu.getByTestId("file-menu-vscode");
	if (await vscode.isEnabled()) {
		await vscode.click();
		await expect
			.poll(() => (existsSync(E2E_EDITOR_LOG) ? readFileSync(E2E_EDITOR_LOG, "utf8") : ""))
			.toContain(filePath);
	} else {
		await expect(vscode).toBeDisabled();
	}
	await page.keyboard.press("Escape");
	await expect(menu).toHaveCount(0);
	if (activeTabBefore === null) await expect(activeTab).toHaveCount(0);
	else await expect(activeTab).toHaveText(activeTabBefore);

	await file.click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"Hej från Windows.txt",
	);

	await revealWorkbenchTool(page, "changes");
	const changedRow = page.getByText("Hej från Windows.txt").last();
	await expect(changedRow).toBeVisible();
	await changedRow.click({ button: "right" });
	await expect(menu).toHaveCount(0);
});

test("an older host hides Files actions without sending their methods", async ({ page }) => {
	const unsupportedCalls: string[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && (frame.method === "fs.pathInfo" || frame.method === "fs.open")) {
				unsupportedCalls.push(frame.method);
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as {
				channel?: string;
				data?: { protocolVersion?: number };
			};
			if (frame.channel === WS_CHANNELS.serverWelcome && frame.data)
				frame.data.protocolVersion = FILE_ACTIONS_PROTOCOL_VERSION - 1;
			browser.send(JSON.stringify(frame));
		});
	});

	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	const readme = page.getByTestId("file-node").filter({ hasText: "README.md" });
	await expect(readme).toBeVisible();
	await readme.click({ button: "right" });
	await expect(page.getByTestId("file-actions")).toHaveCount(0);
	expect(unsupportedCalls).toEqual([]);
});

test("Files context action failures show localized feedback", async ({ page }) => {
	let failPathInfo = true;
	const failedRequests = new Map<string, "fs.pathInfo" | "fs.open">();
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if (
				"method" in frame &&
				((frame.method === "fs.pathInfo" && failPathInfo) || frame.method === "fs.open")
			) {
				failedRequests.set(frame.id, frame.method);
			}
			server.send(message);
		});
		server.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as { id?: string };
			const method = frame.id ? failedRequests.get(frame.id) : undefined;
			if (frame.id && method) {
				failedRequests.delete(frame.id);
				browser.send(
					JSON.stringify({
						id: frame.id,
						ok: false,
						error: "isolated file action failure",
						errorCode:
							method === "fs.pathInfo" ? "WORKTREE_PATH_UNAVAILABLE" : "FILE_ACTION_FAILED",
					}),
				);
				return;
			}
			browser.send(message);
		});
	});

	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	const readme = page.getByTestId("file-node").filter({ hasText: /^README\.md/ });
	await expect(readme).toBeVisible();
	await readme.click({ button: "right" });
	const menu = page.getByTestId("file-actions");
	await expect(menu).toBeVisible();
	await expect(menu.getByTestId("file-menu-copy-path")).toBeDisabled();
	await expect(
		page.getByTestId("toast").filter({ hasText: "Couldn't access the selected path" }),
	).toBeVisible();

	failPathInfo = false;
	await page.keyboard.press("Escape");
	await readme.click({ button: "right" });
	await expect(menu.getByTestId("file-menu-default-app")).toBeEnabled();
	await menu.getByTestId("file-menu-default-app").click();
	await expect(
		page.getByTestId("toast").filter({ hasText: "Couldn't complete the file action" }),
	).toBeVisible();
});

test("Files context menu stays inside a dark, short viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 650 });
	await openFixtureProject(page);
	await page.getByTestId("open-settings").click();
	const settings = page.getByTestId("settings-dialog");
	await settings.getByTestId("settings-nav-appearance").click();
	await settings.getByTestId("theme-toggle").click();
	const darkTheme = settings
		.locator('[data-testid^="theme-option-"][data-appearance="dark"][data-contrast="normal"]')
		.first();
	await expect(darkTheme).toBeVisible();
	await darkTheme.click();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();
	await expect(page.locator("html")).toHaveAttribute("data-theme", /dark/);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	const lastFile = page.getByTestId("file-node").filter({ hasText: /^sample\.ipynb/ });
	await expect(lastFile).toBeAttached();
	await lastFile.scrollIntoViewIfNeeded();
	await lastFile.click({ button: "right" });
	const menu = page.getByTestId("file-actions");
	await expect(menu).toBeVisible();
	const box = await menu.boundingBox();
	expect(box).not.toBeNull();
	expect(box?.x).toBeGreaterThanOrEqual(0);
	expect(box?.y).toBeGreaterThanOrEqual(0);
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(1000);
	expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(650);
	await expect(menu.locator('[role="menuitem"]')).toHaveText([
		"Open in VS Code",
		"Open with Default App",
		/Reveal in (Windows Explorer|File Manager)/,
		"Copy Absolute Path",
	]);
});
