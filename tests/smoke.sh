#!/usr/bin/env bash
# Offline smoke test: the image builds, tools are present, and the Foundry
# extension loads in the installed pi and registers models with the right APIs.
# Needs no Azure credentials (discovery off, models from a test foundry.json).
set -euo pipefail
IMAGE="${1:-pi-foundry:local}"
here="$(cd "$(dirname "$0")" && pwd)"

run() {
  docker run --rm --entrypoint "$1" \
    -e FOUNDRY_DISCOVER=0 \
    -e FOUNDRY_ENDPOINT=https://example.services.ai.azure.com \
    -e FOUNDRY_CONFIG=/tests/foundry.test.json \
    -e PI_OFFLINE=1 \
    -v "$here:/tests:ro" \
    "$IMAGE" "${@:2}"
}

echo "== versions"
run bash -c 'pi --version && az version --query "\"azure-cli\"" -o tsv && node --version'

echo "== permission classifier"
run node /tests/permissions.test.mjs

echo "== extensions load together and register models"
out="$(run pi -e /opt/pi-foundry/extension -e /opt/pi-foundry/permissions --list-models foundry 2>&1)"
if grep -qi "conflict\|failed to load\|error" <<<"$out"; then echo "FAIL: extension warnings"; echo "$out"; exit 1; fi
echo "$out"
for m in gpt-5.5 claude-opus-4-8; do
  grep -q "foundry *$m" <<<"$out" || { echo "FAIL: $m not registered"; exit 1; }
done

echo "== model planning"
run node --input-type=module -e '
  import { loadConfig, planModels } from "/opt/pi-foundry/lib/foundry.mjs";
  const p = planModels(loadConfig(), null);
  const by = Object.fromEntries(p.models.map(m => [m.deployment, m]));
  const want = {
    "gpt-5.5": ["openai-responses", "https://example.services.ai.azure.com/openai/v1"],
    "claude-opus-4-8": ["anthropic-messages", "https://example.services.ai.azure.com/anthropic"],
  };
  for (const [d, [api, url]] of Object.entries(want)) {
    if (by[d]?.api !== api || by[d]?.baseUrl !== url) { console.error("FAIL", d, by[d]); process.exit(1); }
  }
  console.log("ok");
'
echo "== themes define every token the installed pi knows"
run node -e '
  const fs = require("fs"), path = require("path"), cp = require("child_process");
  const root = cp.execSync("npm root -g").toString().trim();
  const builtin = require(path.join(root, "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json"));
  for (const f of fs.readdirSync("/opt/pi-foundry/themes")) {
    const t = JSON.parse(fs.readFileSync(path.join("/opt/pi-foundry/themes", f), "utf8"));
    const missing = Object.keys(builtin.colors).filter((k) => !(k in t.colors));
    const badRefs = Object.values(t.colors).filter((v) => typeof v === "string" && v && !v.startsWith("#") && !(v in (t.vars || {})));
    if (missing.length || badRefs.length) { console.error("FAIL", f, { missing, badRefs }); process.exit(1); }
    console.log("ok", t.name);
  }
'
echo "PASS"
