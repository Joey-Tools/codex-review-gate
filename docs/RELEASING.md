# Action v2 Release

The public v2 action is a complete `packages/action` subtree split from
`Joey-Tools/codex-review-gate` into
`Joey-Tools/codex-review-gate-action`. The one supported release in this
pipeline is `v2.0.0`, with signed aliases `v2.0` and `v2`.

No source-repository job may write to
`JoeyTeng/codex-review-gate-action`. That personal repository is a permanently
frozen v1 archive. Existing v1 consumers and every archived ref/object remain
unchanged; the source release pipeline only re-reads its recorded baseline.

## Two-stage publication and activation boundary

This runbook has two independent, fail-closed phases. Phase 1 publishes and
verifies the action repository. Phase 2 installs an immutable production
consumer and changes branch protection only after a live canary succeeds.

Throughout Phase 1, the source-root caller at
`.github/workflows/codex-review-gate.yml` must remain exactly on
`JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`.
Neither the release workflow nor its publication change may edit that caller,
install the v2 reconcile graph, change a required status context, or claim that
v2 is active. A successful publication is only an input to the separately
reviewed activation phase.

## Closed repository and ref contract

The machine-readable pre-release baseline is
`docs/release/action-v2-repository-baselines.json`. Production verification
also pins its exact SHA-256 to
`63dc08cdf35720a5659ec6e2557ac4a3f49c26be331f4b62d1cb3e402336df6a`;
editing the baseline is not a drift-recovery mechanism.

- Frozen archive: `JoeyTeng/codex-review-gate-action`, all 27 recorded refs and
  object IDs unchanged; `master` remains
  `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`, tree
  `8d909dd441b28b6915c46f60e8a144e64fd5268b`.
- v2 target before first publication:
  `Joey-Tools/codex-review-gate-action`, exactly three recorded heads, no tags,
  21 commits reachable from those heads, and two roots. Its transferred
  `master` has the same commit and tree as the frozen archive.
- v2 target after publication: the same two archival heads, `master` advanced
  by a normal fast-forward to the complete split head, and exactly the direct
  annotated tags `v2.0.0`, `v2.0`, and `v2`.
- All three v2 tags are signed by the same policy-bound OpenPGP primary key and
  peel directly to the exact new `master` commit. The immutable tag and aliases
  are never moved, replaced, deleted, nested, lightweight, or force-pushed.
- No `refs/heads/v1*` or `refs/tags/v1*` may exist in the v2 target. Retained
  `src/core.mjs` or `src/gate.mjs` files are split-DAG/runtime implementation
  details and do not admit a v1 selector.

The provenance manifest binds the complete parent graph, reachable commit-set
digest, root count, parent edge count, canonical graph digest, complete released
tree with every blob OID and SHA-256, the source package identity, and these
public v2 identities:

- source `package.json`: `codex-review-gate-source@2.0.0` with exact repository
  URL `git+https://github.com/Joey-Tools/codex-review-gate.git`;

- `action.yml`: plan-only composite entry;
- `.github/workflows/codex-review-gate.yml`: trusted public controller entry;
- `.github/workflows/codex-review-gate-reconcile.yml`: trusted reconciliation entry;
- `src/v2/workflow-controller.mjs`: v2 workflow controller;
- `src/v2/action.mjs`: plan-adapter controller;
- every direct, canonically named, regular non-symlink `src/v2/*.mjs` module,
  discovered from the released tree and recorded in UTF-8 byte order;
- `github-codex-evidence-authority-v2.json`, with its exact blob OID, SHA-256,
  and `sha256:<digest>` policy identity;
- action `package.json`: `codex-review-gate-action@2.0.0` with exact repository
  URL `git+https://github.com/Joey-Tools/codex-review-gate-action.git`.

Any hidden, nested, non-`.mjs`, noncanonical, duplicate, symlink, or special
entry under `src/v2/` rejects publication instead of escaping runtime identity.
Source-only Required-CI workflows remain outside `packages/action`; they are
neither split into the action repository nor admitted to runtime identity.

## Required external configuration

Publication is deliberately closed until all of these controls exist:

1. Create the protected GitHub Actions environment `action-v2-release` in the
   source repository. Require deliberate approval for its use.
2. Add `ACTION_REPO_PUSH_TOKEN_V2` to that environment. It must be a fine-grained
   PAT or GitHub App token scoped only to
   `Joey-Tools/codex-review-gate-action`, with minimum `Contents: write`.
   Organization deploy keys are disabled and are not supported by this flow.
