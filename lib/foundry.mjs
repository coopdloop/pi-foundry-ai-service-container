// Shared Foundry logic used by the pi extension and the `pi-foundry` CLI.
// No npm dependencies: identity comes from the Azure CLI (`az`), which the
// entrypoint has already logged in.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_SCOPE = "https://ai.azure.com/.default";
export const PROVIDER_ID = "foundry";

// Refresh tokens this long before they expire so in-flight requests never
// carry a token that dies mid-stream.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const FOUNDRY_KINDS = new Set(["AIServices", "OpenAI"]);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function agentDir() {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function cacheDir() {
	return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pi-foundry");
}

const parseBool = (v) => (v === undefined || v === "" ? undefined : !/^(0|false|no|off)$/i.test(v));
const parseList = (v) =>
	v
		? v
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: undefined;
const trimSlash = (v) => (v ? v.replace(/\/+$/, "") : undefined);

/**
 * Merge `foundry.json` (in the pi agent dir) with FOUNDRY_* env vars.
 * Env vars win so a one-off `FOUNDRY_RESOURCE=x docker compose run ...` works.
 */
export function loadConfig() {
	const file = process.env.FOUNDRY_CONFIG || join(agentDir(), "foundry.json");
	let fc = {};
	if (existsSync(file)) {
		try {
			fc = JSON.parse(readFileSync(file, "utf8"));
		} catch (e) {
			throw new Error(`Invalid JSON in ${file}: ${e.message}`);
		}
	}
	const env = process.env;
	return {
		file,
		fileExists: existsSync(file),
		resource: env.FOUNDRY_RESOURCE || fc.resource,
		resourceGroup: env.FOUNDRY_RESOURCE_GROUP || fc.resourceGroup,
		subscription: env.AZURE_SUBSCRIPTION_ID || fc.subscription,
		tenant: env.AZURE_TENANT_ID || fc.tenant,
		endpoint: trimSlash(env.FOUNDRY_ENDPOINT || fc.endpoint),
		scope: env.FOUNDRY_SCOPE || fc.scope || DEFAULT_SCOPE,
		discover: parseBool(env.FOUNDRY_DISCOVER) ?? fc.discover ?? true,
		includeOtherModels: parseBool(env.FOUNDRY_INCLUDE_OTHER_MODELS) ?? fc.includeOtherModels ?? false,
		defaultModel: env.FOUNDRY_DEFAULT_MODEL || fc.defaultModel,
		exclude: parseList(env.FOUNDRY_EXCLUDE) || fc.exclude || [],
		models: Array.isArray(fc.models) ? fc.models : [],
		discoveryTtlSeconds: Number(env.FOUNDRY_DISCOVERY_TTL ?? fc.discoveryTtlSeconds ?? 600),
	};
}

// ---------------------------------------------------------------------------
// Azure CLI
// ---------------------------------------------------------------------------

export class AzError extends Error {
	constructor(message, args) {
		super(message);
		this.name = "AzError";
		this.args = args;
	}
}

/** Run `az ... -o json` and parse the result. */
export function az(args, { timeoutMs = 90_000, signal } = {}) {
	return new Promise((resolve, reject) => {
		execFile(
			"az",
			[...args, "--only-show-errors", "-o", "json"],
			{
				timeout: timeoutMs,
				maxBuffer: 32 * 1024 * 1024,
				signal,
				env: { ...process.env, AZURE_CORE_NO_COLOR: "1", AZURE_CORE_ONLY_SHOW_ERRORS: "1" },
			},
			(err, stdout, stderr) => {
				if (err) {
					if (err.code === "ENOENT") return reject(new AzError("Azure CLI (az) not found on PATH", args));
					const msg = (stderr || "").trim() || err.message;
					return reject(new AzError(msg, args));
				}
				const out = stdout.trim();
				if (!out) return resolve(null);
				try {
					resolve(JSON.parse(out));
				} catch {
					reject(new AzError(`az ${args.join(" ")} returned non-JSON output`, args));
				}
			},
		);
	});
}

