// pi extension: Claude Code–style permission modes.
//
//   ask    (default) prompt before file edits and non-read-only commands
//   edits  file edits run freely; commands still prompt
//   plan   read-only: investigate and propose, nothing changes
//   auto   pi's native behavior: no prompts
//
// Shift+Tab (or Alt+M) cycles modes; /mode or --permission-mode sets one. Every tool call goes
// through pi's `tool_call` hook, including nested and MCP tool calls.
// Prompts reduce accidents; they are not a security boundary (the container is).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { commandPrefix, isReadOnlyBash, matchesApprovedPrefix } from "./bash-classifier.mjs";

type Mode = "ask" | "edits" | "plan" | "auto";
const MODES: Mode[] = ["ask", "edits", "plan", "auto"];
const ENTRY = "foundry-mode";

const LABEL: Record<Mode, { text: string; color: string; describe: string }> = {
	ask: { text: "⏵ ask", color: "muted", describe: "Ask before edits and commands" },
	edits: { text: "⏵⏵ accept edits", color: "accent", describe: "Edit files freely, ask before commands" },
	plan: { text: "⏸ plan", color: "warning", describe: "Read-only: investigate and propose a plan" },
	auto: { text: "⚠ auto", color: "error", describe: "No prompts (pi's native behavior)" },
};

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["write", "edit"]);
const SHELL_TOOLS = new Set(["bash"]);

const PLAN_PROMPT = [
	"Plan mode is active. You are in a read-only phase.",
	"- Investigate with read-only tools (read, grep, find, ls, read-only shell commands).",
	"- Do not create, modify or delete files, and do not run commands that change state.",
	"- Finish by presenting a concise, numbered plan. The user will switch modes to carry it out.",
].join("\n");

const isMode = (v: unknown): v is Mode => typeof v === "string" && (MODES as string[]).includes(v);