3. Add `ACTION_RELEASE_SIGNING_PRIVATE_KEY_V2` and
   `ACTION_RELEASE_SIGNING_FINGERPRINT_V2` to the environment. The fingerprint
   is the full OpenPGP primary-key fingerprint; the workflow rejects any import
   that does not match it exactly. Use a dedicated automation signing key whose
   protected secret material can sign non-interactively on an ephemeral runner;
   this workflow has no passphrase or pinentry interface.
4. Configure the target branch/ruleset so the selected token has the documented
   maintenance role or narrow bypass needed for the single `master` update.
   Protect `v2*` tags against update and deletion. A token that cannot satisfy
   these rules leaves publication blocked; never weaken the rules ad hoc.

The token is transported only through a runner-private Git config HTTPS
`extraheader`. It is never embedded in a URL, accepted as an SSH deploy key, or
passed to the release script. `actions/checkout` uses
`persist-credentials: false`.

## Validation

The workflow runs read-only validation on matching `master` pushes. A normal
push never publishes to the action repository. From a clean source checkout:

```bash
scripts/release-action-subtree.sh --check --source-ref HEAD
```

This command runs source/action checks and tests, computes the complete subtree
split, re-reads both remote baselines, imports the target heads into a private
bare staging repository, and verifies:

- source `packages/action` tree equals the split root tree;
- source and action package names, version `2.0.0`, and exact Joey-Tools
  repository URLs match the closed release identity;
- transferred target `master` is an ancestor of the split head;
- the recorded initial target has 21 commits and two roots across all heads;
- the frozen personal repository still has every recorded ref and tree;
- public action, reusable-workflow, controller, evidence-authority policy,
  package, and dynamically discovered v2 module identities are closed and
  complete.

Any remote drift, partial baseline, missing object, v1 ref in the new target,
runtime identity mismatch, dirty source tree, or test failure rejects the run.

## First publication

Do not run this section until the v2 runtime, reusable workflow, target ruleset,
HTTPS credential, and signing identity are all independently reviewed and
closed.

Dispatch `Release Action Subtree v2` from exact source `master` with
`publish_v2=true`. The protected `action-v2-release` environment is the manual
authorization boundary. That dispatch runs the integrated validation inside the
single publishing invocation so the clean-tree and exact-commit boundary is not
split across jobs. The workflow imports and binds the signing key, then runs:

```bash
scripts/release-action-subtree.sh \
  --publish \
  --source-ref "$GITHUB_SHA" \
  --output "$RUNNER_TEMP/codex-review-gate-action-v2.0.0-provenance.json"
```

The script stages the split and tags outside the source refs, generates a
preflight manifest, and performs one atomic non-force push containing:

```text
<split>:refs/heads/master
refs/tags/v2.0.0:refs/tags/v2.0.0
refs/tags/v2.0:refs/tags/v2.0
refs/tags/v2:refs/tags/v2
```

It then re-reads both repositories, requires exact planned refs, writes the
manifest through a private create-only publication boundary, and re-reads both
repositories again. The workflow uploads the exact manifest as the
`codex-review-gate-action-v2.0.0-provenance` artifact.

GitHub's atomic receive protects the four-ref update at the target repository.
It does not make the source and target repositories one transaction. The
frozen archive is never a push target and is verified before and after the
target write.

## Post-publication admission

Do not prepare a production consumer from a local split, a workflow run's source
SHA, or any v2 tag name. Download the exact provenance artifact from the exact
successful publication run and admit its `action.commit_oid` as `RELEASE_SHA`
only when it matches `^[0-9a-f]{40}$` and all of these checks close together:

- the publication run used the intended source `master` commit and its uploaded
  artifact bytes and SHA-256 are retained as activation evidence;
- target `master` is exactly `RELEASE_SHA`, and the manifest's released tree,
  runtime closure, repository identities, and source/action package identities
  revalidate against that commit;
- remote `v2.0.0`, `v2.0`, and `v2` are the exact manifest-bound direct annotated
  tag objects, all verify under the independently trusted primary fingerprint,
  and all peel directly to `RELEASE_SHA`;
- the complete target ref inventory contains only the admitted post-publication
  state, while the frozen personal repository still exactly matches its
  read-only baseline; and
- a fresh exact-state verification produces no ref, graph, tree, signature, or
  provenance drift.

Any mismatch blocks activation. It never authorizes a branch or tag selector,
an alternate 40-hex object, a repaired provenance file, or a moved release ref.

## Phase 2: immutable consumer activation

Activation is a separate reviewed change. Substitute the admitted lowercase
40-hex `RELEASE_SHA` into every controller call in the complete consumer graph:

```yaml
uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@<RELEASE_SHA>
```

`<RELEASE_SHA>` is documentation notation and must not appear literally in a
workflow. The deployed selector must equal the already admitted
`RELEASE_SHA` byte for byte. Production rejects the personal `JoeyTeng`
repository, `@v1`, every `@v2*` selector (including the signed release tags),
branches, tags, symbolic refs, shortened SHAs, and every other floating or
different selector.

