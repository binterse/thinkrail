import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	FILE_ACTIONS_PROTOCOL_VERSION,
	WS_CHANNELS,
	type WsClientMessage,
} from "@thinkrail/contracts";
import { enterDefaultWorkspace, openFixtureProject, revealWorkbenchTool } from "./fixtures/app";
import { E2E_FIXTURE_REPO } from "./fixtures/paths";

type NativeContextMenuContribution = {
	items: {
		id: string;
		label: string;
		enabled?: boolean;
		iconPngLight: string;
		iconPngDark: string;
	}[];
	payload: { workspaceId: string; path: string };
};

async function getContribution(row: Locator) {
	const encoded = await row.getAttribute("data-electrobun-context-menu");
	if (!encoded) throw new Error("File row has no native context-menu contribution");
	return JSON.parse(encoded) as NativeContextMenuContribution;
}

async function enableNativeContextMenu(page: Page) {
	await page.addInitScript(() => {
		Object.defineProperty(window, "__ELECTROBUN_WEBVIEW2_CONTEXT_MENU__", { value: true });
	});
}

async function openNativeMenu(page: Page, row: Locator, menuId: string) {
	const contribution = await getContribution(row);
	await page.evaluate(
		(detail) => window.dispatchEvent(new CustomEvent("electrobun-context-menu-open", { detail })),
		{ menuId, payload: contribution.payload },
	);
	return contribution;
}

async function selectItem(page: Page, row: Locator, id: string, menuId: string) {
	const contribution = await getContribution(row);
	await page.evaluate(
		(detail) => window.dispatchEvent(new CustomEvent("electrobun-context-menu-action", { detail })),
		{ id, menuId, payload: contribution.payload },
	);
}

