---
id: 20260825-019ff4f8-action-v2-grilling-plan
title: Action v2 Confirmed Delivery Plan
status: active
created: 2026-08-25
updated: 2026-09-02
branch: codex/action-v2-release
pr: 34
supersedes: [20260813-7bf930a-action-v2-release-pipeline]
superseded_by:
---

# Action v2 Confirmed Delivery Plan

## Summary

- This is the authoritative adopted plan and implementation ledger for the
  replacement Codex review gate v2 runtime, consumer installation, publisher,
  and rollout. It records individually adopted decisions, accepted tradeoffs,
  explicit deferrals, implementation evidence, and delivery handoffs.
- Joey confirmed the then-complete shared summary and requested execution on
  2026-08-26. Later review evidence reopened the authoritative-result
  architecture branch. Q25-Q28 resolved that branch on 2026-08-27. Joey then
  reconfirmed the revised complete shared understanding and authorized plan
  commit plus execution on 2026-08-27. Implementation has resumed; privileged
  Environment approval remains a separate release-time control.
- A reason appears here only when the rollout contains an explicit reason from
  Joey or from a proposal that Joey explicitly adopted. Absence of a recorded
  reason does not invite a later implementation to invent one.
- The earlier implementation began before the grilling workflow reached its
  required final confirmation. The active worktree was therefore returned to
  `origin/master` at `10217253306ca2ee6f312f766a331f8924e26e47`.
- The pre-confirmation implementation remains recoverable at local branch
  `wip/v2-release-review` commit
  `42773dd2736af2f8759951fc7ebf6e21ebf3275b`; its uncommitted audit fixes are in
  stash `7f96293371cc2adfa0aeccc49effbf4c9d519ff2`. Neither is design authority;
  both must be reconciled against this confirmed plan before delivery.
- Normative implementation documentation now lives in
  `packages/action/DESIGN.md` and `packages/action/DESIGN.zh-CN.md`; release and
  operator procedure lives in `docs/RELEASING.md` and
  `docs/RELEASING.zh-CN.md`; human and agent installation procedures live under
  `docs/install/`. Those documents and the implementation have been reconciled
  to the adopted native-CheckRun architecture. This journal remains the
  decision, evidence, and handoff authority rather than duplicating those
  operational documents in full.

## Adopted Product And Rollout Contract

- A prerelease is allowed, but stable `v2.0.0` must deliver the agreed complete
  production loop.
- Stable releases follow strict SemVer. Prereleases may change; after stable
  `v2.0.0`, compatibility is preserved within the major, while a breaking
  change moves to a new major with a migration period.
- The Action is reusable across repositories. Rollout starts with selected
  Joey-owned repositories, expands to all Joey-owned repositories that need it,
  and preserves a path to public use. The exact initial repositories and rollout
  timing remain deferred.
- Validation and publication are automated, while the privileged publication
  stage requires an explicit human approval.
- Canonical source is `Joey-Tools/codex-review-gate`. Publication uses the
  existing Marketplace repository `JoeyTeng/codex-review-gate-action` so v2
  continues the existing listing and consumer namespace.
- Existing v1 consumers remain valid until deliberately migrated. V2 does not
  rewrite or republish the v1 series.

## Adopted Consumer And Installation Contract

### Packaging And Workflow ABI

- V2 ships a JavaScript Action, two copied canonical thin workflows, and an
  importable disabled ruleset template. A reusable workflow is not the
  consumer ABI. The read-only `pull_request` verifier owns the native required
  CheckRun on the exact PR feature-head SHA. Its merge-ref environment, event
  scope, and fresh PR read bind that result to the unchanged current
  head/base/test-merge scope. The protected-default-branch controller owns
  provider/manual wake-up, review-request creation, and exact verifier rerun
  orchestration.
  - Explicit reason: copied workflows own triggers, separate permissions,
    separate concurrency namespaces, typed dispatch, and pre-runner filtering
    that an Action step cannot own.
- The Action step uses `JoeyTeng/codex-review-gate-action@v2`. Consumers follow
  the floating major so ordinary compatible releases do not require edits in
  every installed repository.
- Installation documentation has two presentations of the same procedure:
  one human-readable guide and one agent-executable guide for carrying out the
  human installation. They are not guides for two different consumer types.

### Triggers, Inputs, And Cost Boundary

- There is no cron.
  - Explicit reason: private repositories with no relevant PR activity should
    not consume billable Actions minutes.
- The verifier uses `pull_request` activity types `opened`, `reopened`,
  `synchronize`, and `ready_for_review`. It fails closed outside the adopted
  same-repository, open, ready, default-base scope. `edited` is deliberately
  absent; a base retarget is refreshed by draft-to-ready lifecycle recovery,
  while strict up-to-date policy protects an advanced base until a new
  test-merge verifier run exists.
- Provider-driven automation uses `issue_comment` activity types `created` and
  `edited`, with exact event sender and comment-author filtering before runner
  allocation in the controller. An edit may invalidate prior success, while
  the absence of edits costs no runner time.
- There is no writable automatic `pull_request_review` job. Review-object and
  reaction-only outcomes are discovered by a later authoritative manual
  reconcile.
- The sole manual trigger is `workflow_dispatch`; `repository_dispatch` and a
  dual-entry design are rejected. The supported invocation uses the protected
  default-branch workflow and GitHub's native repository write/Actions
  permission gate rather than hard-coded actor allowlists. A feature-ref
  dispatch is unsupported; same-repository writers are an explicit trusted
  boundary.
  - Explicit reason: this preserves both the GitHub UI and `gh workflow run`
    with typed inputs, matches the accepted same-repository-writer boundary, and
    avoids a second parser and test surface.
- Manual business inputs are `operation`, `pr_number`, `expected_head_sha`,
  optional `request_comment_id`, `request_review` for `begin-review` with
  default `true`. Every input is untrusted and revalidated from GitHub. Callers
  cannot supply a verdict, CheckRun result, bot identity, required-check name,
  stale override, skip-full-reconcile override, or temporary limits profile.
  The selected soft-limit profile comes from protected repository
  configuration.
- Manual selectors and hints may locate evidence or stop a backward scan early,
  but they never supply authority. The reducer must prove that no newer relevant
  evidence was skipped before accepting an early stop.
- Every manual operation targets exactly one PR. Agents recover multiple PRs
  with separate dispatches.
  - Explicit reason: a per-PR matrix removed the proposed 1-8 target batch's
    Actions-minutes advantage while retaining `targets_json`, matrix, and input
    validation complexity.
- Lightweight API-only jobs prefer `ubuntu-slim`, with `ubuntu-latest` as the
  adopted fallback. The workflow job timeout is 14 minutes.

### Begin, Reconcile, And Concurrency

- The two logical operations are `begin-review` and `reconcile`.
- `begin-review` creates or safely adopts a fresh exact hidden-marker
  `@codex review` request by default, reads that request back, and then requests
  a full verifier rerun. The newer native verifier CheckRun establishes the
  observable pending/blocking generation once it appears. The accepted
  eventual-reconciliation boundary means request creation and that CheckRun
  are not an atomic transaction. `request_review=false` is an advanced
  best-effort option and does not add a dedicated barrier.
- An agent should normally post exact `@codex review` directly when the required
  check is not already passing, then use GHA only when reconciliation is needed.
  - Explicit reason: direct posting avoids unnecessary runner minutes; the
    workflow-owned path remains available when pending and request creation need
    to be coordinated.
- Verifiers and controllers use separate per-PR concurrency namespaces. The
  verifier is latest-generation single-flight with `cancel-in-progress: true`;
  cancellation is blocking and cannot satisfy the required check. Controllers
  retain `cancel-in-progress: false` because `begin-review` can cross a
  may-have-committed comment-creation boundary. GitHub may still replace one
  not-yet-started pending controller wake-up, so agents must observe the exact
  controller operation and later verifier attempt required by its recovery
  contract. Concurrency supplies scheduling, not an event or mutation fence.
- A `begin-review` logical attempt is keyed by repository ID, PR, expected head,
  and `GITHUB_RUN_ID`. A rerun adopts an existing exact, unedited, matching
  hidden marker. After an unknown POST result it rereads before retrying; if
  visibility remains unknown, the controller reports `unhealthy/pending` with
  `retry_begin` and `retry_safe=false`; it does not request a verifier rerun or
  claim that the required CheckRun is pending. GitHub issue-comment creation
  has no idempotency key, so the side effect may have succeeded before the
  failure became visible. The caller must wait for the exact same-run marker to
  settle and, if it remains absent, rerun the original controller workflow run
  instead of immediately retrying the POST or dispatching a new generation.
  Duplicate same-run requests are folded conservatively and reported rather
  than selecting a convenient clean result.

### Permissions And Execution Boundary

- The verifier grants only the read permissions needed for repository, issue,
  review, reaction, and pull-request evidence; it has no `statuses`, `checks`,
  `actions`, `issues`, `pull-requests`, contents, or OIDC write authority. The
  controller grants `actions: write` for the exact verifier rerun plus
  `issues: write` for canonical request and diagnostic comments, with only the
  necessary read permissions otherwise. It has no `statuses: write`,
  `checks: write`, contents write, pull-request write, or OIDC authority.
- Runtime is API-only. It never checks out or executes consumer or PR code,
  accepts repository identity only from `GITHUB_REPOSITORY` plus a strict PR
  number, treats all PR text as untrusted, and obtains protected policy only
  from the default-branch wrapper.
- The exact provider identity is `chatgpt-codex-connector[bot]` with GitHub type
  `Bot`. The wrapper filters eligible automatic events before allocating a
  runner, and the Action revalidates the event and evidence boundary after
  start.
- V2 introduces no dedicated runtime GitHub App or webhook service.
  - Explicit reason: the event-bridge App alternative required a separately
    hosted receiver; v2 keeps the agent-driven begin/reconcile path and the
    explicit trusted same-repository-writer boundary.

### Ruleset, Migration, And Supported Scope

- The importable ruleset template targets `~DEFAULT_BRANCH`, ships disabled,
  requires `codex/github-review-gate` from expected source GitHub Actions,
  requires branches to be up to date, requires all conversations resolved, and
  carries no repository-specific bypass actors.
- No consumer workflow receives `statuses: write`. Installation first observes
  the verifier's native feature-head CheckRun, its execution binding to the
  current test-merge, and actual expected source on a canary, validates the
  imported disabled ruleset, and only then activates it; `Any source` is not
  accepted.
- The expected-source integration ID identifies the GitHub Actions App, not one
  particular workflow. Installation therefore exact-byte verifies both
  canonical default-branch workflows and fails closed on any noncanonical
  reserved job/check name, relevant write authority, `write-all`, or additional
  v1/v2 direct or reusable gate caller. The only admitted write boundary is the
  exact canonical controller's reviewed `actions: write`/`issues: write`
  surface. The canary must resolve the unique required-name CheckRun to the
  exact canonical `pull_request` verifier run whose native CheckRun is on the
  current PR feature head and whose execution is bound to the current
  test-merge, reject legacy same-name status or CheckRun collisions, and prove
  the scoped CODEOWNERS/ruleset compound control plane before activation.
  - Explicit reason: otherwise another GitHub Actions workflow could present
    the same required job name or acquire controller authority while sharing
    the same integration identity.
- Immediately before an active ruleset POST or PUT, installation rereads the
  repository default branch and head, canonical workflow bytes and complete
  workflow inventory, canary run, and the full existing ruleset. A PUT proceeds
  only when the normalized writable ruleset fingerprint is unchanged from the
  prior read; drift stops activation without overwriting another administrator's
  concurrent protection change. GitHub exposes no conditional ruleset PUT, so
  this is a fail-closed double-read boundary rather than an atomic transaction.
- One migration PR may remove v1 and install v2. After it is merged and
  installed, a separate harmless PR using `@v2` exercises the live gate and is
  closed unmerged.
- Stable `v2.0.0` supports GitHub.com public and private repositories;
  same-repository ordinary branches targeting an open, non-draft,
  default-branch PR; `ubuntu-slim` with `ubuntu-latest` fallback; rulesets,
  native required CheckRun, conversation resolution, and up-to-date
  enforcement; `pull_request` verifier plus `issue_comment` and
  `workflow_dispatch` controller entry points; and ordinary merge, squash, and
  rebase methods under the documented agent merge closure.
- Stable `v2.0.0` fails closed for GHES, forks, merge queues, non-default bases,
  drafts, bot-owned PRs, self-hosted/Windows/macOS runners, and new operations on
  closed or merged PRs.

## Adopted Runtime Authority Contract

### Authority And Evidence

- Every reconcile rebuilds authority from GitHub. There is no durable Git
  ledger, Actions-artifact ledger, central router, or sticky-comment authority.
- One marker-bearing sticky comment is best-effort diagnostic evidence and may
  be rebuilt from unknown state. Its deletion, edit, or write failure only loses
  recovery acceleration and never changes the gate decision.
  - Explicit reason: a writable comment must not become a credential or
    decision authority.
- Reconciliation consumes qualifying Codex top-level issue comments and
  pull-request review bodies. Inline review threads and conversation-resolution
  state remain outside the reducer and are enforced by the ruleset.
  - Explicit reason: delegating inline resolution to the native ruleset reduces
    GHA queries and avoids duplicating the ruleset's responsibility.
- A review generation is established only by an exact, unedited
  `@codex review` request. Its visible first line is exact and contains no other
  visible text. A GitHub-Actions-authored request also requires the canonical v2
  hidden marker binding version, full head SHA, current base repository/ref/SHA,
  and run ID. An ordinary request author requires `write`, `maintain`, or `admin` by default; protected
  default-branch configuration may relax that threshold to `any`.
  - Explicit reason: this avoids hard-coded Joey identities and prevents an
    arbitrary public commenter from repeatedly resetting the review generation,
    while qualifying Codex findings remain blocking regardless of request-author
    permission.
- Terminal clean text and a qualifying `+1` normally have equivalent clean
  authority. The deliberate base-epoch lineage exception below requires a
  direct qualifying `+1` on a post-epoch canonical request because terminal
  payloads do not carry request/base lineage.
  A terminal `Reviewed commit` may use a short SHA when GitHub resolves it
  unambiguously to the current PR head; for a pull-request review, that resolved
  SHA must also agree with native `commit_id`.
  - Explicit reason: observed provider evidence uses 10-character commit IDs;
    requiring only a 40-character SHA was rejected as over-defensive.
- An ordinary unmarked request may establish an authorized generation, but its
  parent reaction alone does not prove which PR head existed when the request
  was posted. Therefore reaction-only clean on such a request remains
  indeterminate unless another authoritative carrier binds it to the current
  head. A workflow-authored request with the exact head/base marker can supply
  that binding; on a PR with no base epoch, an ordinary request can instead
  complete through terminal clean evidence whose reviewed commit resolves to
  the current head. After a base epoch, only a qualifying provider `+1`
  directly attached to the latest strictly post-epoch canonical request may
  provide positive or superseding authority; unlineaged terminal clean remains
  pending.
  - Implementation rationale: reconstructing from the current snapshot must
    not bind an old reaction to a newer head after the PR changes. This
    preserves the adopted equal authority of *qualifying* terminal clean and
    `+1` wherever GitHub can prove the required lineage, while failing closed
    across a base epoch rather than inventing historical state that terminal
    payloads do not carry.
- Findings are conservative negative evidence. A qualifying current-head
  finding blocks at first. On the same head, an older non-inline finding may be
  superseded only by a strictly newer authorized `@codex review` generation and
  a later head-bound clean (`terminal clean` or `+1`) that satisfies the active
  lineage rule. A clean not bound to that newer generation does not clear it;
  ambiguous ordering or binding remains failure or inconclusive, and the old
  finding remains in audit accounting.
  - Explicit reason: this permits a no-code-change re-review to recover from a
    false or inapplicable finding without letting an unrelated later clean mask
    a finding.
- Reconciliation works backward from the newest evidence to establish the
  latest safely identifiable review generation. Selectors remain hints: every
  newer relevant request, finding, progress artifact, malformed artifact, and
  conflict must be accounted for before stopping.
- A malformed artifact or provider-identity error remains indeterminate in
  accounting, but does not poison the PR forever. It becomes historical and
  non-blocking only after a strictly later authorized current-head generation
  is followed by qualifying head-bound clean evidence. An error at or after the
  current generation still blocks, and a later `eyes` reaction or progress
  artifact at or after the candidate clean vetoes that clean for both pass and
  finding/error supersession.
  - Explicit reason: fail-closed handling must preserve current uncertainty
    without making a provider formatting error on an old head unrecoverable.

### Head, Native CheckRun, And Merge Closure

- A verifier is admitted only for the exact `pull_request` event PR, head,
  base, and test-merge SHA. It never follows a changed target and has no
  authoritative write API. GitHub attaches the native job CheckRun to the
  feature-head SHA while the workflow executes on `refs/pull/N/merge`; strict
  `GITHUB_REF`/`GITHUB_SHA`, event-scope, and fresh-PR checks bind its result to
  the unchanged current test-merge. Only a proved stable `healthy/success` may
  conclude successfully; findings, pending evidence, unsupported scope,
  cancellation, timeout, API uncertainty, and every unhealthy result remain
  blocking.
- A deliberate same-head re-review uses controller `begin-review` to create or
  adopt the canonical request and then establish a strictly newer full
  verifier attempt. A provider or manual reconcile similarly establishes a
  newer attempt only through the adopted ledgerless baseline/readback
  handshake. Cancelled or ambiguous attempts are never success substitutes.
- Success is a stable observation, not a permanent review lease. Native
  CheckRuns do not expire merely because later provider evidence appears, and
  automatic wake-ups can be lost. An agent-driven merge must therefore run an
  exact-current reconcile immediately before merge; observe the strictly newer
  attempt and unique canonical CheckRun; require `healthy/success`; reread the
  unchanged PR head, base, test-merge SHA, and ruleset allowance; and merge with
  an exact-head compare-and-swap. The accepted eventual-reconciliation contract
  does not claim atomic invalidation of an older success, and direct human UI
  merge outside this closure is unsupported.
- Public result semantics are fixed:
  - stable clean: `healthy/success`;
  - findings: `healthy/failure`;
  - findings proved but execution or result finalization also failed:
    `unhealthy/failure`;
  - provider not complete: `healthy/pending`;
  - API, pagination, cap, or stability failure: `unhealthy/pending`;
  - stale delayed event: `healthy/not_applicable`;
  - invalid manual target or unsupported scope: `unhealthy/not_applicable`;
  - no trusted state can be read: `unhealthy/unknown`.
  `unhealthy/success` is invalid. The structured outputs and Actions summary
  preserve execution-health and gate-outcome detail, while the required native
  verifier job/CheckRun maps only `healthy/success` to a successful conclusion.
  Every other pair maps to a blocking conclusion.
- Public Action outputs are `execution_health`, `gate_outcome`,
  `recovery_code`, and `retry_safe`. `execution_health` is `healthy` or
  `unhealthy`; `gate_outcome` is `success`, `failure`, `pending`,
  `not_applicable`, or `unknown`; and `retry_safe` is boolean. The closed
  `recovery_code` values are `none`, `wait_provider`, `reconcile`,
  `fix_findings`, `request_clean_generation`, `retry_reconcile`,
  `wait_then_reconcile`, `use_expanded_limits`, `raise_protected_limit`,
  `refresh_head`, `repair_permissions`, `retry_begin`, `unsupported_target`,
  and `create_verifier_run`; the last covers an absent current
  test-merge verifier. Direct status projection and `status_projection` are
  deleted. Findings do not make execution unhealthy; `retry_safe` means an
  immediate identical-input retry is a valid recovery action.

### Snapshot Stability And Limits

- Only a clean candidate may pass, and it requires two independently fetched,
  fully paginated snapshots five seconds apart. Each snapshot covers the fixed
  PR lifecycle, base, and head; exact review-request IDs, revisions, authors,
  and candidate reactions; qualifying Codex top-level issue comments and
  pull-request review bodies with their IDs, timestamps, actor/App identity,
  body digests, reviewed-commit resolution, and native review `commit_id`; and
  collection completeness plus exact-refetch state.
- The two snapshots must keep the fixed scope valid and have the same
  decision-relevant fingerprint. Relevant evidence changing on the same
  expected head restarts the stability window. A head change, close/merge, or
  expected-head mismatch makes the run stale and stops it rather than
  retargeting. Pagination, API, or cap failure is incomplete, not a change.
- Fixed scope includes the repository identity and current default branch, the
  pull request base repository, base ref, and base SHA, and the pull request
  head repository, ref, and SHA. Repository and pull-request metadata are read
  again at both snapshot boundaries and these fields participate in scope
  comparison and the decision fingerprint. A same-SHA retarget to another base
  ref, or a default-branch rename that leaves the commit unchanged, invalidates
  the candidate and remains pending; it must never inherit an earlier clean
  decision.
  - Explicit reason: commit identity alone does not prove that the pull request
    still targets the supported default-branch policy scope.
- Cross-channel evidence that lands within the same parsed UTC second for the
  same head is treated as an ordering ambiguity even when equivalent ISO-8601
  timestamps use different fractional-second spellings. A later generation can
  supersede that historical ambiguity only when it is strictly newer than every
  member of the conflict and is followed by qualifying head-bound clean
  evidence.
  - Explicit reason: grouping raw timestamp strings would let formatting, rather
    than provider time, decide whether conflicting issue-comment and review
    evidence is ordered.
- GitHub provides no atomic cross-endpoint snapshot: webhook delivery can
  precede API visibility, Codex may publish parent, inline, and terminal objects
  separately, and pagination can mix different points in time. A finding can be
  proved positively at once, while clean requires complete evidence that no
  blocker is present; therefore only a clean candidate pays the second-read
  cost.
- The initial stability budget is 60 seconds and the inter-read delay is five
  seconds. These values bound Action minutes rather than acting as security
  constants. Failure to obtain stability leaves the gate pending and execution
  unhealthy with `wait_then_reconcile`; another provider event or manual
  reconcile is the recovery path.
- Every authoritative collection is fully paginated. A cap hit leaves the gate
  pending, reports execution unhealthy, and names the exact cap, observed stop
  point, and next safe action (`expanded` or a reviewed protected-limit change).
- Canonical profiles are fixed:
  - `default`: 20 pages, 2,000 raw objects, 128 API attempts, 32 MiB snapshot,
    10-second request timeout, and 60-second reconcile budget;
  - `expanded`: 100 pages, 10,000 raw objects, 512 API attempts, 64 MiB snapshot,
    20-second request timeout, and 300-second reconcile budget;
  - hard ceilings: 1,000 pages, 20,000 raw objects, 2,048 API attempts,
    64 MiB snapshot, 30-second request timeout, and 720-second reconcile budget.
  Page size is 100, one response is capped at 8 MiB, the inter-read delay is five
  seconds, and the job timeout is 14 minutes.
  - Explicit reason: reviewed expansion prevents unusually large PRs from
    remaining indefinitely inconclusive, while hard ceilings bound cost,
    memory, and runner time.
- Repositories may persistently select the reviewed `expanded` profile.
  Dispatch callers cannot supply temporary numeric overrides; that option is
  deferred beyond `v2.0.0`.

### Diagnostics And Recovery

- Runtime favors conservative at-least-once recovery. Small duplicate requests,
  verifier attempts, or diagnostic comments are acceptable when they are
  reconciled conservatively; a duplicate must never hide a finding or
  manufacture pass. Later provider events and manual reconcile are the recovery
  paths from an interrupted or unknown state.
  - Explicit reason: Joey preferred automatic recovery from failure and
    accepted a small amount of duplication so long as findings are never missed.
- Public reporting separates execution health from gate outcome and uses a
  closed recovery code with one concrete next action. An unhealthy execution
  tells an agent how to retry or reconcile; an ordinary failed gate tells it
  what evidence must change before pass.
- When derivable without an additional evidence query, diagnostic reporting
  includes `findings_unresolved`, `findings_resolved`, `findings_historical`,
  and `findings_indeterminate` in the sticky diagnostic and GitHub Actions
  summary. Incomplete pagination, API failure, or a cap hit makes affected
  counts `unknown`, never `0`. These counts cover normalized non-inline reducer
  findings only; they neither add inline-conversation authority nor become
  public Action outputs.
- The diagnostic uses one v2 marker distinct from request markers and contains
  no `@codex review`. Before writing, runtime reads the complete issue-comment
  inventory and posts one canonical diagnostic only when none exists. It never
  patches or replaces an existing canonical diagnostic; duplicates remain
  untouched and produce a bounded warning. Only an exact, unedited, official
  `github-actions[bot]` canonical sticky is excluded from physical request
  lineage. Edited, invalid, forged or wrong-provenance marker-looking comments
  fail closed as unbound physical boundaries and can require a replacement PR.
  A write failure remains a non-authoritative warning.
- Every untrusted excerpt and recovery message is length-bounded and escapes
  mentions, Markdown metacharacters, HTML delimiters, and marker-like content
  before entering the summary, sticky comment, or warning. Duplicate-sticky
  warnings also bound the rendered comment ID.
- Runtime uploads no artifacts, retains no raw API payloads, and does not repeat
  full finding bodies. Evidence remains in GitHub PR objects; logs, summary, and
  sticky expose structured identities, digests, bounded escaped excerpts and
  links, diagnostic counts, recovery code, and a safe next action, never tokens,
  headers, or untrusted workflow commands.

## Adopted Publisher Contract

### Intent, Candidate, And Control Closure

- A deterministic committed `release-manifest.json` carries the SemVer. The
  version itself determines prerelease/stable behavior and the floating major;
  there is no `publish_v2=true` switch, and future v3 releases use the same rule.
- The manifest binds SemVer, source and tree, toolchain/schema/status/template
  versions, the expected target `master` baseline, the previous full version,
  and an allowlisted path/mode/size/SHA-256 inventory. It excludes timestamps,
  run IDs, and Release IDs.
