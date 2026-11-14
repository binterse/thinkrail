import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODEL_FALLBACK_MODELS_LIMIT } from "@thinkrail/contracts";
import {
	effectiveModelFallbackSettings,
	getModelFallbackSettings,
	setModelFallbackPublisher,
	updateModelFallbackSettings,
} from "./modelFallback";

const originalDataDir = process.env.THINKRAIL_DATA_DIR;
let fixture: string | undefined;

afterEach(() => {
	setModelFallbackPublisher(null);
	if (fixture) rmSync(fixture, { recursive: true, force: true });
	fixture = undefined;
	if (originalDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = originalDataDir;
});

function useFixture(): string {
	fixture = mkdtempSync(join(tmpdir(), "thinkrail-model-fallback-"));
	process.env.THINKRAIL_DATA_DIR = fixture;
	return fixture;
}

test("defaults to global inheritance and supports disabled and custom project modes", () => {
	useFixture();
	const settings = {
		version: 1 as const,
		enabled: true,
		models: [{ provider: "deepseek", id: "chat" }],
		projects: {
			off: { mode: "disabled" as const },
			custom: { mode: "custom" as const, models: [{ provider: "anthropic", id: "sonnet" }] },
		},
	};
	expect(effectiveModelFallbackSettings(settings, null)).toEqual({
		enabled: true,
		mode: "global",
		models: settings.models,
	});
	expect(effectiveModelFallbackSettings(settings, "off")).toEqual({
		enabled: false,
		mode: "disabled",
		models: [],
	});
	expect(effectiveModelFallbackSettings(settings, "custom")).toEqual({
		enabled: true,
		mode: "custom",
		models: settings.projects.custom.models,
	});
});

test("persists identity-only settings atomically and publishes the saved value", () => {
	const directory = useFixture();
	const settings = {
		version: 1 as const,
		enabled: true,
		models: [{ provider: "deepseek", id: "chat" }],
		projects: {},
	};
	const published: unknown[] = [];
	setModelFallbackPublisher((value) => published.push(value));
	updateModelFallbackSettings(settings);
	expect(getModelFallbackSettings()).toEqual(settings);
	expect(published).toEqual([settings]);
	expect(readFileSync(join(directory, "model-fallback.json"), "utf8")).not.toContain("apiKey");
});

test("rejects credentials and unknown properties from settings updates", () => {
	const directory = useFixture();
	expect(() =>
		updateModelFallbackSettings({
			version: 1,
			enabled: true,
			models: [{ provider: "deepseek", id: "chat", apiKey: "must-not-persist" }],
			projects: {},
		}),
	).toThrow("Invalid model fallback settings");
	expect(() =>
		updateModelFallbackSettings({
			version: 1,
			enabled: true,
			models: Array.from({ length: MODEL_FALLBACK_MODELS_LIMIT + 1 }, (_, index) => ({
				provider: "deepseek",
				id: `model-${index}`,
			})),
			projects: {},
		}),
	).toThrow("Invalid model fallback settings");
	expect(() => readFileSync(join(directory, "model-fallback.json"), "utf8")).toThrow();
});
