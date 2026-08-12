import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const workflowPath = path.join(repoRoot, ".github", "workflows", "watch-provider-registry-refresh.yml");
const workflow = await fs.readFile(workflowPath, "utf8");

function occurrences(pattern) {
  return [...workflow.matchAll(pattern)].length;
}

function block(start, end) {
  const match = workflow.match(new RegExp("^" + start + ":\\n([\\s\\S]*?)^" + end + ":", "mu"));
  assert.ok(match, start + " block should end before " + end);
  return match[1];
}

test("workflow has only manual and twice-monthly schedule triggers", () => {
  const triggers = block("on", "concurrency");
  assert.equal(occurrences(/^  workflow_dispatch:$/gmu), 1);
  assert.equal(occurrences(/^  schedule:$/gmu), 1);
  assert.equal(occurrences(/^    - cron: "17 3 3,17 \* \*"$/gmu), 1);
  assert.equal([...triggers.matchAll(/^  [a-z_]+:$/gmu)].length, 2);
  assert.doesNotMatch(triggers, /inputs:/u);
  assert.doesNotMatch(triggers, /push:|pull_request:|repository_dispatch:/u);
});

test("workflow concurrency, permissions, and first-party runtime are bounded", () => {
  assert.match(workflow, /group: watch-provider-registry-refresh\n  cancel-in-progress: false/u);
  const permissions = block("permissions", "jobs");
  assert.equal(permissions.trim(), "contents: write\n  pull-requests: write");
  const actionReferences = [...workflow.matchAll(/^\s+uses: ([^\n]+)$/gmu)].map((match) => match[1]);
  assert.deepEqual(actionReferences, [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0",
  ]);
  assert.match(actionReferences[0], /^actions\/checkout@[0-9a-f]{40} # v7\.0\.1$/u);
  assert.match(actionReferences[1], /^actions\/setup-node@[0-9a-f]{40} # v7\.0\.0$/u);
  assert.doesNotMatch(workflow, /^\s+uses: actions\/(?:checkout|setup-node)@(?:main|v\d+(?:\.\d+){0,2})(?:\s+#.*)?$/mu);
  assert.match(workflow, /node-version: "22"/u);
  assert.match(workflow, /timeout-minutes: 15/u);
});

test("manual dispatch and checkout always use canonical main", () => {
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(workflow, /\[\[ "\$DISPATCH_REF" != "refs\/heads\/main" \]\]/u);
  assert.match(workflow, /ref: main\n          fetch-depth: 0/u);
  assert.match(workflow, /git checkout --detach refs\/remotes\/origin\/main/u);
  assert.match(workflow, /Remote main advanced after preflight/u);
});

test("existing A1 refresh runs once, is secret-scoped, and is followed by check", () => {
  const refreshCommand = "npm --prefix tools/watch-provider-registry run refresh";
  const checkCommand = "npm --prefix tools/watch-provider-registry run check";
  assert.equal(workflow.split(refreshCommand).length - 1, 1);
  assert.equal(workflow.split(checkCommand).length - 1, 1);
  assert.ok(workflow.indexOf(checkCommand) > workflow.indexOf(refreshCommand));
  assert.equal(occurrences(/\$\{\{ secrets\.NUVIO_PEOPLE_SERVICE_TOKEN \}\}/gu), 1);
  assert.match(workflow, /env:\n          NUVIO_PEOPLE_SERVICE_TOKEN: \$\{\{ secrets\.NUVIO_PEOPLE_SERVICE_TOKEN \}\}/u);
  assert.match(workflow, /summary_path="\$RUNNER_TEMP\/watch-provider-refresh-summary\.json"/u);
  assert.doesNotMatch(workflow, /upload-artifact|artifacts\//u);
});

test("actual canonical Git state gates publication and rejects extra files", () => {
  assert.match(workflow, /git diff --name-only --diff-filter=ACDMRTUXB HEAD/u);
  assert.match(workflow, /Refresh changed unexpected tracked files/u);
  assert.match(workflow, /git diff --quiet HEAD -- "\$REGISTRY_PATH"/u);
  assert.match(workflow, /registry_changed=false/u);
  assert.match(workflow, /if: steps\.gate\.outputs\.registry_changed == 'true'/u);
  assert.match(workflow, /newest source matches main while a refresh PR remains open/u);
});

test("automation branch ownership and exact lease protect every rewrite", () => {
  assert.match(workflow, /AUTOMATION_BRANCH: automation\/watch-provider-registry-refresh/u);
  assert.match(workflow, /github-actions\[bot\].*41898282\+github-actions\[bot\]@users\.noreply\.github\.com/u);
  assert.match(workflow, /automation branch tip does not have the expected bot identity and commit subject/u);
  assert.match(workflow, /open refresh proposal contains unexpected additional commits/u);
  assert.match(workflow, /open refresh proposal changes files other than the canonical registry/u);
  assert.match(workflow, /--force-with-lease=\$target_ref:\$PREFLIGHT_REMOTE_SHA/u);
  assert.doesNotMatch(workflow, /git push[^\n]*(?:--force\s|--force$)/u);
  assert.doesNotMatch(workflow, /HEAD:refs\/heads\/main/u);
});

test("one stable PR is created or reused without automatic publication", () => {
  assert.match(workflow, /PR_TITLE: Refresh TMDB Watch Provider registry/u);
  assert.match(workflow, /More than one open refresh PR exists/u);
  assert.match(workflow, /gh api --method PATCH/u);
  assert.match(workflow, /gh api --method POST/u);
  assert.match(workflow, /PREFLIGHT_PR_COUNT" == "1/u);
  assert.doesNotMatch(workflow, /Closes #9|gh pr (?:close|merge)|enablePullRequestAutoMerge|merge_method|state=closed|delete-branch/iu);
  assert.doesNotMatch(workflow, /\bPAT\b|PERSONAL_ACCESS_TOKEN/u);
});

test("generated recurring PR requires merge commit and forbids squash or rebase", () => {
  const guidance = workflow.match(/When accepting this recurring refresh PR,[^\n]+/u)?.[0];
  assert.ok(guidance, "generated PR body should contain recurring merge guidance");
  assert.match(guidance, /use GitHub's \*\*merge commit\*\* method/u);
  assert.match(guidance, /do not squash or rebase it/u);
  assert.match(guidance, /exact machine-generated commit in `main` history/u);
  assert.doesNotMatch(guidance, /(?:use|choose|prefer)\s+(?:a\s+)?(?:squash|rebase)/iu);
});
