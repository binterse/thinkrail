import type {
	ExtensionAPI,
	ExtensionFactory,
	ModelFallbackEventResult,
} from "@earendil-works/pi-coding-agent";
import {
	isFallbackProvider,
	isFallbackWorthyError,
	isQuotaExhaustion,
	type ModelFallbackPolicy,
	modelRefKey,
	normalizeFallbackModels,
} from "./core";

async function awaitWithAbort<T>(
	promise: Promise<T>,
	signal?: AbortSignal,
): Promise<T | undefined> {
	if (!signal) return promise;
	if (signal.aborted) return;
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<undefined>((resolve) => {
		onAbort = () => resolve(undefined);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}

export function createModelFallbackExtension(
	resolvePolicy: () => ModelFallbackPolicy,
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		let policy = resolvePolicy();
		pi.on("message_start", (event) => {
			if (event.message.role === "user") policy = resolvePolicy();
		});
		pi.on("model_fallback", async (event, ctx): Promise<ModelFallbackEventResult | undefined> => {
			const errorMessage = event.failedMessage.errorMessage ?? "";
			const quotaExhausted = isQuotaExhaustion(errorMessage);
			if (
				event.signal?.aborted ||
				!policy.enabled ||
				!isFallbackProvider(event.selectedModel.provider)
			)
				return;
			if (!isFallbackWorthyError(errorMessage)) return;
			if (!quotaExhausted && event.retryEnabled && event.retryAttempt < event.maxRetries) return;

			const attempted = new Set([
				modelRefKey(event.selectedModel),
				modelRefKey(event.failedModel),
				...event.triedModels.map(modelRefKey),
			]);
			for (const reference of normalizeFallbackModels(policy.models)) {
				const key = modelRefKey(reference);
				if (attempted.has(key)) continue;
				const model = ctx.modelRegistry.find(reference.provider, reference.id);
				if (!model) {
					ctx.ui.notify(
						`Fallback model ${reference.provider}/${reference.id} is unavailable; skipping it.`,
						"warning",
					);
					attempted.add(key);
					continue;
				}
				const auth = await awaitWithAbort(
					ctx.modelRegistry.getApiKeyAndHeaders(model),
					event.signal,
				);
				if (!auth || event.signal?.aborted) return;
				if (!auth.ok) {
					ctx.ui.notify(
						`Fallback model ${reference.provider}/${reference.id} has no configured authentication; skipping it.`,
						"warning",
					);
					attempted.add(key);
					continue;
				}
				if (!ctx.modelRegistry.getAvailable().some((candidate) => modelRefKey(candidate) === key)) {
					ctx.ui.notify(
						`Fallback model ${reference.provider}/${reference.id} is unavailable; skipping it.`,
						"warning",
					);
					attempted.add(key);
					continue;
				}
				ctx.ui.notify(
					`Switching from ${event.failedModel.provider}/${event.failedModel.id} to ${model.provider}/${model.id} ${quotaExhausted ? "after the provider quota was exhausted." : "after provider retries were exhausted."}`,
					"warning",
				);
				return {
					model,
					...(ctx.thinkingLevel ? { thinkingLevel: ctx.thinkingLevel } : {}),
				};
			}
			const attemptedModels = normalizeFallbackModels([
				event.selectedModel,
				...event.triedModels,
				event.failedModel,
			]);
			ctx.ui.notify(
				`Model fallback chain exhausted after trying ${attemptedModels.map((model) => `${model.provider}/${model.id}`).join(", ")}. The final error is shown in the chat.`,
				"error",
			);
			return { skipRetries: quotaExhausted };
		});
	};
}
