import type {
	EffectiveModelFallbackSettings,
	ModelFallbackModelRef,
	ModelFallbackSettings,
} from "@thinkrail/contracts";
import { MODEL_FALLBACK_MODELS_LIMIT } from "@thinkrail/contracts";
import {
	isModelFallbackSettings,
	loadModelFallbackSettings,
	saveModelFallbackSettings,
} from "../persistence";

export type ModelFallbackPublisher = (settings: ModelFallbackSettings) => void;
let publisher: ModelFallbackPublisher | null = null;

export function getModelFallbackSettings(): ModelFallbackSettings {
	return loadModelFallbackSettings();
}

export function effectiveModelFallbackSettings(
	settings: ModelFallbackSettings,
	projectId: string | null,
): EffectiveModelFallbackSettings {
	const override = projectId ? settings.projects[projectId] : undefined;
	if (override?.mode === "disabled") return { enabled: false, mode: "disabled", models: [] };
	if (override?.mode === "custom")
		return {
			enabled: (override.models?.length ?? 0) > 0,
			mode: "custom",
			models: override.models ?? [],
		};
	return {
		enabled: settings.enabled && settings.models.length > 0,
		mode: "global",
		models: settings.models,
	};
}

export function updateModelFallbackSettings(value: unknown): ModelFallbackSettings {
	if (!isModelFallbackSettings(value)) throw new Error("Invalid model fallback settings");
	const settings = normalizeSettings(value);
	saveModelFallbackSettings(settings);
	publisher?.(settings);
	return settings;
}

export function setModelFallbackPublisher(fn: ModelFallbackPublisher | null): void {
	publisher = fn;
}

function normalizeModels(models: readonly ModelFallbackModelRef[]): ModelFallbackModelRef[] {
	const result: ModelFallbackModelRef[] = [];
	for (const model of models.slice(0, MODEL_FALLBACK_MODELS_LIMIT)) {
		if (
			!result.some(
				(candidate) => candidate.provider === model.provider && candidate.id === model.id,
			)
		)
			result.push({ provider: model.provider, id: model.id });
	}
	return result;
}

function normalizeSettings(settings: ModelFallbackSettings): ModelFallbackSettings {
	return {
		version: 1,
		enabled: settings.enabled,
		models: normalizeModels(settings.models),
		projects: Object.fromEntries(
			Object.entries(settings.projects).map(([projectId, override]) => [
				projectId,
				override.mode === "custom"
					? { mode: "custom" as const, models: normalizeModels(override.models ?? []) }
					: { mode: "disabled" as const },
			]),
		),
	};
}
