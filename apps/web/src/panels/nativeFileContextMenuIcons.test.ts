import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngFiles = [
	"file-context-menu-icons/vscode-light.png",
	"file-context-menu-icons/vscode-dark.png",
	"file-context-menu-icons/default-app-light.png",
	"file-context-menu-icons/default-app-dark.png",
	"file-context-menu-icons/reveal-light.png",
	"file-context-menu-icons/reveal-dark.png",
	"file-context-menu-icons/copy-path-light.png",
	"file-context-menu-icons/copy-path-dark.png",
];

test("native file action icons are compact 16px PNG variants for both menu themes", () => {
	for (const file of pngFiles) {
		const bytes = readFileSync(new URL(file, import.meta.url));
		expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);
		expect(bytes.readUInt32BE(16)).toBe(16);
		expect(bytes.readUInt32BE(20)).toBe(16);
		expect(bytes.byteLength).toBeLessThan(4096);
	}
});
