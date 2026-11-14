import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
	type AgentSessionEvent,
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createModelFallbackExtension } from "./extension";

const model = (id: string, contextWindow = 100_000) => ({
	id,
	name: id,
	reasoning: true,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow,
	maxTokens: 2048,
});

test("a quota uses the ordered fallback through tools, then a new user turn restores the selected model", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-model-fallback-"));
	const agentDir = join(cwd, ".pi-agent");
	mkdirSync(agentDir);
	writeFileSync(join(cwd, "answer.txt"), "read once");
	const codex = createFauxCore({
		provider: "openai-codex",
		api: "fallback-test-codex",
		models: [model("codex-main")],
		tokensPerSecond: 100_000,
	});
	const fallback = createFauxCore({
		provider: "deepseek",
		api: "fallback-test-deepseek",
		models: [model("deepseek-chat", 32_000)],
		tokensPerSecond: 100_000,
	});
	const missingAuth = createFauxCore({
		provider: "fallback-no-auth",
		api: "fallback-test-no-auth",
		models: [model("no-auth-model")],
		tokensPerSecond: 100_000,
	});
	const secondFallback = createFauxCore({
		provider: "anthropic",
		api: "fallback-test-anthropic",
		models: [model("claude-sonnet", 16_000)],
		tokensPerSecond: 100_000,
	});
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	for (const [provider, core, id] of [
		["openai-codex", codex, "codex-main"],
		["deepseek", fallback, "deepseek-chat"],
		["anthropic", secondFallback, "claude-sonnet"],
	] as const) {
		runtime.registerProvider(provider, {
			api: core.api,
			apiKey: "fixture-only-key",
			baseUrl: "http://fixture.invalid",
			streamSimple: core.streamSimple,
			models: [
				{
					...model(id, id === "deepseek-chat" ? 32_000 : id === "claude-sonnet" ? 16_000 : 100_000),
					api: core.api,
				},
			],
		});
	}
	runtime.registerProvider("fallback-no-auth", {
		api: missingAuth.api,
		authHeader: true,
		baseUrl: "http://fixture.invalid",
		streamSimple: missingAuth.streamSimple,
		models: [{ ...model("no-auth-model"), api: missingAuth.api }],
	});
	await runtime.refresh({ allowNetwork: false });
	const settingsManager = SettingsManager.inMemory({
		retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
	});
	let policyReads = 0;
	let policyEnabled = true;
	let configuredModels = [
		{ provider: "missing-provider", id: "not-installed" },
		{ provider: "fallback-no-auth", id: "no-auth-model" },
		{ provider: "deepseek", id: "deepseek-chat" },
		{ provider: "deepseek", id: "deepseek-chat" },
		{ provider: "anthropic", id: "claude-sonnet" },
	];
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [
			createModelFallbackExtension(() => {
				policyReads++;
				return { enabled: policyEnabled, models: configuredModels };
			}),
		],
	});
	await resourceLoader.reload();
	codex.setResponses([
		fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: '429: {"type":"GoUsageLimitError","message":"usage limit reached"}',
		}),
		fauxAssistantMessage("The next turn used Codex."),
	]);
	fallback.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: "answer.txt" })),
		fauxAssistantMessage("", {
			stopReason: "error",
			errorMessage: '429: {"type":"FreeUsageLimitError","message":"usage limit reached"}',
		}),
	]);
	secondFallback.setResponses([
		fauxAssistantMessage("The second fallback completed the tool step."),
	]);
	const selectedModel = runtime.getModel("openai-codex", "codex-main");
	if (!selectedModel) throw new Error("Missing Codex fixture model");
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		model: selectedModel,
		modelRuntime: runtime,
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
	});
	let concurrentSession: typeof session | undefined;
	let concurrentUnsubscribe: (() => void) | undefined;
	const events: AgentSessionEvent[] = [];
	const unsubscribe = session.subscribe((event) => events.push(event));
	try {
		await session.prompt("Read the answer file.");
		expect(policyReads).toBe(2);
		expect(codex.state.callCount).toBe(1);
		expect(fallback.state.callCount).toBe(2);
		expect(missingAuth.state.callCount).toBe(0);
		expect(secondFallback.state.callCount).toBe(1);
		expect(session.model).toMatchObject({ provider: "openai-codex", id: "codex-main" });
		expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
		expect(session.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
		expect(session.messages.filter((message) => message.role === "assistant").at(-1)).toMatchObject(
			{
				provider: "anthropic",
				model: "claude-sonnet",
				stopReason: "stop",
			},
		);
		expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(1);
		expect(session.getContextUsage()?.contextWindow).toBe(16_000);

		await session.prompt("Use the selected model again.");
		expect(codex.state.callCount).toBe(2);
		expect(fallback.state.callCount).toBe(2);
		expect(secondFallback.state.callCount).toBe(1);
		expect(session.model).toMatchObject({ provider: "openai-codex", id: "codex-main" });
		expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
		expect(session.messages.filter((message) => message.role === "assistant").at(-1)).toMatchObject(
			{
				provider: "openai-codex",
				model: "codex-main",
			},
		);
		expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(2);

		let fallbackStarted!: () => void;
		const fallbackRequestStarted = new Promise<void>((resolve) => {
			fallbackStarted = resolve;
		});
		let releaseFallback!: () => void;
		const fallbackResponseReleased = new Promise<void>((resolve) => {
			releaseFallback = resolve;
		});
		codex.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: '429: {"type":"GoUsageLimitError"}',
			}),
			fauxAssistantMessage("The queued follow-up used Codex again."),
		]);
		fallback.setResponses([
			async () => {
				fallbackStarted();
				await fallbackResponseReleased;
				return fauxAssistantMessage("The fallback completed before the queued follow-up.");
			},
		]);
		const queuedRun = session.prompt("Trigger fallback before a queued follow-up.");
		await fallbackRequestStarted;
		await session.followUp("Use the selected model for this queued follow-up.");
		releaseFallback();
		await queuedRun;
		expect(codex.state.callCount).toBe(4);
		expect(fallback.state.callCount).toBe(3);
		expect(session.messages.filter((message) => message.role === "user")).toHaveLength(4);
		expect(session.messages.filter((message) => message.role === "assistant").at(-1)).toMatchObject(
			{
				provider: "openai-codex",
				model: "codex-main",
			},
		);
		expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(3);

		fallback.appendResponses([fauxAssistantMessage("Recovered after transient retries.")]);
		codex.appendResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503: service unavailable" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503: service unavailable" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503: service unavailable" }),
		]);
		await session.prompt("Try again after a temporary outage.");
		expect(codex.state.callCount).toBe(7);
		expect(fallback.state.callCount).toBe(4);
		expect(secondFallback.state.callCount).toBe(1);
		expect(events.filter((event) => event.type === "auto_retry_start")).toHaveLength(2);
		expect(session.messages.filter((message) => message.role === "user")).toHaveLength(5);
		expect(session.messages.filter((message) => message.role === "assistant").at(-1)).toMatchObject(
			{
				provider: "deepseek",
				model: "deepseek-chat",
			},
		);
		expect(events.filter((event) => event.type === "agent_settled")).toHaveLength(4);
		expect(session.getContextUsage()?.contextWindow).toBe(32_000);

		const concurrentLoader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			extensionFactories: [
				createModelFallbackExtension(() => ({
					enabled: true,
					models: [{ provider: "deepseek", id: "deepseek-chat" }],
				})),
			],
		});
		await concurrentLoader.reload();
		const concurrent = await createAgentSession({
			cwd,
			agentDir,
			model: selectedModel,
			modelRuntime: runtime,
			settingsManager,
			resourceLoader: concurrentLoader,
			sessionManager: SessionManager.inMemory(cwd),
		});
		concurrentSession = concurrent.session;
		const concurrentEvents: AgentSessionEvent[] = [];
		concurrentUnsubscribe = concurrent.session.subscribe((event) => concurrentEvents.push(event));
		codex.appendResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: '429: {"type":"GoUsageLimitError"}',
			}),
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: '429: {"type":"GoUsageLimitError"}',
			}),
		]);
		fallback.appendResponses([
			fauxAssistantMessage("First concurrent fallback."),
			fauxAssistantMessage("Second concurrent fallback."),
		]);
		await Promise.all([
			session.prompt("Concurrent conversation A."),
			concurrent.session.prompt("Concurrent conversation B."),
		]);
		expect(codex.state.callCount).toBe(9);
		expect(fallback.state.callCount).toBe(6);
		expect(session.model).toMatchObject({ provider: "openai-codex", id: "codex-main" });
		expect(concurrent.session.model).toMatchObject({ provider: "openai-codex", id: "codex-main" });
		expect(concurrent.session.messages.filter((message) => message.role === "user")).toHaveLength(
			1,
		);
		expect(
			concurrent.session.messages.filter((message) => message.role === "assistant").at(-1),
		).toMatchObject({
			provider: "deepseek",
			model: "deepseek-chat",
		});
		expect(concurrentEvents.filter((event) => event.type === "agent_settled")).toHaveLength(1);

		configuredModels = [];
		codex.setResponses([
			fauxAssistantMessage("", {
				stopReason: "error",
				errorMessage: '429: {"type":"GoUsageLimitError"}',
			}),
		]);
		await session.prompt("Quota with an empty fallback list.");
		expect(codex.state.callCount).toBe(10);
		expect(fallback.state.callCount).toBe(6);
		policyEnabled = false;
		codex.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503: service unavailable" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503: service unavailable" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "503: service unavailable" }),
		]);
		await session.prompt("Fallback is disabled, so pi keeps its normal retries.");
		expect(codex.state.callCount).toBe(13);
		expect(fallback.state.callCount).toBe(6);

		let requestStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		codex.setResponses([
			async (_context, options) => {
				requestStarted();
				const signal = options?.signal;
				if (!signal || signal.aborted) return fauxAssistantMessage("", { stopReason: "aborted" });
				await new Promise<void>((resolve) => {
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("", { stopReason: "aborted", errorMessage: "request aborted" });
			},
		]);
		const stoppingPrompt = session.prompt("Stop this turn.");
		await started;
		await session.abort();
		await Promise.allSettled([stoppingPrompt]);
		expect(codex.state.callCount).toBe(14);
		expect(fallback.state.callCount).toBe(6);
	} finally {
		unsubscribe();
		concurrentUnsubscribe?.();
		concurrentSession?.dispose();
		session.dispose();
		runtime.unregisterProvider("openai-codex");
		runtime.unregisterProvider("deepseek");
		runtime.unregisterProvider("fallback-no-auth");
		runtime.unregisterProvider("anthropic");
		rmSync(cwd, { recursive: true, force: true });
	}
});
