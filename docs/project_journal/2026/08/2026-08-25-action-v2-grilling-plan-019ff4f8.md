---
id: 20260825-019ff4f8-action-v2-grilling-plan
title: Action v2 Confirmed Delivery Plan
status: active
created: 2026-08-25
updated: 2026-08-26
branch: codex/action-v2-release
pr: 34
supersedes: [20260813-7bf930a-action-v2-release-pipeline]
superseded_by:
---

# Action v2 Confirmed Delivery Plan

## Summary

- This is the authoritative confirmed plan and implementation ledger for the
  replacement Codex review gate v2 runtime, consumer installation, publisher,
  and rollout. It records individually adopted decisions, accepted tradeoffs,
  explicit deferrals, implementation evidence, and delivery handoffs.
- Joey explicitly confirmed the complete shared summary and requested execution
  on 2026-08-26. That confirmation closed grilling and authorized the
  implementation/delivery workflow described here; privileged Environment
  approval remains a separate release-time control.
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
- Normative implementation documentation lives in
  `packages/action/DESIGN.md` and `packages/action/DESIGN.zh-CN.md`; release and
  operator procedure lives in `docs/RELEASING.md` and
  `docs/RELEASING.zh-CN.md`; human and agent installation procedures live under
  `docs/install/`. This journal remains the decision, evidence, and handoff
  authority rather than duplicating those operational documents in full.

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

- V2 ships a JavaScript Action, a copied canonical thin workflow wrapper, and
  an importable disabled ruleset template. A reusable workflow is not the
  consumer ABI.
  - Explicit reason: the copied wrapper owns triggers, permissions,
    concurrency, typed dispatch, and pre-runner filtering that an Action step
    cannot own.
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
- Provider-driven automation uses `issue_comment` activity types `created` and
  `edited`, with exact event sender and comment-author filtering before runner
  allocation. An edit may invalidate prior success, while the absence of edits
  costs no runner time.
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
  default `true`, and `limits_profile` (`default` or `expanded`) for manual
  reconcile. Every input is untrusted and revalidated from GitHub. Callers
  cannot supply a verdict, status, bot identity, status context, stale override,
  or skip-full-reconcile override.
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
- `begin-review` first establishes pending and, by default, posts a fresh exact
  `@codex review` request. `request_review=false` is an advanced best-effort
  option and does not add a dedicated barrier.
- An agent should normally post exact `@codex review` directly when the required
  check is not already passing, then use GHA only when reconciliation is needed.
  - Explicit reason: direct posting avoids unnecessary runner minutes; the
    workflow-owned path remains available when pending and request creation need
    to be coordinated.
- Same-PR status writers share one concurrency group with
  `cancel-in-progress: false`. GitHub may replace one not-yet-started pending
  wake-up, so an agent must observe the exact `begin-review` run complete before
  treating it as a successful barrier or posting a dependent request. GitHub
  provides no operation-aware queue priority or coalescing.
- A `begin-review` logical attempt is keyed by repository ID, PR, expected head,
  and `GITHUB_RUN_ID`. A rerun adopts an existing exact, unedited, matching
  hidden marker. After an unknown POST result it rereads before retrying; if
  visibility remains unknown, it keeps pending and reports `retry_begin` with
  `retry_safe=false`. GitHub issue-comment creation has no idempotency key, so
  the side effect may have succeeded before the failure became visible; the
  caller must wait for the exact same-run marker to settle and, if it remains
  absent, rerun the original workflow run instead of immediately retrying or
  dispatching a new generation. Duplicate same-run requests are folded
  conservatively and reported rather than selecting a convenient clean result.

### Permissions And Execution Boundary

- The runner job grants only `contents: read`, `issues: write`,
  `pull-requests: read`, and `statuses: write`. It does not grant write access
  to pull requests, checks, contents, Actions, or OIDC, and does not require
  `actions: read`.
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
- Only the gate workflow receives `statuses: write`. Installation first
  observes the actual expected status source on a canary, validates the imported
  disabled ruleset, and only then activates it; `Any source` is not accepted.
- The expected-source integration ID identifies the GitHub Actions App, not one
  particular workflow. Installation therefore also requires repository-default
  workflow permissions to be read-only, rejects every non-canonical default-
  branch workflow or job that grants `statuses: write` or `write-all`, and
  rejects every additional v1 or v2 direct/reusable gate caller. The canary
  status target URL must resolve to a successful run of the exact canonical
  workflow in the same repository at the current default-branch head.
  - Explicit reason: otherwise another GitHub Actions workflow could publish
    the same required status context, or a duplicate gate caller could race the
    canonical workflow while still presenting the same integration identity.
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
  required status, conversation resolution, and up-to-date enforcement;
  `issue_comment` plus `workflow_dispatch`; and ordinary merge, squash, and
  rebase methods.
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

### Head, Status, And Merge Closure

- A valid reconcile rereads the selected PR and, only while its head equals
  `expected_head_sha`, replaces that SHA's gate status with pending before
  collecting evidence. A stale run never follows or writes a new head. This
  invalidates old success during a recheck and leaves an interrupted run
  fail-closed at pending.
- A deliberate same-head re-review uses `begin-review` to write pending and, by
  default, create the new request in the same run.
- A success is a stable observation, not a permanent review lease. Commit
  statuses do not expire and automatic events can be lost, so an agent-driven
  merge must run an exact-current-head reconcile immediately before merge,
  carrying `expected_head_sha`, then require `healthy/success`, the confirmed
  current-head status from GitHub Actions, unchanged head, and ruleset allowance.
