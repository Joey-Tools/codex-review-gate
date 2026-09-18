# Install Codex Review Gate v2

This guide is for a repository maintainer. The [agent runbook](agent.md)
describes the same installation as a deterministic execution checklist; it is
not a different installation mode. Both guides use the canonical assets under
`templates/codex-gated-repo/`.

The ordinary single-repository rollout has two pull requests:

1. one migration PR removes the v1 caller and installs both canonical v2
   workflows; and
2. after the migration merges, one separate harmless canary PR proves that the
   live default-branch workflow and ruleset work together.

The canary is closed without merging.

The fixed eleven-repository organization handoff is the only controlled
exception to removing v1 in the migration PR. Read the advanced section below
before changing any member of that cohort.

## What is installed

A complete installation has three required asset groups:

1. the canonical read-only verifier at
   `.github/workflows/codex-review-gate.yml` and protected-default-branch
   controller at `.github/workflows/codex-review-gate-controller.yml`;
2. the repository ruleset based on
   `templates/codex-gated-repo/rulesets/codex-review-gate.json`; and
3. the final effective `.github/CODEOWNERS`, whose two managed rules protect
   `/.github/workflows/` and `/.github/CODEOWNERS` with one explicitly named
   `CONTROL_PLANE_OWNER`.

The ruleset must require Code Owner review and dismiss stale approvals after a
push. Both workflows call the compatible floating major:

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

Do not replace this selector with a prerelease. The only exception is the
release operator's temporary RC admission bridge in
[`RELEASING.md`](../RELEASING.md), including its installed-consumer and fresh
fixture forms; neither is consumer installation.

Copy both canonical workflows unchanged. They own separate event and permission
boundaries that an Action step cannot define:

- the read-only verifier uses only `pull_request` activity types `opened`,
  `reopened`, `synchronize`, and `ready_for_review`; its native
  `codex/github-review-gate` CheckRun on the exact PR feature-head SHA is
  required;
- controller automatic wake-ups use only `issue_comment` activity types
  `created` and `edited`;
- before a runner is allocated, both the event sender and comment author must
  be the exact Codex bot, `chatgpt-codex-connector[bot]`, with GitHub type
  `Bot`;
- the only manual trigger is `workflow_dispatch`, and one run targets one pull
  request;
- manual dispatches must use the workflow from the repository's default
  branch;
- API-only work uses `ubuntu-slim` by default; the repository Actions variable
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` selects the sole supported
  fallback, `ubuntu-latest`;
- the verifier has read-only evidence permissions; the controller alone has
  narrow `issues: write` and `actions: write` authority for requests and exact
  verifier reruns. Neither workflow has `statuses: write` or `checks: write`.

By default, an ordinary human-authored `@codex review` request establishes a
new review generation only when its author currently has `write`, `maintain`,
or `admin` permission. A repository that intentionally accepts requests from
any commenter may set the protected Actions variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`; every other value maps to
the safer `write` policy. This is wrapper-owned protected configuration, not a
public Action input. It never weakens Codex finding authority: every qualifying
finding remains blocking regardless of request-author permission.

The consumer workflows have no cron, `repository_dispatch`,
`pull_request_target`, automatic `pull_request_review` writer, runtime GitHub
App, status bridge or ledger. Evidence is rebuilt by the selected verifier.

Reactions on a qualifying ordinary, unmarked `@codex review` request are read
only as provider-liveness evidence. An ordinary `+1` cannot independently
create head-bound clean evidence. An official Codex `eyes` reaction or
progress artifact at the same time as or later than candidate terminal clean
evidence vetoes success because review activity is still current. Reaction
changes do not themselves start a consumer job, so let a later qualifying bot
comment run the gate or dispatch a manual exact-head `reconcile`.
For predecessor-to-successor generation closure, liveness at the same timestamp
as the successor request is also ambiguous and keeps the predecessor open.
Once a second physical request boundary exists, an unbound terminal cannot
prove that it belongs to the newer request rather than an older flight. Without
a base epoch, provider terminal evidence may close only the first gap; every
later gap and the newer generation's clean authority require a qualifying `+1`
directly on the corresponding canonical request. With a base epoch, every gap
does. Physical boundaries and positive authority are separate: an edited,
malformed, wrong-author, denied, or stale-base request can remain a boundary
without gaining authority. A new head recovers an unclosed gap only when every
ambiguous predecessor is explicitly bound to a different full head. If any
predecessor is ordinary, deleted, or otherwise unbound, create a replacement
PR, run one canonical producer there, validate it, and close the ambiguous PR.
Explicitly commit-bound progress is scoped to that head. Every unbound progress
carrier remains in the current inventory because nearby request timestamps do
not prove its source. An edited terminal also contributes an unbound unknown-
activity interval from creation through terminal revision. Provider terminal
evidence can close the first gap only with a complete predecessor reaction
inventory and no current `eyes` or provider activity after that terminal
through the successor.

Choose one GitHub user as `CONTROL_PLANE_OWNER`. That account must have
`write`, `maintain`, or `admin` permission on the consumer repository. The
helper defaults to `@JoeyTeng`; pass a different user for every non-Joey
repository. The owner is deliberately explicit because GitHub's required-check
`integration_id: 15368` identifies the entire GitHub Actions App, not either
workflow. Exact-byte and complete-inventory checks, CODEOWNERS, Code Owner
review, stale dismissal, strict freshness, no bypass actors and canary
collision readback form the adopted compound boundary.