function expectOrderedItems(contribution: NativeContextMenuContribution) {
	const labels = contribution.items.map((item) => item.label);
	expect(labels).toHaveLength(4);
	expect(labels.slice(0, 2)).toEqual(["Open in VS Code", "Open with Default App"]);
	expect(labels[2]).toMatch(/^Reveal in (Windows Explorer|File Manager)$/);
	expect(labels[3]).toBe("Copy Absolute Path");
	for (const item of contribution.items) {
		for (const icon of [item.iconPngLight, item.iconPngDark]) {
			const bytes = Buffer.from(icon, "base64");
			expect(bytes.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
			expect(bytes.readUInt32BE(16)).toBe(16);
			expect(bytes.readUInt32BE(20)).toBe(16);
		}
	}
}

test("Files All contributes ordered native actions for files and compact folders", async ({
	page,
}) => {
	await enableNativeContextMenu(page);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.emulateMedia({ colorScheme: "light" });
	await page.setViewportSize({ width: 1600, height: 1000 });
	const openedActions: { action: string; path: string }[] = [];
	await page.routeWebSocket(/\/ws(\?|$)/, (browser) => {
		const server = browser.connectToServer();
		browser.onMessage((message) => {
			const frame = JSON.parse(message.toString()) as WsClientMessage;
			if ("method" in frame && frame.method === "editor.list") {
				browser.send(
					JSON.stringify({
						id: frame.id,
						ok: true,
						result: [{ id: "vscode", label: "VS Code", kind: "gui" }],
					}),
				);
				return;
			}
			if (
				"method" in frame &&
				frame.method === "fs.open" &&
				"action" in frame.params &&
				"path" in frame.params
			) {
				const { action, path } = frame.params;
				if (typeof action === "string" && typeof path === "string") {
					openedActions.push({ action, path });
					browser.send(JSON.stringify({ id: frame.id, ok: true, result: {} }));
					return;
				}
			}
			server.send(message);
		});
		server.onMessage((message) => browser.send(message));
	});
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
	const folderContribution = await getContribution(compactFolder);
	expectOrderedItems(folderContribution);
	expect(folderContribution.payload.path).toBe(join("src", "only", "deep").replaceAll("\\", "/"));
	await compactFolder.click({ button: "right" });
	const folderMenuId = "folder-menu";
	await openNativeMenu(page, compactFolder, folderMenuId);
	await expect(page.getByTestId("file-actions")).toHaveCount(0);
	await selectItem(page, compactFolder, "copyPath", folderMenuId);
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(deepFolder);
	if (activeTabBefore === null) await expect(activeTab).toHaveCount(0);
	else await expect(activeTab).toHaveText(activeTabBefore);

	await compactFolder.click();
	const file = page
		.locator('[data-testid="file-node"][data-kind="file"]')
		.filter({ hasText: /^Hej från Windows\.txt/ });
	await expect(file).toBeVisible();
	const fileContribution = await getContribution(file);
	expectOrderedItems(fileContribution);
	expect(fileContribution.items.find((item) => item.id === "vscode")?.enabled).toBe(true);
	expect(fileContribution.payload.path).toBe(
		join("src", "only", "deep", "Hej från Windows.txt").replaceAll("\\", "/"),
	);
	await file.click({ button: "right" });
	await openNativeMenu(page, file, "file-menu-before-keyboard");
	await expect(page.getByTestId("file-actions")).toHaveCount(0);
	await file.press("Shift+F10");
	const keyboardMenuId = "file-menu-keyboard";
	await openNativeMenu(page, file, keyboardMenuId);
	await expect(page.getByTestId("file-actions")).toHaveCount(0);
	if (activeTabBefore === null) await expect(activeTab).toHaveCount(0);
	else await expect(activeTab).toHaveText(activeTabBefore);

	const vscode = fileContribution.items.find((item) => item.id === "vscode");
	expect(vscode?.enabled).toBeDefined();
	if (vscode?.enabled) await selectItem(page, file, "vscode", keyboardMenuId);
	await selectItem(page, file, "default", keyboardMenuId);
	await selectItem(page, file, "reveal", keyboardMenuId);
	await expect.poll(() => openedActions.length).toBe((vscode?.enabled ? 1 : 0) + 2);
	expect(openedActions).toEqual([
		...(vscode?.enabled ? [{ action: "vscode", path: fileContribution.payload.path }] : []),
		{ action: "default", path: fileContribution.payload.path },
		{ action: "reveal", path: fileContribution.payload.path },
	]);

	await file.click();
	await expect(page.locator('[data-testid="editor-tab"][data-active="true"]')).toContainText(
		"Hej från Windows.txt",
	);

	await page.getByTestId("files-mode-changed").click();
	await expect(page.locator("[data-electrobun-context-menu]")).toHaveCount(0);
});

test("browser renderer keeps the existing Files action-menu fallback", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);
	await revealWorkbenchTool(page, "files");
	const readme = page.getByTestId("file-node").filter({ hasText: /^README\.md/ });
	await expect(readme).toBeVisible();
	await expect(readme).not.toHaveAttribute("data-electrobun-context-menu");
	await readme.click({ button: "right" });
	const menu = page.getByTestId("file-actions");
	await expect(menu).toBeVisible();
	await expect(menu.locator('[role="menuitem"]')).toHaveText([
		"Open in VS Code",
		"Open with Default App",
		/Reveal in (Windows Explorer|File Manager)/,
		"Copy Absolute Path",
	]);
	await page.keyboard.press("Escape");
	await expect(readme).toBeFocused();
	await readme.press("Shift+F10");
	await expect(menu).toBeVisible();
	await expect(menu.locator('[role="menuitem"]')).toHaveCount(4);
	await page.keyboard.press("Escape");
	await expect(readme).toBeFocused();
});

test("an older host omits Files contributions without sending their methods", async ({ page }) => {
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
	const readme = page.getByTestId("file-node").filter({ hasText: /^README\.md/ });
	await expect(readme).toBeVisible();
	await expect(readme).not.toHaveAttribute("data-electrobun-context-menu");
	await readme.click({ button: "right" });
	await expect(page.getByTestId("file-actions")).toHaveCount(0);
	expect(unsupportedCalls).toEqual([]);
});

test("native context-action failures show localized feedback", async ({ page }) => {
	await enableNativeContextMenu(page);
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
	const copyMenuId = "failure-copy";
	await openNativeMenu(page, readme, copyMenuId);
	await selectItem(page, readme, "copyPath", copyMenuId);
	await expect(
		page.getByTestId("toast").filter({ hasText: "Couldn't access the selected path" }),
	).toBeVisible();

	failPathInfo = false;
	const openMenuId = "failure-open";
	await openNativeMenu(page, readme, openMenuId);
	await selectItem(page, readme, "default", openMenuId);
	await expect(
		page.getByTestId("toast").filter({ hasText: "Couldn't complete the file action" }),
	).toBeVisible();
});

test("native Files context contributions remain available in a dark, short viewport", async ({
	page,
}) => {
	await enableNativeContextMenu(page);
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
	await openNativeMenu(page, lastFile, "dark-menu");
	await expect(page.getByTestId("file-actions")).toHaveCount(0);
	expectOrderedItems(await getContribution(lastFile));
});
