import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPinnedNativeWrapper } from "./pinnedNativeWrapper";

const tempDirs: string[] = [];

afterEach(() => {
	for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function targetPath() {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-native-wrapper-"));
	tempDirs.push(dir);
	return join(dir, "libNativeWrapper.dll");
}

test("installs the native wrapper only when its pinned SHA-256 matches", async () => {
	const target = targetPath();
	const bytes = Buffer.from("pinned Windows native wrapper fixture");
	const asset = {
		url: "https://example.test/libNativeWrapper.dll",
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
	const fetchAsset = async (url: string) => {
		expect(url).toBe(asset.url);
		return new Response(bytes);
	};

	await installPinnedNativeWrapper(target, asset, fetchAsset);
	expect(readFileSync(target)).toEqual(bytes);
});

test("does not replace the bundled wrapper after a hash mismatch or failed download", async () => {
	const target = targetPath();
	writeFileSync(target, "original wrapper");
	const asset = { url: "https://example.test/libNativeWrapper.dll", sha256: "0".repeat(64) };
	const fetchAsset = async () => new Response("changed binary");

	await expect(installPinnedNativeWrapper(target, asset, fetchAsset)).rejects.toThrow(
		"SHA-256 mismatch",
	);
	expect(readFileSync(target, "utf8")).toBe("original wrapper");
	await expect(
		installPinnedNativeWrapper(target, asset, async () => new Response(null, { status: 404 })),
	).rejects.toThrow("could not download the pinned WebView2 wrapper (404)");
	expect(readFileSync(target, "utf8")).toBe("original wrapper");
});