The manual `workflow_dispatch` interface is:

| Input | Meaning |
| --- | --- |
| `operation` | `begin-review` or `reconcile` |
| `pr_number` | One open pull request number |
| `expected_head_sha` | The exact pull request head the run may evaluate |
| `request_comment_id` | Optional evidence-location hint |
| `request_review` | Whether `begin-review` posts the request; defaults to `true` |

These values help the Action locate and validate work; they never supply a
verdict or limits profile. The controller Action step uses the exact underscore input names `github_token`,
`pr_number`, `expected_head_sha`, `operation`, `request_comment_id`,
and `request_review`. Both Action steps derive `limits_profile` only from
protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE`. Their only public outputs are
`execution_health`, `gate_outcome`, `recovery_code`, and `retry_safe`. Finding
counts, when available, are diagnostics in the job summary and sticky comment,
not Action outputs.

## Advanced controlled handoff for one eleven-repository cohort

Use this path only for an explicitly approved organization cohort whose
default branches are all covered by one shared v1 organization ruleset. It is
not a general `allow-v1` installation mode. The ordinary path in the numbered
sections below, and the final state of every cohort member, still reject every
v1 caller.

The handoff deliberately separates protection responsibilities:

- every repository receives the complete v2 repository ruleset, which keeps
  the strict up-to-date, Code Owner, stale-review, resolved-conversation and
  non-fast-forward requirements described in this guide;
- a new organization ruleset named `Must Pass Codex Review v2` requires only
  the strict, source-bound `codex/github-review-gate` check for the exact
  eleven members;
- the old organization ruleset remains Active with `deletion`,
  `non_fast_forward` and its sole `codex/review-gate` status rule throughout
  installation, canary proof, v2 activation and repository-level v1 cleanup;
  and
- the old organization ruleset is never deleted. At the final cutover its
  entire legacy-only required-status rule is removed, while its identity,
  targets, enforcement, bypass actors, `deletion`, `non_fast_forward` and
  every other bound field stay unchanged.

The source of truth for this transaction is one reviewed JSON manifest with
schema `organization-review-gate-handoff-manifest/v1`. It binds the
organization identity, the exact old organization ruleset, the new ruleset
name and ID, exactly eleven ordered repository identities, the three workflow
blob and content hashes, the effective CODEOWNERS identity, each complete
Active repository v2 ruleset, and every repository-level legacy cleanup
before/after snapshot. Each canary entry binds an open, non-draft,
same-repository PR to its exact current head, base and test-merge SHAs; the v2
CheckRun plus its workflow run, attempt and job identities; and the latest
successful legacy commit-status ID. Missing, extra or reordered members are a
hard failure.

Start from
`templates/organization-review-gate-handoff/joey-tools-11-member-manifest.template.json`
and follow the README beside it. Replace every explicit placeholder with live,
reviewed evidence; do not infer missing identities. Before `stage`, the only
permitted incomplete value is the literal JSON `null` at `v2_ruleset.id`,
because that organization ruleset does not exist yet. Every other placeholder
or incomplete value is rejected. After the successful `stage` readback,
replace that `null` with only the returned organization ruleset ID and review
the completed manifest again.

For each member, the migration PR installs the canonical v2 verifier and
controller plus the one exact temporary bridge at
`.github/workflows/codex-review-gate-legacy-bridge.yml`:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --legacy-bridge \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --legacy-bridge \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

`--legacy-bridge` admits only that fixed path with the canonical exact bytes;
it does not admit an arbitrary v1 workflow. Keep the flag on every
repository bootstrap staging and activation command while the bridge is
present. The cohort repository ruleset name is
exactly `Must Pass Codex Review v2`, not the ordinary installer default
`Must Pass Codex Review`. Pass that distinct name to every repository
bootstrap call with `--ruleset-name`.

Reuse the ordinary guide only for canonical file preparation, control-plane
review and staging the complete repository v2 policy as **Disabled**. Do not
follow its legacy cleanup or canary-close steps. After the migration merges,
stage the distinct Disabled repository rule with `--legacy-bridge`; then
create a harmless open, non-draft canary, prove the exact-head/test-merge v2
CheckRun and latest successful `codex/review-gate` bridge commit status, and
activate that repository rule with the same distinct name and bridge profile.
Keep the canary open until the shared organization rule has been activated and
its dual-enforcement readback succeeds. Record its current bound evidence in
the manifest. Do not start organization activation until all eleven entries
meet those conditions.

The organization helper is preview-first. Every mutating apply must use the
exact `plan_sha256` emitted by its matching live preview. Because a failed
stage POST may need no-receipt recovery, hold an external organization-admin
policy-mutation freeze from the stage preview through its apply, readback, and
any recovery:

```bash
HANDOFF_MANIFEST=/absolute/path/to/reviewed-handoff-manifest.json

node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode plan

HANDOFF_STAGE_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage > "$HANDOFF_STAGE_PREVIEW"
HANDOFF_STAGE_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_STAGE_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage \
  --apply \
  --expected-plan-sha256 "$HANDOFF_STAGE_PLAN_SHA256"