- Signed `release-provenance.json` plus detached ASCII-armored
  `release-provenance.json.asc` binds the manifest digest to the release
  repository commit/tree/tag, workflow/run identity, signatures, and alias
  transition without self-reference.
- Two unprivileged `materialize_a` and `materialize_b` jobs independently test
  and materialize the same exact source SHA. They must agree on Git tree OID,
  NUL-delimited inventory digest, and a byte-identical deterministic candidate
  tar. `assemble_candidate` selects one canonical single-file artifact.
- Intermediate `materialize_a` and `materialize_b` artifacts are retained for
  one day. The assembled candidate artifact is retained for 35 days.
- The privileged `publish` job revalidates artifact identity and digest, tar
  digest, path/type/mode/size bounds, and rebuilt Git tree, and never executes
  candidate content. Artifact storage is transport, not authority or a ledger.
- The release tree is allowlist-only: no symlink, submodule, or undeclared
  executable; exactly one root `action.yml` whose entrypoint matches the
  manifest; signed annotated full-version tags; signed provenance assets; and
  fail-closed digest, mode, and tree verification.
- Privileged publisher control code comes only from current protected source
  `master`, allowlisted runner tools, and allowlisted GitHub-official Actions,
  never from `candidate.tar`. Publisher workflow/scripts and
  `release-manifest.json` do not change in the same release change:
  infrastructure lands and passes CI first, then a separate release-intent
  change publishes through that established control code.
  - Explicit reason: newly introduced publisher code must not immediately
    receive production credentials to publish itself.

### Workflow, Approval, Identity, And Signing

- Publication runs as a dedicated source-repository workflow with the v1-style
  staged shape. Validation, dual materialization, assembly, and publication-plan
  jobs are unprivileged. Only `publish` binds `marketplace-production`, receives
  the GPG subkey and short-lived Publisher App token after approval, and then
  revalidates every input and remote object before writing.
- Materialize, plan, assemble, and verify jobs use `ubuntu-slim` with 14-minute
  timeouts. The privileged `publish` job uses `ubuntu-24.04`.
- `marketplace-production` initially requires reviewer `JoeyTeng`, keeps
  `Prevent self-review` disabled, disables administrator bypass, and admits only
  source `master`. The approval wait expires after 30 days.
  - Explicit reason: the same human may merge or dispatch and then provide the
    second explicit production confirmation; normal execution, including an
    administrator's, must not skip that confirmation.
- The Environment wait does not consume runner minutes while waiting.
- Publication uses GitHub App
  `JoeyTeng/codex-review-gate-action-publisher`; the SSH deploy-key and PAT
  proposals are superseded. Only that narrowly installed App receives target
  update authority and write scope.
- The App private key is exposed only inside the privileged publish job, after
  credential-free validation. The allowlisted official token Action uses it to
  mint the installation token. A later identity-preflight step also supplies it
  directly to the trusted source-repository generator solely to create an
  in-memory RS256 App JWT with `iat = now - 60`, `exp = now + 540`, and issuer
  equal to the configured App client ID. That JWT is command-scoped to
  `GET /app/installations/{installation_id}` with `Authorization: Bearer`, a
  fixed `api.github.com` endpoint, redirects disabled, a 15-second timeout, and
  a 1 MiB response cap. It is never written to a file,
  `GITHUB_ENV`, an artifact, an output, a summary, or a log. The installation
  token separately reads `GET /installation/repositories` and remains the only
  credential exposed to target Git operations, through a temporary
  `GIT_ASKPASS` path scoped to the target repository. Neither credential enters
  a URL or Git configuration. Installation-token revocation after use is best
  effort.
  - Implementation rationale: GitHub's authenticated-App installation-detail
    endpoint requires an App JWT and explicitly rejects GitHub App installation
    access tokens, while the installation-repositories endpoint accepts the
    installation token. Using the correct token class for each read preserves
    the exact App owner, installation, permission, event, suspension, and sole-
    repository preflight without broadening durable credential exposure. See
    <https://docs.github.com/en/rest/apps/apps#get-an-installation-for-the-authenticated-app>
    and
    <https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation>.
- Release commits and annotated tags use the dedicated JoeyTeng-Codex OpenPGP
  signing identity. The configured signing subkey fingerprint is
  `4DD48552DDEAF6D961769DD4A49827EC48984E2C`.
- The signing subkey deliberately has no passphrase and no expiration. Accepted
  compensating controls are the offline primary key and revocation material,
  Environment approval, the narrowly scoped Publisher App, exact fingerprint
  and revocation preflight, and incident-driven or manual rotation.
- The GPG private-subkey secret is imported only into an isolated temporary
  `GNUPGHOME` used by the privileged publisher.
- The public JoeyTeng-Codex signing certificate is fetched and closed-validated
  before approval, fetched again immediately before the first durable write,
  and required to be byte-identical. The second read rechecks the pinned
  primary/subkey identity, signing capability, revocation, and expiration after
  credentials have been minted.
  - Explicit reason: importing the private subkey proves possession but cannot
    reveal a revocation or expiry update published after the earlier public-key
    snapshot.
- Publication creates a dedicated single-parent JoeyTeng-Codex-GPG-signed
  wrapper commit over the verified Action tree; raw subtree-split history is
  evidence only. The Publisher App pushes it, and GitHub read-back must verify
  the commit and annotated-tag signatures rather than infer verification from
  the pusher identity.

### Serialization, Publication, And Recovery

- The publisher uses one fixed workflow-level, repository-scoped concurrency
  group with `cancel-in-progress: false`. A later run may replace an unstarted
  pending run, which remains reconstructible from its exact source SHA, but it
  must not automatically cancel an active, approval-waiting, or mutating
  release.
  - Explicit reason: publication makes non-transactional writes to `master`,
    tags, Release/assets, and the major alias; cancellation does not roll them
    back, App-token post-step revocation is best effort, and release frequency
    makes active serialization inexpensive.
- The canonical publication sequence is: signed `master` commit; signed
  immutable full-version tag; draft Release and assets; verified immutable
  Release; and stable-only signed floating-major alias such as `v2`. A
  prerelease does not advance the floating major. Only immutable full tags
  receive Releases. The automated publisher completes after rereading and
  verifying the last applicable object in this sequence; Marketplace state is
  not part of publisher completion.
- Marketplace publication is a manual, out-of-band checklist item only for the
  first stable release of each major, beginning with `v2.0.0` and later
  `v3.0.0`. Minor and patch releases do not update the Marketplace version and
  require no Marketplace operation or read-back. The accepted tradeoff is that
  the Marketplace listing may continue to display the first stable full
  version for the lifetime of that major while the signed floating alias such
  as `v2` advances to current releases.
- Every rerun performs a full remote reconcile before its first write. It may
  reuse only exact signer/parent/tree/digest-matching objects that form a valid
  prefix of the current release's canonical sequence. Missing next objects may
  be created. Conflicting, out-of-order, unreadable, or same-name mismatched
  state fails closed without deletion, overwrite, force-push, or alias rollback.
  A full-version tag that exists before its release commit is already reachable
  from target `master` is out of order and is `blocked_conflict`; reconcile must
  not repair that state by pushing `master` after the tag.
- The first-write boundary repeats the complete remote observation rather than
  rereading only the current version: it independently clones the target,
  fetches the full tag namespace, fully paginates the Release inventory, reruns
  the complete historical audit, and compares canonical ref and Release
  fingerprints to the earlier snapshot. Any difference or incomplete read is
  `inconclusive` with no durable write.
- Remote reconcile classifies the release as exactly one of `fresh`,
  `resumable_partial`, `already_complete`, `superseded`, `blocked_conflict`, or
  `inconclusive`. Every publish exit, including an unexpected shell failure,
  emits exactly one of those states and a bounded recovery code before exiting.
- Git refs, Releases, assets, signatures, and the source manifest are authority;
  workflow artifacts and runs are transport and recovery aids, not a ledger.
  Every durable write is reread. An older partial release blocks a newer release
  from leapfrogging it. If a candidate artifact expires or is unavailable,
  redispatch the exact source SHA, rematerialize it, and obtain approval again.
- The older-partial check covers every historical v2-and-later full version,
  not only the manifest's immediate `previous_version`. An unreadable historical
  tag or Release snapshot is `inconclusive`; a proved incomplete older canonical
  prefix blocks every newer mutation.
- Historical completion is cross-bound to the actual target Git objects. The
  wrapper commit must have the expected tree, sole parent, author/committer, and
  exact source/manifest message; its declared previous version must peel to that
  parent. The full tag must be a direct annotated tag with the closed header
  shape, exact name/message/tagger, and signed object identity. A side object,
  nested tag, extra header, or provenance/object disagreement is a conflict.
- Each reconcile explicitly fetches the complete remote tag namespace and
  independently reads the fully paginated GitHub Release inventory. A v2-or-
  later Release without its immutable full tag, a full tag unreachable from
  target `master`, duplicate Release claims, or an incomplete historical
  Release is a conflict; an incomplete inventory read is `inconclusive`.
  - Explicit reason: ordinary clone tag auto-following cannot prove the absence
    of an unreachable tag, and walking tags alone cannot discover an orphaned
    draft or Release.
- Exact-source recovery freezes the old release payload, manifest, and Action
  tree while executing under the current protected publisher controls. A new
  plan, deterministic A/B materialization, publication plan, and Environment
  approval bind that current control commit. If source `master` or those controls
  advance after the publication plan is approved, publish fails before token
  minting or durable mutation and requires rematerialization and approval again.
  - Implementation rationale: requiring the original control commit forever
    would make a partial release unrecoverable after a publisher fix and would
    deadlock all later versions; accepting a plan after its bound controls move
    would instead let stale approved code publish. Freezing payload identity
    while rebinding each recovery attempt to the current protected controls
  preserves both recoverability and approval freshness.
- Publisher modes read `release-manifest.json` from the frozen source commit;
  the current control checkout is not required to contain a root manifest.
  - Explicit reason: the infrastructure commit intentionally has no release
    intent, and current-control recovery must not substitute an unrelated
    current-worktree manifest for the old source manifest.
- After a draft Release is made immutable and before any floating alias update,
  publisher rereads the final Release and complete asset snapshot, downloads all
  three exact assets, verifies their IDs, names, byte digests, signed provenance,
  and detached OpenPGP signature, and then rereads stable Release identity. A
  same-name asset replacement at any earlier read boundary fails closed.
- Release lifecycle checks use canonical double reads around draft creation,
  every upload, publication, final asset verification, and alias mutation. Each
  boundary binds Release/author object IDs and types, fixed metadata, the direct
  and peeled full-tag OIDs, and canonical asset IDs, uploaders, sizes, digests,
  and timestamps. Immediately before the pre-alias snapshot, a separate closed
  immutability read must still return exact `true`; the following complete
  snapshot detects a same-name asset replacement that races that read.
- OpenPGP verification accepts exactly one expected `GOODSIG`/`VALIDSIG` identity
  pair and rejects any concurrent negative status, including bad/error,
  revoked-key/signature, expired-key/signature, missing-key, and explicit key or
  signature expiry statuses. The same closed parser governs commit, tag,
  provenance, and signing-key probes.
- Rollback is historically forward: a later higher version may restore earlier
  code, but the floating alias never moves backward through version history.
  `v2.0.0` has no automatic alias rollback. If a stable alias is absent, only
  the highest proved-complete stable version in that major may recreate it; an
  older exact-source rerun is superseded or blocked and cannot repoint the alias.
- The ban on force recovery does not prohibit the normal stable floating-alias
  advance. That update uses exact `--force-with-lease` from the verified prior
  alias OID to the new signed alias tag object; a lease mismatch fails closed.
- Before exposing an installation token to Git, the target-push helper verifies
  that the staged repository's actual `origin` fetch URL is the exact canonical
  target, that no separate push URL is configured, and that the push argv and
  refspec are closed to the expected staged repository and target refs. Setting
  an expected-URL environment variable alone is not treated as remote binding.
- Target pushes disable inherited credential helpers, system/global Git config,
  and HTTP authorization headers; enable `credential.useHttpPath`; and release
  the token only for Git's exact canonical target username/password prompts.
  Public verification re-fetches the complete GitHub signing-key inventory and
  rechecks the pinned primary/subkey fingerprints, revocation, and expiration
  metadata before accepting the detached signature.
- The privileged shell captures the installation token into a non-exported
  variable and immediately unsets every inherited GitHub-token name. Ordinary
  Git runs credential-free; authenticated `gh` calls and the exact target push
  receive the token only in their command environment. The target push bypasses
  the credential-clearing Git wrapper only after the origin, push URL, refspec,
  lease, helper, and prompt checks have succeeded.

### Repository Protection And Dependencies

- Tag protection uses two non-overlapping rulesets. `freeze-v1-tags` covers
  `refs/tags/v1` and `refs/tags/v1.*` with no bypass. `publisher-v2-plus-tags`
  covers `refs/tags/v*` while excluding those v1 patterns, with the Publisher
  App as its sole configured bypass actor.
  - Explicit reason: publisher credentials must not be able to mutate frozen v1
    history.
- `master` protection is separately layered. `publisher-master-update` grants
  only Publisher App update authorization, while a no-bypass
  `master-integrity` ruleset requires signed single-parent linear commits and
  blocks force-push and deletion even for the App. Tag signature and ref
  integrity are additionally fail-closed publisher pre/post-readback checks;
  the branch no-bypass property does not apply to the tag ruleset.
- The publisher uses only allowlisted GitHub-official Actions at floating major
  refs such as `@vN`, never `@main`; a major upgrade still requires an ordinary
  PR. The paused all-SHA policy is superseded.
  - Explicit reason: patch-level execution drift is consciously accepted so
    official fixes arrive automatically. If immutable SHA pins are adopted
    later, Dependabot in `Joey-Tools/codex-review-gate` becomes required so
    important updates are not silently missed.

## Adopted Stable Admission And Installation Sequence

- Before stable `v2.0.0`, publish `v2.0.0-rc.N` and run the complete gate loop
  in a real consumer repository on a temporary PR.
- Stable publication then follows the v1-like staged publisher. A dedicated
  exact-tag canary or dedicated post-release alias canary is not required for
  `v2.0.0`.
- Each production consumer migration uses the remove-v1/install-v2 PR followed
  by the separate harmless `@v2` canary PR, which is closed unmerged after the
  live gate succeeds.

## Rejected Or Superseded Designs

- Durable runtime Git ledger, Actions-artifact ledger, wait-job controller,
  central router, cron reconciliation, and a dedicated runtime App/webhook
  service.
- Writable automatic `pull_request_review` jobs and multi-PR manual batches.
- `repository_dispatch` as the sole manual transport or a dual manual-entry
  design.
- A reusable workflow as the consumer ABI, consumer SHA pins, `publish_v2=true`,
  rolling breaking changes within v2, and SHA-only compatibility.
- Sticky-comment authority, truncated evidence, 40-character-only reviewed
  commit parsing, or an unbound later clean erasing a finding.
- SSH deploy-key or PAT publication, a target-repository PR publisher, raw
  subtree-split publication commits, and equivalent-tree force recovery.
- Publishing to the old Joey-Tools target, moving the major alias backward, or
  giving the Publisher App one ruleset that bypasses all `v*` tags including
  frozen v1.
- Immutable SHA pins for publisher Actions under the current adopted policy.
- Per-release Marketplace publication and Marketplace read-back as an
  automated publisher completion gate.

## Deferred Beyond Stable V2.0.0

- Temporary numeric per-dispatch soft-limit overrides.
- The exact initial consumer repositories, rollout sequencing, and timing of
  later expansion.
- Support for GHES, forks, merge queues, non-default bases, drafts, bot-owned
  PRs, self-hosted runners, and non-Linux runners.
- Generated exact/major canary workflows, a pre-Release exact-ref gate, a
  dedicated post-release `@v2` canary, automated Marketplace gating, automated
  RC-to-stable proof, automated rollout stopping, and automatic alias
  rollback/recovery.

## Confirmation And Implementation Gate

- Joey confirmed the then-complete shared summary and requested implementation
  on 2026-08-26. Later review evidence reopened only the authoritative-result
  architecture branch: the fixed-context commit-status bridge could not fence
  a delayed success after an ambiguous mutation response.
- Joey adopted the two-workflow native-CheckRun architecture on 2026-08-27.
  The dependent source-authenticity, event-visibility, merge-closure, and
  ledger nodes are now resolved. A complete frontier audit found no remaining
  reachable product decision. Joey reconfirmed the revised shared understanding
  and authorized execution on 2026-08-27. Historical implementation detail
  cannot override this journal.
- This journal-only signed commit is the required plan checkpoint before
  implementation reconciliation. The task list then advances from planning to
  implementation; no product decision remains open.
- The signed plan checkpoint is
  `4120dcf9f63c7547d420f5b7e269b63b4a1443ba`; `git verify-commit` accepted its
  ED25519 signature before implementation resumed.
- Local implementation, tests, documentation, fresh-context review, and signed
  commit precede PR readiness. Merge precedes the approved publisher run;
  release read-back precedes consumer installation and canary expansion.
- If the specialized local reviewer role is unavailable, the fresh local review
  lane uses an ordinary general agent with `gpt-5.6-sol` and `ultra` reasoning.
  PR #32 remains outside this delivery workstream.

## Implementation Checkpoint

- Phase: final plan checkpoint followed by infrastructure implementation and
  contract reconciliation, authorized on 2026-08-27.
- Recovery source: `wip/v2-release-review` at
  `42773dd2736af2f8759951fc7ebf6e21ebf3275b`, with stash
  `7f96293371cc2adfa0aeccc49effbf4c9d519ff2` applied but deliberately retained
  as a recovery copy.
- The first post-recovery audit proved that the paused implementation could not
  ship unchanged. Material drift included the obsolete `repository_dispatch`
  manual ABI, missing `issue_comment.edited`, missing exact-head binding and
  closed public result ABI, permanent-finding and arbitrary-limit semantics,
  incomplete install/ruleset activation closure, SHA-pinned publisher Actions,
  incorrect artifact retention, early/broad credential exposure, a single App-
  bypass tag ruleset covering v1, incomplete manifest/provenance closure, and
  per-release Marketplace read-back wording.
- Delivery is therefore split at the adopted control boundary. The current PR
  lands publisher/runtime/install infrastructure without a live
  `release-manifest.json`. Only after that protected control code merges and
  passes CI will a separate release-intent PR add the exact RC manifest and be
  eligible to enter `marketplace-production`.
- The infrastructure change also keeps the Action package version at its
  existing `2.0.0` baseline. The `2.0.0-rc.N` package-version change belongs to
  the separate release-intent PR together with its manifest and inventory.
- Runtime packaging has been corrected from the paused composite wrapper to the
  adopted direct Node 20 JavaScript Action. Consumer/bootstrap focused
  validation currently passes 62 of 62 tests, including the fixed GitHub
  Actions source, explicit empty bypass list, activation write-before/write-
  after canary closure, default-branch manual dispatch, and both installation
  guide presentations.
- Subsequent runtime adversarial work added recoverable historical malformed and
  provider-error epochs, liveness-vetoed supersession, bounded safe diagnostics,
  and deterministic duplicate-sticky handling. The current v2 focused suite
  passes 45 of 45 tests.
- Consumer installation hardening now binds the GitHub Actions source to the
  sole canonical writer/caller, exact canary workflow run, stable default-
  branch workflow snapshot, and a no-lost-update ruleset reread. Bootstrap,
  workflow-security, and v2-workflow focused validation passes 72 of 72 tests.
- Publisher focused validation passes its App-JWT, provenance, credential,
  history, alias, and mutation-boundary tests. The first full publisher run
  passed 64 of 65 tests and exposed one dormant `after-immutable` adversary;
  adding the independent immutability read before the complete pre-alias
  snapshot made both before/after replacement tests pass.
- After all implementation and journal bytes froze, the final whole-repository
  `npm test` run passed 617 of 617 tests. `npm run check`, `bash -n`, ShellCheck,
  actionlint with only the two reviewed stale-metadata exceptions for the
  official `actions/create-github-app-token@v3` `client-id` transition,
  `git diff --check`, and project-journal validation also passed.
- The first signed whole-range review checkpoint is
  `0c2d2bc47ebcd972d230488a2171f2762799ed83`; `git verify-commit` accepted its
  ED25519 signature from Joey's local signing key. Its frozen review range is
  `10217253306ca2ee6f312f766a331f8924e26e47..0c2d2bc47ebcd972d230488a2171f2762799ed83`.
- The native collaboration `reviewer` role was temporarily unavailable on
  three consecutive launch attempts. The required fresh lane therefore used
  the playbook's platform-equivalent zero-inherited-context path: Codex CLI
  `0.149.1`, model `gpt-5.6-sol`, reasoning `xhigh`, `--ephemeral`, and a
  read-only sandbox. It ran in a separately materialized private repository
  and used the exact sanitized Git prefix. The trusted control bundle was
  release `284f0f54daba1e9e17e922e4fa87aa6b586e37a4`, canonical manifest SHA-256
  `d12328d7a2da38c7c2edc58287a194faedbc4a37587ca047dbd48db34ac0a5b9`,
  and review-skill SHA-256
  `76ae06111e6da1a04cab44e6fba5eb772af00b55c923e5234311edecb33449bd`.
  Materialization and final validation both bound commit count `3`, parent-edge
  count `2`, parent-graph SHA-256
  `2f39efaa88e0a39b42be8003719ff7989ad2565daf9e22646dc1ee0b6227cf01`,
  and local-config SHA-256
  `07990c1d83a78ea34a87e3f51883e3164c3098b21770082207e00a3a898ab24f`.
  The raw findings artifact SHA-256 is
  `6561029d00aa9124706260b8a619ec7a35e70db47b2b52ac363e8ad74c4dd619`.
- That first whole-range review found four items. Three require implementation
  changes before delivery: a short reviewed-commit resolution must retain the
  supplied hexadecimal-prefix binding; quoted or otherwise opaque
  `statuses` permission keys must fail closed; and the consumer control plane
  needs an independent code-owner boundary because GitHub Actions integration
  ID `15368` identifies the whole GitHub Actions App rather than one workflow.
  The adopted repair adds base-branch CODEOWNERS coverage for the workflow
  directory and CODEOWNERS file itself, requires code-owner review only for
  owned paths, and validates that contract during installation/activation.
  This follows GitHub's documented use of base-branch CODEOWNERS plus required
  code-owner review and its recommendation that CODEOWNERS own itself.
- The fourth review item recommended restoring immutable SHA pins for official
  publisher Actions. It is adjudicated as a consciously accepted dependency
  policy rather than an implementation defect: Joey explicitly selected
  allowlisted GitHub-official floating major refs so patch fixes arrive without
  a Dependabot installation, and explicitly rejected immutable publisher
  Action pins under the current plan. The risk and later migration condition
  remain recorded in `Adopted Publisher Contract` above; the rereview scope
  must treat this exact policy as a fixed non-goal rather than silently
  reversing it.
- The three actionable findings are now repaired. Short reviewed-commit
  resolution accepts a 7-39 hexadecimal reference only when GitHub returns a
  full SHA with that exact prefix; same-name branch/tag redirection therefore
  stays pending. The workflow writer inventory now fails closed on the YAML
  carriers proved by standard parsing and actionlint during adversarial
  review: quoted and escaped keys, flow/explicit keys, tags, anchors, aliases,
  merge keys, a leading BOM, non-ASCII YAML line separators, and plain-scalar
  `#` that is not a legal comment boundary. The focused v2 suite passes 45 of
  45 tests, and the focused bootstrap/security suite passes 72 of 72 tests.
- Consumer control-plane installation now adds an idempotent final managed
  block in `.github/CODEOWNERS` for `/.github/workflows/` and CODEOWNERS
  itself, using one explicit user owner (default `@JoeyTeng`). The helper
  refuses root/docs CODEOWNERS shadowing, verifies GitHub's exact-head
  CODEOWNERS error report and the owner's current write-capable identity, and
  requires code-owner review plus stale-approval dismissal. A new ruleset
  keeps zero ordinary approvals, while an existing higher approval count is
  deliberately preserved rather than weakened.
  - Explicit reason: integration ID `15368` names the whole GitHub Actions App,
    not the canonical workflow. The independent base-branch CODEOWNERS policy
    therefore protects every future status-writer change without introducing
    a dedicated runtime App.
- The first migration PR is a documented manual trust bootstrap because its
  base branch does not yet contain the new CODEOWNERS and the ruleset is not
  yet active. The Agent runbook now requires a paginated review snapshot, an
  owner `APPROVED` review whose `commit_id` equals the current full PR head,
  and a final head reread immediately before merge; the owner must differ from
  the PR author. Human documentation calls out the same non-enforced boundary.
- Ruleset writes now use a final pre-PUT full ruleset fingerprint after the
  security/canary reads, independently read the written ruleset back, and then
  reread the complete consumer security snapshot. Updates require exact
  equality of all writable fields so existing checks and stronger review
  settings cannot disappear. Creates compare every planned field and accept
  only a closed, shape-validated allowlist of safe server-added defaults,
  because the GitHub API expands optional pull-request and status-check fields
  on GET. A detected
  post-write drift fails without claiming staging or activation complete and
  supplies an explicit inspect/disable/retry recovery direction.
- Local installation defines the protected target-file property as admitted
  absence or exact UTF-8 content. It rereads that property at both pre-write
  and immediate pre-rename checkpoints so concurrent unrelated CODEOWNERS
  edits are not overwritten; object replacement with identical content is
  benign for this property, while unreadable, non-regular, or changed content
  remains a distinct failure. Remote workflow inventory also binds each
  regular Git mode and rejects symlink-mode blobs.
- A final focused read-only adversarial audit of the repaired consumer control
  plane returned `No findings`. This is supporting working-tree evidence, not
  a substitute for the frozen whole-range review recorded below.
