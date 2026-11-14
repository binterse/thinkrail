export {
	type FallbackModelRef,
	isFallbackProvider,
	isFallbackWorthyError,
	isQuotaExhaustion,
	type ModelFallbackPolicy,
	modelRefKey,
	normalizeFallbackModels,
} from "./src/core";
export {
	createModelFallbackExtension,
	type ModelFallbackExtensionCallbacks,
} from "./src/extension";