Install the entire graph represented by the released
`.github/workflows/codex-review-gate-reconcile.yml`; do not extract only its
initial job. The activation review must preserve all of these contracts:

- the complete event topology, the `17 */2 * * *` schedule, repository-wide
  `codex-review-gate-v2-${{ github.repository }}` concurrency with
  `cancel-in-progress: false`, and the `pull-request` dispatch input;
- the schedule route's `scan-all-open` coordinator, its controller-owned
  durable candidate inventory/reservation, and its canonical matrix output;
  the per-candidate job must consume
  `fromJSON(needs.schedule-dispatch.outputs.matrix)`, pass through the raw
  `dispatch_binding`, use `max-parallel: 1` with `fail-fast: false`, and gate
  both steps with `matrix.enabled`; an empty inventory uses one disabled
  sentinel and no later job may re-enumerate or select a caller-provided PR;
- exactly four controller calls, each pinned to the same `RELEASE_SHA`, with
  exact `contents: write`, `id-token: write`, `issues: write`,
  `pull-requests: write`, and `statuses: write` permissions;
- `selection-policy: joey-default`, the closed initial route expression,
  `ordinary` follow-up routes, the exact pull-request selector expression, and
  the four `initial`/post-wait observation boundaries;
- exactly three credential-free wait jobs with `permissions: {}`,
  `runs-on: ubuntu-slim`, `timeout-minutes: 5`, `deployment: false`, and the
  environments `codex-review-gate-public-initial-15m`,
  `codex-review-gate-public-post-request-15m`, and
  `codex-review-gate-public-no-start-15m`; and
- the released reusable workflow's closed inputs, permissions, exact checkout
  binding, and all three trusted execution legs' exact
  `V2_PUBLIC_WAIT_MINUTES: "15"` and `codex/github-review-gate` status context.

Before any canary, use the authenticated Environment API to prove that all
three named environments exist in the consumer repository and each has exactly
one 15-minute `wait_timer` protection rule. The workflow's five-minute job
timeout is not the public wait; the environment protection rule supplies that
boundary. Missing, unreadable, early-released, or non-15-minute evidence blocks
the rollout.

Treat the following as one required-context ruleset/branch-protection switch and
use this forward order:

1. Keep the legacy v1 caller enabled and keep its recorded required context in
   branch protection. Configure the three environment rules, then deploy the
   complete exact-SHA graph to an approved live canary consumer where the v2
   context is not yet required.
2. Exercise the supported event paths and waits. Prove the selected workflow
   repository and `job.workflow_sha`, checkout commit, environment server-time
   boundaries, ledger/effect receipts, and emitted
   `codex/github-review-gate` status all bind to `RELEASE_SHA` and the canary
   head. A skipped, ambiguous, or partially observed run is not a pass.
3. Only after the canary passes, deploy the byte-equivalent graph to the
   production consumer while the legacy v1 path remains available. Add
   `codex/github-review-gate` to the required contexts and prove a new ordinary
   pull request satisfies it before removing the recorded legacy v1 required
   context. Retire the legacy caller only after the rollback window closes.

Rollback uses the inverse authority order: first restore or retain the legacy
v1 caller, then re-add and prove its required context, then remove the v2
required context, and only then disable or remove the v2 consumer graph. Never
roll back by moving/deleting v2 refs, switching the consumer to a floating
selector, weakening an environment wait, or rewriting provenance.

## Retry and incident policy

An exact-state rerun is verification-only: it requires all three tag object IDs,
their signatures, the target `master`, complete refs, graph, and tree to match,
then emits a new create-only provenance file. It never rewrites a tag.

Stop without repair pushes when any of these occurs:

- only some v2 tags exist;
- any planned ref differs;
- `master` cannot fast-forward from the transferred baseline;
- a v2 tag is lightweight, nested, unsigned, signed by another identity, or
  peels to another commit;
- a v1 head/tag appears in the new target;
- the frozen repository differs from its baseline;
- target rules deny the atomic write.

Preserve logs and any successfully linked provenance output for audit. Correct
the source/runtime or external policy through an ordinary reviewed change; do
not force-push, delete tags, move aliases, edit the baseline to bless drift, or
write to the frozen personal repository.

## Historical v1 releases

The v1.1.0 through v1.5.1 refs and release assets remain solely in the frozen
personal repository. This v2 generator does not reinterpret or regenerate
their runtime provenance. Existing consumer URLs continue to resolve there;
an activated v2 production caller must use
`Joey-Tools/codex-review-gate-action` at the single admitted exact
`RELEASE_SHA`, never a v2 tag or alias.
