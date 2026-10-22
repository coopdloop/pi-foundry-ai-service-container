// Decide whether a bash command only reads. Used to skip approval prompts for
// harmless commands (ls, rg, git status...). Conservative by design: anything
// it can't prove read-only needs approval. Idea adapted from pi's plan-mode
// example extension (MIT).

const READ_ONLY_COMMANDS = new Set([
	"cat", "head", "tail", "less", "more", "wc", "ls", "tree", "pwd", "stat", "file",
	"du", "df", "which", "type", "whereis", "echo", "printf", "date",
	"uname", "whoami", "id", "hostname", "uptime", "jq", "yq", "sort", "uniq", "cut",
	"tr", "diff", "cmp", "comm", "column", "nl", "basename", "dirname", "realpath",
	"readlink", "grep", "egrep", "fgrep", "rg", "fd", "fdfind", "find", "sed", "awk",
	"true", "false", "test", "[", "md5sum", "sha1sum", "sha256sum", "base64", "od",
	"hexdump", "xxd", "strings", "tac", "rev", "fold", "fmt", "expand", "seq", "ps",
	"free", "nproc", "lsb_release", "locale", "tldr", "man", "help",
]);

// Subcommands that only read, for tools with mixed read/write subcommands.
const READ_ONLY_SUBCOMMANDS = {
	git: new Set([
		"status", "log", "diff", "show", "blame", "ls-files", "ls-tree", "rev-parse",
		"describe", "shortlog", "reflog", "grep", "cat-file", "merge-base", "name-rev",
		"whatchanged", "version", "help",
	]),
	npm: new Set(["ls", "list", "outdated", "view", "info", "explain", "why", "help", "version", "--version", "-v"]),
	pnpm: new Set(["ls", "list", "outdated", "why", "--version", "-v"]),
	yarn: new Set(["list", "info", "why", "--version", "-v"]),
	pip: new Set(["list", "show", "freeze", "--version"]),
	cargo: new Set(["tree", "metadata", "--version", "version"]),
	go: new Set(["version", "env", "list", "doc"]),
	docker: new Set(["ps", "images", "version", "info"]),
	kubectl: new Set(["get", "describe", "logs", "version", "explain", "api-resources"]),
	az: new Set([]),
};

// Version/help probes are always harmless.
const PROBE = /^(--?version|-V|--?help|-h)$/;

// `git branch`/`git remote`/`git tag`/`git stash` only read when listing.
const GIT_LISTING = {
	// Any positional argument would create/rename a branch.
	branch: (args) => args.every((a) => /^(-a|-r|-v|-vv|-l|--all|--remotes|--list|--show-current|--merged|--no-merged|--contains|--sort=.*|--format=.*)$/.test(a)),
	remote: (args) => args.length === 0 || (args.length === 1 && args[0] === "-v") || args[0] === "show" || args[0] === "get-url",
	tag: (args) => args.length === 0 || args.every((a) => /^(-l|--list|-n\d*|--contains|--sort=.*)$/.test(a)),
	stash: (args) => args[0] === "list" || args[0] === "show",
	config: (args) => args.some((a) => /^(--get|--get-all|--list|-l|--get-regexp)$/.test(a)),
};

/** Split a command line into simple-command segments on unquoted ;, &&, ||, |, &, newlines. */
export function splitSegments(cmd) {
	const segments = [];
	let cur = "";
	let quote = null;
	for (let i = 0; i < cmd.length; i++) {
		const c = cmd[i];
		if (quote) {
			cur += c;
			if (c === "\\" && quote === '"' && i + 1 < cmd.length) cur += cmd[++i];
			else if (c === quote) quote = null;
			continue;
		}
		if (c === "'" || c === '"') {
			quote = c;
			cur += c;
			continue;
		}
		if (c === "\\" && i + 1 < cmd.length) {
			cur += c + cmd[++i];
			continue;
		}
		if (c === ";" || c === "\n" || c === "|" || c === "&") {
			// `2>&1` / `>&2` are redirections, not separators.
			if (c === "&" && (cmd[i - 1] === ">" || cmd[i + 1] === ">")) {
				cur += c;
				continue;
			}
			segments.push(cur);
			cur = "";
			if ((c === "|" || c === "&") && cmd[i + 1] === c) i++;
			continue;
		}
		cur += c;
	}
	segments.push(cur);
	return segments.map((s) => s.trim()).filter(Boolean);
}

