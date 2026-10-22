// pi extension: registers a "foundry" provider backed by Azure AI Foundry
// deployments, authenticated with Microsoft Entra ID (no API keys).
//
// - Deployments are discovered from the Foundry resource via ARM (az CLI).
// - GPT/codex deployments use the OpenAI Responses API at <endpoint>/openai/v1.
// - Claude deployments use the Anthropic Messages API at <endpoint>/anthropic.
// - Every request resolves auth through a token cache that refreshes the
//   Entra token ~10 minutes before expiry, so long sessions never 401.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as piAi from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import {
	PROVIDER_ID,
	TokenProvider,
	discover,
	loadConfig,
	planModels,
	preferenceScore,
} from "../lib/foundry.mjs";

type Planned = ReturnType<typeof planModels>["models"][number];

const DEFAULT_THINKING = { off: "none", minimal: null, low: "low", medium: "medium", high: "high" };

function readSettings(): { defaultProvider?: string; defaultModel?: string } {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	try {
		return JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
	} catch {
		return {};
	}
}

function catalog(provider: string): any[] {
	try {
		return getBuiltinModels(provider as any) as any[];
	} catch {
		return [];
	}
}

/** Find pi's built-in metadata (context window, reasoning, cost...) for a Foundry model name. */
function lookupMeta(p: Planned): any | undefined {
	const name = String(p.model || p.deployment).toLowerCase();
	const lists = p.family === "anthropic" ? [catalog("anthropic")] : [catalog("azure-openai-responses"), catalog("openai")];
	const stripped = name.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
	for (const list of lists) {
		const exact = list.find((m) => m.id === name) || list.find((m) => m.id === stripped);
		if (exact) return exact;
	}
	for (const list of lists) {
		const prefix = list
			.filter((m) => stripped.startsWith(m.id))
			.sort((a, b) => b.id.length - a.id.length)[0];
		if (prefix) return prefix;
	}
	return undefined;
}

function toPiModel(p: Planned) {
	const meta = lookupMeta(p);
	const looksReasoning = /gpt-5|codex|^o\d|claude/i.test(String(p.model));
	const label = meta?.name || p.model;
	const thinkingLevelMap =
		p.api === "openai-responses" && meta?.reasoning
			? { ...DEFAULT_THINKING, ...(meta?.thinkingLevelMap || {}) }
			: meta?.thinkingLevelMap;
	const model: any = {
		id: p.deployment,
		name: p.deployment === p.model ? `${label} (Foundry)` : `${label} (Foundry: ${p.deployment})`,
		api: p.api,
		provider: PROVIDER_ID,
		baseUrl: p.baseUrl,
		reasoning: meta?.reasoning ?? looksReasoning,
		input: meta?.input ?? ["text", "image"],
		cost: meta?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: meta?.contextWindow ?? 128_000,
		maxTokens: meta?.maxTokens ?? 16_384,
		...(thinkingLevelMap ? { thinkingLevelMap } : {}),
		...(meta?.compat ? { compat: { ...meta.compat } } : {}),
		...p.overrides,
	};
	return model;
}