```

`stage` creates only the exact Disabled, v2-only organization ruleset. Bind
the returned `next_manifest_update.v2_ruleset.id` into the reviewed manifest,
then run `plan` again. When all eleven open, non-draft, current-base canaries,
canonical workflows, temporary bridges, Active repository v2 rulesets and
still-uncleaned legacy surfaces match that manifest, preview and activate the
shared rule:

If the `stage --apply` POST fails after it may have reached GitHub, the helper
first attempts one read-only reconciliation. A returned `applied-recovered`
result and `next_manifest_update` are a verified success. If the process was
interrupted or reports an unknown outcome instead, do not rerun the POST. With
`v2_ruleset.id` still `null`, use the explicit read-only recovery entry:

```bash
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage \
  --recover-created-v2
```

This option cannot be combined with `--apply` or a plan digest. It returns a
`next_manifest_update` only when exactly one same-name organization ruleset
has the canonical Disabled v2 payload and the old organization rule is still
at its exact before-state. An absent candidate, multiple candidates, an
Active candidate or any payload/source drift fails closed. Recovery never
replays the POST. Hold an external organization-admin policy-mutation freeze
for the complete recovery read so the uniquely adopted object cannot change
during that boundary.

```bash
HANDOFF_ACTIVATE_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode activate > "$HANDOFF_ACTIVATE_PREVIEW"
HANDOFF_ACTIVATE_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_ACTIVATE_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode activate \
  --apply \
  --expected-plan-sha256 "$HANDOFF_ACTIVATE_PLAN_SHA256"
```

Before the matching activation preview, establish an external organization-
and repository-admin policy-mutation freeze and hold it through the apply and
stable post-write readback. During that interval, no administrator may change
organization or repository rulesets, classic branch protection, conditions,
required checks or bypass actors. GitHub's ruleset update endpoint has no
documented conditional/CAS update. The digest and immediate rereads detect
earlier or later drift, but they cannot make the final GET-to-PUT interval
atomic. The helper checks the exact manifest-bound bypass lists; it cannot
automatically discover or preserve an actor concurrently added outside that
snapshot.

The successful activation readback is the double-protection handoff point:
all eleven members have the complete repository v2 policy, the shared v2-only
organization rule is Active, and the old organization v1 rule is still Active.
Only after the helper reports that post-write dual-enforcement proof may each
canary be closed without merging. Never close one before `activate` completes.
The later `derive-cutover`, `apply-repository-cleanup`, and `verify` modes use
post-activation cohort snapshots and do not require closed canaries to be
reopened. They also do not require the current default-branch head to remain
equal to the historical canary base. The canary receipt is activation-bound
evidence; after activation the helper reads each repository's live default
branch and proves the current control-plane/ruleset closure instead: exact
repository identity, a complete regular-blob workflow inventory with the
three canonical files and no extra producer, exact CODEOWNERS, default-read
Actions policy with an explicit boolean `can_approve_pull_request_reviews`,
Active repository and organization v2 rules, the temporary bridge, and current
cleanup state.

Next derive the repository-level cleanup read-only:

```bash
HANDOFF_CUTOVER_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode derive-cutover > "$HANDOFF_CUTOVER_PLAN"
jq . "$HANDOFF_CUTOVER_PLAN"
```

Review the emitted `external_repository_actions`; they may remove only
`codex/review-gate` and must preserve every non-legacy check, strictness
setting, repository ruleset identity, condition, bypass actor, `deletion`,
`non_fast_forward` and unrelated rule bound by the manifest. Do not execute
the raw actions manually. Apply them through the controlled executor while the
external organization/repository-admin policy-mutation freeze remains
continuously in force from this cleanup preview through the cleanup apply and
readback, the later `verify` preview/apply, and its final stable readback:

```bash
HANDOFF_CLEANUP_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode apply-repository-cleanup > "$HANDOFF_CLEANUP_PREVIEW"
HANDOFF_CLEANUP_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_CLEANUP_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode apply-repository-cleanup \
  --apply \
  --expected-plan-sha256 "$HANDOFF_CLEANUP_PLAN_SHA256"
```

For each item, the executor performs GET, requires the exact `expected_before`
snapshot, uses the surface-specific mutation, and requires an exact
`expected_after` readback. A stable mixture of before- and after-state items is
a safe resume point: already-after items are no-ops and only still-before
items enter the new plan. If a mutation returns an error or its result is
unknown, the executor first performs a narrow read-only reconciliation. It
treats exact after-state as completed; before-state, drift, or an unreadable
result stops the batch. Then run a fresh preview under the freeze, review the
live state, and never blindly replay the old mutation or old plan digest.

Only after all repository cleanup surfaces match their exact `expected_after`
snapshots may the old organization status rule be removed:

```bash
HANDOFF_VERIFY_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode verify > "$HANDOFF_VERIFY_PREVIEW"
HANDOFF_VERIFY_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_VERIFY_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode verify \
  --apply \
  --expected-plan-sha256 "$HANDOFF_VERIFY_PLAN_SHA256"
