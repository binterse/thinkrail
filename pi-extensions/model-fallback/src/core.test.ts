import { expect, test } from "bun:test";
import {
	isFallbackProvider,
	isFallbackWorthyError,
	isQuotaExhaustion,
	normalizeFallbackModels,
} from "./core";

test("classifies exhausted Go and Codex quotas but excludes auth and invalid-request failures", () => {
	expect(isQuotaExhaustion('429: {"type":"GoUsageLimitError"}')).toBe(true);
	expect(isQuotaExhaustion('429: {"code":"usage_limit_reached"}')).toBe(true);
	expect(isQuotaExhaustion('429: {"type":"subscription_sharing_usage_limit_exceeded"}')).toBe(true);
	expect(isQuotaExhaustion("You have hit your ChatGPT usage limit")).toBe(true);
	expect(isFallbackWorthyError("upstream overloaded: 503")).toBe(true);
	expect(isFallbackWorthyError("401 invalid API key")).toBe(false);
	expect(isFallbackWorthyError("400 invalid request: unsupported parameter")).toBe(false);
	expect(isFallbackWorthyError("provider rejected the prompt")).toBe(false);
});

test("limits fallback eligibility to Go and Codex providers", () => {
	expect(isFallbackProvider("opencode-go")).toBe(true);
	expect(isFallbackProvider("openai-codex")).toBe(true);
	expect(isFallbackProvider("opencode")).toBe(false);
	expect(isFallbackProvider("anthropic")).toBe(false);
});

test("normalizes fallback identities while preserving order", () => {
	expect(
		normalizeFallbackModels([
			{ provider: "deepseek", id: "chat" },
			{ provider: "deepseek", id: "chat" },
			{ provider: "anthropic", id: "sonnet" },
			{ provider: "", id: "ignored" },
		]),
	).toEqual([
		{ provider: "deepseek", id: "chat" },
		{ provider: "anthropic", id: "sonnet" },
	]);
});
