import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathInfo, readDir, workspaceRelativePath } from "./files";

let dataDir: string;
let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	mkdirSync(join(root, "src", "auth"), { recursive: true });
	writeFileSync(join(root, "src", "auth", "login.ts"), "export {};\n");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("readDir reports worktree-relative paths with forward slashes on every platform", () => {
	expect(readDir("w1", ".").map((node) => node.path)).toEqual(["src"]);
	expect(readDir("w1", "src").map((node) => node.path)).toEqual(["src/auth"]);
	expect(readDir("w1", "src/auth").map((node) => node.path)).toEqual(["src/auth/login.ts"]);
});

test("pathInfo returns the absolute host path and object kind for contained files and directories", () => {
	expect(pathInfo("w1", "src/auth/login.ts")).toEqual({
		absolutePath: join(root, "src", "auth", "login.ts"),
		kind: "file",
	});
	expect(pathInfo("w1", "src/auth")).toEqual({
		absolutePath: join(root, "src", "auth"),
		kind: "dir",
	});
});

test("pathInfo refuses missing paths, metadata and paths outside the worktree", () => {
	mkdirSync(join(root, ".git"));
	writeFileSync(join(root, ".git", "config"), "metadata\n");
	const paths = ["missing.txt", ".git/config", "../outside.txt"];
	if (process.platform === "win32") paths.push(".GIT/config");
	for (const path of paths) {
		let error: unknown;
		try {
			pathInfo("w1", path);
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({ code: "WORKTREE_PATH_UNAVAILABLE" });
	}
});

test("pathInfo refuses a directory junction that resolves outside the worktree", () => {
	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	writeFileSync(join(outside, "payload.txt"), "outside\n");
	try {
		symlinkSync(outside, join(root, "outside-link"), "junction");
	} catch {
		return;
	}
	let error: unknown;
	try {
		pathInfo("w1", "outside-link/payload.txt");
	} catch (caught) {
		error = caught;
	}
	expect(error).toMatchObject({ code: "WORKTREE_PATH_UNAVAILABLE" });
});

test("workspaceRelativePath names a contained path worktree-relative with / separators", () => {
	expect(workspaceRelativePath(root, join(root, "src", "auth", "login.ts"))).toBe(
		"src/auth/login.ts",
	);
	expect(workspaceRelativePath(root, join("src", "auth", "login.ts"))).toBe("src/auth/login.ts");
	expect(workspaceRelativePath(root, "./src/../src/auth")).toBe("src/auth");
	expect(workspaceRelativePath(`${root}${sep}.`, "src")).toBe("src");
	expect(workspaceRelativePath(root, "..env")).toBe("..env");
	expect(workspaceRelativePath(root, ".")).toBe("");
});

test("workspaceRelativePath rejects a path outside the worktree", () => {
	expect(workspaceRelativePath(root, "../worktree-sibling/a.ts")).toBeNull();
	expect(workspaceRelativePath(root, join(dataDir, "elsewhere"))).toBeNull();
});

const symlinkTest = process.platform === "win32" ? test.skip : test;

symlinkTest("readDir classifies symlinks by target and refuses escaping ones", () => {
	mkdirSync(join(root, "real"));
	writeFileSync(join(root, "real", "a.ts"), "");
	mkdirSync(join(dataDir, "outside"));
	symlinkSync(join(root, "real"), join(root, "dirlink"));
	symlinkSync(join(root, "real", "a.ts"), join(root, "filelink"));
	symlinkSync(join(root, "missing"), join(root, "dangling"));
	symlinkSync(join(dataDir, "outside"), join(root, "escape"));
	const kinds = Object.fromEntries(readDir("w1", ".").map((n) => [n.name, n.kind]));
	expect(kinds).toMatchObject({
		real: "dir",
		dirlink: "dir",
		filelink: "file",
		dangling: "file",
		escape: "file",
	});
	expect(readDir("w1", "dirlink").map((n) => n.path)).toEqual(["dirlink/a.ts"]);
	expect(() => readDir("w1", "escape")).toThrow("escapes");
});