HANDOFF_FINAL_VERIFY=/absolute/path/to/final-read-only-verify.json
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode verify > "$HANDOFF_FINAL_VERIFY"
jq -e '
  .schema_version == "organization-review-gate-handoff-output/v1" and
  .mode == "verify" and
  .status == "final-verified" and
  .applied == false and
  .action == null and
  .final_closure_receipt.schema_version == 1 and
  (.final_closure_receipt_sha256 | test("^[0-9a-f]{64}$"))
' "$HANDOFF_FINAL_VERIFY"
HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256="$(jq -er \
  '.final_closure_receipt_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_FINAL_VERIFY")"
```

`verify --apply` is the only helper mode that changes the old organization
ruleset. It removes the whole legacy-only required-status rule, not the old
ruleset. Its `applied-final-verified` response is not the bridge-removal
authorization: the organization or repository control plane can still drift
after that write/readback boundary. Continue the external policy-mutation
freeze begun before repository cleanup through the separate final read-only
`verify`, its stable two-snapshot readback, and validation of the saved output.
That read-only result must have top-level
`schema_version: "organization-review-gate-handoff-output/v1"`,
`mode: "verify"`, `status: "final-verified"`, `applied: false`, and
`action: null`. It also embeds
`final_closure_receipt` schema version 1, binding the organization, reviewed
manifest digest, final snapshot digest, legacy/v2 ruleset IDs and states, and
the exact repository cohort. `final_closure_receipt_sha256` binds the canonical
embedded receipt. Preserve the **complete verify JSON output** at
`HANDOFF_FINAL_VERIFY`; do not save only the embedded receipt.

The third freeze may end after that complete output has been captured and
validated. If the read-only verify is inconclusive, any bound policy differs,
or a known organization/repository policy mutation occurs after capture but
before bridge removal is prepared, keep every bridge, resolve the drift, and
produce a fresh final read-only verify output under a new freeze. Never use the
`verify --apply` response or an older receipt as a substitute.

Every
authoritative success boundary reads one complete snapshot, waits five
seconds, and reads it again. If their selected evidence or policy differs, the
pair restarts; after 60 seconds without an identical pair the result is
inconclusive and no next write is allowed.

After that closure, open a separate PR in every member to remove the canonical
bridge:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --remove-legacy-bridge \
  --final-closure-receipt "$HANDOFF_FINAL_VERIFY" \
  --expected-final-closure-receipt-sha256 \
  "$HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --remove-legacy-bridge \
  --final-closure-receipt "$HANDOFF_FINAL_VERIFY" \
  --expected-final-closure-receipt-sha256 \
  "$HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

Despite its option name, `--final-closure-receipt` takes the complete final
read-only verify JSON file. The bootstrap validates the terminal top-level
fields, recomputes the canonical embedded receipt digest, compares the explicit
expected SHA-256, and requires the worktree's GitHub `origin` repository to be
one of the receipt's exact repository bindings. A receipt for another cohort
or repository cannot authorize removal.

If the bridge is already absent, the bridge-removal component is an idempotent
no-op. An existing non-canonical bridge is rejected rather than deleted. The
command as a whole is also the canonical local installer: with `--apply` it
would repair drifted verifier/controller bytes or the managed CODEOWNERS block
even when there is no bridge to remove. Start from a clean worktree and verify
those three surfaces before applying. If the dry run proposes anything besides
bridge removal, stop and resolve or separately review that drift instead of
describing the PR as bridge-only. After the PRs merge, rerun ordinary
validation without `--legacy-bridge`; every repository must satisfy the normal
final no-v1 contract.

## 1. Create and merge the migration PR

Before changing the consumer worktree, perform a read-only preflight:

```bash
REPO=OWNER/REPO
DEFAULT_BRANCH="$(gh api --hostname github.com \
  "repos/$REPO" \
  --jq '.default_branch')"
DEFAULT_WORKFLOW_PERMISSIONS="$(gh api --hostname github.com \
  "repos/$REPO/actions/permissions/workflow" \
  --jq '.default_workflow_permissions')"
test -n "$DEFAULT_BRANCH"
test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
```

Stop if the permissions read is missing, fails, or is not `read`. Changing that
repository setting is not implicit installation authority. Obtain separate
authorisation to set default workflow permissions to read-only, read the
endpoint back, and repeat the preflight before continuing.

Use a clean checkout of `Joey-Tools/codex-review-gate` as `SOURCE_ROOT` and a
clean worktree of the consumer repository as `TARGET_ROOT`:

```bash
CONTROL_PLANE_OWNER=@JoeyTeng
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

The helper revalidates the target workflow parents at explicit checkpoints.
This is not an operation-bound filesystem sandbox: a hostile same-UID process
can still race path-based operations between checkpoints. Use a worktree whose
parent directories are not being concurrently modified by an untrusted
process, and do not bypass a reported safety failure with a manual copy.

The first command previews the change. The second copies both canonical
workflows byte for byte and merges a final managed block into
`.github/CODEOWNERS` without removing unrelated entries. If another workflow
still calls v1, inspect the paths reported by the helper and remove or
deactivate those callers in this same migration PR. One PR may remove v1,
install v2, and install the CODEOWNERS control plane.

If the repository currently uses `CODEOWNERS` at the repository root or under
`docs/`, the helper stops rather than creating `.github/CODEOWNERS` and
silently shadowing that policy. Move or merge all existing entries into
`.github/CODEOWNERS` in the same migration PR, then rerun the helper.