- Public result semantics are fixed:
  - stable clean: `healthy/success`;
  - findings: `healthy/failure`;
  - findings proved but failure-status projection failed:
    `unhealthy/failure`;
  - provider not complete: `healthy/pending`;
  - API, pagination, cap, or stability failure: `unhealthy/pending`;
  - stale delayed event: `healthy/not_applicable`;
  - invalid manual target or unsupported scope: `unhealthy/not_applicable`;
  - no trusted state can be read or projected: `unhealthy/unknown`.
  `unhealthy/success` is invalid. Workflow conclusion reports execution health;
  the PR-head status reports gate outcome.
- Public Action outputs are `execution_health`, `gate_outcome`,
  `recovery_code`, and `retry_safe`. `execution_health` is `healthy` or
  `unhealthy`; `gate_outcome` is `success`, `failure`, `pending`,
  `not_applicable`, or `unknown`; and `retry_safe` is boolean. The closed
  `recovery_code` values are `none`, `wait_provider`, `reconcile`,
  `fix_findings`, `request_clean_generation`, `retry_reconcile`,
  `wait_then_reconcile`, `use_expanded_limits`, `raise_protected_limit`,
  `refresh_head`, `repair_permissions`, `retry_begin`, and
  `unsupported_target`. `status_projection` is summary-only. Findings do not
  make execution unhealthy; `retry_safe` means an immediate identical-input
  retry is a valid recovery action.

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
  statuses, or diagnostic comments are acceptable when they are reconciled
  conservatively; a duplicate must never hide a finding or manufacture pass.
  Later provider events and manual reconcile are the recovery paths from an
  interrupted or unknown state.
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
  no `@codex review`. Only `github-actions[bot]` marker comments match. The
  runtime updates the oldest/lowest-ID canonical duplicate, warns without
  deleting extras, recreates after deletion, treats write failure as a
  non-authoritative warning, and excludes the diagnostic from the evidence
  fingerprint.
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

- No reachable design or fact-investigation node remains open.
- Joey confirmed the complete shared summary and requested implementation on
  2026-08-26. Implementation resumes from the recoverable branch/stash only
  after an explicit contract audit; historical implementation detail cannot
  override this journal.
- Local implementation, tests, documentation, fresh-context review, and signed
  commit precede PR readiness. Merge precedes the approved publisher run;
  release read-back precedes consumer installation and canary expansion.

## Implementation Checkpoint

- Phase: infrastructure implementation and contract reconciliation, started
  after confirmation on 2026-08-26.
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
- No push, PR, target-repository write, Release, tag, alias, Marketplace change,
  ruleset mutation, or consumer installation had occurred at this checkpoint.
- Existing source-repository PR #32 is explicitly outside this workstream and
  does not block or supply changes to this delivery.

## Verified Facts And Required Live Preflight

- Verified: a hidden-marker request whose visible first line is exact
  `@codex review` can be authored by `github-actions[bot]` and still trigger
  Codex. On unchanged-head PR #7, request `4461404667` triggered terminal clean
  result `4461418036`.
- Remaining marker verification: live-canary the final v2 hidden-marker byte
  grammar on an unchanged head before stable admission.
- Read-only live preflight verified that `marketplace-production` exists with
  reviewer `JoeyTeng`, self-review permitted, source branch restricted to
  `master`, the three expected non-secret App variables, and the two expected
  secret names. It also verified current target immutable-Release support and
  valid signed v1 tags. No secret value was read.
- The same preflight found two required configuration corrections before
  publication: Environment administrator bypass is currently enabled and must
  be disabled, and the target still has one Publisher-App-bypass ruleset for
  all `v*` tags. The latter must be replaced by the adopted no-bypass v1 freeze
  plus the v2-and-later Publisher ruleset before credentials may publish.
- The private App's Bot identity is visible, but ordinary user credentials
  cannot read its private App or installation metadata. Before publication,
  authenticated installation evidence or the logged-in App settings must prove
  owner `JoeyTeng`, active selected-repository installation, the sole target,
  and the reviewed Contents/Administration/Metadata permission surface.
- Live publisher preflight must establish the private Publisher App's slug,
  installation identity, sole target repository, and actual permissions; the
  configured layered rulesets; GitHub read-back of an App-pushed,
  JoeyTeng-Codex-signed commit and tag; compatibility of the selected floating
  Action majors; `ubuntu-slim` jobs completing within the adopted 14-minute
  budget; and Environment waiting allocating no runner in the live workflow.
- The stable-major operator checklist includes manually publishing `v2.0.0`
  through the Action Marketplace Release UI. This is deliberately not a
  publisher gate or machine-read-back requirement. Historical v1 evidence
  shows a GitHub Release for every full version while the Marketplace listed
  only selected versions (`v1.2.1`, `v1.3.5`, and `v1.5.1`).

## Next Steps

- Satisfy infrastructure PR #34's CI, review, and merge-readiness gates without
  involving PR #32.
- After the infrastructure PR merges, create the separate release-intent PR and
  execute the approved publisher workflow through RC and stable `v2.0.0`.
  Verify immutable refs, Release/assets, signatures, and floating alias before
  carrying out the explicitly selected consumer migrations and canaries.
  Marketplace publication remains the separate stable-major manual checklist
  item defined above.

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
