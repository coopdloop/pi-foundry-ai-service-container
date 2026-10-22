#!/usr/bin/env node
// `pi-foundry doctor` and `pi-foundry models`: check every link in the chain
// (az login -> Entra token -> ARM discovery -> each deployment) and say
// exactly what to fix when something is broken.

import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { TokenProvider, az, discover, explainAuthError, loadConfig, planModels } from "../lib/foundry.mjs";

const args = process.argv.slice(2);
const mode = args[0] === "models" ? "models" : "doctor";
const noPing = args.includes("--no-ping");
const asJson = args.includes("--json");

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const green = c(32), red = c(31), yellow = c(33), dim = c(2), bold = c(1);
const OK = green("✓"), BAD = red("✗"), WARN = yellow("!");

let failures = 0;
const line = (mark, label, detail = "") => console.log(`${mark} ${label}${detail ? ` ${dim(detail)}` : ""}`);
const fail = (label, detail, hint) => {
	failures++;
	line(BAD, label, detail);
	if (hint) console.log(`    ${yellow("→")} ${hint.split("\n").join("\n      ")}`);
};

function version(cmd, argv) {
	try {
		return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0];
	} catch {
		return undefined;
	}
}

function hintForStatus(status, body, p) {
	const b = String(body || "");
	if (status === 401) {
		return "Token rejected. Check FOUNDRY_SCOPE (default https://ai.azure.com/.default) and that you're signed in to the resource's tenant (AZURE_TENANT_ID).";
	}
	if (status === 403) {
		if (/public access is disabled|private endpoint|Virtual Network|firewall/i.test(b)) {
			return "Network rules block this client. Add your IP to the resource firewall or run from a network that can reach the private endpoint.";
		}
		return "Missing data-plane permission. Grant your identity the 'Foundry User' role (formerly 'Azure AI User') or 'Cognitive Services User' on the resource. See docs: Requirements.";
	}
	if (status === 404) {
		if (/DeploymentNotFound/i.test(b)) return `Deployment "${p.deployment}" not found at ${p.baseUrl}. Was it just created? Wait a few minutes.`;
		return `Endpoint path not found (${p.baseUrl}). If this resource is not a Foundry (AIServices) resource, Claude/Anthropic routes won't exist.`;
	}
	if (status === 429) return "Rate limited / out of quota. Raise the deployment's TPM capacity in Foundry (coding agents need ≥ 100K TPM to be comfortable).";
	if (status === 400 && /unsupported|not supported/i.test(b)) return "The deployment doesn't support this API. Override `api` for it in foundry.json.";
	return undefined;
}

async function ping(p, token) {
	const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
	let url, body;
	if (p.api === "anthropic-messages") {
		url = `${p.baseUrl}/v1/messages`;
		headers["anthropic-version"] = "2023-06-01";
		body = { model: p.deployment, max_tokens: 16, messages: [{ role: "user", content: "Reply with: ok" }] };
	} else if (p.api === "openai-responses") {
		url = `${p.baseUrl}/responses`;
		body = { model: p.deployment, input: "Reply with: ok", max_output_tokens: 32 };
	} else {
		url = `${p.baseUrl}/chat/completions`;
		body = { model: p.deployment, messages: [{ role: "user", content: "Reply with: ok" }] };
	}
	const started = Date.now();
	const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
	const text = await res.text();
	return { status: res.status, ms: Date.now() - started, body: text, region: res.headers.get("x-ms-region") };
}

function printModels(plan) {
	const rows = plan.models.map((m) => [m.deployment, m.model ?? "", m.api, m.sku ?? "", m.capacity ?? "", m.source]);
	const head = ["deployment", "model", "api", "sku", "capacity", "source"];
	const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
	const fmt = (r) => r.map((v, i) => String(v).padEnd(widths[i])).join("  ");
	console.log(bold(fmt(head)));
	for (const r of rows) console.log(fmt(r));
	if (plan.skipped.length) {
		console.log(dim("\nskipped:"));
		for (const s of plan.skipped) console.log(dim(`  ${s.deployment} (${s.model ?? "?"}): ${s.reason}`));
	}
}