/** Turn raw az/HTTP auth errors into something a user can act on. */
export function explainAuthError(message) {
	const m = String(message);
	const hints = [];
	if (/az login|not logged in|No subscription found|Please run 'az login'/i.test(m)) {
		hints.push("Not signed in. Run: docker compose run --rm pi login");
	}
	if (/AADSTS700082|AADSTS50173|refresh token has expired|interaction_required|AADSTS50076|AADSTS50079/i.test(m)) {
		hints.push("Your Azure sign-in expired or needs MFA. Run: docker compose run --rm pi login");
	}
	if (/AADSTS50020|AADSTS90072|tenant/i.test(m) && !hints.length) {
		hints.push("Wrong tenant? Set AZURE_TENANT_ID in .env and run: docker compose run --rm pi login");
	}
	if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|certificate|SSL/i.test(m)) {
		hints.push("Network/TLS problem reaching Microsoft Entra ID. See docs: Troubleshooting > Network.");
	}
	return hints.length ? `${m}\n\n→ ${hints.join("\n→ ")}` : m;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * Caches one Entra ID access token and refreshes it ahead of expiry.
 * Concurrent callers share a single in-flight `az` call.
 */
export class TokenProvider {
	constructor({ scope = DEFAULT_SCOPE, tenant } = {}) {
		this.scope = scope;
		this.tenant = tenant;
		this.cached = undefined;
		this.inflight = undefined;
		this.lastError = undefined;

		// The entrypoint already fetched a token while checking the login;
		// reuse it, then scrub it so tool subprocesses never inherit it.
		const t = process.env.FOUNDRY_BOOTSTRAP_TOKEN;
		const exp = Number(process.env.FOUNDRY_BOOTSTRAP_EXPIRES_ON);
		if (t && exp && process.env.FOUNDRY_BOOTSTRAP_SCOPE === scope) {
			this.cached = { token: t, expiresAt: exp * 1000, source: "bootstrap" };
		}
		delete process.env.FOUNDRY_BOOTSTRAP_TOKEN;
		delete process.env.FOUNDRY_BOOTSTRAP_EXPIRES_ON;
		delete process.env.FOUNDRY_BOOTSTRAP_SCOPE;
	}

	get expiresAt() {
		return this.cached?.expiresAt;
	}

	async getToken({ forceRefresh = false } = {}) {
		if (!forceRefresh && this.cached && this.cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
			return this.cached.token;
		}
		if (!this.inflight) {
			this.inflight = this.#fetch().finally(() => {
				this.inflight = undefined;
			});
		}
		return this.inflight;
	}

	async #fetch() {
		const args = ["account", "get-access-token", "--scope", this.scope];
		if (this.tenant) args.push("--tenant", this.tenant);
		let res;
		for (let attempt = 1; ; attempt++) {
			try {
				res = await az(args, { timeoutMs: 60_000 });
				break;
			} catch (e) {
				// Transient network blips on token refresh shouldn't kill a session.
				const transient = /ETIMEDOUT|ECONNRESET|EAI_AGAIN|timed out|Connection aborted|temporarily/i.test(e.message);
				if (transient && attempt < 3) {
					await new Promise((r) => setTimeout(r, attempt * 2000));
					continue;
				}
				this.lastError = e.message;
				// Fall back to a still-valid cached token rather than failing the request.
				if (this.cached && this.cached.expiresAt - Date.now() > 60_000) return this.cached.token;
				throw new Error(`Could not get a Microsoft Entra ID token for ${this.scope}:\n${explainAuthError(e.message)}`);
			}
		}
		const expiresAt = res.expires_on ? Number(res.expires_on) * 1000 : Date.now() + 45 * 60 * 1000;
		this.cached = { token: res.accessToken, expiresAt, source: "az" };
		this.lastError = undefined;
		return res.accessToken;
	}
}

// ---------------------------------------------------------------------------
// Discovery (ARM control plane)
// ---------------------------------------------------------------------------

function subArgs(cfg) {
	return cfg.subscription ? ["--subscription", cfg.subscription] : [];
}

function cacheFile(cfg) {
	const key = createHash("sha256")
		.update(JSON.stringify([cfg.resource, cfg.resourceGroup, cfg.subscription, cfg.endpoint]))
		.digest("hex")
		.slice(0, 16);
	return join(cacheDir(), `discovery-${key}.json`);
}

function readCache(cfg) {
	try {
		const data = JSON.parse(readFileSync(cacheFile(cfg), "utf8"));
		if (Date.now() - data.at < cfg.discoveryTtlSeconds * 1000) return data;
	} catch {}
	return undefined;
}