function agentDir() {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

/** Shift+Tab is reserved for pi's thinking cycle unless keybindings.json moves it. */
function shiftTabIsFree(): boolean {
	try {
		const kb = JSON.parse(readFileSync(join(agentDir(), "keybindings.json"), "utf8"));
		const v = kb["app.thinking.cycle"];
		if (v === undefined) return false;
		const keys = (Array.isArray(v) ? v : [v]).map((k: string) => String(k).toLowerCase());
		return !keys.includes("shift+tab");
	} catch {
		return false;
	}
}

function truncate(s: string, max: number) {
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function previewLines(text: string, max = 6, prefix = "") {
	const lines = String(text ?? "").split("\n");
	const shown = lines.slice(0, max).map((l) => `${prefix}${truncate(l, 110)}`);
	if (lines.length > max) shown.push(`${prefix}… (${lines.length - max} more lines)`);
	return shown.join("\n");
}

function describeCall(toolName: string, input: any): string {
	if (SHELL_TOOLS.has(toolName)) return `Run command:\n\n  ${previewLines(input?.command ?? "", 8, "  ").trimStart()}`;
	if (toolName === "write") {
		const n = String(input?.content ?? "").split("\n").length;
		return `Write ${input?.path} (${n} line${n === 1 ? "" : "s"}):\n\n${previewLines(input?.content ?? "", 6, "  + ")}`;
	}
	if (toolName === "edit") {
		const edits: any[] = Array.isArray(input?.edits) ? input.edits : [input];
		const parts = edits.slice(0, 3).map(
			(e) => `${previewLines(e?.oldText ?? "", 3, "  - ")}\n${previewLines(e?.newText ?? "", 3, "  + ")}`,
		);
		const more = edits.length > 3 ? `\n  … ${edits.length - 3} more edit(s)` : "";
		return `Edit ${input?.path} (${edits.length} change${edits.length === 1 ? "" : "s"}):\n\n${parts.join("\n\n")}${more}`;
	}
	let args = "";
	try {
		args = JSON.stringify(input);
	} catch {}
	return `Use tool ${toolName}${args ? `:\n\n  ${truncate(args, 400)}` : ""}`;
}

export default function permissionModes(pi: ExtensionAPI) {
	pi.registerFlag("permission-mode", {
		description: "Permission mode: ask (default), edits, plan or auto",
		type: "string",
	});

	const envMode = (process.env.FOUNDRY_MODE || "").toLowerCase();
	let mode: Mode = isMode(envMode) ? envMode : "ask";
	let autoUnlocked = mode === "auto";
	const approvedPrefixes = new Set<string>();
	let shortcutHintShown = false;
	const shiftTabFree = shiftTabIsFree();

	function setMode(next: Mode, ctx: any, { persist = true, announce = true } = {}) {
		mode = next;
		if (next === "auto") autoUnlocked = true;
		updateStatus(ctx);
		if (persist) pi.appendEntry(ENTRY, { mode });
		if (announce) ctx.ui.notify(`Mode: ${LABEL[mode].text.replace(/^\S+\s/, "")}. ${LABEL[mode].describe}.`, "info");
	}

	function updateStatus(ctx: any) {
		const l = LABEL[mode];
		const theme = ctx.ui.theme;
		ctx.ui.setStatus("foundry-mode", theme?.fg ? theme.fg(l.color, l.text) : l.text);
	}

	function cycle(ctx: any) {
		const order: Mode[] = autoUnlocked ? ["ask", "edits", "plan", "auto"] : ["ask", "edits", "plan"];
		const i = order.indexOf(mode);
		setMode(order[(i + 1) % order.length], ctx);
	}

	// --- tool gate -----------------------------------------------------------

	function classify(toolName: string, input: any): "read" | "edit" | "exec" {
		if (READ_TOOLS.has(toolName)) return "read";
		if (EDIT_TOOLS.has(toolName)) return "edit";
		if (SHELL_TOOLS.has(toolName)) return isReadOnlyBash(input?.command) ? "read" : "exec";
		const tool = pi.getAllTools().find((t: any) => t.name === toolName) as any;
		if (tool?.annotations?.readOnlyHint === true) return "read";
		return "exec";
	}

	pi.on("tool_call", async (event: any, ctx: any) => {
		if (mode === "auto") return;
		const { toolName, input } = event;
		const kind = classify(toolName, input);
		if (kind === "read") return;
		if (kind === "edit" && mode === "edits") return;
		if (kind === "exec" && SHELL_TOOLS.has(toolName) && matchesApprovedPrefix(input?.command, approvedPrefixes)) return;

		if (mode === "plan") {
			return {
				block: true,
				reason:
					"Plan mode is active, so this action is not allowed. Use read-only tools to investigate, then present a numbered plan. The user will switch modes to carry it out.",
			};
		}

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `This needs approval, but there is no interactive UI. Rerun with FOUNDRY_MODE=${kind === "edit" ? "edits" : "auto"} (or --permission-mode) to allow it.`,
			};
		}

		const prefix = SHELL_TOOLS.has(toolName) ? commandPrefix(input?.command) : "";
		const yes = "Yes";
		const always =
			kind === "edit"
				? "Yes, and accept all edits (switch to accept-edits mode)"
				: prefix
					? `Yes, and don't ask again for \`${prefix}\` commands this session`
					: undefined;
		const no = "No";
		const noTell = "No, and tell pi what to do instead";
		const options = [yes, ...(always ? [always] : []), no, noTell];

		const choice = await ctx.ui.select(describeCall(toolName, input), options);

		if (choice === yes) return;
		if (choice && choice === always) {
			if (kind === "edit") setMode("edits", ctx);
			else approvedPrefixes.add(prefix);
			return;
		}
		if (choice === noTell) {
			const feedback = (await ctx.ui.input("What should pi do instead?", ""))?.trim();
			if (feedback) {
				return { block: true, reason: `The user declined this ${toolName} call and said: ${feedback}` };
			}
		}
		// Plain "No" (or Esc): stop and wait for the user, like Claude Code.
		return { block: true, reason: `The user declined this ${toolName} call. Wait for their instructions.`, terminate: true };
	});

	// --- plan mode prompt ----------------------------------------------------

	pi.on("before_agent_start", async (event: any) => {
		const opts = event?.systemPromptOptions;
		if (!opts) return;
		if (mode === "plan") {
			opts.sections = { ...(opts.sections || {}), "plan-mode": PLAN_PROMPT };
		} else if (opts.sections?.["plan-mode"]) {
			delete opts.sections["plan-mode"];
		}
	});

	// --- state ---------------------------------------------------------------

	pi.on("session_start", async (event: any, ctx: any) => {
		if (event?.reason !== "reload") approvedPrefixes.clear();

		const saved = ctx.sessionManager
			.getEntries()
			.filter((e: any) => e.type === "custom" && e.customType === ENTRY)
			.pop() as { data?: { mode?: string } } | undefined;
		if (isMode(saved?.data?.mode)) mode = saved.data.mode;

		const flag = pi.getFlag("permission-mode");
		if (typeof flag === "string" && flag) {
			if (isMode(flag)) mode = flag;
			else ctx.ui.notify(`Unknown --permission-mode "${flag}" (use ask, edits, plan or auto)`, "warning");
		}
		if (mode === "auto") autoUnlocked = true;
		updateStatus(ctx);

		if (!shiftTabFree && !shortcutHintShown && ctx.hasUI && event?.reason === "startup") {
			shortcutHintShown = true;
			ctx.ui.notify(
				'Switch permission modes with Alt+M or /mode. To use Shift+Tab, set "app.thinking.cycle": "alt+t" in keybindings.json.',
				"info",
			);
		}
	});

	// --- commands & shortcuts ------------------------------------------------

	pi.registerCommand("mode", {
		description: "Permission mode: ask, edits, plan or auto",
		getArgumentCompletions: (prefix: string) =>
			MODES.filter((m) => m.startsWith(prefix)).map((m) => ({ value: m, label: `${m}  ${LABEL[m].describe}` })),
		handler: async (args: string, ctx: any) => {
			const want = args.trim().toLowerCase();
			if (isMode(want)) return setMode(want, ctx);
			if (want) return ctx.ui.notify(`Unknown mode "${want}". Use ask, edits, plan or auto.`, "warning");
			const picked = await ctx.ui.select(
				`Permission mode (current: ${mode})`,
				MODES.map((m) => `${m.padEnd(6)} ${LABEL[m].describe}`),
			);
			const m = picked?.split(/\s+/)[0];
			if (isMode(m)) setMode(m, ctx);
		},
	});

	if (shiftTabFree) {
		pi.registerShortcut("shift+tab", { description: "Cycle permission mode", handler: async (ctx: any) => cycle(ctx) });
	}
	pi.registerShortcut("alt+m", { description: "Cycle permission mode", handler: async (ctx: any) => cycle(ctx) });
}