Review the consumer diff and run that repository's normal validation, but do
not request approval until the canonical inventory snapshot below is ready.
Then obtain an independent approval from `CONTROL_PLANE_OWNER` before merging
the migration PR. This first approval is a manual trust-bootstrap gate: pull
requests use CODEOWNERS from the base branch, where the new rules are not yet
present, and the new ruleset is not active yet. Immediately before merge,
verify that the owner is not the PR author, that the owner's latest review is
`APPROVED` for the current full head SHA, and that the head has not changed
after that read. Future PRs that change the workflow or CODEOWNERS are enforced
by GitHub and require the same owner to approve the final head; stale approvals
are dismissed after a push. Do not manually reconstruct the workflow from
this guide, and do not activate the required check while the v2 workflow exists
only on a feature branch.

### Canonical legacy inventory generator

Use the tracked executable helper at
`$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`. It accepts exactly
three arguments—repository, expected default branch, and output path—and owns
the fail-fast schema validation, canonical sorting, cleanup, and digest output.
Both calls below use this same reviewed executable; do not reconstruct it from
this guide.

Before requesting owner approval, execute the generator, print the digest, and
record both the canonical JSON and printed SHA-256 in the approval snapshot:

```bash
APPROVAL_INVENTORY_DIR="$(mktemp -d)"
APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
  "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
```

It binds the exact repository slug, numeric repository ID, opaque node ID, and
default branch; every matching active/inherited
ruleset's ID, name, source, enforcement, target, conditions, complete
`bypass_actors`, and complete `rules`; the complete matching effective
`required_status_checks` rule with all parameters; and the complete classic
parent required-status object, including `strict` and every check's producer
`app_id`, or explicit `null`. The shell helper and runtime use the same Node
canonicalizer, so approval and enforcement hash identical bytes. Before
hashing, it sorts semantically unordered
bypass actors, required checks, classic contexts/checks, and condition
`include`/`exclude` sets. Even a repository with no legacy requirement has a
digest because the canonical empty inventory remains bound to the repository
and default branch. An incomplete API response or schema is inconclusive, and
any digest drift fails closed rather than being treated as absence. A successful
empty or JSON `null` classic response is inconclusive; only an explicitly
recognised absence response becomes canonical `null`.

Keep every legacy requirement active until this migration merges, so later
failure remains fail closed. Preserve `MIGRATION_HEAD` and the owner-approved
snapshot, then supply its recorded digest externally as
`LEGACY_INVENTORY_SHA256`; the transaction has no default for it. The same
digest is also the cross-process baseline for every remote staging and
activation preview/apply below. It must remain identical through the Disabled
stage, canary, activation write, and exact Active readback; a new helper
process does not establish a new baseline.

The entire final gate and merge is one fail-fast transaction. It refreshes the
legacy inventory, default branch, PR base/head/state, authenticated actor, and
complete owner-review inventory before its sole mutation. Use one
repository-approved merge method:

```bash
(
  set -euo pipefail

  MIGRATION_PR=PR_NUMBER
  MIGRATION_HEAD=FULL_HEAD_SHA_FROM_APPROVAL_SNAPSHOT
  MERGE_METHOD=REPOSITORY_APPROVED_METHOD
  CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
  case "$MERGE_METHOD" in
    merge|squash|rebase) ;;
    *) printf 'unsupported or unset repository merge method\n' >&2; exit 1 ;;
  esac
  TXN_DIR="$(mktemp -d)"
  PR_STATE="$TXN_DIR/pr.json"
  FINAL_REVIEW_PAGES="$TXN_DIR/reviews.json"
  MERGE_BODY="$TXN_DIR/merge-body.json"
  MERGE_RESPONSE="$TXN_DIR/merge-response.json"
  POST_MERGE_STATE="$TXN_DIR/post-merge.json"
  LEGACY_INVENTORY="$TXN_DIR/legacy-inventory.json"
  cleanup() {
    rm -f "$PR_STATE" "$FINAL_REVIEW_PAGES" "$MERGE_BODY" \
      "$MERGE_RESPONSE" "$POST_MERGE_STATE" "$LEGACY_INVENTORY"
    rmdir "$TXN_DIR" 2>/dev/null || true
  }
  trap cleanup EXIT
  trap 'exit 130' HUP INT TERM

  DEFAULT_BRANCH_FRESH="$(gh api --hostname github.com \
    "repos/$REPO" --jq '.default_branch')"
  test "$DEFAULT_BRANCH_FRESH" = "$DEFAULT_BRANCH"
  "$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
    "$REPO" "$DEFAULT_BRANCH_FRESH" "$LEGACY_INVENTORY" > /dev/null
  FRESH_LEGACY_INVENTORY_SHA256="$(node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    process.stdout.write(crypto.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"));' \
    "$LEGACY_INVENTORY")"
  test "$FRESH_LEGACY_INVENTORY_SHA256" = \
    "${LEGACY_INVENTORY_SHA256:?external approval-snapshot digest is required}"

  gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
    --json author,baseRefName,headRefOid,state,isDraft > "$PR_STATE"
  jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
    --arg owner "$CONTROL_PLANE_LOGIN" \
    '.baseRefName == $base and .headRefOid == $head and .state == "OPEN" and (.isDraft | not)
     and (((.author.login // "") | ascii_downcase) != ($owner | ascii_downcase))' \
    "$PR_STATE"
  CURRENT_ACTOR="$(gh api --hostname github.com user --jq '.login')"
  jq -ne --arg actor "$CURRENT_ACTOR" --arg owner "$CONTROL_PLANE_LOGIN" \
    '($actor | ascii_downcase) == ($owner | ascii_downcase)'
  gh api --hostname github.com --paginate --slurp \
    "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
    > "$FINAL_REVIEW_PAGES"
  jq -e --arg owner "$CONTROL_PLANE_LOGIN" --arg head "$MIGRATION_HEAD" \
    '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
     | sort_by([.submitted_at, .id]) | last
     | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
    "$FINAL_REVIEW_PAGES"

  jq -n --arg sha "$MIGRATION_HEAD" --arg method "$MERGE_METHOD" \
    '{sha:$sha, merge_method:$method}' > "$MERGE_BODY"
  gh api --hostname github.com --method PUT \
    "repos/$REPO/pulls/$MIGRATION_PR/merge" \
    --input "$MERGE_BODY" > "$MERGE_RESPONSE"
  jq -e '.merged == true' "$MERGE_RESPONSE"
  test "$(gh api --hostname github.com "repos/$REPO" --jq '.default_branch')" = \
    "$DEFAULT_BRANCH_FRESH"
  gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
    --json baseRefName,headRefOid,state,mergedAt > "$POST_MERGE_STATE"
  jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
    '.state == "MERGED" and .mergedAt != null and .baseRefName == $base
     and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))' \
    "$POST_MERGE_STATE"
)
```

