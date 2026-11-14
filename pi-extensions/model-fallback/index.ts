export {
	type FallbackModelRef,
	isFallbackProvider,
	isFallbackWorthyError,
	isQuotaExhaustion,
	type ModelFallbackPolicy,
	modelRefKey,
	normalizeFallbackModels,
} from "./src/core";
export { createModelFallbackExtension } from "./src/extension";