export default async function foundryExtension(pi: ExtensionAPI) {
	const cfg = loadConfig();
	const tokens = new TokenProvider({ scope: cfg.scope, tenant: cfg.tenant });

	let plan: ReturnType<typeof planModels> = { endpoint: cfg.endpoint, models: [], skipped: [] };
	let discovered: any;
	const warnings: string[] = [];

	async function build(force = false) {
		warnings.length = 0;
		discovered = undefined;
		if (cfg.discover) {
			try {
				discovered = await discover(cfg, { force });
			} catch (e: any) {
				warnings.push(`Foundry discovery failed: ${e.message}`);
			}
		}
		plan = planModels(cfg, discovered);
		if (!plan.models.length) {
			warnings.push(
				"No usable Foundry chat deployments found. Run `docker compose run --rm pi doctor`, or add models to foundry.json.",
			);
		}
		return plan.models.map(toPiModel);
	}

	function register(models: any[]) {
		pi.registerProvider(
			piAi.createProvider({
				id: PROVIDER_ID,
				name: "Azure AI Foundry",
				auth: {
					apiKey: {
						name: "Microsoft Entra ID (Azure CLI)",
						// Cheap availability check so model listing never shells out to az.
						async check() {
							return { source: "Microsoft Entra ID", type: "api_key" as const };
						},
						async resolve() {
							const token = await tokens.getToken();
							return {
								auth: { headers: { Authorization: `Bearer ${token}` } },
								source: "Microsoft Entra ID",
							};
						},
					},
				},
				models,
				api: {
					"openai-responses": piAi.openAIResponsesApi(),
					"openai-completions": piAi.openAICompletionsApi(),
					"anthropic-messages": piAi.anthropicMessagesApi(),
				} as any,
			}) as any,
		);
	}

	register(await build());

	const argv = process.argv.slice(2);
	const userPickedModel = argv.some((a) => /^(--model|--provider|-m)(=|$)/.test(a));

	pi.on("session_start", async (event: any, ctx: any) => {
		for (const w of warnings) ctx.ui.notify(w, "warning");
		if (event?.reason && event.reason !== "startup") return;
		if (userPickedModel || !plan.models.length) return;

		// FOUNDRY_DEFAULT_MODEL wins. Otherwise respect a model the user saved
		// (Ctrl+S in /model); with nothing saved, pick the strongest coder.
		let target = cfg.defaultModel;
		if (!target) {
			const saved = readSettings();
			if (saved.defaultProvider && saved.defaultModel) return;
			target = [...plan.models].sort((a, b) => preferenceScore(b) - preferenceScore(a))[0]?.deployment;
		}
		if (!target || (ctx.model?.provider === PROVIDER_ID && ctx.model?.id === target)) return;
		const model = ctx.modelRegistry.find(PROVIDER_ID, target);
		if (!model) {
			ctx.ui.notify(`FOUNDRY_DEFAULT_MODEL "${target}" is not a known Foundry deployment`, "warning");
			return;
		}
		await pi.setModel(model);
	});

	// Tell the model where it is: a Linux container sharing the project with
	// the user's machine. Prevents host-only commands and broken docker -v paths.
	const hostOs = { darwin: "macOS", windows: "Windows", linux: "Linux", wsl: "Windows (WSL)" }[
		String(process.env.HOST_OS || "").toLowerCase()
	];
	const hostWs = process.env.HOST_WORKSPACE;
	if (hostWs || hostOs) {
		const envNote = [
			`You run inside a Debian Linux container. The project at /workspace is shared with the user's ${hostOs ?? "host"} machine${hostWs ? `, where it lives at ${hostWs}` : ""}.`,
			"- Available: git, python3 + pip, uv, node + npm + pnpm, make, gcc/g++, ripgrep, fd, jq, sqlite3, and the docker CLI (connected to the user's Docker).",
			"- Host-only programs (Homebrew, Windows .exe tools, the user's local virtualenvs) are not available. Install Linux equivalents instead.",
			"- Prefer `uv` for Python: its project environments are kept outside /workspace, so the user's own .venv is never touched. Avoid creating .venv inside /workspace.",
			"- node_modules built here contain Linux binaries; mention this if the user also runs the project natively.",
			hostWs
				? `- For docker bind mounts use the host path: \`docker run -v "$HOST_WORKSPACE:/src" ...\` (not /workspace), because the Docker daemon runs on the host.`
				: "",
		]
			.filter(Boolean)
			.join("\n");
		pi.on("before_agent_start", async (event: any) => {
			const opts = event?.systemPromptOptions;
			if (opts) opts.sections = { ...(opts.sections || {}), "pi-foundry-environment": envNote };
		});
	}

	pi.registerCommand("foundry", {
		description: "Azure AI Foundry status. `/foundry refresh` re-discovers deployments.",
		getArgumentCompletions: (prefix: string) =>
			["refresh", "token"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
		handler: async (args: string, ctx: any) => {
			const sub = args.trim();
			if (sub === "refresh") {
				const models = await build(true);
				register(models);
				for (const w of warnings) ctx.ui.notify(w, "warning");
				ctx.ui.notify(`Foundry: ${models.length} model(s) registered`, "info");
				return;
			}
			if (sub === "token") {
				try {
					await tokens.getToken({ forceRefresh: true });
					ctx.ui.notify(`Token refreshed; expires ${new Date(tokens.expiresAt!).toLocaleTimeString()}`, "info");
				} catch (e: any) {
					ctx.ui.notify(e.message, "error");
				}
				return;
			}
			const lines = [
				`Endpoint: ${plan.endpoint ?? "(unknown)"}`,
				discovered?.account ? `Resource: ${discovered.account.name} (${discovered.account.resourceGroup}, ${discovered.account.location})` : "",
				`Scope: ${cfg.scope}`,
				`Token: ${tokens.expiresAt ? `valid until ${new Date(tokens.expiresAt).toLocaleTimeString()}` : "not fetched yet"}`,
				"Models:",
				...plan.models.map((m) => `  ${m.deployment}  →  ${m.model} [${m.api}]`),
				...(plan.skipped.length ? ["Skipped:", ...plan.skipped.map((s) => `  ${s.deployment}: ${s.reason}`)] : []),
			].filter(Boolean);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