- The complete post-remediation `npm test -- --test-reporter=dot` run exited
  successfully. `npm run check`, `bash -n scripts/release-action-subtree.sh`,
  ShellCheck, `git diff --check`, and the bundled project-journal validator
  also passed. Actionlint `1.7.12` reported only its two known stale metadata
  diagnostics for `actions/create-github-app-token@v3`: at the validation
  snapshot, the official floating `v3` ref resolved to
  `bcd2ba49218906704ab6c1aa796996da409d3eb1`, whose `action.yml` declares
  `client-id` and marks `app-id` deprecated. The workflow intentionally follows
  that current official ABI under the adopted floating-major dependency policy;
  the diagnostics are retained as reviewed tool-metadata exceptions rather
  than hidden or worked around.
- The first-review remediations and their then-current journal were committed
  in signed checkpoint `06bdb0deb561a899cec160d89ed06e0122126454`;
  `git verify-commit` accepted its EDDSA signature from Joey Teng with key
  `EFBBC913F49A5F6E0AF0D248F70246143DC28F32`.
- The next frozen whole-range review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..06bdb0deb561a899cec160d89ed06e0122126454`.
  The native collaboration `reviewer` role was again unavailable. One
  platform-equivalent zero-context CLI attempt stalled after its WebSocket idle
  timeout and was interrupted without a terminal artifact, so it was not
  counted. A bounded retry using Codex CLI `0.149.1`, model `gpt-5.6-sol`,
  reasoning `xhigh`, `--ephemeral`, and a read-only sandbox completed in the
  independently materialized repository
  `/private/tmp/codex-review-gate-v2-rereview-retry.k02xX4/codex`.
  Materialization and pre-launch validation both bound commit count `4`,
  parent-edge count `3`, parent-graph SHA-256
  `51ec59a686e3e47da598440ee81af017e1a3491bda750338421cbd0391595773`,
  local-config SHA-256
  `07990c1d83a78ea34a87e3f51883e3164c3098b21770082207e00a3a898ab24f`,
  and zero symlinks. It used the same trusted control-bundle and review-skill
  digests recorded for the first review. The raw findings artifact SHA-256 is
  `ee83f34667b32f2793aa66c684c6af7b3a490122b26fd0e0433baf7e696d2618`.
- That review found two P2 recovery defects. First, an unknown review-request
  POST result reported `retry_begin` with `retry_safe=true` and instructed an
  immediate identical retry even though GitHub issue-comment creation has no
  idempotency key. A successful but not-yet-visible first POST could therefore
  be duplicated. Second, the provider stale-event fast path omitted trusted
  `owner`/`repo` scope when parsing finding comments, so a valid old-head
  finding became malformed and could project pending onto an unrelated current
  head.
- Both findings are repaired. Only `retry_reconcile` now defaults to
  `retry_safe=true`; every current `retry_begin` path is false and instructs the
  caller to wait for the exact same-run marker to settle, then rerun the
  original workflow run only if it remains absent. The recovery code remains
  distinct because `reconcile` cannot create a missing review request. The
  provider stale parser now receives the already API-bound `config.owner` and
  `config.repo`, preserving the canonical parser's strict repository grammar
  without deriving authority from event text.
  - Explicit reason: the first change prevents the recovery interface from
    presenting a non-idempotent POST as an immediately safe retry while keeping
    the adopted ledgerless, best-effort boundary; the second prevents a delayed
    finding from changing status on a different head.
- New regressions prove delayed visibility and failed post-unknown rereads each
  produce only one request POST, `unhealthy/pending`, `retry_begin`,
  `retry_safe=false`, and only the original pending status. A separate provider
  test proves an old-head finding exits `healthy/not_applicable` before reading
  a full evidence snapshot or writing status/sticky diagnostics. Two independent
  read-only focused audits found no blocking residual issue in either repair.
  The runtime-focused test file passes 41 of 41 tests; `npm run test:v2` passes
  48 of 48; the complete `npm test -- --test-reporter=dot` run exited `0`.
  `npm run check`, `bash -n`, ShellCheck, `git diff --check`, and project-journal
  validation pass. Actionlint `1.7.12` still reports only the same two reviewed
  stale-metadata diagnostics for the adopted official floating `v3` Action.
- These repairs and this tracked evidence update necessarily move the head past
  `06bdb0d`; a new signed checkpoint and one final fresh whole-range review are
  therefore required before the infrastructure PR is created.
- The resulting signed checkpoint was
  `7815e437c82c86c6287810e4612a036f4bb64cd6`. A fresh whole-range review over
  `10217253306ca2ee6f312f766a331f8924e26e47..7815e437c82c86c6287810e4612a036f4bb64cd6`
  completed in independently materialized repository
  `/private/tmp/codex-review-gate-v2-final-review.5nhZyo/codex`. The paired
  receipts bound commit count `5`, parent-edge count `4`, parent-graph SHA-256
  `b48b47cff197ad92873d461bb86ffabe02b95cce83d0968e8bf6f3a8427ba486`,
  and local-config SHA-256
  `07990c1d83a78ea34a87e3f51883e3164c3098b21770082207e00a3a898ab24f`.
  The raw review artifact SHA-256 is
  `2b143db4b6b2e091a657fd01cabd680400438c2968886c6bec6891c77aca0275`.
- That review found two issues. First, same-head clean evidence could cross a
  base retarget or base force-push epoch. Second, the publisher hashed the
  complete GitHub Release API response, including mutable observation fields
  such as asset `download_count`, so its own verification downloads could
  manufacture `remote-state-changed`.
- Release inventory fingerprinting now uses a closed stable projection. It
  binds Release and asset identities, tag/target and policy metadata, content
  metadata, author/uploader identity, timestamps, URLs, and asset digest, while
  deliberately excluding `download_count` and decorative profile fields.
  Pagination boundaries and API ordering are canonicalized. Focused tests
  proved that observation-only changes do not move the fingerprint while
  identity, content or policy changes do; the historical v1 User-authored
  inventory remains readable, while public v2 asset verification still
  requires the Publisher Bot. The focused provenance suite passed `33/33`, and
  `bash -n` plus ShellCheck passed for the affected publisher script.
- Base events are now a fully read GitHub GraphQL evidence barrier. The first
  implementation incorrectly treated timeline `totalCount` as the filtered
  node count. Live GraphQL evidence showed a valid response with
  `totalCount: 13`, `filteredCount: 0`, `pageCount: 0`, and `nodes: []`; the
  runtime now validates the actual `filteredCount`/`pageCount` contract. The
  corrected focused runtime suite passed `49/49`, and an independent consumer
  audit plus Actionlint found the narrow pre-runner base-retarget route and
  parameterless `non_fast_forward` ruleset rule clean.
- A subsequent runtime audit exposed a stricter lineage race: an old-base
  review can finish after a post-epoch request and publish a same-head terminal
  clean. Stable double snapshots prove that the payload is stable, but not
  which request or base snapshot produced it. GitHub timeline evidence cannot
  generally prove when an ordinary fast-forward head entered the PR, and even
  a matching `HeadRefForcePushedEvent` cannot exclude the same SHA having been
  reviewed earlier, pushed away, and restored.
  - Adopted fail-closed rule: once a PR has an observed base epoch, only a
    qualifying Codex `+1` attached directly to the latest strictly post-epoch,
    current-base-bound canonical workflow request may supply positive clean
    authority or supersede an older finding. A terminal finding remains
    blocking. An unlineaged terminal clean remains pending and diagnostic; it
    cannot pass or erase a finding. PRs with no base epoch retain the adopted
    parity between terminal clean text and a qualifying `+1`, including
    ordinary direct `@codex review` requests.
  - Explicit reason: the accepted failure policy prioritizes never overlooking
    a finding and permits conservative pending/recovery. GitHub exposes no
    provider-authenticated request/run/base lineage for terminal payloads, so
    treating timestamp order as lineage would permit a false pass.
- The same audit found that repeated public exact `@codex review` comments
  could consume the snapshot request budget before author filtering. The
  implemented repair caches repository permission by lower-cased login within
  each complete snapshot and exact-refetches
  only provider evidence, canonical workflow requests, and ordinary requests
  that pass the configured author-permission threshold. Unauthorized ordinary
  comments have no authority and therefore do not receive per-object exact
  refetches. Provider, canonical, and authorized objects retain exact-refetch
  and complete-snapshot stability checks. A regression with seventy denied
  same-login requests performs one permission lookup, exact-refetches none of
  those requests, retains exact refetch for provider evidence, stays healthy,
  and cannot produce success. The focused runtime suite passes `50/50` after
  both the lineage and budget repairs.
- A publisher-focused fresh audit identified pre-release blockers in App JWT
  authentication, closed Action metadata parsing, historical object/provenance
  lineage, complete pre-write inventory stability, floating-alias Release
  rejection, prerelease alias exclusion, immutable Release boundary readback,
  and installation-token exposure. The local repairs are now implemented:
  - The bounded Node identity client alone sends the App JWT with
    `Authorization: Bearer`; it is never routed through `GH_TOKEN`/`gh api`.
    The repository-scoped installation token remains command-scoped to
    `publisher_gh` and exact target Git askpass calls. The current official
    `actions/create-github-app-token@v3` metadata was re-read directly and
    confirms `client-id` is supported while `app-id` is deprecated; Actionlint
    `1.7.12` retains the two already reviewed stale-metadata diagnostics.
  - The root Action metadata parser explicitly rejects U+0085, U+2028 and
    U+2029 structural line breaks. Published commit/tag object headers now use
    a closed allowlist with exact-one multiplicity; `previous_version` fully
    peels to the wrapper's sole parent; signed annotated-tag message blocks
    remain supported. The complete provenance test passes `38/38`.
  - Before the first durable write, a second full target-ref namespace and
    stable Release-inventory snapshot is taken from an independent complete
    tag fetch, with full history audit repeated. Namespace or stable-projection
    drift is classified `inconclusive/remote-state-changed` before malformed
    history can authorize a write. A regression injects a new lightweight
    full-version tag during this boundary and proves zero target writes.
  - Floating-alias Releases are rejected. Full and alias tags are validated
    from raw tag-object headers as exact annotated tags directly targeting a
    commit, with exact name/tagger/message/signature. Stable alias targets must
    be completed, non-prerelease, same-major, SemVer-forward releases with
    forward commit ancestry. The same rules apply to public readback, and a
    nested tag-to-tag alias regression is rejected without mutation.
  - GitHub Release creation has a double-404 absence plus stable full-tag
    boundary, followed by exact created-draft readback. Upload, publish,
    pre-alias and post-alias boundaries double-read canonical Release identity,
    assets, full-tag binding and exact alias object/peeled commit. Alias
    advancement still uses the verified prior object in an exact
    `--force-with-lease`.
  - A first complete publisher test run passed `33/35`; its only failures showed
    that the new validation order had changed two established rollback/missing
    alias recovery codes. The order was corrected so a proved newer complete
    release is independent of alias state: missing or rolled-back aliases retain
    `older-partial-release`, while malformed/nested/lightweight/bad-signature
    aliases remain `malformed-major-alias-target`. Both affected regressions then
    passed `2/2`. The subsequent complete
    `npm test -- --test-reporter=dot` run exited `0`, including the entire
    publisher pipeline file. `npm run test:v2` passes `57/57`; the focused
    provenance suite passes `38/38`; `npm run check`, Bash syntax, ShellCheck,
    `git diff --check`, and the bundled project-journal validator pass.
- All runtime, publisher, consumer, ruleset, documentation, test and journal
  repairs above were captured in signed checkpoint
  `99defc2669a6c797bdf35791c484a08d3dccab0a`. `git verify-commit` accepted its
  EDDSA signature from Joey Teng using key
  `EFBBC913F49A5F6E0AF0D248F70246143DC28F32`. This evidence-only journal update
  necessarily creates one later signed head; the final fresh-context review
  must freeze and inspect that later complete range rather than stopping at
  `99defc2`.
- The final fresh-context read-only review froze
  `10217253306ca2ee6f312f766a331f8924e26e47..107809ec975680af74f461f9d8e1a3c7d45ff024`
  and reported no reproducible P0, P1, or P2 correctness, security, or
  reliability regression. The trusted materializer and validator produced
  type-preserving equal receipts for base, head, worktree, seven scoped
  commits, six parent edges, parent-graph digest
  `fc5d9553ddc019016a087326e9a7b8453321ee68da1b79a4b31cce2a8c10577b`, and
  local-config digest
  `07990c1d83a78ea34a87e3f51883e3164c3098b21770082207e00a3a898ab24f`.
  The reviewer inspected all 87 changed files and independently passed
  `npm run check`, Bash syntax, ShellCheck, frozen-range `git diff --check`,
  `git fsck --strict`, and clean-worktree verification. It deliberately did
  not rerun tests that create files inside its strictly read-only workspace;
  the complete test executions are recorded above. PR #32 was neither read nor
  used as evidence.
- Infrastructure PR #34 exposed two test-harness portability defects in CI run
  `33012740781`; neither defect relaxed or bypassed production validation. The
  Node 20 and Node 24 jobs inherited the host CI workflow's
  `GITHUB_WORKFLOW_REF`, while direct publisher fixtures must model the
  canonical `sync-action-subtree.yml@refs/heads/master` workflow. The
  production generator correctly rejected that non-canonical provenance. The
  fixture environment now binds the canonical workflow ref and deterministic
  run identity and clears host-owned `GITHUB_OUTPUT` plus ambient publisher
  credentials. A hostile environment reproducing the PR CI workflow passed
  the complete 35-test publisher file. A separate Ubuntu tar diagnostic used
  the generator's valid link/special-entry rejection text rather than either
  macOS structural diagnostic; the assertion now admits that exact fail-closed
  branch. The new environment-isolation invariant and the cross-platform
  transport regression pass `2/2`.
- CI run `33013968499` then passed `646/647` tests in both Node lanes and
  exposed one real command-scope defect: `RELEASE_TARGET_ASKPASS` remained an
  exported environment variable for ordinary Git and Node subprocesses even
  though the publisher token itself was already non-exported. The macOS test
  had missed the leak because its `/var/folders` fixture path and Git's
  `/private/var/folders` path did not compare equal; Linux used one spelling
  and correctly blocked the subprocess. The publisher now captures the helper
  path in a non-exported read-only shell variable, immediately unsets the
  inherited name, and injects it only as `GIT_ASKPASS` on an allowlisted target
  push. The fake Git regression now rejects any sensitive helper or token on
  every non-push command rather than relying on a source-path match. With
  `TMPDIR=/private/tmp`, the exact test changed from a stable failure to a pass.
- The final exact-head review of `39daa3e8337178c2ea01aed57664c776b9625b37`
  found one further credential-isolation edge case. Bash imports `SHELLOPTS`
  before executing the publisher, so an inherited `xtrace` exposed expanded
  credential values before the script's `unset`, while inherited `allexport`
  caused the captured lowercase token and askpass variables to remain visible
  to ordinary subprocesses. The publisher now disables inherited trace,
  verbose input echo, and automatic export before any credential expansion,
  overwrites any inherited lowercase captures, and explicitly removes their
  export attributes before making them read-only. The regression uses
  the helper-approved `joey-private-v3` `access-a` synthetic fixture: one case
  proves hostile `xtrace`/`verbose` stderr contains no token or capture
  assignment, and the full target-push case runs under `allexport` while every
  push and non-push fake Git invocation rejects inherited lowercase captures.
  This revision is required because the earlier fix removed the uppercase
  workflow variables but implicitly relied on the caller's default Bash option
  state; command-scoped credential isolation must not depend on that ambient
  shell state. Startup files such as `BASH_ENV` run before script control and
  remain outside this in-script guarantee; the reviewed privileged workflow
  does not set them. The installed synthetic-token catalog validated as
  `joey-private-v3`; the two focused hostile-option regressions passed `2/2`.
  The subsequent complete `npm test -- --test-reporter=dot` run exited `0`, and
  `npm run check`, Bash syntax, ShellCheck, `git diff --check`, and the bundled
  project-journal validator all passed. The entire 37-test publisher file also
  passed under `/private/tmp` while inheriting the PR CI workflow identity and
  deliberately poisoned GitHub run/output variables, preserving the earlier
  Linux/path-alias regression coverage.
- The GitHub Codex review of `717015f48aed5d5b1b1f326b06f4fca15562a11f`
  repeated the already adjudicated recommendation to replace the official
  token Action's floating `@v3` ref with an immutable SHA. This is not accepted
  as an implementation change because it conflicts with Joey's fixed publisher
  dependency policy above. To prevent future review-context loss, the
  secret-bearing workflow step now carries a proximal security-policy comment
  and a contract test: GitHub-owned Actions intentionally follow floating major
  refs for automatic patch fixes, while a later move to immutable SHAs requires
  Dependabot and a separate policy change. The review thread is resolved as an
  explicitly accepted dependency-policy tradeoff rather than by silently
  reversing the decision.
- The native collaboration `reviewer` role remained unavailable after bounded
  retries. Joey explicitly authorized one fresh ordinary Codex agent at the
  fixed `gpt-5.6-sol` / `ultra` profile, with zero inherited turns, to replace
  that local lane for the frozen
  `10217253306ca2ee6f312f766a331f8924e26e47..6b7509216181e9b1c31976bf4261364b08ba26b6`
  range. It ran against the independently materialized and immediately
  revalidated read-only workspace and reported one P1: reactions were fetched
  only for exact head/base-bound canonical requests, even though an authorized
  ordinary `@codex review` request can be the active generation when no base
  epoch exists. Consequently, an official `eyes` reaction simultaneous with or
  later than terminal clean evidence on that ordinary request was invisible to
  the liveness veto and could allow success while review activity continued.
  The snapshot loader and reducer now share one generation-selection function,
  and reactions are fetched and fingerprinted for every request that can be the
  current generation. Reaction-only `+1` clean remains restricted to canonical
  head/base-bound requests. Focused regressions prove ordinary terminal clean
  still passes; simultaneous or later official `eyes` produces
  `pending/wait_provider`; non-provider `eyes` is ignored; ordinary `+1` alone
  stays pending; an older finding remains blocking while such liveness is
  active; and ordinary, unauthorized, or pre-base-epoch requests do not consume
  reaction-query budget when they cannot be the current generation.
- The required rerun used another zero-context ordinary `gpt-5.6-sol` / `ultra`
  agent against the independently prepared and immediately validated frozen
  `10217253306ca2ee6f312f766a331f8924e26e47..7b8d4a1ceab04e9d47f09e7584935bd9fe067943`
  range. It repeated the already adjudicated immutable-SHA recommendation for
  the secret-bearing publisher Action. That recommendation remains a conscious
  non-goal under Joey's fixed floating-major policy above and is not an
  implementation defect. Its other finding was valid: this entry's `updated`
  field still named `2026-08-26` after evidence added on `2026-08-27`; the
  frontmatter now records the actual latest update date.
- The production configuration preconditions were applied and read back before
  publication. Source Environment `marketplace-production` now has
  administrator bypass disabled, keeps `JoeyTeng` as its sole required reviewer,
  permits self-review, and admits only source `master`; the expected two secret
  names and three App variables remained unchanged. Target tag rules now use
  active no-bypass `freeze-v1-tags` for `v1`/`v1.*` plus
  `publisher-v2-plus-tags` for other `v*` tags with App ID `4700530` as the sole
  bypass. This completed the previously required no-gap migration without
  changing any v1 ref.
- At the pre-PR implementation checkpoint, no target-repository write, Release,
  tag, alias, Marketplace change, ruleset mutation, or consumer installation
  had occurred. The later source-repository branch pushes and infrastructure PR
  #34 recorded above do not cross that rollout boundary.
- Existing source-repository PR #32 is explicitly outside this workstream and
  does not block or supply changes to this delivery.
- After signed checkpoint `2b1397bf1c972ba276a0c9a0f79d84dd5ff53bdb`,
  fresh ordinary-agent review at the explicitly required
  `gpt-5.6-sol` / `ultra` profile found additional runtime, installer,
  publisher, and installation-runbook defects. These repairs remain in the
  working tree and are not yet a landing commit; all final evidence below is
  therefore working-tree evidence until a new signed checkpoint freezes it.
- Runtime complete-snapshot closure now rereads and fingerprints every
  decision-relevant issue comment, review, reaction, request-authority result,
  short-SHA resolution, base epoch, repository identity, and PR scope. A clean
  result still requires two independently fetched, fully paginated snapshots;
  a mutation between snapshots restarts the stability observation instead of
  inheriting a stale clean result. Safe-read retry classification covers
  read-only GraphQL POSTs as well as GETs, while begin-review preserves its
  non-idempotent may-have-committed boundary until the same-run request marker
  is completely reconciled.
- Runtime status-response handling now preserves the received HTTP status and
  response phase through body-stream, size, JSON, and exact-ACK failures.
  Permission rejections, definite transient rejections, and permanent target
  errors therefore keep distinct recovery codes. The mandatory pre-mutation
  receipt is separate from the one authoritative final Actions summary, so an
  ambiguous or rejected success projection cannot leave contradictory
  `success/none` and recovery blocks in the same summary. The current complete
  runtime test file passes `59/59`; `npm run check:v2` and scoped diff checks
  pass.
- Consumer bootstrap now enforces the no-runtime-App single-producer boundary
  against extra workflows with `statuses`, `checks`, `issues`, or
  `pull-requests` write authority, `write-all`, exact or dynamic reserved job
  names, and direct or reusable v1/v2 callers. Ambiguous YAML carriers fail
  closed. Classic branch protection is read from the parent protection
  endpoint with exact absent/error classification, activation requires an
  already staged and exactly read-back disabled ruleset, and the canary proves
  the canonical run/job plus the required PR-head signal without accepting a
  same-name PR-head CheckRun. The complete bootstrap test file passes `65/65`.
- Publisher remediation keeps privileged admission closed to an exact writable
  plan, double-checks immutable-Release policy and source-branch/ruleset state
  before mutation and at success readback, and classifies public verification
  and Release `404` states without turning deterministic conflicts into generic
  retries. Full-tag history, immutable Release, assets, and forward-only stable
  alias reconciliation retain exact readback. The complete focused publisher
  suite passed `46/46`, with Bash syntax, ShellCheck, Node syntax, and scoped
  diff checks passing on the frozen publisher bytes.
- Installation documentation is now split into a human-readable guide and a
  separately agent-executable guide rather than treating “agent” as a shorter
  audience summary. The first migration remains fail closed: every inventoried
  v1 requirement stays active through the exact-head synchronous merge; the
  transaction then rereads the current repository default plus merged/base/head
  PR scope before removing any legacy requirement. A base retarget after the
  pre-merge read therefore cannot open a v1/v2 protection gap.
- The canonical preapproval/final legacy snapshot is implemented once in
  tracked executable
  `scripts/build-legacy-review-gate-inventory.sh`. Its canonical JSON binds the
  repository and default branch, full ruleset identity/source/conditions,
  enforcement and target, complete `bypass_actors`, the complete matching
  effective `required_status_checks` rule and parameters, and the classic
  parent required-status object. Both approval and final merge transaction call
  that same helper and compare SHA-256 over the same bytes. Focused fixtures
  prove that bypass or strict-policy drift changes the digest and malformed
  rule/bypass schema fails without output. Conditions and other set-valued
  policy arrays are recursively canonicalized within their reviewed scope, so
  API ordering of repository IDs, property values, include/exclude patterns,
  bypass actors, required checks, and classic contexts/checks does not create a
  false drift. The current documentation/security contract suite passes
  `30/30`; the helper passes `bash -n` and ShellCheck. A final zero-context
  ordinary `gpt-5.6-sol` / `ultra` delta audit reported `Clean` on helper
  SHA-256 `b3c82d024785728c860e748ed2fc08aaf184fd15201b86d3c6864f5c42864b81`
  and contract-test SHA-256
  `d7e56c1c3e39b3fc206abc1107fa0ca076345089a1f7fc87311c1e8ec6c7be9e`.
- The fresh runtime review also proved one unresolved P1 architectural limit in
  the adopted fixed-context PR-head commit-status projection. An exact GitHub
  `201 Created` followed by an unreadable body provides an ordering boundary,
  but a complete `5xx`, gateway timeout, transport abort, or no-response result
  does not prove that the origin stopped processing the old success request.
  Because GitHub selects the latest status for the same SHA/context and the
  controller job's native CheckRun is bound to the default-branch SHA, a late
  old success can overwrite a later same-head failure without a PR-head
  generation fence. `target_url`, description, readback absence, serial
  concurrency, and `retry_safe=false` are diagnostics, not a server-side fence.
  The current working tree intentionally does not disguise this limit as a
  solved retry case.
- A separate zero-context ordinary `gpt-5.6-sol` / `ultra` architecture lane
  proved a no-runtime-App alternative: a read-only `pull_request` verifier whose
  GitHub-managed CheckRun is required on the PR feature-head SHA and
  execution-bound to the current test-merge, plus a protected default-branch
  controller that creates review requests and precisely reruns the current
  verifier. That shape removes authoritative status POSTs and makes
  every non-`healthy/success` verifier result blocking. It also changes adopted
  decisions: one canonical workflow becomes two; workflow conclusion becomes
  gate authority rather than execution-health-only telemetry; each PR/head
  allocates a verifier runner; controller-triggered reconcile usually adds a
  second run; `actions: write` replaces `statuses: write`; and per-dispatch
  `limits_profile` cannot flow through a native rerun without another reviewed
  carrier. Joey explicitly adopted this architecture on 2026-08-27. The
  fixed-context commit-status bridge is superseded and must not ship in stable
  v2. The accepted tradeoff is the additional workflow, permission, runner,
  and ABI cost in exchange for mechanically removing delayed-success overwrite
  while retaining the no-runtime-App boundary.
- Joey superseded the temporary `edited` selection. The adopted
  `pull_request` activity types are `opened`, `reopened`, `synchronize`, and
  `ready_for_review`; `edited` is deliberately absent. A base-ref retarget does
  not create an exact-current verifier run, while advancing the existing base
  ref was never covered by `edited` and remains protected by strict up-to-date
  policy until a head update emits `synchronize`. Omitting `edited` avoids a
  full verifier allocation for ordinary title/body edits. A retarget therefore
  remains fail closed until an operator or agent creates a new PR lifecycle
  event: convert a ready PR to draft and mark it ready for review, or mark an
  already-draft PR ready. That `ready_for_review` event creates the verifier for
  the current exact head/base/test-merge scope; native rerun of the old run is
  not a substitute because it retains the old event SHA and ref.
- The human-readable and agent-executable usage guides must both document that
  retarget recovery. The controller must also emit the same next action in its
  Actions summary when it cannot locate exactly one canonical `pull_request`
  verifier run for the current exact head/base/test-merge scope. The
  machine-readable result is
  `recovery_code=create_verifier_run` with `retry_safe=false`: for a ready PR,
  convert it to draft and mark it ready again; for an already-draft PR, mark it
  ready; then verify a new `ready_for_review` verifier attempt exists for that
  exact scope before reconciling again. The controller does not
  change draft state itself and must not present an identical manual rerun as a
  valid recovery. Updating the PR head to emit `synchronize`, or close/reopen as
  a secondary manual recovery, remains valid but is not the primary retarget
  instruction.
- The adopted architecture's race boundary is layered rather than supplied by
  concurrency alone. It removes every authoritative commit-status POST; binds
  the GitHub-managed required CheckRun to the exact current PR feature-head SHA
  and binds its execution to the current test-merge; permits only one current
  verifier per PR with latest-generation cancellation;
  and maps every conclusion except a proved stable `healthy/success` to a
  blocking result. The verifier concurrency is therefore latest-wins
  single-flight, not a FIFO queue: `cancel-in-progress: true` cancels an older
  verifier, and a cancelled, timed-out, failed, pending, or unhealthy verifier
  cannot satisfy the gate. A controller wake-up that finds a verifier already
  running must not assume that run observed the new evidence; it must establish
  a later full-reconcile attempt or fail closed with an explicit recovery path.
  In particular, cancellation or an accepted-but-not-yet-visible rerun request
  is not a barrier: the controller must read back the exact `run_id`, a strictly
  newer `run_attempt`, and its canonical verifier job/CheckRun as queued or in
  progress before treating refresh as established. Verifier and controller use
  separate per-PR concurrency namespaces. Controller operations retain
  `cancel-in-progress: false` because `begin-review` can create a comment with
  a may-have-committed, non-idempotent result.
- Native rerun does not atomically connect a newly created provider event to a
  required pending CheckRun. Until the controller proves the newer attempt,
  an older same-head success can remain visible. The controlled lifecycle must
  therefore establish and read back the new attempt before a dependent review
  request, and merge automation must retain the exact-current verifier rerun
  and readback closure. An already-running verifier is never presumed to have
  observed a later event. Eliminating this wake-up window for arbitrary
  out-of-band review requests would require an additional authenticated event
  carrier or runtime App; bare concurrency and cancellation do not supply it.
- The existing evidence reducer, complete pagination, exact provider filtering,
  terminal-clean and `+1` semantics, commit-binding and unambiguous short-SHA
  handling, finding accounting, base/head/test-merge validation, two-snapshot
  stability proof, soft limits, decision/recovery codes, and Actions summary
  move into the read-only `pull_request` verifier. Review-request creation,
  hidden-marker deduplication, automatic `issue_comment` admission, manual
  dispatch validation, exact current-run selection, and Actions rerun remain in
  the protected default-branch controller. Direct commit-status projection and
  its mutation/readback recovery state are deleted rather than migrated; the
  ruleset continues to own up-to-date-branch and resolved-conversation policy.

### Final Native-CheckRun Implementation Checkpoint

- Phase: signed implementation checkpoint
  `063b612e86757284a6b905de4cac45ce01266672` exists. Its first frozen-range
  review found the platform-subject error recorded below; the correction is
  staged, and a new signed checkpoint plus fresh whole-range review remain
  pending.
- The direct JavaScript Action now routes trusted `pull_request` launches to a
  read-only verifier and `issue_comment` / `workflow_dispatch` launches to the
  non-authoritative controller. The verifier retains the full reducer,
  pagination, finding accounting, exact base/head/test-merge binding, and two
  stable snapshots; only `healthy/success` exits successfully. The controller
  retains canonical request creation/adoption, exact provider-event readback,
  baseline `A` to exact `A+1` rerun observation, and unique canonical
  job/CheckRun verification. V2 no longer posts commit statuses.
- The copied consumer contract now contains the read-only `Codex Review Gate
  Verifier` workflow and the separately permissioned `Codex Review Gate
  Controller` workflow. Their job names, event filters, per-PR concurrency,
  protected limits profile, and 14-minute runner budget are contract-tested.
- Bootstrap installs and exact-byte verifies both workflows plus scoped
  CODEOWNERS. Inventory rejects alternate required-name producers and relevant
  write authority; activation proves the unique native GitHub Actions CheckRun
  on the exact feature-head SHA and separately preserves its current
  test-merge execution scope, rejects a same-name legacy status, preserves the
  disabled/readback/canary/active sequence, and fails closed on unmanaged
  CODEOWNERS policy expansion.
- Human-readable and agent-executable installation guides, package design and
  recovery docs, and both release runbooks now describe the same two-workflow
  contract. The stable-RC selector bridge changes and later restores both
  canonical workflows; dedicated generated canary automation remains deferred.
- Final local validation on the reconciled bytes:
  - `npm test`: 701 of 701 passed, 0 failed, in 815131 ms;
  - `npm run check`: passed;
  - Action/runtime focused suite: 68 of 68 passed;
  - bootstrap suite: 68 of 68 passed;
  - workflow-security suite: 30 of 30 passed;
  - workflow-contract suite: 8 of 8 passed;
  - release pipeline suite: 46 of 46 passed;
  - release-provenance suite: 38 of 38 passed;
  - `bash -n` and ShellCheck passed for both release and legacy-inventory
    scripts;
  - actionlint passed both copied consumer workflows;
  - `git diff --check` and project-journal validation passed.
- The first full run passed 699 of 701 and exposed two test-only alternate
  line-break fixtures that still replaced the old Action description literally.
  Their helper now locates the root description structurally and asserts the
  malicious NEL/LS/PS payload changed the fixture. Production parsing was not
  loosened; the focused 38-test suite and the final 701-test run passed.
- Source-repository publisher actionlint still reports its reviewed stale
  metadata model for `actions/create-github-app-token@v3` plus five SC2016
  informational literals. A live read of the official v3 `action.yml` on
  2026-08-27 confirmed `client-id` is current and `app-id` carries the
  `Use 'client-id' instead` deprecation message, so the workflow remains on
  `client-id`. The publisher script, standalone ShellCheck, and 46-test release
  suite pass.

### Frozen-Range Review Correction: CheckRun Subject Versus Execution Scope

- The first independent frozen review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..063b612e86757284a6b905de4cac45ce01266672`
  in an isolated exact-pack workspace. The native reviewer role was unavailable,
  so the explicitly authorized fallback was a zero-context ordinary general
  agent using `gpt-5.6-sol` with `ultra` reasoning. Preparation and post-review
  workspace validation, prefix receipts, and control-bundle digest all matched.