function writeCache(cfg, data) {
	try {
		const f = cacheFile(cfg);
		mkdirSync(dirname(f), { recursive: true });
		writeFileSync(f, JSON.stringify(data));
	} catch {}
}

function endpointFromAccount(account) {
	const p = account.properties || {};
	const eps = p.endpoints || {};
	const foundry = eps["AI Foundry API"] || eps["Azure AI Model Inference API"];
	if (foundry) return trimSlash(foundry);
	if (p.customSubDomainName) return `https://${p.customSubDomainName}.services.ai.azure.com`;
	return trimSlash(p.endpoint);
}

/** Find the Foundry account, either the named one or the only one in the subscription. */
async function findAccount(cfg) {
	if (cfg.resource && cfg.resourceGroup) {
		return az(["cognitiveservices", "account", "show", "-n", cfg.resource, "-g", cfg.resourceGroup, ...subArgs(cfg)]);
	}
	const all = (await az(["cognitiveservices", "account", "list", ...subArgs(cfg)])) || [];
	const candidates = all.filter((a) => FOUNDRY_KINDS.has(a.kind));
	if (cfg.resource) {
		const hit = candidates.find((a) => a.name.toLowerCase() === cfg.resource.toLowerCase());
		if (!hit) {
			throw new Error(
				`Foundry resource "${cfg.resource}" not found in the current subscription.` +
					` Set AZURE_SUBSCRIPTION_ID, or check the name. Found: ${candidates.map((a) => a.name).join(", ") || "none"}`,
			);
		}
		return hit;
	}
	if (cfg.endpoint) {
		const host = new URL(cfg.endpoint).hostname.split(".")[0].toLowerCase();
		const hit = candidates.find((a) => (a.properties?.customSubDomainName || "").toLowerCase() === host);
		if (hit) return hit;
		throw new Error(`No Foundry resource with subdomain "${host}" in the current subscription.`);
	}
	if (candidates.length === 1) return candidates[0];
	if (!candidates.length) {
		throw new Error("No Foundry (AIServices/OpenAI) resources found in the current subscription. Set FOUNDRY_RESOURCE or AZURE_SUBSCRIPTION_ID.");
	}
	throw new Error(
		`Multiple Foundry resources found; set FOUNDRY_RESOURCE to one of: ${candidates.map((a) => `${a.name} (${a.resourceGroup})`).join(", ")}`,
	);
}

/**
 * Look up the resource endpoint and its deployments via ARM.
 * Results are cached on disk (default 10 min) so pi starts fast.
 */
export async function discover(cfg, { force = false } = {}) {
	if (!force) {
		const cached = readCache(cfg);
		if (cached) return { ...cached, fromCache: true };
	}
	const account = await findAccount(cfg);
	const rg = account.resourceGroup || /resourceGroups\/([^/]+)/i.exec(account.id)?.[1];
	const deployments =
		(await az(["cognitiveservices", "account", "deployment", "list", "-n", account.name, "-g", rg, ...subArgs(cfg)])) || [];
	const data = {
		at: Date.now(),
		account: {
			name: account.name,
			resourceGroup: rg,
			kind: account.kind,
			location: account.location,
			id: account.id,
			disableLocalAuth: account.properties?.disableLocalAuth,
			publicNetworkAccess: account.properties?.publicNetworkAccess,
		},
		endpoint: cfg.endpoint || endpointFromAccount(account),
		deployments: deployments.map((d) => ({
			name: d.name,
			model: d.properties?.model?.name,
			version: d.properties?.model?.version,
			format: d.properties?.model?.format,
			sku: d.sku?.name,
			capacity: d.sku?.capacity,
			state: d.properties?.provisioningState,
			capabilities: d.properties?.capabilities || {},
		})),
	};
	writeCache(cfg, data);
	return data;
}

// ---------------------------------------------------------------------------
// Model planning: deployment -> which pi API + base URL
// ---------------------------------------------------------------------------

const isTrue = (v) => v === true || v === "true";

