import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { delimiter, dirname, join, win32 } from "node:path";
import type { EditorInfo } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { spawnDetached } from "@thinkrail/shared/spawn";

interface GuiCandidate {
	id: string;
	label: string;
	bin: string;
}

const GUI_CANDIDATES: GuiCandidate[] = [
	{ id: "vscode", label: "VS Code", bin: "code" },
	{ id: "emacs", label: "Emacs", bin: "emacs" },
];

const JETBRAINS_CANDIDATES: { label: string; bin: string }[] = [
	{ label: "IntelliJ IDEA", bin: "idea" },
	{ label: "WebStorm", bin: "webstorm" },
	{ label: "PyCharm", bin: "pycharm" },
	{ label: "GoLand", bin: "goland" },
	{ label: "Rider", bin: "rider" },
	{ label: "CLion", bin: "clion" },
	{ label: "PhpStorm", bin: "phpstorm" },
	{ label: "RubyMine", bin: "rubymine" },
];

const JETBRAINS_ID = "jetbrains";

const TERMINAL_CANDIDATE = { id: "vim", label: "Vim", bin: "vim" };

const EDITOR_BINS = [...GUI_CANDIDATES, ...JETBRAINS_CANDIDATES, TERMINAL_CANDIDATE].map(
	(candidate) => candidate.bin,
);

const PATH_SCAN_CONCURRENCY = 8;

export type WhichFn = (bin: string) => string | null;

function installedWindowsVsCode(): string | null {
	if (process.platform !== "win32") return null;
	const candidates = [
		process.env.LOCALAPPDATA &&
			join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
		process.env.ProgramFiles && join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
		process.env["ProgramFiles(x86)"] &&
			join(process.env["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe"),
	].filter((candidate): candidate is string => Boolean(candidate));
	return candidates.find(existsSync) ?? null;
}

export const defaultWhich: WhichFn = (bin) => {
	const onPath = Bun.which(bin, { PATH: process.env.PATH ?? "" }) ?? null;
	return onPath ?? (bin === "code" ? installedWindowsVsCode() : null);
};

async function binsListedIn(dir: string, bins: readonly string[]): Promise<Set<string> | null> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? new Set() : null;
	}
	const listed = new Set<string>();
	for (const entry of entries) {
		const name = entry.toLowerCase();
		for (const bin of bins) if (name === bin || name.startsWith(`${bin}.`)) listed.add(bin);
	}
	return listed;
}

export async function pathWhich(
	bins: readonly string[],
	searchPath: string = process.env.PATH ?? "",
): Promise<WhichFn> {
	const names = bins.map((bin) => bin.toLowerCase());
	const dirs = searchPath.split(delimiter).filter(Boolean);
	const listed: (Set<string> | null)[] = dirs.map(() => null);
	let next = 0;
	const scan = async () => {
		while (next < dirs.length) {
			const index = next++;
			listed[index] = await binsListedIn(dirs[index] ?? "", names);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PATH_SCAN_CONCURRENCY, dirs.length) }, scan));
	return (bin) => {
		const name = bin.toLowerCase();
		const candidates = dirs.filter((_, index) => listed[index]?.has(name) ?? true);
		if (candidates.length === 0) return null;
		return Bun.which(bin, { PATH: candidates.join(delimiter) }) ?? null;
	};
}
export type SpawnFn = (cmd: string[], options?: { windowsHide?: boolean }) => void;

export const defaultSpawn: SpawnFn = (cmd, options) => {
	if (!spawnDetached(cmd, options)) throw new Error("Failed to launch the requested application");
};

let discovery: Promise<EditorInfo[]> | null = null;

export function listAvailableEditors(which?: WhichFn): Promise<EditorInfo[]> {
	if (which) return Promise.resolve(editorsOnPath(which));
	discovery ??= pathWhich(EDITOR_BINS)
		.then(editorsOnPath)
		.finally(() => {
			discovery = null;
		});
	return discovery;
}

function editorsOnPath(which: WhichFn): EditorInfo[] {
	const editors: EditorInfo[] = [];
	for (const c of GUI_CANDIDATES) {
		if (which(c.bin)) editors.push({ id: c.id, label: c.label, kind: "gui" });
	}
	const jetbrains = JETBRAINS_CANDIDATES.find((c) => which(c.bin));
	if (jetbrains) editors.push({ id: JETBRAINS_ID, label: jetbrains.label, kind: "gui" });
	if (which(TERMINAL_CANDIDATE.bin)) {
		editors.push({ id: TERMINAL_CANDIDATE.id, label: TERMINAL_CANDIDATE.label, kind: "terminal" });
	}
	return editors;
}

function resolveGuiBin(editorId: string, which: WhichFn): string | null {
	const simple = GUI_CANDIDATES.find((c) => c.id === editorId);
	if (simple) return which(simple.bin);
	if (editorId === JETBRAINS_ID) {
		for (const c of JETBRAINS_CANDIDATES) {
			const bin = which(c.bin);
			if (bin) return bin;
		}
		return null;
	}
	return null;
}

export async function openEditor(
	editorId: string,
	worktreePath: string,
	which?: WhichFn,
	spawn: SpawnFn = defaultSpawn,
): Promise<void> {
	const bin = resolveGuiBin(editorId, which ?? (await pathWhich(EDITOR_BINS)));
	if (!bin) throw new Error(`"${editorId}" isn't installed on this host`);
	spawn([bin, worktreePath]);
}

export function openFileInVsCode(
	path: string,
	which: WhichFn = defaultWhich,
	spawn: SpawnFn = defaultSpawn,
): void {
	const bin = resolveGuiBin("vscode", which);
	if (!bin)
		throw new CodedError(
			"FILE_ACTION_UNAVAILABLE",
			"Visual Studio Code is not installed on this host.",
		);
	try {
		spawn([bin, path]);
	} catch {
		throw new CodedError(
			"FILE_ACTION_FAILED",
			"The host could not open the selected path in VS Code.",
		);
	}
}

export function openWithDefaultApp(
	path: string,
	spawn: SpawnFn = defaultSpawn,
	platform: NodeJS.Platform = process.platform,
): void {
	const cmd =
		platform === "darwin"
			? ["open", path]
			: platform === "win32"
				? ["explorer", path]
				: ["xdg-open", path];
	try {
		spawn(cmd, platform === "win32" ? { windowsHide: false } : undefined);
	} catch {
		throw new CodedError("FILE_ACTION_FAILED", "The host could not open the selected path.");
	}
}

export function revealPath(
	path: string,
	spawn: SpawnFn = defaultSpawn,
	platform: NodeJS.Platform = process.platform,
): void {
	const cmd =
		platform === "darwin"
			? ["open", "-R", path]
			: platform === "win32"
				? ["explorer", "/select,", path]
				: ["xdg-open", dirname(path)];
	try {
		spawn(cmd, platform === "win32" ? { windowsHide: false } : undefined);
	} catch {
		throw new CodedError("FILE_ACTION_FAILED", "The host could not reveal the selected path.");
	}
}

export function revealInFileManager(
	worktreePath: string,
	spawn: SpawnFn = defaultSpawn,
	platform: NodeJS.Platform = process.platform,
): void {
	if (!existsSync(worktreePath)) throw new Error(`Folder not found: ${worktreePath}`);
	const cmd =
		platform === "darwin"
			? ["open", worktreePath]
			: platform === "win32"
				? ["explorer", win32.normalize(worktreePath)]
				: ["xdg-open", worktreePath];
	try {
		spawn(cmd, { windowsHide: false });
	} catch {
		throw new Error(`No file manager launcher available on this host (${platform}).`);
	}
}