- That review found one P1: activation expected the REST workflow-run `path` to
  contain `@refs/pull/N/merge`, while the live API exposes the canonical path
  without that suffix. The fixture had repeated the same false assumption, so
  it could not catch a live activation failure.
- Parent adjudication checked current GitHub objects rather than narrowing the
  fix to that string. Live `pull_request` run `33019349074` and its CheckRun/job
  expose feature head `6b7509216181e9b1c31976bf4261364b08ba26b6` as
  `head_sha`; PR #34 separately reports test-merge
  `439319b6e80dd18f696767bf96d39090d642daa4`. The run path is the pure
  `.github/workflows/ci.yml`. This establishes two different facts that must
  not be collapsed:
  - GitHub attaches the native workflow run, job, and required CheckRun to the
    exact PR feature-head SHA.
  - The `pull_request` workflow executes on `refs/pull/N/merge`; the verifier
    must strictly require `GITHUB_SHA == pull_request.merge_commit_sha`, the
    exact merge ref, matching event/current head and base, and a stable fresh PR
    read. That is the test-merge execution binding.
- The correction therefore queries and validates native run/job/CheckRun
  objects only against the feature head, requires the canary REST run path to
  equal the pure canonical workflow path, and keeps test-merge validation as a
  separate launch/snapshot invariant. Regression fixtures reject a test-merge
  subject, stale feature heads, attacker/decorated workflow paths, and drift in
  any run/job/CheckRun binding.
- Explicit reason: a ruleset consumes the GitHub-managed feature-head CheckRun,
  while merge-code validation must still prove that the successful evaluator
  ran against the exact current test-merge. Treating either SHA as both objects
  would make activation fail against the live API or would weaken the tested
  merge scope.
- Validation on the corrected working tree passed:
  - `npm test`: 702 of 702 passed, 0 failed, in 1265194 ms;
  - `npm run check`: passed;
  - focused v2 runtime suite: 68 of 68 passed;
  - bootstrap suite: 68 of 68 passed;
  - workflow-security suite: 30 of 30 passed;
  - actionlint passed both copied consumer workflows;
  - `bash -n` and ShellCheck passed both tracked shell scripts;
  - `git diff --check` and project-journal validation passed.
- This correction does not turn success into a lease. Same-head base or evidence
  changes can leave an older feature-head success visible. Under the adopted
  eventual-reconciliation boundary, the supported agent merge path must force
  an exact-current verifier refresh, observe the new canonical attempt and
  CheckRun, require stable `healthy/success`, reread unchanged
  head/base/test-merge and ruleset state, and merge the exact head. Direct human
  UI merge outside that closure remains unsupported.

### Whole-Range Review At The Feature-Head Correction

- The next independent review covered the complete frozen range
  `10217253306ca2ee6f312f766a331f8924e26e47..0033c1b9d15b34c396aa912b6dd67ab483d8ad61`
  in a clean detached no-local clone. The source and review workspace both
  resolved tree `80dfe90548965be005ae7153b09639ae8c247b5a`; the workspace was clean before
  and after review. The dedicated reviewer role was unavailable, so the
  explicitly authorized zero-context ordinary `gpt-5.6-sol` / `ultra` fallback
  performed the review.
- The reviewer retained four actionable findings:
  - canary PR-file pagination was not bound to `changed_files`, did not reject
    an unsafe truncated/limit inventory, and checked only `filename`, so a
    rename away from a protected control-plane path could evade the canary
    change check;
  - verifier workflow-run pagination silently deduplicated a repeated boundary
    ID, so concurrent newest-first insertion could omit an active run while the
    raw count still appeared complete;
  - the GitHub.com-only installer did not explicitly pass
    `--hostname github.com` to `gh api`, allowing ambient `GH_HOST` to redirect
    a same-slug read or write;
  - the existing-Code-Owner-policy equivalence ignored non-empty bypass actors,
    so a new no-bypass ruleset could silently expand approval requirements for
    an actor that previously bypassed unmanaged CODEOWNERS paths.
- The parent review correctly did not retain a proposal to add
  `pull_request.edited`: that would reverse the explicitly adopted low-cost
  trigger and draft-to-ready retarget-recovery boundary rather than repair an
  implementation defect within it. It also did not retain two bootstrap
  candidates whose complete security boundary or migration deadlock was not
  established by the final review.
- Remediation is implemented on the subsequent checkpoint:
  - canary activation requires an authoritative non-negative `changed_files`
    count within the GitHub REST 3,000-file bound, exact page and record counts,
    well-formed unique current filenames, and both current and previous rename
    paths to be outside the protected control plane;
  - any duplicate verifier workflow-run ID across pages is unstable evidence
    and fails closed as `pending/wait_then_reconcile` before a rerun request;
  - every helper `gh api` call carries `--hostname github.com`, and a hostile
    ambient `GH_HOST` is covered by regression;
  - an existing Code Owner rule is policy-equivalent only when its
    `bypass_actors` field is readable and explicitly empty.
- Validation on the remediation working tree passed:
  - `npm test`: 706 of 706 passed, 0 failed, in 1611120 ms;
  - `npm run check`: passed;
  - focused v2 runtime suite: 69 of 69 passed;
  - bootstrap suite: 71 of 71 passed;
  - `git diff --check` and project-journal validation passed;
  - local `gh api --help` confirmed the explicit
    `gh api --hostname github.com <endpoint>` argument order.
- The remediation checkpoint remains subject to another fresh whole-range
  review before delivery; earlier reviews are finding evidence, not acceptance
  evidence for changed bytes.

### Whole-Range Review At The Snapshot-Hardening Checkpoint

- A third independent review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..8dbf6805f0087540db7bf0824bfcd6e686ac3049`
  in a clean detached no-local clone at tree
  `fe1375f703fd3b4021ba23b9b5d142a5a0d817fe`. The dedicated reviewer role was
  already proved unavailable, so the explicitly authorized zero-context
  ordinary `gpt-5.6-sol` / `ultra` fallback reviewed all 12 commits and 89
  changed paths. The workspace was clean and retained the exact head/tree after
  review.
- The reviewer retained two P1 findings and one P3:
  - the installer tied a canary run to feature head, base ref, and repository,
    but not the run's exact base SHA or a machine-readable receipt for the
    current `merge_commit_sha`; an old same-head success could therefore be
    accepted after the default branch advanced;
  - after the non-idempotent verifier-rerun POST may have committed, a transient
    run/job/CheckRun read failure could still escape as
    `retry_reconcile/retrySafe=true` and map `begin-review` to an immediately
    retry-safe `retry_begin`, allowing a blind extra attempt;
  - workflow-run pagination compared the accumulated count only with the final
    page's `total_count`; a deletion between pages could lower that count and
    make an incomplete inventory look complete.
- The adopted remediation is a canonical verifier run-name receipt
  `codex-review-gate-verifier/<pr-number>/<test-merge-full-sha>`, generated from
  `github.event.pull_request.number` and `github.sha`. Installer and runtime
  must require that exact current value in addition to feature-head and exact
  base-SHA bindings. Once the rerun POST may have committed, every later
  readback failure becomes `pending/wait_then_reconcile/retrySafe=false`.
  Workflow-run pagination freezes the first `total_count` and rejects any later
  drift or duplicate. The resulting checkpoint again requires focused/full
  validation and a fresh whole-range review before delivery.
- A parent-side focused audit then found that a frozen count and duplicate-ID
  check alone still allowed a same-count member replacement while pagination
  was in progress: one new active run could enter while one old run disappeared,
  leaving an apparently complete but stale inventory. The mutation boundary now
  requires two complete workflow-run inventories with identical canonical
  fingerprints before the rerun POST. The fingerprint covers every member's
  identity, attempt, workflow receipt, head and PR/base bindings, status,
  conclusion, and URL. Any member replacement, status change, per-snapshot
  count drift, or duplicate remains
  `pending/wait_then_reconcile/retrySafe=false` and performs no POST. This is a
  finite stability observation rather than an atomic GitHub transaction; its
  purpose is to reject an internally unstable pre-mutation snapshot, while
  later attempt readback and the strict up-to-date ruleset remain the outer
  race controls.
- Final validation on the frozen remediation working tree passed:
  - `npm test -- --test-reporter=dot`: 712 of 712 passed, 0 failed;
  - focused runtime suite: 75 of 75 passed;
  - focused v2 suite: 84 of 84 passed;
  - focused bootstrap suite: 71 of 71 passed;
  - `npm run check`: passed;
  - `actionlint` passed for both canonical consumer workflows;
  - project-journal validation and `git diff --check` passed.
- The first full-suite attempt was intentionally interrupted after the focused
  audit exposed the same-count replacement race. It is not acceptance
  evidence. The 712-test result above is the subsequent uninterrupted run on
  the corrected, frozen working tree.

### Whole-Range Review At The Stable-Receipt Checkpoint

- A fourth independent review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..40797a032fb4f9d2fa732cd6fa4d1a82cdeb073a`
  in a clean detached no-local clone at tree
  `b61c9f170796237047366211846333d66b88c478`. The dedicated reviewer role
  remained unavailable, so the explicitly authorized zero-context ordinary
  `gpt-5.6-sol` / `ultra` fallback reviewed all 13 commits and 89 changed paths.
- The reviewer retained one P3 documentation defect. The executable agent
  canary command queried the default first CheckRun page and filtered locally;
  a valid `codex/github-review-gate` beyond that page would be omitted and the
  agent installer would falsely reject the canary. The runtime and bootstrap
  helper were not affected because their authoritative inventories already
  use complete pagination.
- Both agent installation guides now use the server-side
  `check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100` query with
  `gh api --paginate --slurp`, then flatten every returned page. The workflow
  security contract pins this executable guidance so the first-page-only bug
  cannot silently return. Local `gh api --help` confirms that `--slurp` wraps
  every paginated response into the outer array consumed by the documented jq
  expression.
- This documentation checkpoint requires focused validation, a new signed
  commit, and another fresh whole-range review before it can become acceptance
  evidence.
- Focused validation on the documentation remediation passed:
  - workflow-security contract: 30 of 30 passed;
  - `npm run check`: passed;
  - project-journal validation and `git diff --check`: passed.

### Whole-Range Review At The Paginated-Canary Checkpoint

- A fifth independent review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..866ee16f1ba7e69133e72266f23c10c638dce559`
  in a clean detached no-local clone at tree
  `91ceca54c30af3783796709d8e82b48731e9dca8`. The dedicated reviewer role
  remained unavailable, so the explicitly authorized zero-context ordinary
  `gpt-5.6-sol` / `ultra` fallback reviewed all 14 commits and 89 changed paths.
- The reviewer retained one P1 and one P3:
  - the GitHub.com-only installation transaction did not pin every executable
    `gh` read and merge write to `github.com`; a hostile ambient `GH_HOST` plus
    a same-slug GHES mirror could make the legacy inventory, owner/review
    authorization, and final merge PUT self-consistent on the wrong host;
  - the runtime appended a healthy success summary before persisting required
    `GITHUB_OUTPUT` values, so an output-write failure could leave that success
    block followed by an unhealthy recovery block. The native CheckRun still
    failed closed, but the Actions page no longer had one authoritative final
    summary.
- The adopted remediation is explicit GitHub.com binding for every executable
  helper and installation-transaction `gh` operation, with hostile-`GH_HOST`
  regression coverage. Runtime finalization must persist all required outputs
  before appending the success summary, so a persistence failure reaches the
  recovery path without any stale success projection. Both remediations require
  focused/full validation, a signed checkpoint, and another fresh whole-range
  review before delivery.
- The host-binding remediation removes `gh repo view` from the legacy inventory
  helper and pins all of its REST reads with `--hostname github.com`. Across all
  executable shell blocks in the four installation guides, every `gh api` call
  now carries that explicit hostname and every `gh pr`, `gh workflow`, `gh run`,
  and `gh variable` operation uses the host-qualified
  `--repo "github.com/$REPO"`. A closed command classifier fails the docs
  contract on an unknown executable `gh` family, while the dynamic helper test
  runs under hostile `GH_HOST` and rejects any unpinned request.
- Runtime finalization now writes required `GITHUB_OUTPUT` values before it
  appends the ordinary final summary. If output persistence fails, the top-level
  recovery path downgrades the report and invokes an explicit failure-only
  finalization mode: it may append the single unhealthy summary even though the
  output path remains broken, then exits nonzero. A regression with a writable
  summary path and a directory in place of `GITHUB_OUTPUT` requires exactly one
  summary heading, one unhealthy result, and no healthy/success projection.
- Final validation on the frozen remediation working tree passed:
  - `npm test -- --test-reporter=dot`: 714 of 714 passed, 0 failed;
  - focused runtime suite: 76 of 76 passed;
  - focused v2 suite: 85 of 85 passed;
  - workflow-security contract: 31 of 31 passed;
  - `npm run check`: passed;
  - `bash -n` and ShellCheck 0.11.0 passed for the changed legacy inventory
    helper;
  - project-journal validation and `git diff --check` passed.

### Whole-Range Review At The Host-And-Summary Checkpoint

- A sixth independent review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..2d9f4efb318c0b942c4822bd921d26039474a943`
  in a clean detached no-local clone at tree
  `6df40996dba31a3a8f82b12d2a320feb1cd13b73`. The dedicated reviewer role
  remained unavailable, so the explicitly authorized zero-context ordinary
  `gpt-5.6-sol` / `ultra` fallback reviewed all 15 commits and 89 changed paths.
- The reviewer retained two P1 and three P2 findings:
  - publisher Release/API operations and direct workflow `gh` calls still
    inherited ambient host and enterprise-token state, allowing Git pushes to
    GitHub.com while Release mutations targeted a same-slug GHES repository;
  - executable Cookbook recovery commands still used unqualified
    `OWNER/REPO`, so a hostile `GH_HOST` could redirect head reads, dispatches,
    and repository-variable writes;
  - output-persistence recovery preserved fail-closed job exit but changed an
    already proved finding verdict and counts from `failure` to `unknown`, then
    recommended permission repair instead of finding remediation;
  - the agent canary branch endpoint interpolated an unescaped default branch,
    so a valid branch such as `release/v2` produced the wrong REST path;
  - the new executable-`gh` regex scanned only the first apparent command per
    physical line, missed split `gh`/subcommand syntax, and treated comments or
    quoted strings as commands. It therefore could both false-pass and
    false-fail while claiming a closed command contract.
- The adopted remediation pins and sanitizes the publisher's complete GitHub
  CLI boundary, extends host-qualified command guidance and contracts to both
  Cookbooks, preserves a proved finding verdict/counts when finalization itself
  becomes unhealthy, URI-encodes the agent guide's branch path parameter, and
  replaces the regex with a shell-aware closed executable-command audit backed
  by explicit multi-command, continuation, comment, and string regressions.
  The resulting checkpoint again requires focused/full validation, a signed
  commit, and a fresh whole-range review before delivery.

### Host, Recovery, And Documentation Remediation

- The publisher now treats GitHub.com as an explicit trust boundary instead of
  inheriting ambient GitHub CLI routing:
  - the privileged script captures its intended publisher token before clearing
    `GH_HOST`, `GH_ENTERPRISE_TOKEN`, and `GITHUB_ENTERPRISE_TOKEN`;
  - every publisher `gh` subprocess receives only that token and an explicit
    `GH_HOST=github.com` after enterprise-token removal;
  - the two direct workflow API reads likewise use `--hostname github.com`, and
    the target-scoped installation token remains command-scoped;
  - a hostile-environment release regression verifies the child process sees
    the intended publisher token, GitHub.com, and no competing credential.
- A report-output write failure no longer erases an already proved finding
  verdict. When the completed evaluator report is `healthy/failure` with
  `fix_findings` and four proved nonnegative counts, finalization still becomes
  `unhealthy/failure`, retains those exact counts and recovery code, marks the
  invocation retry-unsafe, emits one authoritative unhealthy summary, and exits
  nonzero. A clean or otherwise unproved result still fails closed as
  `unhealthy/unknown` with permission repair guidance.
- All executable `gh api` commands in the four installation guides and both
  Cookbooks now begin with `--hostname github.com`; executable
  `gh pr`, `gh run`, `gh variable`, and `gh workflow` commands bind
  `--repo "github.com/$REPO"`. The agent canary separately URI-encodes the
  default branch with `jq @uri`, so a valid `release/v2` branch addresses
  `release%2Fv2` rather than changing the REST path structure.
- The documentation contract no longer relies on a first-command-per-line
  regex. Its conservative shell scanner enumerates literal executable `gh`
  commands across compound separators, pipelines, command substitutions,
  backticks, and backslash continuations while ignoring comments and purely
  quoted strings; every unknown literal `gh` subcommand fails the host audit
  closed. Regressions cover an unsafe second command after a safe first command,
  split `gh`/subcommand syntax, substitutions, and quoted/comment examples.
- The first frozen full-suite run exposed one stale independent provenance
  assertion that still required the former unqualified installation-token
  command. The contract now requires the sanitized enterprise-token boundary,
  explicit GitHub.com host, intended installation token, and explicit API
  hostname. Its focused 38/38 rerun passed before restarting the full suite.
- Validation at this remediation checkpoint passed:
  - full repository suite: 717/717 on the frozen worktree after the stale
    provenance-contract correction;
  - v2 runtime: 77/77;
  - v2 aggregate: 86/86;
  - release pipeline: 46/46;
  - workflow security contract: 33/33;
  - `npm run check`, `bash -n`, `shellcheck`, project-journal validation, and
    `git diff --check`;
  - `actionlint 1.7.12` retained only its known
    `actions/create-github-app-token@v3` `client-id` metadata false positive and
    the existing SC2016 informational messages in the immutable jq program.

### Whole-Range Review At The Host-And-Recovery Checkpoint

- A seventh independent review covered
  `10217253306ca2ee6f312f766a331f8924e26e47..0d25abde1b048a3a902a0c35b5c3565b642e3e90`
  in a clean detached no-local clone at tree
  `f5bd7b01275ec6346b444716845ccfc429b6a9ce`. The explicitly authorized
  zero-context ordinary `gpt-5.6-sol` / `ultra` reviewer checked all 16 commits
  and 89 changed paths without editing, networking, or accessing a PR.
- The reviewer confirmed that the publisher host/token split, finding verdict
  preservation after output failure, and default-branch URI encoding were
  closed, and retained two P1 and one P2 findings:
  - the GitHub UI defaulted to `operation=reconcile` plus
    `request_review=true`, while the controller passed false for reconcile and
    runtime required the raw values to match; the primary manual recovery path
    therefore rejected its own default input combination;
  - the documented final merge command used only `--match-head-commit`, so it
    did not bind the selected GitHub.com repository or PR and could operate on
    ambient checkout/host context;
  - the literal-`gh` documentation scanner still confused command and argument
    positions, ignored complete inline commands, and accepted later selector
    overrides such as a second `--hostname` or `-R`.