Every precondition command is before the synchronous merge mutation; any
API, `jq`, `test`, pagination, parse, actor, base, head, state, or review
failure exits and the trap cleans every temporary file. The REST endpoint
either merges immediately or fails (including 405/409); it cannot enqueue the
PR. Do not use `gh pr merge`, auto-merge, a merge queue, or an admin bypass.
GitHub still has no atomic compare-and-swap over review state and head, so the
hard actor check requires the trusted owner to perform this direct merge
immediately after the fresh review readback. A head-only reread is insufficient.

After that immediate post-merge default/base/head/lifecycle readback succeeds,
keep every inventoried legacy requirement active. Stage a separate v2 ruleset
as Disabled, run the canary while the legacy gate continues to block merges,
then activate v2 and read the exact complete Active policy back. Only after
that Active readback may you perform a separately authorised cleanup that
removes the legacy requirements and reads both ruleset and classic surfaces
back. This overlap may
temporarily require both gates; it never permits an interval with neither gate.

Afterward, read the PR back as merged, refresh a clean checkout of the default
branch, compare both installed workflows byte for byte with their canonical
templates again, and re-read the final effective CODEOWNERS block and explicit
owner.

## 2. Stage the ruleset as Disabled

After the migration is present on the default branch, preview and apply remote
staging:

```bash
V2_RULESET_NAME="Must Pass Codex Review"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply
```

Alternatively, import
`templates/codex-gated-repo/rulesets/codex-review-gate.json` through
**Settings -> Rules -> Rulesets -> New ruleset -> Import a ruleset**.

Before continuing, verify that the staged ruleset:

- remains **Disabled**; a newly created ruleset targets only the default
  branch. When the helper updates an existing same-name branch ruleset whose
  include/exclude conditions cover more refs, it preserves those broader
  targets; inspect them and confirm every additional target is intended;
- requires `codex/github-review-gate` from expected source **GitHub Actions**
  (`integration_id: 15368`), not “Any source”;
- requires the branch to be up to date;
- requires Code Owner review and dismisses stale approvals; a new ruleset uses
  zero ordinary approvals, while the helper preserves any existing higher
  approval count;
- requires all review conversations to be resolved; and
- blocks non-fast-forward updates to the default branch; and
- has no bypass actors.

Every preview and apply compares the complete canonical dual-surface inventory
with the same owner-approved digest. API/schema incompleteness and any drift in
repository, default branch, ruleset policy, or classic producer binding are
inconclusive and fail closed.

The helper inventories the legacy `codex/review-gate` context in both effective
repository rulesets and classic branch protection required-status contexts.
Keep those active legacy requirements unchanged throughout Disabled staging,
the canary, and v2 activation. The helper permits this fail-closed overlap and
never edits classic protection or a separately managed legacy ruleset. If an
active legacy or incomplete ruleset already uses the selected v2 ruleset name,
the helper refuses every write; set `V2_RULESET_NAME` to a distinct name before
staging, and pass that same variable to staging, activation, and the final
probe. An unreadable or malformed legacy inventory, or any change that makes
the full canonical inventory differ from the owner-approved digest, is
inconclusive, not absence. Do not remove any legacy requirement in this phase.

## 3. Create and exercise the separate canary PR

Create a temporary branch from the merged default branch, make one harmless
reviewable change, and open a non-draft PR. Record its pull request number and
full current head SHA. Also bind the same-repository head ref that may later be
deleted; do not infer it from a branch name after the canary has run:

```bash
CANARY_HEAD="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.sha')"
CANARY_HEAD_REPO="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.repo.full_name')"
CANARY_HEAD_REF="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.ref')"
test "${#CANARY_HEAD}" -eq 40
test "$CANARY_HEAD_REPO" = "$REPO"
test -n "$CANARY_HEAD_REF"
```

Normally, request the review directly on the PR:

```text
@codex review
```

Do not add prose to the request. GitHub may persist this one-line direct
request with exactly one terminal LF or CRLF; those two storage forms are
equivalent to exact `@codex review`. Do not accept or emit any other
whitespace, visible text, or hidden comment.

This is the preferred path because it does not spend Actions minutes merely to
create the request. A later qualifying `created` or `edited` Codex bot comment
wakes the controller, which establishes a strictly newer full verifier attempt.
If the provider result arrives only as a review or reaction, or another
recovery is needed, run a manual reconcile.

GitHub records the verifier run/job/CheckRun against the exact PR feature-head
SHA, not its test-merge SHA. The canonical `pull_request` verifier still
executes on `refs/pull/N/merge`; inside the Action it strictly checks
`GITHUB_REF`, `GITHUB_SHA`, the event PR head/base scope, and a fresh PR read
whose test-merge matches the runtime SHA. Its protected top-level `run-name`
also makes GitHub expose the exact
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` as `display_title`;
the run's sole PR binding must carry the current feature head and
default-branch base SHA. A successful feature-head CheckRun is therefore
execution-bound to the exact current test-merge.

Event validation is limited to the PR head/base SHA, ref, and repository. Its
`merge_commit_sha` may be missing or historical and is deliberately not a
binding input.

There is deliberately no cron or writable review event. The verifier starts on
`opened`, `reopened`, `synchronize`, and `ready_for_review`; controller and
verifier have separate per-PR concurrency namespaces. Before a deliberate
same-head re-review, run `begin-review` so the new request is read back and a
strictly newer verifier attempt becomes observable. A direct comment alone
does not atomically invalidate an older success.

If a base retarget leaves no verifier for the current exact
head/base/test-merge scope, follow
`create_verifier_run`: for a ready PR, convert it to draft and mark it ready
again; for an already-draft PR, mark it ready. Verify that a new
`ready_for_review` verifier exists for the current exact head/base/test-merge scope, then
reconcile. Rerunning the old verifier is not valid retarget recovery.

After a base retarget or a detected base force-push epoch, always use
`begin-review` with `request_review=true`, then reconcile after Codex places a
qualifying `+1` directly on that canonical request. GitHub terminal clean
payloads do not identify the request/base snapshot that produced them, so in
this recovery mode a later terminal clean by itself deliberately remains
pending. Findings still block immediately.

Use `begin-review` when request creation and the newer verifier attempt must be
coordinated. For example:

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo "github.com/$REPO" \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true
```

Do not add `--ref`. Omitting it selects the default-branch workflow. After
dispatch, locate the new run and read it back:

```bash
gh run list \
  --repo "github.com/$REPO" \
  --workflow codex-review-gate-controller.yml \
  --event workflow_dispatch \
  --limit 10 \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

Require the selected run's `event` to be `workflow_dispatch` and `headBranch`
to equal the repository's current default branch. A feature-branch run is
unsupported; do not use its result.

Before accepting the canary, reconcile its exact current head even if an
automatic bot-comment run already completed:

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo "github.com/$REPO" \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false
```

If the direct request comment ID was recorded, it may be supplied as the
optional `request_comment_id` input. It is only a hint; the Action still checks
the pull request and all relevant newer evidence.

The completed run reports execution health separately from the gate outcome.
Follow its `recovery_code` and summary next action in every non-success case.
A finding is normally a healthy gate failure, while an unhealthy execution
requires recovery or a retry; do not treat the two cases as equivalent.
`healthy/pending` is also fail-closed: it means the run safely cannot authorize
success yet. Only `recovery_code=wait_provider` is a pure wait; every other
code requires the concrete action named by the summary before a later
exact-head reconcile.

For an unusually large PR, set the reviewed protected Actions variable only
when the summary reports `use_expanded_limits`:

```bash
gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
  --repo "github.com/$REPO" \
  --body expanded
```

Then reread the exact head and run one scoped controller reconcile. Manual
dispatch has no limits-profile or numeric override. Only the named profiles
are supported.

Finally, re-read the PR, verifier attempt and exact feature-head CheckRun.
Require
all of the following:

- the PR head is still `FULL_HEAD_SHA`;
- the PR base and test-merge SHA are unchanged;
- the controller established a strictly newer verifier attempt and its unique
  canonical `codex/github-review-gate` CheckRun is `success` on that exact
  feature-head SHA;
- that verifier run is bound to the unchanged current test-merge by its
  merge-ref environment, event head/base scope (not event `merge_commit_sha`),
  and fresh PR read;
- the CheckRun expected source is GitHub Actions; and
- the run summary reports `execution_health=healthy` and
  `gate_outcome=success`.

If the head changes, stop and reread the summary plus the complete physical
lineage; never accept success from an older commit or automatically start a
same-PR generation. Continue on the new head only when every ambiguous
predecessor is explicitly bound to a different full head. An unclosable
ordinary, edited, malformed, denied, deleted, or otherwise unbound predecessor
requires a replacement PR.

## 4. Activate and close the canary

