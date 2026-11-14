import { expect, type Page, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2eWire } from "./fixtures/wire";

async function withHostWire<T>(page: Page, run: (wire: E2eWire) => Promise<T>) {
	const wire = await E2eWire.connect(Number(new URL(page.url()).port));
	try {
		return await run(wire);
	} finally {
		wire.close();
	}
}

function fallbackButton(page: Page) {
	return page.getByRole("button", { name: "Fallback models" });
}

test("fallback settings persist and converge across connected chat clients", async ({
	page,
	context,
}) => {
	await openWorkspaceChat(page);
	const original = await withHostWire(page, async (wire) => {
		const response = await wire.request("modelFallback.get", {});
		await wire.request("modelFallback.update", {
			settings: { version: 1, enabled: true, models: [], projects: {} },
		});
		return response.settings;
	});
	let peer: Page | undefined;
	try {
		peer = await context.newPage();
		await peer.goto(page.url());
		await expect(peer.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

		await fallbackButton(page).click();
		await expect(page.getByRole("dialog", { name: "Model fallback" })).toBeVisible();
		await fallbackButton(peer).click();
		await expect(peer.getByRole("dialog", { name: "Model fallback" })).toBeVisible();

		const global = page.getByRole("switch", { name: "Enable fallback models globally" });
		const peerGlobal = peer.getByRole("switch", { name: "Enable fallback models globally" });
		await expect(global).toHaveAttribute("aria-checked", "true");
		await global.click();
		await expect(peerGlobal).toHaveAttribute("aria-checked", "false");
		await peerGlobal.click();
		await expect(global).toHaveAttribute("aria-checked", "true");

		for (const mode of ["Off for this project", "Custom list", "Inherit global"]) {
			await page.getByRole("button", { name: mode, exact: true }).click();
			await expect(peer.getByRole("button", { name: mode, exact: true })).toHaveAttribute(
				"data-selected",
				"true",
			);
		}

		const saved = await withHostWire(page, (wire) => wire.request("modelFallback.get", {}));
		expect(saved.settings.enabled).toBe(true);
		expect(saved.settings.projects).toEqual({});
	} finally {
		await withHostWire(page, (wire) =>
			wire.request("modelFallback.update", { settings: original }),
		).catch(() => {});
		await peer?.close();
	}
});