/** Tokenize one segment, honoring quotes. Returns null on unbalanced quotes. */
function tokenize(seg) {
	const out = [];
	let cur = "";
	let quote = null;
	let has = false;
	for (let i = 0; i < seg.length; i++) {
		const c = seg[i];
		if (quote) {
			if (c === quote) quote = null;
			else if (c === "\\" && quote === '"' && i + 1 < seg.length) cur += seg[++i];
			else cur += c;
			continue;
		}
		if (c === "'" || c === '"') {
			quote = c;
			has = true;
			continue;
		}
		if (c === "\\" && i + 1 < seg.length) {
			cur += seg[++i];
			has = true;
			continue;
		}
		if (/\s/.test(c)) {
			if (has || cur) out.push(cur);
			cur = "";
			has = false;
			continue;
		}
		cur += c;
		has = true;
	}
	if (quote) return null;
	if (has || cur) out.push(cur);
	return out;
}

/** True when the redirections in a segment can't write files. */
function redirectionsAreSafe(seg) {
	// Strip harmless forms: 2>&1, >&2, >/dev/null, 2>/dev/null, &>/dev/null
	const stripped = seg
		.replace(/\d?>&\d/g, "")
		.replace(/(&|\d)?>>?\s*\/dev\/null/g, "");
	// Any remaining unquoted > means writing a file.
	return !/(^|[^'"])>/.test(stripped.replace(/'[^']*'|"[^"]*"/g, ""));
}

function segmentIsReadOnly(seg) {
	if (!redirectionsAreSafe(seg)) return false;
	let tokens = tokenize(seg);
	if (!tokens || !tokens.length) return false;

	// Leading env assignments (FOO=bar cmd) are fine; `env` alone prints.
	while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens = tokens.slice(1);
	if (!tokens.length) return false; // bare assignment changes shell state

	const [cmd, ...args] = tokens;
	const name = cmd.split("/").pop();

	if (args.length === 1 && PROBE.test(args[0])) return true;

	if (name === "find") return !args.some((a) => /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/.test(a));
	if (name === "sed") return !args.some((a) => /^(-i|--in-place)/.test(a) || /^-[a-zA-Z]*i/.test(a) && !a.startsWith("--"));
	if (name === "awk") return !args.some((a) => /system\s*\(|print\s*>|printf[^;]*>|\|\s*getline|>\s*"/.test(a));
	// `env` with a command runs that command; only bare `env` just prints.
	if (name === "env") return args.every((a) => a.startsWith("-") && !/^(-S|--split-string|-C|--chdir)/.test(a));
	if (name === "printenv") return args.every((a) => /^-|^[A-Za-z_][A-Za-z0-9_]*$/.test(a));
	if (name === "sort") return !args.some((a) => /^(-o|--output)/.test(a));

	if (READ_ONLY_COMMANDS.has(name)) return true;

	const subs = READ_ONLY_SUBCOMMANDS[name];
	if (subs) {
		const sub = args.find((a) => !a.startsWith("-") || PROBE.test(a));
		if (!sub) return args.every((a) => PROBE.test(a));
		if (name === "git" && GIT_LISTING[sub]) {
			const rest = args.slice(args.indexOf(sub) + 1);
			return GIT_LISTING[sub](rest);
		}
		return subs.has(sub);
	}
	return false;
}

/**
 * True only if every part of the command is known to be read-only.
 * Command substitution, process substitution, subshells and heredocs that
 * feed interpreters are treated as not read-only.
 */
export function isReadOnlyBash(command) {
	if (typeof command !== "string") return false;
	const cmd = command.trim();
	if (!cmd) return false;
	// Substitutions can run anything; keep it simple and ask.
	const unquotedSingles = cmd.replace(/'[^']*'/g, "''");
	if (/\$\(|`|<\(|>\(/.test(unquotedSingles)) return false;
	if (/<<-?\s*['"]?\w+/.test(unquotedSingles)) return false;
	// sudo, eval, source, `.`, bash -c, etc. are rejected per segment because
	// they aren't on the allowlist.
	const segments = splitSegments(cmd);
	if (!segments.length) return false;
	return segments.every(segmentIsReadOnly);
}

/** A short, stable prefix used for "don't ask again" rules, e.g. "npm test", "git commit". */
export function commandPrefix(command) {
	const first = splitSegments(String(command))[0] || "";
	const tokens = (tokenize(first) || []).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
	if (!tokens.length) return "";
	const [cmd, sub] = tokens;
	const multi = new Set(["git", "npm", "pnpm", "yarn", "bun", "cargo", "go", "make", "docker", "kubectl", "az", "pip", "python", "python3", "uv", "dotnet", "mvn", "gradle", "./gradlew", "npx"]);
	return multi.has(cmd) && sub && !sub.startsWith("-") ? `${cmd} ${sub}` : cmd;
}

/** True when every segment of the command starts with an approved prefix. */
export function matchesApprovedPrefix(command, prefixes) {
	if (!prefixes.size) return false;
	const unquoted = String(command).replace(/'[^']*'/g, "''");
	if (/\$\(|`|<\(|>\(/.test(unquoted)) return false;
	return splitSegments(command).every((seg) => {
		const p = commandPrefix(seg);
		return p && (prefixes.has(p) || segmentIsReadOnly(seg));
	});
}
