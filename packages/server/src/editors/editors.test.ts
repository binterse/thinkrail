import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, win32 } from "node:path";
import {
	defaultWhich,
	listAvailableEditors,
	openEditor,
	openFileInVsCode,
	openWithDefaultApp,
	pathWhich,
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
	test("nothing installed → empty list", async () => {
		expect(await listAvailableEditors(whichOnly())).toEqual([]);
	});

	test("names only what's actually on PATH, in candidate order", async () => {
		const editors = await listAvailableEditors(whichOnly("code", "vim"));
		expect(editors).toEqual([
			{ id: "vscode", label: "VS Code", kind: "gui" },
			{ id: "vim", label: "Vim", kind: "terminal" },
		]);
	});

	test("JetBrains: no single binary — the first installed launcher in priority order wins, labeled for its product", async () => {
		expect(await listAvailableEditors(whichOnly("pycharm", "goland"))).toEqual([
			{ id: "jetbrains", label: "PyCharm", kind: "gui" },
		]);
	});

	test("JetBrains: idea outranks webstorm when both are installed", async () => {
		expect(await listAvailableEditors(whichOnly("webstorm", "idea"))).toEqual([
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
	test("throws for an unknown id", async () => {
		await expect(
			openEditor("nonexistent", "/tmp/wt", whichOnly(), recordingSpawn),
		).rejects.toThrow();
	});

	test("throws for the terminal-kind Vim — the client must run it in an embedded terminal instead", async () => {
		await expect(openEditor("vim", "/tmp/wt", whichOnly("vim"), recordingSpawn)).rejects.toThrow();
	});

	test("throws when the editor is no longer on PATH (uninstalled after the list was fetched)", async () => {
		await expect(openEditor("vscode", "/tmp/wt", whichOnly(), recordingSpawn)).rejects.toThrow();
	});

	test("resolves jetbrains to whichever product is actually installed, not a fixed binary, and launches it at the worktree path", async () => {
		spawnCalls.length = 0;
		await openEditor("jetbrains", "/tmp/wt", whichOnly("clion"), recordingSpawn);
		expect(spawnCalls).toEqual([["/usr/bin/clion", "/tmp/wt"]]);
	});
});

describe("pathWhich", () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-path-"));

	function dirWith(name: string, files: { name: string; executable?: boolean }[]): string {
		const dir = join(root, name);
		mkdirSync(dir, { recursive: true });
		for (const file of files) {
			const fileName = process.platform === "win32" ? `${file.name}.cmd` : file.name;
			writeFileSync(join(dir, fileName), "", { mode: file.executable === false ? 0o644 : 0o755 });
		}
		return dir;
	}

	const empty = dirWith("empty", []);
	const first = dirWith("first", [{ name: "code" }, { name: "emacs", executable: false }]);
	const second = dirWith("second", [{ name: "code" }, { name: "emacs" }, { name: "webstorm" }]);
	const lookalike = dirWith("lookalike", [{ name: "vimdiff" }, { name: "codex" }]);
	const unlistable = dirWith("unlistable", [{ name: "idea" }]);
	chmodSync(unlistable, 0o111);
	afterAll(() => {
		chmodSync(unlistable, 0o755);
		rmSync(root, { recursive: true, force: true });
	});
	const notADir = join(first, process.platform === "win32" ? "code.cmd" : "code");
	const searchPath = [
		empty,
		join(root, "missing"),
		notADir,
		"",
		first,
		lookalike,
		unlistable,
		second,
	].join(delimiter);

	test("resolves every candidate exactly as a full Bun.which PATH search would", async () => {
		const which = await pathWhich(["code", "emacs", "webstorm", "vim", "idea"], searchPath);
		for (const bin of ["code", "emacs", "webstorm", "vim", "idea"]) {
			expect(which(bin)).toBe(Bun.which(bin, { PATH: searchPath }) ?? null);
		}
		expect(which("code")).not.toBeNull();
		expect(which("webstorm")).not.toBeNull();
		expect(which("idea")).not.toBeNull();
	});

	test("reads PATH asynchronously, letting other work run before it settles", async () => {
		let otherWorkRan = false;
		setImmediate(() => {
			otherWorkRan = true;
		});
		await pathWhich(["code"], Array.from({ length: 32 }, () => second).join(delimiter));
		expect(otherWorkRan).toBe(true);
	});

	test("concurrent editor.list callers share one PATH scan of the live PATH", async () => {
		const savedPath = process.env.PATH;
		process.env.PATH = searchPath;
		try {
			const pending = listAvailableEditors();
			expect(listAvailableEditors()).toBe(pending);
			expect(await pending).toEqual([
				{ id: "vscode", label: "VS Code", kind: "gui" },
				{ id: "emacs", label: "Emacs", kind: "gui" },
				{ id: "jetbrains", label: "IntelliJ IDEA", kind: "gui" },
			]);
			const next = listAvailableEditors();
			expect(next).not.toBe(pending);
			await next;
		} finally {
			process.env.PATH = savedPath;
		}
	});
});

describe("revealInFileManager", () => {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-reveal-"));
	const revealCalls: { cmd: string[]; options: { windowsHide?: boolean } | undefined }[] = [];
	const recordingReveal: SpawnFn = (cmd, options) => {
		revealCalls.push({ cmd, options });
	};
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("macOS: open", () => {
		revealCalls.length = 0;
		revealInFileManager(dir, recordingReveal, "darwin");
		expect(revealCalls.map((call) => call.cmd)).toEqual([["open", dir]]);
	});

	test("Windows: explorer, given backslash separators it can parse", () => {
		revealCalls.length = 0;
		revealInFileManager(dir.replaceAll("\\", "/"), recordingReveal, "win32");
		expect(revealCalls.map((call) => call.cmd)).toEqual([["explorer", win32.normalize(dir)]]);
		expect(revealCalls[0]?.cmd[1]).not.toContain("/");
	});

	test("Linux (and every other platform): xdg-open, the desktop's default handler", () => {
		revealCalls.length = 0;
		revealInFileManager(dir, recordingReveal, "linux");
		expect(revealCalls.map((call) => call.cmd)).toEqual([["xdg-open", dir]]);
	});

	test("launches the file manager with a visible window on every platform", () => {
		for (const platform of ["darwin", "win32", "linux"] as const) {
			revealCalls.length = 0;
			revealInFileManager(dir, recordingReveal, platform);
			expect(revealCalls[0]?.options).toEqual({ windowsHide: false });
		}
	});

	test("rejects a missing folder before launching anything", () => {
		revealCalls.length = 0;
		const missing = join(dir, "gone");
		expect(() => revealInFileManager(missing, recordingReveal, "win32")).toThrow(
			/Folder not found/,
		);
		expect(revealCalls).toEqual([]);
	});

	test("names the platform when no file manager launcher is available", () => {
		const throwingSpawn: SpawnFn = () => {
			throw new Error("ENOENT");
		};
		expect(() => revealInFileManager(dir, throwingSpawn, "linux")).toThrow(/linux/);
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
