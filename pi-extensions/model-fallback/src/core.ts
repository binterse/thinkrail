export interface FallbackModelRef {
	provider: string;
	id: string;
}

export interface ModelFallbackPolicy {
	enabled: boolean;
	models: readonly FallbackModelRef[];
}

const QUOTA_ERROR =
	/GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|insufficient_quota|quota[_ ](?:exceeded|exhausted)|usage[_ ]limit(?:[_ ](?:reached|exceeded))?|subscription_sharing_usage_limit_exceeded|subscription_sharing_workplace_individual_usage_limit_exceeded|out of budget/i;
const AUTH_ERROR =
	/unauthorized|authentication|invalid api key|invalid_api_key|permission denied|forbidden|401|403/i;
const INVALID_REQUEST =
	/bad request|invalid request|invalid_request|model_not_found|not found|unsupported parameter|context length|maximum context/i;
const TRANSIENT_ERROR =
	/\b429\b|rate limit|rate_limit|overloaded|temporarily unavailable|\b5\d\d\b|econnreset|econnrefused|etimedout|fetch failed|network error|connection closed|stream ended/i;

export function modelRefKey(model: FallbackModelRef): string {
	return `${model.provider}\0${model.id}`;
}

export function normalizeFallbackModels(value: unknown): FallbackModelRef[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const models: FallbackModelRef[] = [];
	for (const item of value) {
		if (
			!item ||
			typeof item !== "object" ||
			typeof item.provider !== "string" ||
			!item.provider.trim() ||
			typeof item.id !== "string" ||
			!item.id.trim()
		)
			continue;
		const model = { provider: item.provider, id: item.id };
		const key = modelRefKey(model);
		if (seen.has(key)) continue;
		seen.add(key);
		models.push(model);
	}
	return models;
}

export function isQuotaExhaustion(errorMessage: string): boolean {
	return QUOTA_ERROR.test(errorMessage);
}

export function isFallbackWorthyError(errorMessage: string): boolean {
	if (AUTH_ERROR.test(errorMessage) || INVALID_REQUEST.test(errorMessage)) return false;
	return isQuotaExhaustion(errorMessage) || TRANSIENT_ERROR.test(errorMessage);
}

export function isFallbackProvider(provider: string): boolean {
	return provider === "opencode" || provider === "openai-codex";
}
