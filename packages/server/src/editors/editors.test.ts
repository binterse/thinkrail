import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	defaultWhich,
	listAvailableEditors,
	openEditor,
	openFileInVsCode,
	openWithDefaultApp,
	revealInFileManager,
	revealPath,
	type SpawnFn,
	type WhichFn,
} from "./editors";

const spawnCalls: string[][] = [];
const spawnOptions: (Parameters<SpawnFn>[1] | undefined)[] = [];
const recordingSpawn: SpawnFn = (cmd, options) => {
	spawnCalls.push(cmd);
	spawnOptions.push(options);
};

function resetSpawnCalls(): void {
	spawnCalls.length = 0;
	spawnOptions.length = 0;
}

function whichOnly(...installed: string[]): WhichFn {
	return (bin) => (installed.includes(bin) ? `/usr/bin/${bin}` : null);
}

describe("listAvailableEditors", () => {
	test("nothing installed → empty list", () => {
		expect(listAvailableEditors(whichOnly())).toEqual([]);
	});

	test("names only what's actually on PATH, in candidate order", () => {
		const editors = listAvailableEditors(whichOnly("code", "vim"));
		expect(editors).toEqual([
			{ id: "vscode", label: "VS Code", kind: "gui" },
			{ id: "vim", label: "Vim", kind: "terminal" },
		]);
	});

	test("JetBrains: no single binary — the first installed launcher in priority order wins, labeled for its product", () => {
		expect(listAvailableEditors(whichOnly("pycharm", "goland"))).toEqual([
			{ id: "jetbrains", label: "PyCharm", kind: "gui" },
		]);
	});

	test("JetBrains: idea outranks webstorm when both are installed", () => {
		expect(listAvailableEditors(whichOnly("webstorm", "idea"))).toEqual([
			{ id: "jetbrains", label: "IntelliJ IDEA", kind: "gui" },
		]);
	});
});

test.skipIf(process.platform !== "win32")(
	"finds a per-user VS Code install when the packaged host PATH omits its code shim",
	() => {
		const root = mkdtempSync(join(tmpdir(), "thinkrail-vscode-discovery-"));
		const executable = join(root, "Programs", "Microsoft VS Code", "Code.exe");
		const prior = {
			PATH: process.env.PATH,
			LOCALAPPDATA: process.env.LOCALAPPDATA,
			ProgramFiles: process.env.ProgramFiles,
			ProgramFilesX86: process.env["ProgramFiles(x86)"],
		};
		try {
			mkdirSync(dirname(executable), { recursive: true });
			writeFileSync(executable, "test executable marker");
			process.env.PATH = "";
			process.env.LOCALAPPDATA = root;
			process.env.ProgramFiles = join(root, "Program Files");
			process.env["ProgramFiles(x86)"] = join(root, "Program Files (x86)");
			expect(defaultWhich("code")).toBe(executable);
			expect(defaultWhich("emacs")).toBeNull();
		} finally {
			for (const [key, value] of Object.entries(prior)) {
				const envKey = key === "ProgramFilesX86" ? "ProgramFiles(x86)" : key;
				if (value === undefined) delete process.env[envKey];
				else process.env[envKey] = value;
			}
			rmSync(root, { recursive: true, force: true });
		}
	},
);

describe("openEditor", () => {
	test("throws for an unknown id", () => {
		expect(() => openEditor("nonexistent", "/tmp/wt", whichOnly(), recordingSpawn)).toThrow();
	});

	test("throws for the terminal-kind Vim — the client must run it in an embedded terminal instead", () => {
		expect(() => openEditor("vim", "/tmp/wt", whichOnly("vim"), recordingSpawn)).toThrow();
	});

	test("throws when the editor is no longer on PATH (uninstalled after the list was fetched)", () => {
		expect(() => openEditor("vscode", "/tmp/wt", whichOnly(), recordingSpawn)).toThrow();
	});

	test("resolves jetbrains to whichever product is actually installed, not a fixed binary, and launches it at the worktree path", () => {
		resetSpawnCalls();
		openEditor("jetbrains", "/tmp/wt", whichOnly("clion"), recordingSpawn);
		expect(spawnCalls).toEqual([["/usr/bin/clion", "/tmp/wt"]]);
	});
});

describe("revealInFileManager", () => {
	test("macOS: open", () => {
		resetSpawnCalls();
		revealInFileManager("/tmp/wt", recordingSpawn, "darwin");
		expect(spawnCalls).toEqual([["open", "/tmp/wt"]]);
	});

	test("Windows: explorer", () => {
		resetSpawnCalls();
		revealInFileManager("/tmp/wt", recordingSpawn, "win32");
		expect(spawnCalls).toEqual([["explorer", "/tmp/wt"]]);
	});

	test("Linux (and every other platform): xdg-open, the desktop's default handler", () => {
		resetSpawnCalls();
		revealInFileManager("/tmp/wt", recordingSpawn, "linux");
		expect(spawnCalls).toEqual([["xdg-open", "/tmp/wt"]]);
	});

	test("names the platform when no file manager launcher is available", () => {
		const throwingSpawn: SpawnFn = () => {
			throw new Error("ENOENT");
		};
		expect(() => revealInFileManager("/tmp/wt", throwingSpawn, "linux")).toThrow(/linux/);
	});
});

describe("Files context actions", () => {
	test("VS Code opens the selected path as an argv item and distinguishes missing installations", () => {
		resetSpawnCalls();
		openFileInVsCode("C:\\Users\\Test\\Hej från Windows.txt", whichOnly("code"), recordingSpawn);
		expect(spawnCalls).toEqual([["/usr/bin/code", "C:\\Users\\Test\\Hej från Windows.txt"]]);
		try {
			openFileInVsCode("C:\\file.txt", whichOnly(), recordingSpawn);
			throw new Error("expected VS Code to be unavailable");
		} catch (error) {
			expect(error).toMatchObject({ code: "FILE_ACTION_UNAVAILABLE" });
		}
	});

	test("default app and reveal pass the host path as arguments on Windows", () => {
		const path = "C:\\Users\\Test\\mellanslag och åäö\\file.txt";
		resetSpawnCalls();
		openWithDefaultApp(path, recordingSpawn, "win32");
		revealPath(path, recordingSpawn, "win32");
		expect(spawnCalls).toEqual([
			["explorer", path],
			["explorer", "/select,", path],
		]);
		expect(spawnOptions).toEqual([{ windowsHide: false }, { windowsHide: false }]);
	});

	test("default app and reveal use native desktop handlers elsewhere", () => {
		resetSpawnCalls();
		openWithDefaultApp("/tmp/file.txt", recordingSpawn, "darwin");
		revealPath("/tmp/file.txt", recordingSpawn, "darwin");
		openWithDefaultApp("/tmp/file.txt", recordingSpawn, "linux");
		revealPath("/tmp/file.txt", recordingSpawn, "linux");
		expect(spawnCalls).toEqual([
			["open", "/tmp/file.txt"],
			["open", "-R", "/tmp/file.txt"],
			["xdg-open", "/tmp/file.txt"],
			["xdg-open", "/tmp"],
		]);
	});
});
