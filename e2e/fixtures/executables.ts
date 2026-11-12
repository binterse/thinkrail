import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOGIN_ENV_MARKER } from "@thinkrail/shared/shellEnv";

function findOnPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
	return (env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.map((directory) => join(directory, name))
		.find(existsSync);
}

export function resolveBunExecutable(env: NodeJS.ProcessEnv = process.env): string {
	const executable = findOnPath(process.platform === "win32" ? "bun.exe" : "bun", env);
	if (!executable) throw new Error("bun executable not found for the e2e host");
	return executable;
}

export function writeFakeCentral(fakeBinDir: string): void {
	const source = fileURLToPath(new URL("./bin/central", import.meta.url));
	if (process.platform === "win32") {
		const bash = resolveGitBashExecutable();
		writeFileSync(join(fakeBinDir, "central.cmd"), `@echo off\r\n"${bash}" "${source}" %*\r\n`);
		return;
	}

	const target = join(fakeBinDir, "central");
	copyFileSync(source, target);
	chmodSync(target, 0o755);
}

export function runFakeCentral(fakeBinDir: string, argv: string[], env: NodeJS.ProcessEnv): void {
	const windows = process.platform === "win32";
	const command = windows ? resolveGitBashExecutable() : join(fakeBinDir, "central");
	const args = windows ? [fileURLToPath(new URL("./bin/central", import.meta.url)), ...argv] : argv;
	execFileSync(command, args, { env, stdio: "ignore" });
}

function resolveGitBashExecutable(): string {
	const git = resolveWindowsGitExecutable();

	let directory = dirname(git);
	while (true) {
		for (const candidate of [
			join(directory, "bin", "bash.exe"),
			join(directory, "usr", "bin", "bash.exe"),
		]) {
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}

	throw new Error("Git Bash was not found next to the E2E Git executable");
}

function resolveWindowsGitExecutable(): string {
	const git = executableOnPath(process.env.PATH ?? "", "git.exe");
	if (!git) throw new Error("Git is required to locate the E2E Central shell on Windows");
	return git;
}

function executableSuffixes(env: NodeJS.ProcessEnv): string[] {
	if (process.platform !== "win32") return [""];
	return ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)];
}

export function executableOnPath(
	path: string,
	name: string,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const suffixes = executableSuffixes(env);
	return path
		.split(delimiter)
		.filter(Boolean)
		.flatMap((directory) => suffixes.map((suffix) => join(directory, name + suffix)))
		.find(existsSync);
}

const FAKED_TOOLS = ["pi", "central", "code"];

export function hermeticE2ePath(fakeBinDir: string, env: NodeJS.ProcessEnv = process.env): string {
	if (process.platform !== "win32") {
		return [fakeBinDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
	}

	const git = executableOnPath(env.PATH ?? "", "git.exe", env);
	if (!git) throw new Error("git executable not found for the e2e host");
	const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
	let gitRoot = dirname(git);
	for (let depth = 0; depth < 4; depth++) {
		if (existsSync(join(gitRoot, "mingw64", "bin")) && existsSync(join(gitRoot, "usr", "bin"))) {
			break;
		}
		const parent = dirname(gitRoot);
		if (parent === gitRoot) break;
		gitRoot = parent;
	}
	const ambient = [
		dirname(git),
		join(gitRoot, "mingw64", "bin"),
		join(gitRoot, "usr", "bin"),
		join(systemRoot, "System32"),
		systemRoot,
	].join(delimiter);
	for (const tool of FAKED_TOOLS) {
		const real = executableOnPath(ambient, tool, env);
		if (real) throw new Error(`e2e host PATH would expose a real ${tool}: ${real}`);
	}
	return [fakeBinDir, ambient].join(delimiter);
}

export function hermeticE2eShell(fakeBinDir: string): string {
	return join(fakeBinDir, "login-shell");
}

export function writeHermeticE2eShell(fakeBinDir: string, realShell: string): void {
	const script = [
		"#!/bin/sh",
		'case "$*" in',
		`\t*${shellQuote(LOGIN_ENV_MARKER)}*) printf '%sPATH=%s\\0' ${shellQuote(LOGIN_ENV_MARKER)} ${shellQuote(hermeticE2ePath(fakeBinDir))}; exit 0 ;;`,
		"esac",
		`exec ${shellQuote(realShell)} "$@"`,
		"",
	].join("\n");
	const target = hermeticE2eShell(fakeBinDir);
	writeFileSync(target, script);
	chmodSync(target, 0o755);
}

export function writeFakeGh(fakeBinDir: string, scenarioPath: string, logPath: string): void {
	const source = fileURLToPath(new URL("./fakeGh.ts", import.meta.url));
	const script = [
		"#!/bin/sh",
		`exec ${[resolveBunExecutable(), source, scenarioPath, logPath].map(shellQuote).join(" ")} "$@"`,
		"",
	].join("\n");
	const target = join(fakeBinDir, "gh");
	writeFileSync(target, script);
	chmodSync(target, 0o755);
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