### Manual Dispatch, Merge Closure, And Command-Audit Remediation

- The controller retains the adopted UI defaults: reconcile remains the
  default operation, and `request_review=true` remains the begin-review default
  while false remains its advanced option. The workflow now forwards the raw
  boolean unchanged. Runtime first requires the event payload and Action input
  to match exactly, then treats that value as semantically ignored/false only
  for reconcile. This preserves the anti-tamper binding without making a
  begin-review user opt in again or making default reconcile invalid.
  - Runtime regressions use the real default UI event instead of silently
    rewriting the event input, prove that default reconcile requests verifier
    attempt `A+1`, reject event/Action mismatch before API access, and retain
    begin-review true/false behavior.
  - Cookbook commands still pass `request_review=false` explicitly for
    deterministic agent execution rather than relying on the ignored UI field.
- The complete merge command is now a fenced executable block in both
  Cookbooks, READMEs, and DESIGN documents. It simultaneously supplies
  `PR_NUMBER`, `--repo "github.com/$REPO"`, and
  `--match-head-commit "$HEAD_SHA"`; exact-head compare-and-swap is therefore
  not mistaken for repository, host, or PR selection.
- The documentation audit now parses the literal simple-command position:
  quoted command names are executable, while a `gh` argument to `printf` is
  not. It audits installation guides and all package documents, including
  complete inline snippets, while permitting short inline command-name
  references and prohibitions. For API calls it requires exactly one canonical
  leading `--hostname github.com`; for repository commands it requires exactly
  one two-word `--repo github.com/$REPO`, rejects long/short attached or later
  overrides, and requires `gh pr merge` to target `$PR_NUMBER` explicitly.
  The scanner handles the documented compound-command, pipeline, command
  substitution, backtick, continuation, assignment, and `env` forms. It does
  not claim to expand dynamic `eval`, `sh -c` strings, aliases, or shell
  functions; such dynamically generated commands are outside the executable
  documentation contract.
- Focused validation passed at this checkpoint:
  - full repository suite: 720/720 on the frozen remediation worktree;
  - v2 aggregate: 87/87;
  - workflow security contract: 35/35;
  - controller template `actionlint`, `npm run check`, project-journal
    validation, and `git diff --check`.
  A signed checkpoint and new exact-head whole-range review remain mandatory
  before PR delivery resumes.

### Whole-Range Review At The Manual-Recovery Checkpoint

- A fresh no-local clone reviewed the exact frozen range
  `10217253306ca2ee6f312f766a331f8924e26e47..03a7f751498e8c77229d6c151f2cc199c69cc4f6`
  at tree `ef68efdca69171d9a6ae8985e8f12663be967354`. The local lane used an
  ordinary general agent with `gpt-5.6-sol` / `ultra`, as explicitly selected
  for environments without a dedicated reviewer role. It found two remaining
  P2 documentation-audit gaps; it confirmed that the prior manual-dispatch and
  merge-target findings were otherwise closed.
  - A documented `gh pr merge` could bind the repository and PR but omit the
    exact-head compare-and-swap selector. The scanner now requires exactly one
    two-token `--match-head-commit "$HEAD_SHA"`; missing, duplicated, attached
    `=`, and wrong-value forms are rejected. Reason: repository and PR binding
    prevent ambient-target drift, while the exact-head selector independently
    prevents a newly pushed head from being merged under stale verification.
  - Literal `gh` execution behind `command` or `exec` wrappers could evade the
    executable-position scanner. Those two wrappers and their supported static
    options are now unwrapped, while `command -v` / `-V` lookup forms remain
    non-executing. `env -S` / `--split-string`, unsupported wrapper options,
    and literal `gh` behind a non-display command whose execution position
    cannot be proven fail closed. Reason: a documentation security contract
    must reject statically ambiguous execution instead of treating it as
    harmless prose.
- The scanner still does not expand arbitrary variable-generated commands,
  aliases, or function bodies. This is an explicit static-analysis boundary,
  not a claim that those dynamic forms are safe. Direct literal command
  strings behind wrappers such as `bash -c` are rejected, and `echo` / `printf`
  remain the narrow display-only exceptions.
- Independent validation passed after remediation: workflow security contract
  36/36, full repository suite 721/721, `npm run check`, and
  `git diff --check`. A signed exact-head whole-range review remains required
  before PR delivery.

### Whole-Range Review At The Command-Audit Checkpoint

- A fresh no-local clone reviewed the exact frozen range
  `10217253306ca2ee6f312f766a331f8924e26e47..8210c6fae7250c3c4ce1e4b1262ac31557ce8e8f`
  at tree `a810126a06e26621aea27bde541e0f5743098c1e`. The lane was an
  ordinary general agent using `gpt-5.6-sol` / `ultra`, with no dedicated
  reviewer role. It confirmed the command-audit remediation and found one P1
  installation-order defect plus one P2 release-job budget defect.
- P1: the documented and enforced migration removed every legacy
  `codex/review-gate` requirement before staging v2 Disabled, running the
  canary, and activating v2. That created an unbounded interval in which no
  Codex review gate was required, contradicting the fail-closed installation
  contract. Classic branch protection, a separate/inherited legacy ruleset,
  and a same-name active legacy ruleset all exposed this window.
  - The adopted order is now intentionally overlapping: retain every active
    legacy gate; stage a distinct v2 ruleset Disabled; run the canary while
    legacy still blocks merges; activate v2; read the exact complete Active
    v2 policy back; only then perform separately authorised legacy cleanup;
    finally prove both legacy surfaces clear and the same v2 policy still
    Active. A canary need not merge, so legacy blocking it remains compatible
    with this sequence.
  - An active legacy or otherwise incomplete ruleset occupying the selected
    v2 name is never disabled or rewritten. Staging stops before a write and
    requires a distinct `--ruleset-name`. A complete Active v2 ruleset that
    still contains the legacy context is a preserve/no-op state; bootstrap
    does not silently perform cleanup.
  - The protected overlap property is explicit and spans separate bootstrap
    processes. Before the first remote stage command, the owner records one
    canonical SHA-256 inventory for the exact repository and default branch.
    Repository binding includes the exact slug, numeric repository ID, opaque
    repository node ID, and default-branch name so repository replacement or
    retargeting cannot replay an old approval. The external shell producer and
    runtime consumer call the same Node canonicalizer and therefore share one
    byte ordering, numeric domain, schema, and trailing-newline contract rather
    than attempting to keep independent jq and JavaScript serializers aligned.
    That inventory contains every effective legacy ruleset's identity, source,
    enforcement, target, conditions, bypass actors, complete rules, and
    effective required-check rule, plus the complete classic required-status
    object including `strict`, `contexts`, `checks`, and each check's explicit
    producer `app_id`. Even an empty legacy inventory remains repository- and
    branch-bound and therefore has an approval digest. Every Disabled-stage
    and activation preview/apply must present the same digest; bootstrap reads
    and compares the complete inventory initially, immediately before a write,
    again after the final target-ruleset lost-update readback, and after the
    exact v2 write/readback. Every digest read verifies repository identity and
    default-branch existence at both ends. Successful empty or JSON `null`
    classic responses are schema-inconclusive; only the two recognised exact
    404 absence states are canonicalized as absent. API or schema unreadability
    is inconclusive rather than legacy absence, while any readable inventory
    drift fails closed.
    Reason: a process-local witness would reset its baseline between stage and
    activation, a context-only classic witness would lose producer binding,
    and summary ruleset objects can omit security-relevant policy fields.
  - An authorised legacy cleanup necessarily changes the pre-cleanup approval
    digest. The final proof therefore uses a separate read-only
    `--verify-post-cleanup` mode rather than accepting a new unapproved digest.
    It requires no effective legacy ruleset and no classic legacy context,
    while allowing unrelated classic checks, and independently reads back the
    selected v2 ruleset as the complete Active policy. It performs two complete
    ordered legacy-plus-selected-v2 reads and requires byte-identical legacy
    inventories and identical selected-v2 writable fingerprints. This prevents
    a classic-to-ruleset surface swap from being assembled into a false clear
    snapshot. It has no mutation path.
  - The active update's final mutation boundary is fixed as complete final
    canary readback, complete final consumer-security snapshot, exact selected
    target readback, and then the immediately adjacent PUT. The target readback
    binds ID, name, repository source, and branch target. After PUT, bootstrap
    performs an immediate exact readback, the complete security and legacy
    checks, and a second exact target readback before reporting success. GitHub
    exposes no ruleset ETag or conditional update, so the final GET-to-PUT gap
    cannot be eliminated; the two write-back reads make any observable race
    fail closed instead of claiming completion.
- P2: `candidate-a` and `candidate-b` had only 14 minutes for checkout, setup,
  deterministic candidate materialisation, packaging/upload, syntax checks,
  and the complete test suite. The suite alone had consumed about 755.6
  seconds before its last release-pipeline test completed, leaving inadequate
  headroom and making a valid release likely to time out before assembly.
  A subsequent platform check found that GitHub imposes a separate 15-minute
  hard limit on the single-CPU `ubuntu-slim` runner, so merely declaring a
  30-minute workflow timeout would not extend these jobs. The two
  low-frequency heavy candidate jobs therefore use `ubuntu-24.04` with
  30-minute timeouts. The four light unprivileged jobs remain on
  `ubuntu-slim` at 14 minutes, and the privileged publisher remains on
  `ubuntu-24.04` at its existing 30-minute limit. This keeps the low-cost
  runner preference for genuinely light work without relying on an
  unenforceable timeout for the full suite.
- Focused post-remediation validation passed: bootstrap 83/83, workflow
  security contract 38/38, release-pipeline contract 2/2, `npm run check`, and
  `git diff --check`. `actionlint` retained only the three already recorded
  baseline diagnostics for App-token metadata and the quoted summary body;
  the exact baseline-filtered run was clean. A serialized repository baseline
  subsequently passed 736/736 before the cross-process inventory hardening
  described above. Those results are historical checkpoints, not acceptance
  evidence for the new digest and post-cleanup modes; the final focused and
  complete suites, signed checkpoint, and fresh exact-head whole-range review
  remain mandatory.

### Canonical Inventory And Mutation-Boundary Follow-Up

- A focused ordinary-agent audit of the latest shared tree found no remaining
  actionable production defect in the migration digest, active-write
  sequencing, or post-cleanup closure. It explicitly confirmed shared
  canonical bytes, repository identity binding, complete status-rule producer
  binding, selected-target identity, the final
  `canary -> security -> target GET -> PUT` order, and the two-round read-only
  cleanup proof. The unavoidable final GET-to-PUT interval is the minimum
  remaining race under GitHub's API and is followed by two exact target
  readbacks. This was a focused pre-review, not the required whole-range
  acceptance lane.
- Regression coverage now fixes the previously implicit boundaries: repository
  numeric/node identity replacement, successful `null` classic responses,
  duplicate status-rule splicing, selected-target identity drift, cross-surface
  torn cleanup reads, drift after the first write readback, and the final active
  call order. Final focused validation passed bootstrap 94/94, workflow-security
  contract 38/38, and release-pipeline 47/47; the release-pipeline file took
  about 1,106 seconds, independently validating the standard-Ubuntu runner
  decision. The final serialized repository suite passed 747/747 with exit
  status zero. `npm run check`, shell `bash -n`, ShellCheck, the baseline-filtered
  actionlint invocation, `git diff --check`, and project-journal validation also
  passed. This evidence covers the code and documentation snapshot immediately
  before this evidence-only journal append; the append is revalidated by the
  journal, syntax, diff, and exact-head review gates rather than rerunning the
  18-minute release simulation solely for its own recorded result.

### Exact-Head Acceptance Review And Remediation Round

- The first formal whole-range lane reviewed the exact signed checkpoint
  `10217253306ca2ee6f312f766a331f8924e26e47..29a7646bc3905ecb6371dfd58d219a1245c6722c`
  at tree `20c170722e6ac727e2701da98b9c12a851c975fa`. It was a fresh
  no-local clone and an ordinary general agent running `gpt-5.6-sol` / `ultra`,
  not a dedicated reviewer role. The checkpoint had a Good GPG signature from
  `EFBBC913F49A5F6E0AF0D248F70246143DC28F32`. The review returned five P1,
  nine P2, and one P3 actionable findings. No remote PR, release, or consumer
  mutation occurred while the findings were open.
- Runtime evidence is now generation-safe rather than timestamp-only. An
  unbound terminal clean cannot satisfy a later request after that request has
  shown liveness; ambiguous lineage remains pending and cannot clear retained
  findings. The exact `+1`, uniquely resolved short-SHA, terminal clean-text,
  and direct-request behavior remain supported. The controller additionally
  rereads exact PR scope and the complete canonical-run inventory immediately
  before its sole rerun POST and after observing attempt `A+1`; a synchronize,
  retarget, or competing-run drift is retry-unsafe pending and never cancels a
  new verifier. The former tampered-launch test is now success-capable except
  for the single altered binding, so deleting the guard makes the test fail.
  Reason: asynchronous Codex terminal evidence and native reruns have no
  request transaction ID, so absence of provable lineage must not become a
  success shortcut.
- Bootstrap now implements the supported GitHub/Ruby `File.fnmatch` branch
  subset with `FNM_PATHNAME` semantics. In particular, naked `**` matches one
  path component while a component-leading `**/` is recursive; unsupported or
  malformed patterns are inconclusive rather than coverage. Controller source
  validation is a closed YAML structure and rejects explicit, quoted, tagged,
  flow, alias, merge-key, secrets, extra-job, extra-step, and alternate-callee
  forms. Local apply re-enumerates and content-binds the complete security-
  relevant workflow/CODEOWNERS set immediately before its first rename and
  again before success, reporting a partial apply when a post-write race is
  observed. Repository branch rulesets with the selected name must be unique
  at discovery, immediately before create, and after create, with a fresh exact
  ID bound through the final authoritative GET. Reason: these checks protect
  actual access-policy content and object selection, not benign directory
  metadata or API order.
- Legacy cleanup has a new two-phase, read-only proof. Before cleanup, an owner
  runs `--derive-post-cleanup-plan` with the original approved legacy digest.
  Two identical complete pre-state closures are transformed only by removing
  `codex/review-gate`; stdout is deterministic reviewable JSON containing the
  complete expected state, permitted actions, selected v2 identity, and
  `expected_post_cleanup_security_sha256`. Only an empty status policy/rule or
  a truly dedicated legacy-only ruleset may disappear structurally. After the
  separately authorised cleanup, `--verify-post-cleanup` requires the external
  `--expected-post-cleanup-security-sha256`; two identical complete security
  closures must both match it, show no legacy requirement, and retain the same
  unique complete Active v2 ruleset. Neither mode can mutate. Active write
  uncertainty always says to preserve v2 and every legacy protection and use
  read-only diagnostics; it never advises disable or rollback. Reason: an
  actual post-cleanup snapshot cannot self-authorise deletion of unrelated
  rules, checks, strictness, producer binding, workflows, CODEOWNERS, or owner
  authority.
- Publisher admission now binds a push's complete
  `github.event.before..github.sha` landing range and rejects any release-
  control path change in that range. Manual dispatch accepts only
  `source_sha`, `admission_run_id`, and `admission_run_attempt`; it binds the
  exact push run/attempt and exact non-expired artifact ID/name/server digest,
  verifies downloaded bytes again, and recomputes the entire plan from Git.
  It cannot freely rebuild or substitute an admission. Plan artifacts retain
  for 90 days, candidate A/B artifacts for one day, and assembled/publication
  artifacts for 35 days. Ninety days is chosen to cover the Environment
  approval and bounded recovery window; expiry is intentionally fail-closed
  and requires a new reviewed release intent rather than promising indefinite
  recovery or treating an artifact as a ledger.
- Release payload validation rejects all `.github/workflows/**` content and
  enumerates every tracked `src/v2/**` entry before applying its exact runtime
  allowlist. Archive bytes are now produced by the repository-owned
  deterministic ustar/gzip encoder with a golden digest instead of floating
  host `git archive`/`gzip`. Historical validation routes the v2 plan,
  candidate, publication-plan, and provenance v2 schemas through the frozen
  `codex-review-gate-action-v2.0-contract-v1` behavior so a future legitimate
  contract upgrade does not retroactively reinterpret old immutable releases.
- Public verification fully inventories the major's stable releases and
  requires its floating alias to identify the highest complete SemVer. A later
  release used as forward-alias proof receives the same metadata, wrapper,
  source, asset-byte/uploader, provenance, and signature validation as the
  current release. The remote annotated-tag direct object ID and peeled commit
  are both bound through stable readback, closing same-commit tag-object
  replacement. Release documentation no longer claims that current Git/ref
  readback reconstructs historical Publisher App pusher attribution: it proves
  the current App token/installation before mutation and the signed Git object,
  ref, and Release state afterward. GPG signer identity remains independently
  verified.
- Canary cleanup no longer uses `gh pr close --delete-branch`. It first closes
  without deletion, verifies closed-unmerged state plus the exact head
  repository/ref/OID, and deletes only the still-exact remote ref with an
  exact-OID lease. Mismatch or transport uncertainty preserves the branch and
  reports recovery. The documented, previously adopted no-`edited` boundary is
  unchanged: base retarget refresh remains draft-to-ready/manual and direct
  human UI merge remains outside the stable-v2 agent merge contract.
- Focused final remediation evidence passed: runtime 83/83, bootstrap 100/100,
  workflow-security contract 39/39, release provenance 46/46, and release
  pipeline 50/50. `npm run check`, Node syntax checks, `bash -n`, ShellCheck,
  actionlint, owned-file `git diff --check`, documentation shell snippets, and
  project-specific independent read-only audits also passed. These are focused
  integration checkpoints. The root then reran the four principal integrated
  files from the combined working tree (83/83, 100/100, 39/39, and 46/46) and
  ran `npm test -- --test-reporter=dot --test-concurrency=1`; the serialized
  whole suite passed 779/779 with exit code zero. Serial execution is retained
  as the final gate because the repository and GitHub-state fixtures must not
  create cross-file contention. The new exact-head acceptance result is
  recorded only after this combined tree is signed and frozen.

### Exact-Head Acceptance Review Round Two And Race Closure

- The second formal whole-range lane reviewed the exact signed checkpoint
  `10217253306ca2ee6f312f766a331f8924e26e47..acedef36333a913779e83fdd6031e8d2106b6b2e`
  at tree `98f8aa4321ff5a36c47fd27a1f273ad9905ecc2d`. The lane used a
  fresh `git clone --no-local`, detached the exact head, verified a clean
  worktree and the 20-commit DAG, and ran an ordinary general agent with
  `gpt-5.6-sol` / `ultra`. It made no local or GitHub mutation. The checkpoint
  had a Good GPG signature from
  `EFBBC913F49A5F6E0AF0D248F70246143DC28F32`.
- That lane retained two P1 fail-closed defects, so the checkpoint was not
  pushed. First, an exact, unedited `@codex review` from a user lacking write
  permission was discarded entirely. Its later unbound terminal clean could
  therefore be assigned to an earlier authorised generation and pass before
  that earlier request emitted a finding. The reducer now retains every exact,
  unedited request as a lineage and liveness boundary while allowing only
  authorised requests to grant positive authority. A denied boundary prevents
  later unbound clean and any earlier direct `+1` from passing. At this
  checkpoint, a new direct `+1` after the boundary was expected to recover; the
  later third frozen-head review proved that expectation unsafe because the
  denied predecessor remains unbound. That intermediate recovery claim is
  superseded by the replacement-PR rule below. The denied request still causes
  no exact-refetch or reaction fan-out after its permission classification.
- Second, Active ruleset activation performed its final approved legacy digest
  before the final canary and complete consumer-security closure. Concurrent
  removal of the last legacy requirement during those reads could therefore
  leave both gates absent until the later v2 PUT, while the post-write digest
  could only report the already-created gap. The final write sequence is now
  `final canary -> complete consumer-security closure -> approved legacy
  digest -> authoritative target GET/fingerprint -> PUT Active`. A new
  interleaving fixture makes the legacy inventory disappear on that final
  read, requires the named write-boundary mismatch, and proves zero v2 or
  legacy PUTs. This is the tightest best-effort boundary available because the
  GitHub ruleset API exposes neither a transaction nor an `If-Match` update
  contract.
- Post-fix focused integration passed runtime 84/84, bootstrap 101/101, and
  workflow-security contract 39/39. `npm run check`, owned-file
  `git diff --check`, and project-journal validation also passed. The root then
  ran `npm test -- --test-reporter=dot --test-concurrency=1`; the final combined
  implementation tree passed 781/781 with exit code zero. This evidence covers
  the code and documentation snapshot immediately before this evidence-only
  journal append; the append is revalidated by the journal, syntax, diff, and
  new exact-head review gates rather than rerunning the approximately
  20-minute release simulation solely for its own recorded result.
- The resulting signed checkpoint is
  `37690cbadfdf52a8412ac5af42dd07a294631fe5` at tree
  `13de9d7a420c989ef58cd4548f1b7e9d9434efa8`. `git verify-commit`
  accepted its ED25519 signature from
  `EFBBC913F49A5F6E0AF0D248F70246143DC28F32`, and the worktree was clean.
  A third fresh no-local, ordinary `gpt-5.6-sol` / `ultra` whole-range review
  of
  `10217253306ca2ee6f312f766a331f8924e26e47..37690cbadfdf52a8412ac5af42dd07a294631fe5`
  explicitly rechecked both round-two P1 closures plus the earlier remediation
  set and returned no findings. This evidence-only append changes no
  implementation bytes; its final signed landing head still receives a fresh
  exact-head read-only confirmation before push.

### Follow-Up Migration Witness Review And Resolution

- A fresh ordinary-agent pre-review retained four defects in the first overlap
  remediation. Two were P1 security-contract defects: each bootstrap process
  chose a fresh legacy baseline, so stage and activation could approve
  different inventories, and the classic witness reduced a check to its
  context while discarding `app_id`. A third defect treated incomplete
  ruleset API objects as if no legacy policy existed. The fourth was the
  release-runner defect recorded above: `ubuntu-slim` has a platform hard limit
  of 15 minutes, so a declared 30-minute candidate timeout was ineffective.
- The adopted remediation is the external canonical digest, strict full-object
  validation, preserved classic producer binding, read-only post-cleanup proof,
  and standard-Ubuntu candidate runners described in this section. No atomic
  multi-object compare-and-swap exists in GitHub's ruleset and branch-
  protection APIs. Bootstrap therefore combines exact full-object readbacks,
  repeated digest checks around the target-ruleset lost-update check, and a
  post-write digest/readback. A detected pre-write drift prevents mutation; a
  detected post-write drift refuses to claim completion and requires an owner
  to inspect the independently concurrent change. The v2 write itself never
  removes a retained legacy surface.

### Verified Two-Workflow Platform Boundaries And Resolution