async function main() {
	const cfg = loadConfig();

	if (mode === "models") {
		const d = cfg.discover ? await discover(cfg, { force: args.includes("--refresh") }) : undefined;
		const plan = planModels(cfg, d);
		if (asJson) console.log(JSON.stringify(plan, null, 2));
		else printModels(plan);
		return;
	}

	console.log(bold("pi-foundry doctor\n"));

	// 1. Tooling
	line(OK, "pi", version("pi", ["--version"]) ?? "?");
	const azv = version("az", ["version", "--query", '"azure-cli"', "-o", "tsv"]);
	if (azv) line(OK, "az", azv);
	else fail("az", "not found", "The image should include the Azure CLI. Rebuild with `make build`.");
	line(OK, "node", process.version);
	const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
	if (proxy) line(OK, "proxy", proxy.replace(/\/\/[^@]*@/, "//***@"));
	if (process.env.NODE_EXTRA_CA_CERTS) line(OK, "extra CA bundle", process.env.NODE_EXTRA_CA_CERTS);
	console.log(dim(`  config: ${cfg.fileExists ? cfg.file : "(no foundry.json; using env vars)"}`));
	console.log(dim(`  auth source: ${process.env.FOUNDRY_AUTH_SOURCE || "unknown"}  AZURE_CONFIG_DIR=${process.env.AZURE_CONFIG_DIR || "~/.azure"}`));

	// 2. Identity
	let account;
	try {
		account = await az(["account", "show"]);
		const who = account.user?.type === "servicePrincipal" ? `service principal ${account.user.name}` : account.user?.name;
		line(OK, "signed in", `${who} · tenant ${account.tenantId} · subscription "${account.name}"`);
	} catch (e) {
		fail("signed in", "", explainAuthError(e.message));
		return;
	}

	// 3. Token
	const tokens = new TokenProvider({ scope: cfg.scope, tenant: cfg.tenant });
	let token;
	try {
		token = await tokens.getToken({ forceRefresh: true });
		const mins = Math.round((tokens.expiresAt - Date.now()) / 60000);
		line(OK, "Entra token", `scope ${cfg.scope} · expires in ${mins} min (auto-refreshed in pi)`);
	} catch (e) {
		fail("Entra token", "", e.message);
		return;
	}

	// 4. Discovery
	let discovered;
	if (cfg.discover) {
		try {
			discovered = await discover(cfg, { force: true });
			const a = discovered.account;
			line(OK, "Foundry resource", `${a.name} · ${a.kind} · ${a.location} · rg ${a.resourceGroup}`);
			line(OK, "endpoint", discovered.endpoint);
			if (a.kind !== "AIServices") {
				line(WARN, "resource kind is", `${a.kind}: Claude and other Foundry models need an AIServices (Foundry) resource`);
			}
			if (a.disableLocalAuth) line(OK, "key auth disabled", "(Entra-only, as recommended)");
		} catch (e) {
			fail(
				"Foundry discovery",
				"",
				`${e.message}\nDiscovery needs read access to the resource (Reader or 'Foundry User'). Alternatively set FOUNDRY_ENDPOINT and list models in foundry.json with FOUNDRY_DISCOVER=0.`,
			);
		}
	}
	const plan = planModels(cfg, discovered);
	if (!plan.endpoint) {
		fail("endpoint", "unknown", "Set FOUNDRY_RESOURCE (recommended) or FOUNDRY_ENDPOINT.");
		return;
	}

	// 5. DNS
	const host = new URL(plan.endpoint).hostname;
	try {
		const addrs = await lookup(host, { all: true });
		const ips = [...new Set(addrs.map((a) => a.address))];
		const priv = ips.some((ip) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip));
		line(OK, "DNS", `${host} → ${ips.join(", ")}${priv ? " (private endpoint)" : ""}`);
	} catch (e) {
		fail("DNS", host, `Cannot resolve ${host}: ${e.code || e.message}. Check Docker DNS / VPN / private DNS zones.`);
		return;
	}

	// 6. Deployments
	console.log("");
	if (!plan.models.length) {
		fail("deployments", "no usable chat deployments", "Deploy a GPT or Claude model in Foundry (see docs: Models), or add models to foundry.json.");
	}
	for (const p of plan.models) {
		const label = `${p.deployment} ${dim(`(${p.model} · ${p.api})`)}`;
		if (noPing) {
			line(OK, label);
			continue;
		}
		try {
			const r = await ping(p, token);
			if (r.status >= 200 && r.status < 300) line(OK, label, `${r.status} in ${r.ms} ms${r.region ? ` · ${r.region}` : ""}`);
			else {
				let msg = r.body;
				try {
					const j = JSON.parse(r.body);
					msg = j.error?.message || j.message || r.body;
				} catch {}
				fail(label, `HTTP ${r.status}: ${String(msg).slice(0, 300)}`, hintForStatus(r.status, r.body, p));
			}
		} catch (e) {
			fail(label, e.cause?.code || e.message, "Request failed before reaching Foundry. Check proxy (HTTPS_PROXY), CA certs (see docs), and firewall.");
		}
	}
	for (const s of plan.skipped) line(dim("-"), dim(`${s.deployment} skipped`), s.reason);

	console.log("");
	if (failures) {
		console.log(red(bold(`${failures} problem(s) found.`)));
		process.exitCode = 1;
	} else {
		console.log(green(bold("All good. Run `docker compose run --rm pi` to start coding.")));
	}
}

main().catch((e) => {
	console.error(red(e.stack || e.message));
	process.exit(1);
});