/** Decide how pi should talk to a deployment, or why it is skipped. */
export function classifyDeployment(d, { includeOtherModels = false } = {}) {
	if (d.state && d.state !== "Succeeded") return { skip: `deployment state is ${d.state}` };
	const fmt = (d.format || "").toLowerCase();
	const caps = d.capabilities || {};
	if (fmt === "anthropic") return { api: "anthropic-messages", family: "anthropic" };
	if (fmt === "openai") {
		if (isTrue(caps.responses)) return { api: "openai-responses", family: "openai" };
		if (isTrue(caps.chatCompletion)) return { api: "openai-completions", family: "openai" };
		return { skip: "not a chat model (no responses/chatCompletion capability)" };
	}
	if (isTrue(caps.chatCompletion)) {
		return includeOtherModels
			? { api: "openai-completions", family: "other" }
			: { skip: `${d.format} model (set FOUNDRY_INCLUDE_OTHER_MODELS=1 to try it via Chat Completions)` };
	}
	return { skip: `unsupported format ${d.format || "unknown"}` };
}

export function baseUrlFor(api, endpoint) {
	const root = trimSlash(endpoint);
	return api === "anthropic-messages" ? `${root}/anthropic` : `${root}/openai/v1`;
}

/**
 * Combine discovered deployments with manual `models` entries from foundry.json.
 * Manual entries with the same deployment name override discovered ones.
 */
export function planModels(cfg, discovered) {
	const endpoint = cfg.endpoint || discovered?.endpoint;
	const planned = new Map();
	const skipped = [];
	const exclude = new Set(cfg.exclude.map((s) => s.toLowerCase()));

	for (const d of discovered?.deployments || []) {
		if (exclude.has(d.name.toLowerCase())) {
			skipped.push({ deployment: d.name, model: d.model, reason: "excluded by config" });
			continue;
		}
		const c = classifyDeployment(d, cfg);
		if (c.skip) {
			skipped.push({ deployment: d.name, model: d.model, reason: c.skip });
			continue;
		}
		planned.set(d.name, {
			deployment: d.name,
			model: d.model,
			version: d.version,
			format: d.format,
			family: c.family,
			api: c.api,
			baseUrl: baseUrlFor(c.api, endpoint),
			sku: d.sku,
			capacity: d.capacity,
			source: "discovered",
			overrides: {},
		});
	}

	for (const m of cfg.models) {
		const deployment = m.deployment || m.id;
		if (!deployment) continue;
		const prev = planned.get(deployment);
		const format = m.format || prev?.format || (/^claude/i.test(m.model || deployment) ? "Anthropic" : "OpenAI");
		const api =
			m.api ||
			prev?.api ||
			(format.toLowerCase() === "anthropic" ? "anthropic-messages" : format.toLowerCase() === "openai" ? "openai-responses" : "openai-completions");
		const ep = trimSlash(m.endpoint) || endpoint;
		if (!ep) {
			skipped.push({ deployment, model: m.model, reason: "no endpoint (set FOUNDRY_ENDPOINT or models[].endpoint)" });
			continue;
		}
		const { deployment: _d, id: _i, endpoint: _e, model: _m, format: _f, api: _a, ...overrides } = m;
		planned.set(deployment, {
			...(prev || {}),
			deployment,
			model: m.model || prev?.model || deployment,
			format,
			family: format.toLowerCase() === "anthropic" ? "anthropic" : format.toLowerCase() === "openai" ? "openai" : "other",
			api,
			baseUrl: m.baseUrl || baseUrlFor(api, ep),
			source: prev ? "discovered+config" : "config",
			overrides,
		});
	}

	return { endpoint, models: [...planned.values()], skipped };
}

/** Rank models so we pick a strong coding model when the user hasn't chosen one. */
export function preferenceScore(p) {
	const id = `${p.model || ""} ${p.deployment}`.toLowerCase();
	const ver = Number(/(\d+(?:\.\d+)?)/.exec(id.replace(/-(\d)-(\d)/, "-$1.$2"))?.[1] || 0);
	let s = ver;
	if (/claude/.test(id)) s += /opus/.test(id) ? 300 : /sonnet/.test(id) ? 250 : 100;
	else if (/codex/.test(id)) s += 280;
	else if (/gpt-5/.test(id)) s += 240;
	else if (/^o\d|\so\d/.test(id)) s += 150;
	else if (/gpt-4\.1/.test(id)) s += 120;
	if (/mini|nano|haiku|chat-latest|realtime|spark/.test(id)) s -= 80;
	if (/pro\b/.test(id)) s -= 40; // slow/expensive for interactive coding
	return s;
}