- Required-CheckRun source selection is not workflow provenance. GitHub's
  ruleset schema binds a required check to `context` plus `integration_id`;
  `15368` identifies the GitHub Actions App as a whole, not a workflow ID,
  workflow path, event, ref, or step graph. A `pull_request` run evaluates the
  PR merge commit's workflow definition, and required-check matching uses the
  job name. A PR can therefore propose a same-name replacement producer; an
  additional duplicate name may instead make the required check ambiguous and
  block. Sources: [rules schema](https://docs.github.com/en/rest/orgs/rules),
  [required-check troubleshooting](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules#troubleshooting-required-status-checks),
  [pull-request event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request),
  and [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- Joey adopted the repository-level no-runtime-App design on 2026-08-27. It
  provides a compound merge-safety boundary, not machine-verifiable workflow
  provenance: exact-byte verification of both canonical default-branch
  workflows; fail-closed inventory rejection of noncanonical reserved-name
  producers and relevant write authority; CODEOWNERS coverage of
  `/.github/workflows/` and `/.github/CODEOWNERS`; required Code Owner review;
  stale-approval dismissal; strict up-to-date policy; no bypass; and
  canonical-run/no-collision canary readback. The ordinary required-approval
  count remains zero, so a business-code PR that does not modify an owned
  control-plane path needs no human approval. A control-plane-changing PR may
  display a misleading same-name success, but the independent Code Owner rule
  prevents that change from merging without explicit authorization.
  - Explicit reason: protect the gate against a PR modifying `.github` control
    files to forge a pass without imposing human review on every ordinary PR.
  - The installer must not silently broaden approval policy. If Code Owner
    review is not already required and an existing CODEOWNERS file contains any
    effective non-managed owner pattern, activation stops with an explicit
    policy-expansion decision instead of making those existing paths newly
    approval-gated. Existing already-enforced owner policy is preserved.
  - The public contract must not describe `integration_id: 15368` as
    single-producer proof. It is the GitHub-owned GitHub Actions App that
    produces native workflow CheckRuns, including the verifier CheckRun on the
    PR feature-head SHA; it is neither the removed commit-status projection nor
    the private Publisher App. The verifier's separate merge-ref checks provide
    the current test-merge execution binding.
- An organization/enterprise required-workflow ruleset is the strongest native
  no-runtime-App alternative because it can bind a source repository, path,
  ref, and SHA. It requires an eligible organization plan and owner-level
  installation, excludes personal-repository-only deployment, and changes the
  adopted event and floating-version assumptions. A push-ruleset path freeze is
  another organization-level hardening option but adds narrow-bypass and
  control-plane-update friction. Neither is a stable-v2 installation
  prerequisite; they remain optional future hardening profiles.
- Native rerun provides an observable attempt boundary but no event-to-attempt
  transaction. A successful full-rerun request returns only `201 Created` and
  accepts no operation inputs; `GITHUB_RUN_ID` remains stable while
  `run_attempt` increments, and the controller can query the exact attempt's
  jobs and CheckRuns. GitHub documents no idempotency key, duplicate-POST
  suppression, read-after-write deadline, or comment/manual-event binding.
  Sources: [workflow-run rerun](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow),
  [GitHub context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context),
  and [attempt jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt).
- The minimum ledgerless handshake is therefore: refetch the exact current
  verifier run; record baseline attempt `A`; issue one rerun request; require a
  later attempt plus its unique canonical job/CheckRun to become observable;
  and never blindly repeat an ambiguous POST. This does not atomically revoke
  an older success between a new provider event and the new CheckRun becoming
  visible. Eliminating command-to-attempt ambiguity requires a separate
  authenticated append-only command marker and verifier receipt, which would
  make that marker an authority/ledger and supersede the adopted best-effort
  sticky-comment boundary.
- Joey adopted the ledgerless handshake on 2026-08-27. Controller inputs such
  as PR number, expected head, operation, and optional comment hint provide
  validation and early-stop information only; they are not verifier authority
  and cannot replace the complete GitHub evidence scan. The create-once
  canonical sticky remains best-effort diagnostics and recovery guidance only:
  it is never patched or replaced while a canonical candidate exists, and only
  an exact, unedited, official instance is exempt from physical request lineage.
  - For automatic admission, the controller must exactly refetch and validate
    the admitted provider event before requesting a rerun. For manual
    reconcile, the exact current PR/head contract is mandatory while any event
    or comment hint remains optional acceleration.
  - For `begin-review`, the controller creates or safely adopts the canonical
    hidden-marker `@codex review` request, reads that exact request back, and
    only then requests the full verifier rerun. Direct agent-authored
    `@codex review` remains the lower-minutes default when no controller pending
    transition is needed.
  - The controller records baseline attempt `A`, establishes that no competing
    canonical attempt is queued or running, issues one rerun request, and
    requires exact attempt `A+1` plus its unique canonical job/CheckRun. A jump
    beyond `A+1`, duplicate/conflicting attempt, unreadable response, or timeout
    is inconclusive. The same operation never blindly repeats an ambiguous
    POST; a later reconcile refetches the settled attempt inventory, adopts a
    new baseline, and requests a fresh attempt if necessary.
  - Native rerun carries no manual operation inputs. The verifier therefore
    takes its soft-limit profile from protected repository configuration;
    temporary per-dispatch numeric or profile overrides remain deferred.
  - An authenticated append-only command/receipt ledger is not adopted.
- A controller-only merge path cannot be built from the repository's ordinary
  `GITHUB_TOKEN` under the current no-dedicated-App boundary. GitHub rulesets do
  allow GitHub Apps as bypass actors, and `Restrict updates` applies to PR
  merges, but the GitHub-owned Actions App is not selectable as a bypass actor
  in the current GitHub.com ruleset UI. Read-only checks on both
  `JoeyTeng/codex-review-gate-action` and
  `Joey-Tools/codex-review-gate` returned no GitHub Actions candidate. GitHub
  does not document support for registering App ID `15368` through the API, so
  an undocumented write is not an installation contract. Even if it became
  selectable later, bypass would bind the shared App integration rather than a
  canonical workflow and would therefore grant the same bypass identity to any
  sufficiently privileged repository workflow. Sources:
  [ruleset bypass](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository#granting-bypass-permissions-for-your-branch-or-tag-ruleset),
  [`GITHUB_TOKEN` identity](https://docs.github.com/en/actions/concepts/security/github_token),
  and [rules REST schema](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset).
- Merge queue and organization required workflows are not substitutes for the
  missing event transaction. They add merge/test freshness or workflow-source
  provenance, but an arbitrary later Codex comment or review does not
  atomically create a new pending required check. They also exclude the adopted
  personal-repository baseline or change its event, cost, and installation
  assumptions. Therefore the next product decision must choose between a
  documented eventual-reconciliation/merge-procedure boundary, reopening a
  dedicated merge identity and materially broader infrastructure, or deferring
  stable v2 if a zero-window server-side guarantee is non-negotiable.
- Joey adopted the documented eventual-reconciliation boundary on 2026-08-27.
  Stable v2 does not claim that GitHub atomically revokes an older same-SHA
  success when arbitrary later provider evidence arrives. Automatic controller
  admission is a wake-up mechanism, not independent decision authority. The
  supported agent merge path must request an exact-current verifier refresh,
  observe the strictly newer attempt and its unique canonical job/CheckRun,
  require the complete stable reducer result to be `healthy/success`, reread
  current PR scope and ruleset state, and merge immediately with exact-head
  compare-and-swap. A direct human UI merge that skips this closure is outside
  the stable-v2 safety contract. Dedicated runtime/merge identity and stable-v2
  deferral are not adopted for this node.

## Delayed Release Review And Final Mutation Fences

- A delayed late-review result arrived after RC release-intent PR #35 had been
  opened and exposed two P1 publication-boundary findings. PR #35 was converted
  back to Draft so the infrastructure fixes land first. No RC tag, target
  update, GitHub Release, asset, or floating alias was published from #35.
- The first adopted correction treats the current signer inventory as live
  access-policy and content evidence: it binds the pinned primary fingerprint,
  pinned signing-subkey fingerprint, and exact raw public certificate, but not
  a GitHub GPG-key REST object ID. Every durable mutation fence must revalidate
  that live tuple, especially immutable Release publication. An existing
  GitHub persistent verification result cannot replace current-inventory
  proof.
  - Explicit reason: historical signature verification and current signer
    authorization are different protected properties.
- The second adopted correction requires every governing source, ruleset,
  immutable-Release, and current-signer policy read to complete before the
  final exact draft-Release/asset/tag boundary. The publisher then uses the
  frozen Release ID with a direct REST `PATCH` carrying exact metadata; it must
  not use `gh release edit`, whose convenience implementation may insert a
  hidden read after that boundary.
  - Explicit reason: the final object snapshot must be the last read boundary
    before publication rather than being invalidated by an implicit helper
    lookup.
- The landed fence shape distinguishes ordinary mutations from the two
  critical irreversible Release/alias boundaries. Every durable mutation
  revalidates source, rulesets, and the current signer immediately around the
  mutation. The stronger ordered sequence—governing policy reads followed by
  the final exact object boundary—is specific to immutable Release publication
  and major-alias mutation. Immutable-Release policy is cached after the
  first-mutation check for ordinary work, but that cached result is explicitly
  insufficient at either critical fence; each performs a fresh policy read.
- Alias mutation now follows one exact order: lease-protected alias binding
  raw-first A/B double-read; final source/ruleset/current-signer policy fence;
  explicit immutable-Release-policy re-read; fresh exact immutable
  Release/asset/full-tag boundary; alias push; and exact post-alias binding plus
  Release-boundary readback. This prevents an early policy observation from
  being represented as proof of the policy at the later alias mutation.
- Both Release and alias boundaries are raw-first A/B: they first capture and
  neutrally canonicalize both raw observations, compare A with B, and only then
  apply structural and expected-policy validation. An unreadable command or
  canonical projection is `inconclusive` / `remote-read-inconclusive`; A/B
  drift is `inconclusive` / `remote-state-changed`; and a stable malformed,
  lightweight, wrong-frozen, or wrong-planned Release state is
  `blocked_conflict` / `immutable-release-mismatch`.
  - Explicit reason: validating one observation before the raw A/B comparison
    can disguise a stable wrong state as a transient read failure.
- For alias post-write specifically, raw A different from raw B is
  `inconclusive` / `remote-state-changed`. Stable A equal to B but not an
  annotated tag with the exact planned direct object and peeled commit is
  `blocked_conflict` / `malformed-major-alias-target`.
- The first formal exact-head review reported two P2 findings, and both are
  fixed on the current working tree.
  - The first correction changed fresh-create expected absence to the then-
    understood raw-first point-presence sequence: presence A, raw tag A,
    presence B, raw tag B; compare both pairs; only after stable absence
    validate tag policy. Remote unreadability is
    `inconclusive` / `remote-read-inconclusive`; A/B drift or stable presence is
    `inconclusive` / `remote-state-changed`; and a stable-absence malformed,
    lightweight, or wrong tag is `blocked_conflict` /
    `immutable-release-mismatch`.
    - Explicit reason: the fresh path must not be an exception that lets an
      early validator disguise stable wrong state as transient read failure.
      The later draft-aware correction below supersedes point presence with the
      complete paginated inventory because release-by-tag cannot see drafts.
  - An explicit `--test-enforce-live-signer-policy` production-shaped seam is
    gated by both `CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY=1` and
    `NODE_ENV=test`, accepted only for `--publish`, and rejected with the
    filesystem `--test-release-dir` path. Production never skips the signer
    fence. The enabled seam executes the real GitHub inventory validator and
    byte-compares the exported raw certificate with the approved certificate.
    Dynamic coverage includes the valid path reaching publication `PATCH` and
    alias mutation, live-inventory API outage at publication and alias fences,
    revoked inventory, and raw-certificate replacement; each failure is
    fail-closed before its protected write.
    - Explicit reason: the production signer fence needed dynamic evidence of
      the real validator and certificate-content comparison without creating a
      signer-policy bypass that production could activate.
- GitHub's official Release REST endpoint has no supported conditional
  compare-and-swap precondition for the publish `PATCH`. The resulting small
  GET-to-PATCH concurrent-asset window cannot be removed by this client.
  Workflow concurrency serializes publisher runs, the private Publisher App is
  the only automated Release writer, and `JoeyTeng` is the explicitly trusted
  manual writer. Any other concurrent Release writer violates the deployment
  contract. A post-publication mismatch blocks the release and must not be
  represented as automatically recoverable.
- A nonzero direct publication `PATCH`, missing response, or malformed response
  is `inconclusive` / `release-publication-unknown`: the request may have
  applied. Recovery reconciles the same exact source and proves either that the
  frozen draft is unchanged or that the exact Release is already immutable; it
  does not blindly advance to another version. A deterministic post-readback
  mismatch remains blocked.
- A live production preflight against GitHub REST API `2026-03-10` exposed an
  additional release blocker before any mutation. The immutable-Release policy
  response was `{"enabled":true,"enforced_by_owner":false}`. The publisher's
  exact-key equality against only `enabled` rejected that valid enabled policy;
  the blocker was the brittle response-shape check, not a disabled policy.
  The correction validates both documented fields as booleans, requires
  `enabled=true`, permits `enforced_by_owner=false`, and tolerates additive
  response fields. Unreadable, non-object, missing/wrong-typed, or disabled
  policy evidence still fails closed.
  - Explicit reason: a valid enabled policy must not be rejected merely because
    GitHub returns another documented field, while unreadable or malformed
    policy evidence must never authorize a publication mutation.
  - Follow-up reviewer evidence refined the endpoint status contract from the
    official GitHub REST `2026-03-10` documentation: `200` is returned only
    when immutable Releases are enabled, while disabled state returns `404`.
    The correction classifies that `404` as `blocked_conflict` /
    `immutable-release-policy-disabled`, classifies every other API failure as
    `inconclusive` / `immutable-release-policy-unreadable`, and still validates
    the schema of a successful `200` body.
- The same live production preflight confirmed a second P1 on the fresh
  Release path. That path parsed `gh release view` stderr for `HTTP 404`, but
  `gh` 2.88.1 actually emits `release not found` when the Release does not
  exist. A valid first-release absence was therefore misclassified as
  `inconclusive` / `remote-read-inconclusive`, blocking every initial publish
  attempt in that runtime.
  - Intermediate remediation replaced porcelain stderr with the REST
    release-by-tag status classifier, and fixtures kept REST status semantics
    distinct from `gh` porcelain text. The later draft-aware review proved that
    even a real release-by-tag `404` is not complete absence evidence because a
    draft can exist; the complete inventory correction below supersedes that
    intermediate classifier for publisher absence.
  - Explicit reason: porcelain stderr is not a stable carrier for REST status,
    so absence authority must come from the API classifier rather than a
    version-specific CLI message.
- A follow-up review also corrected an overbroad release-document statement:
  ordinary mutation fences revalidate source, rulesets, and the current signer
  immediately around the mutation, while only immutable Release publication
  and major-alias mutation enforce governing policy reads before their final
  exact object boundary. No broader ordering is claimed for ordinary writes.
- Two further reviewer-reported P2 fixes, stable-schema-invalid A/B and the
  tag-pipeline path, were addressed in the correction set. Dynamic coverage was
  also added for a direct publication `PATCH` that
  exits zero but returns an empty, malformed, or wrong-Release-ID response. The
  expected result remains `inconclusive` / `release-publication-unknown`, the
  floating alias remains unmoved, and recovery reconciles the same exact source
  rather than advancing publication blindly.
- The first complete serialized suite attempt after these production-focused
  changes exited `1` with 9 failures; it was not a passing run. One failure was
  a real public-verification defect in the same error-semantics class as fresh
  publication: it still expected `HTTP 404` in `gh release view` porcelain
  stderr, while `gh` 2.88.1 reports `release not found`. The other eight were
  stale absence-marker fixture failures whose markers still depended on the
  removed porcelain Release-view path.
  - Remediation moves public-verification Release-view metadata to the direct
    REST `2026-03-10` release-by-tag projection with documented HTTP 404
    classification, and moves the eight fixture markers to the authoritative
    REST absence boundary. The independently rerun affected set then passed
    9/9, and the separate CLI/API missing-Release diagnostic passed 1/1.
- Final validation on the corrected tree then ran
  `npm test -- --test-reporter=dot --test-concurrency=1`. The second complete
  serialized command exited `0`, and its dot-only output was counted exactly as
  815/815. The earlier 807/807 checkpoint remains historical evidence from the
  then-frozen tree and predates the live-production corrections above.
- Current fast gates also passed: `bash -n`, ShellCheck, `npm run check`, the
  workflow-security contract 39/39, `git diff --check`, and project-journal
  validation. The new signed landing checkpoint and fresh formal exact-head
  review remain pending; this ledger does not yet claim a commit or review.
  Publication therefore remains paused, and PR #35 must not leave Draft yet.

### Draft-aware Release identity correction

- A later exact-head review found a further P1 in the GitHub Release object
  lookup contract: `GET /releases/tags/{tag}` is a published-Release lookup and
  cannot establish either draft presence or draft absence. The publisher still
  used that endpoint for initial/prewrite state and draft mutation boundaries,
  so an existing draft could look absent and a fresh draft could become
  unreadable immediately after creation.
- Official implementation evidence confirms the required split. GitHub CLI's
  `FetchRelease` independently looks up a published Release by tag and draft
  candidates, obtains the selected draft's database ID, and then reads
  `/releases/{id}`. GitHub's complete Release-list contract exposes drafts to a
  caller with push access; the dedicated Publisher App has that access. Public
  verification may continue to use the published-only release-by-tag endpoint.
- The protected property is now explicit: one exact tag maps to exactly one
  positive safe numeric Release ID, and every mutable/draft observation remains
  bound to that frozen object identity. The publisher now:
  - reads the complete `per_page=100`, `--paginate --slurp` inventory with the
    REST `2026-03-10` header;
  - requires an outer page array with at least one page (`[[]]` is valid empty
    state), page arrays, safe positive IDs, global ID uniqueness, and at most
    one exact-tag match;
  - treats outer `[]`, malformed pages, unsafe or repeated IDs, pagination
    failure, and normalization failure as `inconclusive` /
    `remote-read-inconclusive` because absence was not proved;
  - treats one exact tag claimed by distinct unique IDs as
    `blocked_conflict` / `duplicate-release-tag`;
  - proves fresh absence through two complete inventory plus full-tag raw A/B
    snapshots, then discovers a newly created draft through another two
    complete inventory plus full-tag raw A/B snapshots before freezing its ID;
  - obtains an existing draft or published Release ID from the complete
    inventory and never rebinds within that publisher invocation; a later run
    has no persisted ID ledger and performs a new full inventory selection;
    and
  - reads every later Release boundary through `/releases/{frozen_id}` twice,
    requires each response `.id` to equal the path/frozen ID, and treats `404`
    or unreadability as inconclusive rather than selecting another object or
    creating a replacement.
- The same review reported a P3 API-version drift: public Release-view REST
  reads did not explicitly send `X-GitHub-Api-Version: 2026-03-10`. The public
  raw/view/list calls and publisher inventory/ID calls now send that version,
  and fake GitHub rejects an omitted header. This preserves the access-policy
  and response-contract boundary instead of inheriting the CLI default.
- Fake GitHub now models the real distinction: a draft is visible in the
  complete list and by numeric ID while release-by-tag returns REST `404` until
  publication. Draft boundary mutation/unreadable/schema hooks moved to the
  by-ID path.
- Validation actually run on this correction so far:
  - `bash -n scripts/release-action-subtree.sh`,
    `node --check test/v2-release-pipeline.test.mjs`, and `git diff --check`
    passed after the core migration;
  - the existing focused boundary/PATCH group first ran 20 tests with 14 pass
    and 6 expected migration regressions: four missing REST-version headers on
    post-publish by-tag reads and two stale trace assertions still observing
    `release-tag-read`; after correcting those, the six affected tests passed
    6/6;
  - the publisher static contract passed 1/1 after changing the absence
    contract from point presence to complete inventory; and
  - the first command covering seven new dynamic cases passed 6/7; its sole
    failure was an unsaved fake inventory-read counter, not publisher behavior.
    After saving that observation counter, the affected fresh-creation case
    passed 1/1. The covered behaviors are fresh creation and frozen-ID
    boundaries, exact-source recovery of a draft found on the second page
    without a second create, outer `[]`, repeated ID, same exact tag with
    distinct IDs, and post-create ID/presence A/B drift;
  - public release disappearance plus the API/porcelain diagnostic distinction
    passed 2/2 with the explicit public REST version header; and
  - frozen-ID `404` and stable wrong-body-ID cases passed 2/2, proving that the
    publisher neither rebinds nor creates a second draft when the selected ID
    endpoint disappears or returns a different object identity; and
  - the existing nonzero direct-`PATCH` unknown-result recovery cases passed
    2/2 after the draft-aware migration, including response loss after apply;
    exact-source reconcile proved the frozen object without a second publish
    mutation; and
  - the final fast gate passed `bash -n`, ShellCheck, `node --check`,
    `git diff --check`, `npm run check`, and project-journal validation.
- The complete serialized suite, signed checkpoint, and fresh exact-head review
  are still pending and are not claimed by this entry.

### Frozen-ID asset upload and public-inventory follow-up

- The parent lane's first complete serialized baseline after the draft-aware
  correction ran 824 tests: 820 passed and 4 failed. No other failures were
  observed. The four failures were stale test expectations rather than runtime
  regressions: stable and RC direct-PATCH cases still expected two
  `release-tag-read` traces before publication, the post-publication
  same-name-asset replacement case still searched for by-tag reads, and the
  alias-policy drift case did the same. All four boundaries had intentionally
  migrated to `release-id-read`.
- A follow-up review retained one P1, one P2, and one P3:
  - P1: asset upload still used `gh release upload <tag>`, which could resolve
    a different Release after the publisher had frozen a numeric ID. Asset
    upload now posts raw bytes directly to the numeric-ID
    `uploads.github.com/repos/{owner}/{repo}/releases/{frozen_id}/assets`
    endpoint with explicit Accept, `application/octet-stream`, and REST
    `2026-03-10` headers. It accepts only a positive safe returned asset ID,
    exact name, `uploaded` state, and nonempty identity URLs; the next by-ID
    boundary must contain that exact asset ID. Nonzero, empty, malformed, or
    identity-mismatched responses are `inconclusive` /
    `release-asset-upload-unknown` because the bytes may already have been
    written. Within that invocation recovery keeps the frozen Release ID. A
    later exact-source retry performs a new full reconcile and freezes the
    then-unique exact-tag object; cross-run object replacement is prohibited by
    the trusted-owner boundary rather than detected by a persisted ID ledger.
  - P2: initial/final public complete inventories did not yet enforce the
    publisher's page and object-identity schema. Both paths now share the same
    validator: the outer array has at least one page (`[[]]` is valid empty),
    every page is an array, every Release ID is a positive safe integer, and
    IDs are globally unique. Outer `[]`, malformed pages, unsafe IDs, and
    repeated IDs remain incomplete evidence and produce `inconclusive` /
    `remote-read-inconclusive`.
  - P3: historical completed-Release by-tag reads inherited the GitHub CLI API
    version. They now explicitly send `X-GitHub-Api-Version: 2026-03-10`, as do
    the existing public and publisher Release reads.
- Fake GitHub now rejects tag-resolving asset uploads, accepts only the absolute
  frozen-ID upload route with the exact method/headers/input, and models tag
  resolution replacement independently from the frozen object. It also models
  upload failure before apply, response loss after apply, zero-exit empty or
  malformed responses, and structurally inconclusive public inventories.
- Validation actually run for this follow-up so far:
  - the four stale serialized-baseline failures passed 4/4 after their trace
    expectations moved to `release-id-read`;
  - seven new dynamic cases passed 7/7: frozen-ID upload under tag-resolution
    replacement, five unknown upload outcomes, and public outer-`[]`/duplicate-
    ID inventory rejection (the last test covers both public shapes);
  - the focused staged-ABI/publisher static contract passed 1/1; and
  - `bash -n scripts/release-action-subtree.sh`,
    `shellcheck scripts/release-action-subtree.sh`,
    `node --check test/v2-release-pipeline.test.mjs`, `git diff --check`,
    `npm run check`, and the project-journal validator passed after the
    implementation, tests, and documentation update.
- A second complete serialized suite is not claimed here; the parent lane owns
  that final rerun after the shared correction is complete.

### Asset-ID byte readback and per-attempt identity scope

- A third review retained one residual P2: after the upload POST returned an
  asset ID, the publisher still ran `gh release download <tag>` before its
  frozen by-ID boundary. That porcelain command could resolve a replacement
  Release and read bytes from the wrong object. The fake tag-replacement case
  did not previously change `gh release download`, so it could not expose the
  defect.
- The mutation/readback order is now exact: direct POST to the frozen Release
  ID, validate the returned asset identity, capture and validate the frozen
  by-ID Release boundary, require that boundary to contain the returned asset
  ID, then raw-GET `/releases/assets/{asset_id}` with binary Accept and REST
  `2026-03-10` headers and compare bytes. Any asset-ID GET failure or byte
  mismatch after mutation is `inconclusive` /
  `release-asset-upload-unknown`; the post-upload path no longer uses a
  tag-resolving download.
- The identity scope is intentionally limited to one publisher invocation.
  There is no persisted Release-ID ledger. A later exact-source retry performs
  a new full reconcile, selects the then-unique exact-tag object from the
  complete inventory, and freezes that ID for the new invocation. The
  trusted-owner contract forbids deletion or replacement between attempts; the
  publisher does not claim to detect historical ID replacement or preserve
  cross-run ID continuity.
- Fake GitHub now supports raw asset-ID downloads, requires their binary Accept
  and REST-version headers, records the asset ID and owning frozen Release ID,
  and makes tag-based download resolve the replacement object while an upload
  readback is pending. This would fail the removed tag-download implementation
  while allowing later published-Release validation to exercise its separate
  existing path.
- Focused validation so far:
  - the first combined run passed the response-lost exact-source retry but
    failed the tag-replacement case after the new fake also redirected a later,
    unrelated alias-admission download; the fake was narrowed to the pending
    post-upload readback interval;
  - the next tag-replacement run completed the publication but its assertion
    incorrectly prohibited every later tag download rather than only the
    upload-to-asset-ID-read interval; the assertion was narrowed to each exact
    interval; and
  - the corrected tag-replacement case then passed 1/1. The response-lost case
    had already passed 1/1 and proved that the next exact-source full reconcile
    selected the same still-existing remote object, adopted the already-written
    first asset without a second upload, uploaded only the two missing assets,
    and completed publication; and
  - the final affected group passed 4/4: the corrected tag-replacement case,
    response-lost exact-source recovery, asset-ID GET failure, and asset-ID byte
    mismatch. Both readback failures produced
    `release-asset-upload-unknown` after the durable upload;
  - the first static-contract run failed because its new regex expected the
    asset endpoint text before the Accept header even though the implemented
    command correctly placed the header first. Correcting only that assertion
    made the focused static contract pass 1/1; and
  - final fast gates passed `bash -n`, ShellCheck,
    `node --check test/v2-release-pipeline.test.mjs`, `git diff --check`, and
    `npm run check`.
- No complete serialized suite is claimed for this follow-up.

### Final frozen-identity validation checkpoint

- The complete serialized suite was rerun on the final implementation with
  `npm test -- --test-reporter=dot --test-concurrency=1` and completed with
  exit status 0: all 833 tests passed. This supersedes the earlier explicit
  "not yet claimed" checkpoints without erasing their intermediate failure and
  correction evidence.
- The final fast gates remained green: `bash -n`, ShellCheck,
  `node --check test/v2-release-pipeline.test.mjs`, `git diff --check`,
  `npm run check`, and the project-journal validator. The journal-only final
  evidence update is revalidated separately before landing.
- Two independent targeted read-only audits of the final shared tree reported
  no findings: one covered the publisher script and one covered its tests and
  release documentation. These targeted audits are supporting evidence only;
  the required fresh full-range exact-head review still runs after the final
  signed landing commit freezes the complete `origin/master..HEAD` range.

### Neutral Release snapshots and empty-starter recovery

- A fresh full-range review found two fail-closed defects after the 833-test
  checkpoint above. First, exact Release boundaries compared full API JSON, so
  observational `assets[].download_count` churn or semantically irrelevant
  Release/page/asset ordering could produce false `remote-state-changed`.
  Second, GitHub's documented upload-`502` empty `starter` asset could make a
  later exact-source retry fail inventory normalization before it froze the
  unique draft Release ID.
- Release inventory and by-ID A/B reads now use one structurally validated
  neutral projection. It preserves the protected properties: Release and asset
  numeric/node identities, tag/name/body/target and lifecycle fields,
  author/uploader identity, and asset state/content type/size/digest/identity
  URLs. It rejects duplicate asset names or IDs, including
  asset-ID duplication across the complete inventory; it canonicalizes
  Release/page and asset order and excludes observational counters such as
  `download_count`, timestamps, and additive decoration. Expected-policy
  validation remains after A/B equality, so
  stable invalid protected values are not normalized into success and an
  actual body change still produces `remote-state-changed`.
- Starter state is structurally projectable but never treated as completed.
  Automatic cleanup accepts only one empty Publisher-App starter on the
  selected mutable draft, with the exact planned content type/name and the
  next canonical slot after a byte-verified uploaded prefix. The final policy
  fence is followed immediately by a fresh stable frozen-ID A/B boundary that
  must equal the selected boundary. The publisher then issues at most one
  DELETE for that frozen asset ID and reconciles every result through another
  stable frozen-ID boundary. It proceeds only if precisely that asset ID is
  absent and all other protected state is unchanged; otherwise recovery is
  `inconclusive` / `starter-asset-deletion-unknown`. Existing uploaded prefix
  bytes are read through frozen asset IDs rather than tag resolution.
- The DELETE API has no state-predicate compare-and-swap. The remaining
  GET-to-DELETE race is explicitly bounded by the trusted-owner/single-writer
  deployment contract and GitHub's documented terminal empty-starter shape;
  the implementation does not claim a client-side CAS guarantee.
- Focused validation actually run for this remediation so far:
  - `bash -n scripts/release-action-subtree.sh` passed;
  - `node --check scripts/generate-action-release-provenance.mjs` and
    `node --check test/v2-release-pipeline.test.mjs` passed;
  - the existing fresh draft-inventory publication case passed 1/1;
  - seven starter/identity cases passed 7/7: normal deletion and completed-run
    idempotence, response-loss-after-apply, `404`-after-apply,
    failure-before-apply, starter-state pre-delete drift, unrelated protected
    pre-delete drift, and duplicate asset IDs;
  - four stable starter mismatches passed 4/4 and proved wrong name, nonzero
    size, wrong content type, and wrong uploader are blocked without DELETE;
  - three observational/order cases plus the protected body-drift control
    passed 4/4; and
  - a later timestamp-churn regression initially passed the neutral A/B read
    but failed 3/4 in the group because the policy-validated boundary returned
    timestamps to the caller and the upload delta comparison still observed
    them. The boundary now validates those fields but omits them from its
    decision projection; the corrected timestamp case passed 1/1;
  - the raw-first classification control passed 3/3 after splitting neutral
    comparison from policy interpretation: stable schema-invalid remains
    `blocked_conflict`, valid-to-invalid remains `remote-state-changed`, and a
    protected body drift remains `remote-state-changed`;
  - the focused workflow/publisher static contract passed 1/1 after moving its
    boundary assertion from raw full-JSON sorting to the neutral projector;
  - after the final edits, ShellCheck, both Node syntax checks,
    `git diff --check`, `npm run check`, and the project-journal validator all
    passed. The normal starter recovery and duplicate-ID cases were also rerun
    2/2 after the neutral comparison was separated from strict policy checks;
    and
  - the response-lost exact-source retry passed again after both prewrite and
    reconcile prefix adoption moved to frozen asset-ID raw GET. Its dynamic
    assertion proves no tag-resolving draft download occurs; and
  - parent-lane review removed a false compare-and-swap guarantee from the fake
    DELETE endpoint: the fake now models GitHub's unconditional asset deletion,
    so production preconditions alone must prevent a dangerous request. Three
    added dynamic controls passed 3/3 and proved a planned but non-next-slot
    starter, a non-null starter digest, and multiple starters all block before
    DELETE. The strict inventory fingerprint now validates timestamps but omits
    them from its decision projection; the focused fingerprint unit passed 1/1.
    `npm run check`, ShellCheck, both publisher Node syntax checks, the added
    provenance-test syntax check, `git diff --check`, and project-journal
    validation also passed after these parent-lane corrections.
- No complete serialized suite is claimed for this post-checkpoint remediation;
  the parent lane owns that rerun after the shared tree is frozen again.

### Final post-remediation serialized suite

- The parent lane reran the complete suite on the final shared tree with
  `npm test -- --test-reporter=dot --test-concurrency=1`. It completed with
  exit status 0 and all 851 tests passed. The count is the prior 833-test
  checkpoint plus 15 worker-authored neutral/starter regressions and three
  parent-lane fake-API and mismatch controls.
- The same final tree also passed `bash -n`, ShellCheck, `npm run check`, Node
  syntax checks for the publisher generator and both changed test files,
  `git diff --check`, and project-journal validation. The journal-only final
  evidence append is revalidated before the next signed landing commit.
- Because the earlier fresh full-range review produced the two findings fixed
  above, it is not acceptance evidence for this new tree. A new ordinary
  general-agent GPT-5.6 Sol Ultra review must inspect the complete frozen
  `origin/master..HEAD` range after the signed commit.

### Release-create result-loss reconciliation

- A delayed exact-range review found that `gh release create` still ran as an
  unguarded command under `set -e`. A nonzero result therefore exited before
  the post-create complete-inventory/full-tag A/B boundary, even when GitHub had
  already created the draft, and the generic exit trap misclassified the
  ambiguous mutation as publisher execution failure.
- The correction treats the command result as non-authoritative and issues at
  most one create request per publisher invocation. Regardless of status, it
  takes the full post-create `any` inventory/tag boundary. A unique exact draft
  freezes its numeric ID and continues automatically; stable absence is
  `inconclusive` / `release-creation-unknown` and stops without another create.
  Unreadable, drifting, malformed, and duplicate observations retain their
  prior fail-closed classifications, and the pre-create and post-create full-tag
  boundaries must remain equal.
  - Explicit reason: a lost response after an applied POST is safely recoverable
    from the unique exact draft, while eventual visibility cannot prove that a
    second POST in the same invocation is safe.
- Focused validation actually run for this correction:
  - the final create-result command matched two dynamic tests and passed 2/2:
    failure-before-apply stopped after one attempt, then a new exact-source
    invocation made the second total attempt and completed; response loss after
    apply adopted the unique draft in the first invocation, and a later
    exact-source retry kept the total create count at one;
  - the adjacent fresh, second-page retry, and two post-create inventory-drift
    cases passed 4/4; and
  - the workflow/publisher static ABI check passed together with the earlier
    form of the two create-result cases, 3/3. ShellCheck, `bash -n`, the test
    file's Node syntax check, and `git diff --check` also passed during the
    correction.
- The parent lane then ran the complete serialized suite with
  `npm test -- --test-reporter=dot --test-concurrency=1`: exit 0, with 675
  pre-v2 dots plus 45, 80, and 53 final-file dots, for 853/853 tests passed.
  It also independently reran `npm run check`, ShellCheck, `bash -n`, the
  changed test file's Node syntax check, `git diff --check`, and the project
  journal validator successfully. A fresh exact-range acceptance review still
  remains required after the signed commit.

### PR #36 single-producer recovery

- PR #36 exposed an operational race on exact head
  `dd5bcd03cbb534732a983b006756fd1298a72e8a`. The live v1 controller emitted
  canonical hidden-marker request `5460371122` at `2026-08-29T04:38:05Z`.
  Before that asynchronous request became visible in the first read, the
  operator also posted direct request `5460371900` at `04:38:18Z`. Codex later
  produced exact-head terminal clean comment `5460417719` at `04:49:49Z`.
- The live v1 aggregate gate associated that terminal result with its marker
  and passed. V2 must not inherit that weaker result: both comments start
  request generations, there was no terminal or qualifying request-bound
  `+1` between them, and the terminal text does not identify its originating
  request. The first-to-second generation gap therefore remains unclosed under
  the v2 ordering contract. Waiting, removing `eyes`, or observing a second
  stable snapshot cannot retroactively prove lineage.
- PR #36 remains unmerged despite green live-v1 checks. Its next implementation
  and documentation correction creates a new head for the still-deployed v1
  controller, followed by one controller-owned canonical request, a new frozen-
  range GPT-5.6 Sol Ultra review, CI, and exact-head merge closure. This is the
  pre-v2 delivery path for PR #36, not evidence that v2 can reset an unbound
  lineage by changing commits. No manual direct request is sent while that
  controller flight is active.
- Durable operator rule: choose exactly one producer for every exact-head
  generation. Prefer a direct request only before any controller auto-begin
  flight exists. Once `begin-review` with `request_review=true` is dispatched,
  starting, or has emitted its marker, inspect controller/sticky/marker/provider
  state rather than blindly posting another request. Under v2, a legitimate
  new head is sufficient only when every ambiguous predecessor is explicitly
  bound to another full head. If any predecessor is ordinary, edited,
  malformed, denied, or otherwise unbound, safe recovery uses a replacement PR
  and one canonical generation there; late evidence or another commit on the
  ambiguous PR cannot prove that the old provider flight ended.
- The incident audit also found implementation drift behind that operational
  rule. Request-bound `+1` returned before checking the earlier-generation gap,
  so the latest physical request could pass while a predecessor remained
  outstanding. The same shortcut let an older post-base-epoch canonical
  request pass after a newer ordinary request boundary. Predecessor `+1`
  closure also ignored provider progress between the `+1` and successor, and
  reaction-ID uniqueness was checked only inside the selected request. The
  adopted and post-unknown adoption branches additionally read the wrapper's
  nonexistent `.id` instead of `.comment.id`.
- The reducer now treats every physical request comment as a conservative
  generation boundary, including same-run hidden-marker siblings. Every clean,
  including a directly request-bound `+1`, must pass the earlier-gap check; a
  later boundary blocks an older request's reaction. A predecessor `+1` closes
  its gap only when no same-or-later official `eyes` or provider progress
  appears before the successor. Reaction IDs are unique across the complete
  fetched request inventory, and both adoption paths return the physical
  comment ID. Provider terminal evidence retains the previously adopted strict
  predecessor-to-successor time-window contract, and the two-snapshot
  5-second/60-second stability semantics are unchanged.
- Validation actually run on this remediation:
  - `node --test --test-reporter=dot test/v2-gate-runtime.test.mjs` passed all
    86 tests;
  - `npm run test:v2` passed all 95 tests;
  - `npm run check`, both changed-file Node syntax checks, `git diff --check`,
    and project-journal validation passed before this evidence append;
  - the prior signed exact head passed the complete 853-test serialized suite.
    A new complete serialized run was attempted, but the parent deliberately
    interrupted it after the unchanged `test/v2-release-pipeline.test.mjs`
    remained active for 25 minutes 25 seconds. No complete-suite result is
    claimed for the new tree; required CI must complete before merge.

### Exact-head follow-up: time-bound lineage and cross-run Release create

- The fresh full-range review of signed head `cc566ce79981bf85f232489161650c5f37ae6165`
  found two additional fail-open boundaries. A predecessor `+1` ignored
  official `eyes` or provider progress whose timestamp equalled the successor
  request, even though GitHub's timestamp precision cannot prove the liveness
  signal happened first. Progress artifacts were also collected before current-
  head scoping, so an old-head review's progress could keep an unrelated
  current-head generation open.
- That intermediate correction made generation closure treat official `eyes`
  or provider progress at or after the `+1` and no later than the successor as
  ambiguous liveness. It also attempted to exclude unbound progress when its
  most recent strictly earlier request boundary uniquely named another head.
  The later whole-range review documented below proved that the second rule
  inferred carrier origin from temporal proximity and was unsafe; it is not the
  final contract. Only an explicit unambiguous commit binding may now scope
  progress to another head, and every genuinely unbound progress carrier is
  retained.
- Four controls were added inside the existing overlap-generation test: equal-
  successor `eyes`, equal-successor progress, old-head-neighbourhood progress,
  and current-head progress. The focused runtime file passed all 86 tests at
  that checkpoint, but the old-head-neighbourhood case encoded the unsafe
  success expectation and is superseded by the later fail-closed regression.
- The same review found that `release-creation-unknown` prevented a second
  Release POST only within one publisher invocation. A later exact-source run
  could observe stable absence and issue another non-idempotent create, even
  though GitHub does not provide a documented Release-create idempotency key or
  tag-uniqueness guarantee for drafts.
- The corrected cross-run contract supersedes the earlier checkpoint that
  allowed the fake's known-before-apply failure to make a second total POST on
  the next invocation. The target immutable full tag is the durable one-shot
  create fence. Only the invocation that began with that tag absent, created it
  non-force, and read back the exact tag object and peeled commit may issue one
  Release-create POST. If the tag pre-existed while the complete Release
  inventory is stably absent, the later invocation emits `inconclusive` /
  `release-create-attempt-unknown` and issues no POST. The producing invocation
  still uses `release-creation-unknown` when its one POST is followed by stable
  absence, and it still adopts a uniquely discovered exact draft after response
  loss.
  - Explicit reason: once a POST has started, its process exit status cannot be
    durable evidence that GitHub did not apply it. The signed protected full tag
    already precedes Release creation and survives runs, so reusing it adds no
    App permission, workflow input, service, or separate ledger.
  - Explicit liveness cost: a crash after tag readback but before the POST, or a
    create attempt that remains stably invisible, blocks ordinary automated
    retry. A new Environment approval, dispatch, Actions run, or artifact does
    not re-arm the one-shot permission. A richer automatic recovery would need
    a separately reviewed target-side deterministic attempt marker and its own
    protection/provenance contract.
- The two test-harness gaps from the same review are corrected. The final-fence
  static extractor accepts horizontal indentation and explicitly proves that
  `publisher_gh`, `capture_release_boundary`, and
  `read_remote_full_tag_snapshot` enter its remote-capable helper set. The tag-
  replacement fake now builds an independent Release ID and asset identities;
  every tag resolver selects that object while upload readback is pending,
  while frozen numeric Release/asset endpoints remain on the original object.
- Validation actually run for this follow-up so far:
  - the five focused publisher cases passed 5/5: static publisher contract,
    fresh create, cross-run create fence, create response-loss adoption, and
    frozen-ID upload under real tag-resolution replacement;
  - `node --test --test-reporter=dot test/v2-gate-runtime.test.mjs` passed all
    86 tests, and `npm run test:v2 -- --test-reporter=dot` passed 95/95;
  - `npm run check`, `bash -n`, ShellCheck, the release-test syntax check,
    `git diff --check`, and project-journal validation passed; and
  - the complete serialized suite was attempted with
    `npm test -- --test-reporter=dot --test-concurrency=1`. It completed the
    preceding test groups, then stopped producing output inside the known slow
    release-pipeline file. The parent interrupted it after it exceeded the prior
    25-minute-25-second bound. It emitted no failure before interruption, but no
    complete-suite result is claimed; required GitHub CI must complete before
    merge.

### Source CI matrix split before the final frozen head

- PR #36's preceding head showed that both ordinary source-CI jobs were on the
  critical path: `Node.js` ran from `04:37:52Z` to `04:54:31Z`, and `Node.js
  24` from `04:37:52Z` to `04:54:12Z`. The release-pipeline suite now registers
  131 top-level tests, and historical standard-Ubuntu runs show that this one
  file dominates the complete suite. A file-only matrix would therefore leave
  the same slow file as the critical path.
- The source `CI` workflow now runs two symmetric Node-version groups. Each
  version has one `core` cell plus four release cells. The core cell sets the
  release suite to `off`, runs syntax checks, and runs every non-release test
  file with `--test-concurrency=1`; serialization preserves the repository and
  GitHub-state fixture isolation required by the existing final-gate evidence.
  The four release cells run only `test/v2-release-pipeline.test.mjs` and select
  top-level test ordinals modulo four. The current closed inventory is split
  33/33/33/32, so every release behavior test executes exactly once per Node
  version while each cell retains the file's sequential execution semantics.
  Unset shard configuration preserves the ordinary local all-tests behavior;
  `off` and the four explicit fractions are the only CI values, and an empty or
  malformed value fails at module load.
- The adapter exposes a read-only registration count and the release test file
  asserts the exact current count after synchronous registration. The contract
  test proves the modulo partition, rejects malformed and unsafe fractions,
  forbids alternate `test.skip`/`test.only`/`test.todo` registration surfaces,
  and locks the two-version/four-shard workflow inventory. This converts a
  future test-addition or conditional-registration drift into an explicit
  reviewable contract update rather than a silent coverage gap.
- No aggregate matrix-result job is used. A focused review found that GitHub
  permits a single job and its dependents to be rerun; relying on the folded
  `needs.<matrix-job>.result` could therefore let a successful partial rerun
  replace the aggregate view while another matrix leg's earlier failure was
  not rerun. Every cell instead has a unique check name and retains its own
  conclusion. This is both fail-closed and cheaper than starting two extra
  aggregator runners.
- Live ruleset readback confirmed that the source repository's required check
  contexts are `Review gate state machine` and `codex/review-gate`, both from
  GitHub Actions. The old ordinary-CI names `Node.js` and `Node.js 24` were not
  required, and the separate fast state-machine workflow is unchanged. The
  dormant `required-ci.yml` reusable workflow is also unchanged because it has
  no current source PR/push caller; its complete closure remains available to
  an explicit future caller.
- Validation actually run for the CI split:
  - the new shard/workflow contract passed 5/5 under local Node 24, and the
    focused ordinary-agent lane independently passed it under Node 22 and Node
    24;
  - release `off` mode loaded the real file and skipped the exact 131/131
    closed inventory; the serialized core group completed with exit zero;
  - `npm run check`, `actionlint`, all three changed-file Node syntax checks,
    and `git diff --check` passed; and
  - a same-host attempt to run all four heavy release cells concurrently was
    deliberately bounded: three cells were interrupted after about 14 minutes
    of shared-resource contention, and the remaining cell after about 21
    minutes. No local release-cell success is claimed from that attempt. The
    new GitHub head must prove all eight Node-version/release-cell combinations
    on independent runners before merge, and their observed wall times will
    determine whether a later weighted partition is warranted.
- A focused ordinary general-agent review using GPT-5.6 Sol Ultra found and
  closed two fail-open issues during this change: the first aggregate shape
  folded matrix results across partial reruns, and the first inventory probe
  depended on recursive `node:test` reporter output. The final design has no
  aggregate and uses an in-process registration-count invariant. The latest
  focused re-review reported no remaining High or Medium finding. This is not
  the required new whole-range exact-head acceptance review.

### Frozen-head whole-range review follow-up

- A fresh ordinary general-agent lane using GPT-5.6 Sol Ultra reviewed the
  complete exact range
  `cf640dc84d2d59ead9acc2ea9cd1c74e4441aaff..75f54b662459fd42553638f90eea9f80eb18ee50`.
  It found no High issue, one Medium fail-open progress-attribution race, and
  one Low documentation-consistency issue. No other High or Medium issue was
  reported.
- The Medium sequence was: a predecessor current-head request received a
  qualifying `+1`; a later old-head physical request boundary appeared; an
  unbound provider-progress revision shared GitHub's one-second timestamp with
  the next current-head request; and a delayed clean arrived afterward. The
  first implementation ignored all boundaries at or after the progress time,
  selected the uniquely old-head strictly earlier boundary, and discarded the
  progress as historical. The predecessor `+1` could then close the gap and
  allow the delayed clean to pass. This contradicted the adopted rule that a
  same-time physical boundary is ordering ambiguity and must remain
  fail-closed.
- The `7e8d174` follow-up retained unbound progress whenever any physical
  request boundary had the same revision timestamp. Only after ruling out that
  ambiguity did it apply the existing most-recent-strictly-earlier-boundary
  rule. It deliberately did not use comment IDs as a timestamp tie-break:
  provider progress can use an edited comment's revision time, while a comment
  ID orders creation and cannot prove the within-second edit/request order.
  The subsequent frozen-head review below proved that revision-only scoping was
  still incomplete and superseded it with the carrier-interval rule.
- Two integration regressions close both sides of the contract. The first
  reproduces the fail-open combination with the current-head successor at the
  same time as progress. The second keeps progress fail-closed when the
  old-head boundary itself is at the same time; this prevents a future change
  from merely replacing `>=` with `>` and attributing the ambiguous signal to
  the old head. The then-existing strictly ordered old-head-progress case still
  passed. The later full-range review proved that request timing alone never
  establishes an unbound carrier's head, so this historical success expectation
  was unsafe and is superseded by the final rule that retains every unbound
  progress carrier.
- The Low issue was accurate: the English DESIGN and README contained the
  physical-generation-boundary, predecessor-gap, and unbound-progress rules,
  while their Chinese counterparts still had only the earlier short form. The
  Chinese DESIGN and README now state the same normative rules and recovery
  boundary; no runtime policy was changed for this documentation fix.
- Validation actually run for this follow-up:
  - the focused overlapping-generation regression passed 1/1;
  - `npm run test:v2 -- --test-reporter=dot` passed 95/95, including both new
    combinations and all runtime, Action ABI, and workflow-contract cases; and
  - `npm run check` passed.
  The follow-up still requires the ordinary diff checks, journal validation,
  signed commit, and a new fresh whole-range exact-head review before push.

### Second frozen-head review: terminal attribution and edited progress

- The next fresh ordinary GPT-5.6 Sol Ultra lane reviewed the complete exact
  range
  `cf640dc84d2d59ead9acc2ea9cd1c74e4441aaff..7e8d174ca1e1699712f693faec3e5d31fd5c5010`.
  It found one High terminal-attribution fail-open and one Medium edited-
  progress fail-open. It found no other High or Medium issue in the
  Publisher/Release/tag/alias, CI matrix/partial-rerun, or bilingual-contract
  paths.
- The High sequence used two or more physical review generations on one head.
  Provider terminal comments and reviews do not carry an originating request
  ID. The prior reducer flattened those carriers to timestamps, allowed one
  terminal from generation A before request B to close `A -> B`, and then
  allowed a delayed or duplicate second A carrier after B to act as B's clean.
  With three generations, the same timestamp-only rule could also let a
  delayed A carrier close `B -> C`, after which a direct `+1` on C would pass
  even though B remained outstanding. Two identical stable snapshots prove
  object stability, not carrier-to-request attribution, so waiting longer does
  not repair this ambiguity.
- The corrected lineage preserves each provider terminal's source, ID, kind,
  and time. In a no-base-epoch lineage, unbound provider terminal evidence may
  close only the first physical gap and may be positive clean authority only
  for the first physical generation. Every later gap, latest clean, finding
  supersession, and evidence-error supersession requires a qualifying direct
  `+1` on the corresponding head-bound request. After a base epoch, provider
  terminal evidence cannot close even the first gap; every gap and the latest
  positive carrier must be request-bound. This keeps ordinary/single-flight
  terminal clean useful while preventing any delayed or duplicate carrier from
  crossing an overlapping generation.
- Negative evidence remains asymmetric. A finding used as first-gap terminal
  evidence still remains an unresolved finding. An ambiguous later terminal
  cannot supersede it; only a strictly newer authorised generation and a clean
  carrier admissible under the rule above can do so. This is the reason the
  shared clean qualifier, rather than only final success selection, owns the
  attribution check.
- The Medium sequence involved an edited progress comment. Its immutable
  `created_at` can belong to or equal a current-head request boundary while its
  later revision follows an old-head boundary. Revision-only scoping could
  classify it as historical and also fail to veto the predecessor's `+1`.
  The intermediate correction modeled unbound edited progress as a closed
  carrier interval from creation through revision, then still attempted to
  infer a historical head from surrounding request boundaries. The later
  whole-range review proved that this ordering does not identify the provider
  flight. The final contract retains every unbound interval; only an explicit,
  unambiguous commit binding may filter progress to another head. Gap liveness
  uses interval intersection, and comment IDs remain excluded because they
  order carrier creation, not later edits.
- Dynamic regressions now cover two- and three-generation delayed terminal
  carriers, findings that ambiguous clean must not resolve, direct-reaction
  recovery for every later gap, base-epoch first-gap rejection, unedited and
  edited same-time progress, an old-head-neighbourhood edited interval, and a
  cross-head edited interval. The old-head-neighbourhood success expectation is
  superseded by the final fail-closed rule described below. English
  and Chinese README, DESIGN, COOKBOOK, human install, and agent install
  guidance state the same operator recovery rule.
- Validation for this correction:
  - the focused base-epoch, delayed-terminal, and multi-generation tests passed
    3/3;
  - the first complete v2 rerun correctly exposed two old supersession tests
    whose expected unbound-terminal success contradicted the new invariant;
    they were converted to canonical request-bound `+1` recovery cases; and
  - the corrected `npm run test:v2 -- --test-reporter=dot` rerun passed 96/96,
    and `npm run check` passed.
  A focused pre-commit review inspected all 13 dirty files and found one
  Medium documentation mismatch against that intermediate implementation. The
  four install guides were aligned and focused follow-up review returned
  `No findings.` The subsequent full-range review nevertheless invalidated the
  shared head-inference premise itself; those historical validations are not
  acceptance evidence for the final retained-unbound rule.

### Third frozen-head review: physical evidence completeness (scoped fix loop closed)

- A fresh ordinary GPT-5.6 Sol Ultra lane reviewed the complete exact range
  `cf640dc84d2d59ead9acc2ea9cd1c74e4441aaff..8b020e507837503831b3e5ca5da10c66b456233b`.
  It found five High runtime fail-open paths and three Medium contract gaps.
  The branch was deliberately not pushed. Its independent Release/publisher
  lane found no additional issue in immutable publication, frozen Release ID,
  cross-run create-unknown recovery, or signing-key policy fences.
- The integrated pre-commit review and its adversarial follow-ups superseded
  every earlier scoped `No findings` result for acceptance. The confirmed
  runtime findings fell into five connected classes:
  - physical requests could disappear after edits, same-second edits could be
    misclassified from REST timestamps, deleted comments had no reconstructive
    body, and provider-triggerable visible/hidden request envelopes were not
    completely recognised;
  - base-epoch filtering, stale-base boundaries, duplicate reaction identity,
    older-request `eyes`, malformed or unresolved carriers, edited terminals,
    and provider identity mismatches could leave liveness or predecessor gaps
    outside the evaluated window;
  - incomplete GraphQL pagination, unstable ordering, failed pages, abandoned
    parallel reads, or cross-source body conflicts could let previously
    observed deletion/edit/finding evidence disappear between stability
    attempts;
  - generic recovery text and a display-reason-derived decision could direct
    another same-PR generation even when an unclosable historical unbound gap
    required a replacement PR; and
  - a mutable controller sticky could self-poison physical lineage, a stale
    pre-create inventory could duplicate the sticky, and a request POST that
    may already have committed could be forgotten after an unproved scope
    transition.
- The fix loop, first validated at a 144-test checkpoint and frozen at 180 v2
  tests, implemented the following fail-closed correction set:
  - physical-boundary recognition is separate from positive authority. It
    retains edited, malformed, wrong-author, denied, stale-base, focused or
    hidden-envelope request shapes; explicit GraphQL edit metadata prevents
    same-second REST timestamps from granting unedited authority. A valid
    ordinary request still performs the cached permission lookup before denial;
    after denial there is no reaction or exact-refetch fan-out, while earlier
    invalid shape/author/binding cases perform none of those reads;
  - complete paginated `CommentDeletedEvent` and issue-comment edit inventories
    are validated against their connection counts, page state, cursor progress,
    duplicate identities and strict opaque ordering. The protected property is
    concrete irreversible evidence, not transient read health. An incomplete
    node with a stable canonical ID installs an identity tombstone: only a later
    complete observation of that same identity may upgrade it; replacement,
    duplicate-identity conflict, or cross-source identity/content conflict
    fails closed. A pure connection-level schema/read failure that admits no
    object installs no tombstone, restarts the stability window, and may recover
    after two later complete identical snapshots. Once a deletion event, edit
    proof, body identity, count floor or conflicting object has been observed,
    later validation/retry cannot forget it. A missing previously observed
    deletion is failed revalidation rather than permanent poison: the observed
    `(id, fingerprint)` union is retained, the stability window restarts, and
    both final complete identical snapshots must contain that union. Persistent
    absence stays pending, `[A] -> [B] -> [A,B] -> [A,B]` may recover, and a
    changed fingerprint for the same deletion ID permanently poisons the run. A
    deleted comment has no recoverable body, so it remains an unbound physical-
    only boundary and provider-activity point;
  - evidence latches are scoped to the gate property rather than every PR
    mutation. Issue comments remain fully reconciled because any one may carry,
    hide or be edited from a provider request. Review latching covers only
    official-Codex review carriers that are terminal, malformed or provenance-
    relevant; reaction latching covers only official-Codex `+1`/`eyes` carriers
    plus identity ambiguity. Human review state and ordinary reactions do not
    affect this gate and therefore never permanently poison a run. Relevant
    reactions are inventoried before epoch/head authority filtering. Provider
    activity, invalid provenance, edited terminal intervals and older-request
    liveness participate in both predecessor-gap and final-clean checks. Edited
    terminal comments cannot supply positive or superseding clean authority,
    and one carrier's endpoint exception cannot exempt another carrier;
  - recovery propagates the structured `requiresReplacementPr` lineage flag
    through normal, error and report-persistence paths; controller routing never
    parses or matches substrings in the human-readable `reason`.
    `request_clean_generation` distinguishes an existing current canonical
    request that needs a direct `+1`, a safe missing generation that permits
    exactly one request, and an unclosable historical unbound gap that requires
    a replacement PR. `fix_findings` likewise moves the fixes to a replacement
    PR when that gap coexists with unresolved findings. Recoverable latest
    ordinary/current boundaries do not falsely require replacement; and
  - controller diagnostics use one immutable write, never edit themselves, and
    are excluded from physical request lineage only after strict validation of
    the original body, hidden-field types, Actions provenance and no-edit proof.
    A fresh complete inventory immediately before creation suppresses a second
    POST once a canonical candidate is visible. Existing candidates, including
    duplicates, remain untouched and are diagnosed; edited, invalid, forged or
    wrong-provenance marker-looking comments remain physical-only boundaries.
    After a request POST may have committed, only a proved head change is a safe
    terminal scope transition; draft, closed, base/test-merge or otherwise
    unproved scope changes retain retry-unsafe same-run recovery instead of
    permitting a new generation.
- The documentation review corrected the same operator contract in the English
  and Chinese agent, human, COOKBOOK, DESIGN and README guides. Head changes and
  ambiguous provider evidence no longer imply an automatic same-PR generation;
  ordinary, edited, malformed, denied, deleted or otherwise unbound historical
  predecessors use a replacement PR when their original gap cannot close.
  DESIGN and README now state the exact denied-boundary permission/read fan-out
  and deleted-comment boundary rules. A fresh read-only bilingual parity review
  of these changes returned `No findings.`
- The CI findings showed that the first sharding contract could be bypassed by
  alternate `node:test` registration forms or suppressed tests, and that one
  correct job could hide another job's empty matrix cells. The final follow-up
  exports only the canonical registration factory, locks the adapter and shard-
  environment identifiers to the Release suite, seals the registered count,
  and rejects a second-file owner plus the reviewed alias/`describe`/`it`/
  `skip`/`todo` and late-registration escape fixtures. The workflow contract
  validates Node 20 and Node 24 independently, including the full core-plus-
  four-shard matrix, conditions, environment and commands, and rejects extra
  axes plus `include` or `exclude`. A Node 24.15.0 discovery probe confirmed
  that test-file symlinks are discoverable, so the scanner explicitly fails
  closed on every `*.test.mjs` symlink and includes a real-symlink regression;
  directory symlinks are not recursively discovered. The actual 2-core/8-
  release workflow shape did not change.
- Validation actually run on the final frozen runtime bytes:
  - runtime SHA-256
    `a53d8cceae83280a42bba219ead3a8e6db70a54234028759fdcbf2a8eaf10132`
    and runtime-test SHA-256
    `edc67f9e86c08dc3ee514fadcaf2b9c96e5fefb37e86f0d1d18f03a68ef7e31b`;
  - `npm run test:v2 -- --test-reporter=dot` passed 180/180;
  - the six-test sticky/create/post-attempt focused regression passed 6/6;
  - `npm run check` passed; and
  - `git diff --check -- packages/action/src/v2/gate-runtime.mjs test/v2-gate-runtime.test.mjs`
    passed.
  A zero-context GPT-5.6 Sol Ultra scoped review of those exact runtime/test
  hashes returned `No findings.` The final CI bytes separately passed
  `node --test test/ci-test-shard.test.mjs` at 13/13, plus `npm run check` and
  their scoped diff check. Post-freeze targeted English/Chinese checks confirmed
  the three recovery branches and the denied/deleted boundary wording; the
  project-journal validator and full-tree `git diff --check` also passed. No
  local full Release or core-suite pass is claimed; required GitHub CI must
  still prove both core cells and all eight independent Release cells. A signed
  follow-up and a completely new whole-range exact-head review remain required
  before landing.

### Live RC staging timing and release-source matrix split

- PR #35 landed the separate `v2.0.0-rc.1` release intent as source commit
  `af8430ce086517918e4ac8b8c7b9ff124ebec3ef`. Live release run
  `33463583561` then proved the unprivileged plan, dual-candidate, assembly and
  publication-plan stages. Candidate A completed in 17m10s and candidate B in
  17m22s; plan, assembly and publication-plan completed in 26s, 25s and 23s.
  At the timing checkpoint, the run had reached `marketplace-production` and
  was waiting for the required `JoeyTeng` approval, with no privileged job
  runner or production write started. After approval it did start the
  privileged job, then ended in the old publisher identity/scope preflight
  before any target write; the final failure and its observability gap are
  recorded in `Publisher Identity Diagnostic Recovery` below.
- Joey explicitly requested matrix/multi-runner splitting when CI proved slow.
  The ordinary PR CI already completed its ten Node 20/24 core-and-Release
  cells in at most 4m35s, while the first live publisher run showed that each
  candidate job still repeated the complete Release inventory serially. The
  publisher source-validation path is therefore split before stable release:
  - candidate A and B remain independent clean-runner builds and upload their
    immutable artifacts before source tests can start;
  - a new `source-validation` job depends on both builders and fans out one
    core cell plus four Release shards across five clean standard-Ubuntu
    runners with `fail-fast: false`;
  - each cell creates its own detached worktree at the exact frozen source
    commit. Validation jobs never download candidate artifacts, so test code
    cannot mutate either frozen candidate;
  - `assemble` depends on the complete matrix as well as both builders, so any
    failed or missing cell prevents publication; and
  - the now-light candidate builders move to `ubuntu-slim` with the adopted
    14-minute limit. Independent construction and byte-identical comparison
    remain unchanged.
- This optimization is a publisher-control change and was kept on an isolated
  WIP branch while the admitted RC run was pending. It did not alter live
  `master` during that run. After the RC closed in the identity/scope preflight,
  it follows the normal signed, reviewed infrastructure PR path; the later
  stable release intent remains a separate landing.
- The matrix field uses the expression-safe `release_test_shard` spelling;
  this avoids relying on ambiguous hyphenated property dereferencing in GitHub
  expressions while leaving the public test-shard environment ABI unchanged.
- A local five-cell equivalent validation then closed successfully: the core
  cell exited zero, and Release shards 1/4 through 4/4 passed 33, 33, 33 and 32
  tests respectively, covering all 131 registered Release tests with zero
  failures. Running all four heavy shards concurrently on one shared Mac
  stretched their wall times to roughly 13m52s–15m20s through local resource
  contention; those timings are not used as the GitHub timeout estimate. The
  independent GitHub-hosted cells from PR #35 remain the relevant performance
  evidence, with a 4m35s observed maximum. After the final field-name fix,
  `npm run check`, the two focused workflow-contract tests, all 13 shard
  contract tests, `actionlint` with the documented upstream-metadata ignores,
  `git diff --check`, and project-journal validation passed.
- A fresh ordinary GPT-5.6 Sol Ultra exact-head review of signed commit
  `0cc238cef573b93badce86c7e7e73e088257495a` found no workflow implementation
  issue, but identified two stale journal handoff statements: the preflight
  still named the removed 30-minute candidate topology, and `Next Steps` still
  treated already-merged PR #35 as a Draft. The corrections above and below
  bind the handoff to the five-cell validation topology and the actual order:
  record the admitted RC run's pre-write failure, land this publisher-control
  change, then land the separate stable release intent. A new whole-range
  exact-head review is required after this documentation correction.

### Publisher Identity Diagnostic Recovery

- The approved frozen recovery run `33491438854` reused RC source/control SHA
  `af8430ce086517918e4ac8b8c7b9ff124ebec3ef` and admission run
  `33463583561`. Its plan, both independent candidates, source-validation
  steps embedded in the old candidate jobs, assembly, and publication-plan
  stages completed. It did not contain the later `source-validation` matrix;
  that hosted matrix still requires validation after its separate control
  change lands. After the required `marketplace-production` approval,
  `actions/create-github-app-token@v3` successfully minted the
  selected-repository token, but the following
  `Validate publisher identity and repository scope` step exited one without a
  condition-specific line. The publisher did not proceed to a target write;
  no RC tag or Release was created.
- The original identity step used bare shell predicates for static App/token
  outputs, a bare metadata `jq -e` predicate, and a bare installation-token
  repository-scope command. Any of those failed closed but surfaced only a
  generic shell exit. The matrix/publisher-control branch now adds explicit
  phase markers and fixed failure messages for every static predicate, the
  App-JWT installation read, metadata invariant, repository-scope query, and
  repository-scope invariant. Its successful installation summary contains
  only boolean comparisons against expected installation/App/account identity
  and selected-repository state, suspension state, enum-limited permission
  values, and a bounded event count; the scope summary contains only bounded
  numeric counts and a boolean target-repository match.
- The initial diagnostic implementation would have inspected
  `/installation/repositories` with the target-repository-scoped token. That
  can prove the token is restricted to the target, but cannot prove that the
  App installation itself has no second repository: GitHub deliberately narrows
  that endpoint to the token's scope. The corrected order is therefore:
  static owner/slug invariants; an inventory-only token with `metadata: read`
  and no `repositories` input; App-JWT installation-metadata validation; a
  complete-installation repository inventory; only then a target-scoped
  write-capable token. The final token must report the same App slug and
  installation ID as the inventory token. This preserves a narrow credential
  for publication while making the App private-key installation boundary
  independently observable before any target write.
- The target-scoped token receives one more post-mint scope read before Git
  authentication or reconciliation. It must itself observe the exact singleton
  repository ID `1239944216` and canonical name
  `JoeyTeng/codex-review-gate-action`, using the same safe five-field
  projection. The protected property is repository-object identity: the token
  Action accepts a repository name, so equality of App slug and installation
  ID alone does not establish that the freshly minted writer still resolves to
  the inventory's repository object. This re-read fails closed before the
  writer can reach Git, and its temporary projection is removed in the
  `always()` cleanup.
- The inventory check accepts exactly one complete-installation repository,
  matched both by immutable repository ID `1239944216` and canonical name
  `JoeyTeng/codex-review-gate-action`. It never persists the raw API object:
  the bounded Node helper retains it only in memory and writes an exact
  five-field summary (`total_count`, `returned_count`, and three target-match
  booleans). This avoids treating an unreviewed future response field, such as
  a temporary clone credential, as safe diagnostic data. Every local
  installation-scope projection, including the post-mint writer projection,
  is removed in the `always()` cleanup. The metadata check also now requires
  the `suspended_at` key to exist and be explicitly `null`; a missing field is
  an invariant failure rather than an implicit "not suspended" result.
- Both release guides now describe the two-token sequence, the complete-
  installation proof, the fixed local projection, the scoped-token binding,
  and the post-mint writer-object proof in lockstep. They no longer describe
  the repository-scoped writer as the token that establishes sole-installation
  scope.
- An executable regression extracts the real workflow scope guard rather than
  reproducing its predicate. It proves the exact singleton projection advances
  to the subsequent target-token boundary while extra repositories, malformed
  target shape, wrong ID, wrong canonical name, or an extra persisted field
  terminate before that boundary. This also exposed the required `jq keys`
  lexical order: `returned_count`, the three `target_*` fields, then
  `total_count`; the guard now uses that actual order. The source-validation
  release shard also places Node's `--test-reporter=dot` before its test entry,
  so the requested compact reporter is actually applied.
- A second executable regression extracts the real post-mint writer binding
  step. The valid writer scope can advance to the Git-authentication marker;
  configured/inventory slug or installation-ID mismatches stop before its
  scope query, while a replacement repository ID, non-canonical name, or
  non-singleton writer scope stops before Git authentication and reconciliation.
  It also proves the synthetic writer token is not emitted under inherited
  xtrace, verbose, or allexport modes.
- A bounded read of the failed job's raw log confirms the exact observability
  gap: GitHub evaluated the configured owner, slug, minted App slug and
  installation ID, then ran the four bare predicates and exited with only
  `Process completed with exit code 1`. The preceding publisher-token step
  completed successfully, so the missing line is downstream of token minting;
  the historical log cannot distinguish which original predicate failed. This
  is why every newly explicit branch writes its phase-specific message before
  it exits nonzero, rather than relying on shell `-e` to carry diagnostic
  meaning.
- Diagnostics remain credential-safe: xtrace, verbose, and allexport modes are
  disabled before secret capture; no private key, App JWT, or installation
  token is printed; non-200 App responses are not read and emit only a closed
  failure code, numeric HTTP status, and a request-ID-presence boolean (not
  the request ID itself). The
  installation-token scope query now uses the same bounded Node HTTP reader,
  rather than preserving a raw CLI error path, so it has the same closed
  transport/status diagnostics and never reads a non-200 body. The local
  App-JWT reader now matches `actions/create-github-app-token@v3` by
  normalizing escaped PEM newlines; malformed JWT construction emits the fixed
  `app_jwt_invalid` code rather
  than an OpenSSL message. Successful response-body I/O failures likewise emit
  a fixed code, while the pre-existing safe byte-limit diagnostic remains
  distinct. Regression coverage includes reflected JWT/token response headers,
  escaped-newline PEM, malformed JWT construction through the real CLI
  stderr/exit/no-output-file boundary, response-body failures, and limit/cancel
  failures. Every invariant still fails closed.
- 新的 RC 恢复运行 `33544572196` 已复用冻结 source
  `af8430ce086517918e4ac8b8c7b9ff124ebec3ef` 与 admission run
  `33463583561`，并以合并后的 publisher control
  `a280c3d3d9c3b1aac5efc698e6ff34832b5b8e04` 完成所有无特权阶段。
  在新的 `marketplace-production` 批准后，新增的静态 App/token 检查和
  App-JWT installation fetch 均成功；失败发生在任何 metadata invariant、
  repository-scope query、writer-token、Git authentication、reconcile 或目标写入之前。
- 该失败不是 App 配置、安装范围或远端 API 的不匹配：runner 的较旧 `jq`
  parser 不能将对象字段值直接写成裸 `if`，而本地 `jq 1.8.1` 接受该写法，
  因而旧本地验证未暴露兼容性差异。`suspension_state` 现在必须把完整
  `if`/`elif`/`else` 表达式包在括号中，语义仍严格区分 missing、explicit
  `null` 与 suspended，并继续对缺失 `suspended_at` fail closed。回归测试从
  真实 workflow 提取完整 `jq` filter，在 `{}`、`suspended_at: null` 和非
  `null` 三种输入上执行；这使 source-validation runner 自身固定该兼容性边界。
- Local validation for this isolated change passed `npm run check`, all 57
  publisher/provenance regressions in `test/release-provenance.test.mjs`, the
  two focused source-validation/publisher credential contracts in
  `test/v2-release-pipeline.test.mjs`, baseline-filtered actionlint,
  extracted `bash -n`, ShellCheck, compilation of the three embedded `jq`
  programs, `git diff --check`, and project-journal validation. The combined
  full command containing the entire
  `test/v2-release-pipeline.test.mjs` was intentionally interrupted after a
  bounded 20-minute local window while it was still progressing through its
  serial temporary-Git scenarios; it is not recorded as a passing test. The
  new full-installation inventory and frozen-source-worktree assertions are
  directly covered by the passing focused contracts.
- 新的 RC 恢复运行 `33605481641` 再次复用同一冻结 source 与 admission，控制
  commit 为 `88b6961fc7ffff5fa82309b684d79a9b915e03a3`。所有无特权阶段均完成，
  Environment 批准后，失败仍发生在任何 target write 之前：App identity、owner、
  selected installation、sole-target scope、suspension state 与前三项 permission
  均匹配，唯一不匹配的是严格的 installation permission shape。
- 登录的 App settings 与该 run 的 non-secret observation 共同确认，实际安装还具有
  `Workflows: write`。这不是应当删除的多余权限：发布脚本用 verified candidate
  tree 建立完整 target commit，而当前 target 仍含 legacy
  `.github/workflows/codex-review-gate.yml`；v2 transition 会删除它，GitHub 将该
  删除视为 workflow write。Candidate payload 继续拒绝 workflow definitions，因而
  这项权限只允许 target complete-tree replacement 执行已审查的删除，不扩大 payload
  内容。
- 决定保持 fail-closed 而不是永久扩权：workflow 以经 publication-plan revalidation 的
  verified candidate receipt 中 `plan.target_master_before` 是否等于 recorded
  `initial_target_master` 决定 exact surface。
  只有该一次性 v1→v2 transition 要求安装与 target-scoped writer token 具有
  `workflows: write`；inventory token 始终仅请求 `metadata: read`。immutable RC
  readback 完成且不再需要 recovery 后，stable release 前必须从 App 移除 Workflows
  permission；新的 target head 会使 workflow 严格要求三权限 surface 并让 writer token
  不再请求 Workflows。文档、transition 检查和实际执行的 `jq` guard 回归共同锁定这两种
  exact surface，防止旧三权限误阻断 RC 或额外权限静默进入 stable token。
- 新的 RC 恢复运行 `33622507589` 继续复用同一冻结 source 与 admission，并以合并后的
  control commit `7ed0da980ca145d9397acbac60aabe0c99372fef` 完成所有无特权阶段。
  Environment 批准后，它在 `Determine frozen target workflow-transition permission`
  停止，仍早于 Publisher token minting、GPG import、target push、tag 或 Release mutation。
- 根因是两个刻意不同的 artifact schema 被混淆：credential-free
  `publication-plan.json` 只保存 candidate digest 等跨阶段绑定字段，并没有顶层
  `target_master_before`；已解包、已验证且刚刚完成 publication-plan revalidation 的
  `release-candidate/candidate.json` 才保存
  `plan.target_master_before`。旧的 `jq -er` 置于 `set -e` command substitution 中，
  对缺失字段直接以 exit 1 终止，因此没有机会打印 custom invariant error。
- 修复保持相同的冻结值与最小权限决策，只改为从 verified candidate receipt 读取
  `plan.target_master_before`，并显式处理 candidate/baseline 的缺失或非字符串字段。
  回归测试直接执行 extracted workflow Bash，覆盖 initial transition、later release 及两条
  缺字段 fail-closed 路径；文档同步说明字段来源，防止 artifact-boundary drift。

## Verified Facts And Required Live Preflight

- Verified: a hidden-marker request whose visible first line is exact
  `@codex review` can be authored by `github-actions[bot]` and still trigger
  Codex. On unchanged-head PR #7, request `4461404667` triggered terminal clean
  result `4461418036`.
- Remaining marker verification: live-canary the final v2 hidden-marker byte
  grammar on an unchanged head before stable admission.
- Live preflight and post-write readback verified that
  `marketplace-production` requires reviewer `JoeyTeng`, permits self-review,
  disables administrator bypass, restricts deployment to source `master`, and
  retains the three expected non-secret App variables plus two expected secret
  names. It also verified current target immutable-Release support, valid signed
  v1 tags, and the adopted non-overlapping v1-freeze/v2-plus tag rulesets. No
  secret value was read.
- The private App's Bot identity is visible, but ordinary user credentials
  cannot read its private App or installation metadata. Before publication,
  authenticated installation evidence or the logged-in App settings must prove
  owner `JoeyTeng`, active selected-repository installation, the sole target,
  and the reviewed transition-dependent permission surface: the one-time RC
  transition has Contents/Administration/Metadata/Workflows, while later
  releases have exactly Contents/Administration/Metadata.
- Live publisher preflight must establish the private Publisher App's slug,
  installation identity, sole target repository, and actual permissions; the
  configured layered rulesets; GitHub read-back of an App-pushed,
  JoeyTeng-Codex-signed commit and tag; compatibility of the selected floating
  Action majors; each `ubuntu-slim` plan, candidate, assembly, publication-plan
  and verification job completing within the adopted 14-minute budget; each
  standard-Ubuntu `source-validation` matrix cell completing within 14 minutes;
  the privileged standard-Ubuntu publish job remaining within 30 minutes; and
  Environment waiting allocating no runner in the live workflow.
- The stable-major operator checklist includes manually publishing `v2.0.0`
  through the Action Marketplace Release UI. This is deliberately not a
  publisher gate or machine-read-back requirement. Historical v1 evidence
  shows a GitHub Release for every full version while the Marketplace listed
  only selected versions (`v1.2.1`, `v1.3.5`, and `v1.5.1`).

## Next Steps

- Preserve exact-head acceptance: any implementation or contract change after
  the clean checkpoint above requires a new full-range review. The
  evidence-only landing commit is separately signed and exact-head confirmed
  before push; its own hash remains Git evidence rather than self-referential
  journal content.
- Run the already specified hidden-marker canary and live
  publisher/runner/Environment preflights as execution evidence; they are not
  remaining grilling choices.
- PR #35 is merged. Its approved frozen RC recovery completed every
  unprivileged stage but failed before any target write in the publisher
  identity/scope preflight. Do not involve PR #32.
- PR #37 与 PR #38 已合并。新的 RC 恢复运行已验证五个 hosted
  source-validation cells、安全身份诊断路径与旧 runner 的 `jq` compatibility
  correction；`33605481641` 进一步将剩余失败收敛到 complete-tree transition 所需的
  Workflows permission contract。先完成该最小权限契约修复、同等签名与精确头审查，
  随后以同一冻结 source/admission 创建新的 RC recovery run。成功后验证 immutable
  RC ref、prerelease、assets、signatures 与 public readback；失败时继续只修复已观察
  到的明确不匹配。
- RC 的 immutable ref、prerelease、assets、signatures 与 public readback 全部验证后，
  且确认不再需要 RC recovery，先在 Publisher App settings 移除 `Workflows: read/write`；
  再创建 stable `v2.0.0` release intent。stable workflow 会以新的 target head 要求
  严格三权限 surface，而不是保留一次性迁移权限。
- Then land the stable `v2.0.0` release intent separately and execute its
  approved publisher workflow. Verify the immutable stable ref,
  Release/assets, signatures and `v2` floating alias before carrying out the
  explicitly selected consumer migrations and canaries. Marketplace
  publication remains the separate stable-major manual checklist item defined
  above.

## Evidence

- Codex task: `019ff4f8-f42a-70f0-9472-94f5ca08fb77`.
- Rollout source:
  `/Users/hoteng/.codex/sessions/2026/08/12/rollout-2026-08-12T08-56-24-019ff4f8-f42a-70f0-9472-94f5ca08fb77.jsonl`.
- The official rollout scanner fully checked a 45,000-record suffix covering
  original lines 79,639-124,638. The grilling interval used by this ledger is
  within original lines 112,677-124,569.
- Key consumer/runtime evidence: original rollout lines 112,706-112,731,
  113,523-116,569, and 124,520-124,526.
- Key publisher/rollout evidence: original rollout lines 116,805-119,178 and
  124,271-124,280.
- Clean planning baseline:
  `10217253306ca2ee6f312f766a331f8924e26e47`.
- Recoverable paused implementation:
  `42773dd2736af2f8759951fc7ebf6e21ebf3275b`.
- Recoverable paused uncommitted fixes:
  `7f96293371cc2adfa0aeccc49effbf4c9d519ff2`.