Only after the exact-head canary passes, preview and activate the ruleset:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

Immediately before every ruleset write, including Disabled staging, the helper
re-reads the exact default-branch workflow inventory, CODEOWNERS errors, and
the named owner's repository permission. Before an active write it also
re-reads the canary lifecycle, base/head/test-merge SHA, exact verifier
run/job/CheckRun, exact canonical `display_title`, sole PR head/base binding,
and collision inventory. After a write it reads the exact
ruleset and the complete consumer security snapshot back.
Use the recorded `V2_RULESET_NAME` in every staging, activation, and final
probe command. Confirm active enforcement, the same expected GitHub Actions source, strict
up-to-date, Code Owner review with stale approval dismissal, the new-ruleset
default of zero ordinary approvals without lowering an existing higher count,
conversation resolution, non-fast-forward default-branch protection, and an
explicitly empty `bypass_actors` array.

Only after that exact Active readback, derive the sole admissible cleanup state
from the complete pre-cleanup security snapshot. This read-only command first
requires the current legacy inventory to equal the original owner-approved
digest. Its stdout is one deterministic JSON object:

```bash
POST_CLEANUP_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --derive-post-cleanup-plan > "$POST_CLEANUP_PLAN"
jq . "$POST_CLEANUP_PLAN"
EXPECTED_POST_CLEANUP_SECURITY_SHA256="$(jq -er \
  '.expected_post_cleanup_security_sha256 |
   select(test("^[0-9a-f]{64}$"))' \
  "$POST_CLEANUP_PLAN")"
```

Review the plan before authorising cleanup. It may remove only
`codex/review-gate`. If that removes the final item from classic
required-status policy, that empty policy and its `strict` field may disappear.
An emptied ruleset status rule may disappear, and the whole dedicated
legacy-only ruleset may disappear only if no other rule remains. Those are the
only structural exceptions. Repository/default-head identity, workflow and
CODEOWNERS inventory, owner permission, every field and non-legacy check
including `strict` and `app_id` in a surviving classic policy, and every
retained ruleset's identity, conditions, bypass actors, and unrelated rules
must remain exact.

Execute only that reviewed plan as the separately authorised legacy cleanup,
then perform the read-only post-cleanup closure with the same selected name and
recorded expected digest. It reads two complete security snapshots and
requires both rounds to be identical, equal the expected digest, clear on both
legacy surfaces, and bound to the same exact complete Active v2 policy:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --verify-post-cleanup \
  --expected-post-cleanup-security-sha256 \
  "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
```

Do not re-derive after cleanup. Any cleanup/readback/verification failure or
inconclusive result leaves v2 Active. Preserve it, run only read-only
diagnostics, and report the exact remaining or indeterminate state; never
disable or roll back v2 to manufacture closure.

Then close the canary without merging it. Do not use `--delete-branch` on the
close command. Prove that the closed-unmerged PR still carries the recorded
head repository, ref, and OID, then use Git's exact-OID lease so deletion is
atomic with the final remote-ref comparison:

```bash
(
  set -euo pipefail
  trap 'printf "%s\n" "Canary cleanup did not prove completion. Do not issue an unconditional delete; inspect and report the exact PR/ref scope." >&2' ERR

  gh pr close "$CANARY_PR" --repo "github.com/$REPO"
  CANARY_CLOSED_STATE="$(gh api --hostname github.com \
    "repos/$REPO/pulls/$CANARY_PR")"
  jq -e \
    --arg repo "$CANARY_HEAD_REPO" \
    --arg ref "$CANARY_HEAD_REF" \
    --arg sha "$CANARY_HEAD" \
    '.state == "closed" and .merged_at == null and
     .head.repo.full_name == $repo and .head.ref == $ref and .head.sha == $sha' \
    <<< "$CANARY_CLOSED_STATE" > /dev/null

  CANARY_REMOTE="https://github.com/$CANARY_HEAD_REPO.git"
  REMOTE_CANARY_HEAD="$(git ls-remote --refs "$CANARY_REMOTE" \
    "refs/heads/$CANARY_HEAD_REF" |
    awk 'NR == 1 { print $1 } END { if (NR != 1) exit 1 }')"
  test "$REMOTE_CANARY_HEAD" = "$CANARY_HEAD"
  git push \
    --force-with-lease="refs/heads/$CANARY_HEAD_REF:$CANARY_HEAD" \
    "$CANARY_REMOTE" \
    ":refs/heads/$CANARY_HEAD_REF"
  POST_DELETE_REMOTE_CANARY="$(git ls-remote --refs "$CANARY_REMOTE" \
    "refs/heads/$CANARY_HEAD_REF")"
  test -z "$POST_DELETE_REMOTE_CANARY"
)
```

If the PR identity, remote OID, or lease does not match, stop and report it.
A mismatch before the leased push leaves the branch intact; a post-push read
failure leaves deletion outcome unknown. Never replace the leased deletion
with an unconditional delete.

Installation is complete when the default branch contains both canonical `@v2`
workflows, the active ruleset has the expected source and protections, both
legacy surfaces read back without `codex/review-gate`, and the closed-unmerged
canary records the exact successful native CheckRun on its current feature-head
SHA, plus the canonical run-name receipt and PR binding for its unchanged
current default-branch base and test-merge.
