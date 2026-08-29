# Action release publisher

This document is the canonical publication contract for action v2 and later.
The source and publication repositories are fixed:

```text
source:  Joey-Tools/codex-review-gate
target:  JoeyTeng/codex-review-gate-action
```

The target is the existing action and Marketplace repository. It retains the
v1 history and selectors while receiving v2 and later releases. The abandoned
`Joey-Tools/codex-review-gate-action` target is not part of this contract.

This contract describes the intended publisher. It does not claim that a
release intent is present, or that a release, test run, Marketplace update, or
production installation has already completed. The complete accepted design
and its rationale are recorded in
[`docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`](project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md).

## Delivery sequence

Publisher infrastructure and release intent are deliberately separate changes:

1. Land and validate the publisher workflow, scripts, tests, documentation,
   repository rulesets, Environment, App installation, and signing setup.
2. In a later reviewed PR, add or change `release-manifest.json` for one exact
   SemVer release.
3. After that release-intent PR reaches protected source `master`, run the
   staged publisher and approve only its privileged `publish` job.

The current infrastructure delivery is step 1. It carries no release intent,
must not trigger publication, and does not mean that any tag, GitHub Release,
floating alias, Marketplace version, or consumer installation exists. A
release-intent change must not modify publisher workflow/scripts or their
control tests. This keeps newly introduced privileged code from immediately
receiving production credentials to publish itself.

## Release intent

When present in a later release-intent PR, `release-manifest.json` is the
committed release intent. A release PR changes its `version` and any
policy-bound release metadata. The normal publisher starts after that reviewed
change reaches source `master`. The workflow derives
the immutable full tag, prerelease/stable status, Release version, and—only for
a stable release—the floating major alias such as `v2` from SemVer.

There is no `publish_v2` flag and no manually supplied version. Future v3 and
later releases use the same rules. A recovery `workflow_dispatch` may select
the exact committed source SHA to reconcile, but the version still comes from
the manifest at that SHA. That SHA is a recovery binding, not a public consumer
selector.

The publisher workflow is `.github/workflows/sync-action-subtree.yml`. Its
normal trigger is a push to source `master` that changes
`release-manifest.json`. Its recovery `workflow_dispatch` requires exactly
three inputs:

- `source_sha`: the exact lowercase 40-hex commit that introduced the intended
  manifest;
- `admission_run_id`: the positive Actions run ID of the original admitted
  `master` push; and
- `admission_run_attempt`: the exact positive successful planning attempt that
  persisted the admission plan.

Before source checkout, dispatch uses the exact run-attempt and artifact REST
identities to require the original push event, `master` head/source SHA,
workflow path and attempt. It then requires exactly one unexpired
`release-plan-<attempt>.json` artifact with a server-returned positive artifact
ID and `sha256:<64hex>` digest, downloads by that ID from that run, and matches
the downloaded file to the REST digest. The publisher finally recomputes the
original admission and plan from Git and requires exact equality with the
persisted JSON. A dispatch with missing or mismatched identity, digest,
manifest, history or Git recomputation is rejected before publication. A
dispatch cannot infer admission from `source_sha` alone, freely rebuild a
rejected admission, or substitute another run/attempt/artifact.

A dispatch always executes the workflow and publisher controls from the live
source `master` commit recorded by `github.sha`; it never checks out an old
commit as executable release control. The selected `source_sha` must be the
linear ancestor commit that changed `release-manifest.json`. That source freezes
the release manifest and complete `packages/action` payload and tree. Recovery
must first authenticate the persisted original push admission as described
above; it does not require the publisher controls at the old source commit to
match the current controls. Only after that binding succeeds does the attempt
use the current protected source `master` control commit to create a fresh
plan, deterministic candidates A and B, publication plan, and Environment
approval that bind that current control inventory. If source `master` or those
controls advance after the attempt's plan is created, publication fails closed
before App-token minting or any durable mutation and must be rematerialized and
approved again. A later release intent cannot leapfrog an older partial
release; the older source may only reconcile and resume its exact canonical
prefix. Mismatched frozen payload or remote publication state is never blessed
as recovery.

The manifest also binds the source path, target repository and branch, and the
expected signing identity. The publisher validates it against release policy
and current remote state before any write. Editing a baseline to bless
unexpected remote drift is not recovery.

The frozen v2.0 release line records
`release_contract=codex-review-gate-action-v2.0-contract-v1`. Its plan,
candidate, publication-plan, and published provenance schemas are respectively
`codex-review-gate-action-release-plan-v2`,
`codex-review-gate-action-candidate-v2`,
`codex-review-gate-action-publication-plan-v2`, and
`codex-review-gate-action-release-provenance-v2`, each with schema version 2.
Published provenance selects this frozen contract for historical verification;
later publisher evolution must not reinterpret v2.0 artifacts through a newer
schema.

## Workflow stages and privilege boundary

The dedicated publisher runs in the source repository and has these logical
stages:

| Stage | Privilege | Contract |
| --- | --- | --- |
| `plan` | Unprivileged | Check the exact source commit, manifest, SemVer, reachability, release policy, and immutable target-parent policy. |
| `candidate-a` | Unprivileged | Independently materialize and test candidate A on a clean runner; record its tree, inventory, modes, sizes, and SHA-256 digests. |
| `candidate-b` | Unprivileged | Independently materialize and test candidate B on another clean runner. |
| `assemble` | Unprivileged | Require byte-identical candidates and produce the canonical candidate bundle. |
| `publication-plan` | Unprivileged | Reconstruct and validate the publication plan and candidate before approval; upload no privileged material. |
| `publish` | Privileged | After Environment approval, revalidate everything and perform signed remote publication. |
| `verify` | Unprivileged | Re-read public refs and Release state and report the observed result. |

The light unprivileged `plan`, `assemble`, `publication-plan`, and `verify`
jobs use `ubuntu-slim` with 14-minute timeouts. GitHub imposes a separate
15-minute hard limit on that single-CPU runner, so the low-frequency, heavy
`candidate-a` and `candidate-b` jobs use `ubuntu-24.04` with 30-minute
timeouts. The full suite alone had consumed about 755.6 seconds before its
final release-pipeline test completed, leaving inadequate headroom on
`ubuntu-slim` for checkout, setup, candidate materialization, packaging, and
upload. The privileged `publish` job also retains `ubuntu-24.04` with its
existing 30-minute timeout.

Only `publish` binds the `marketplace-production` Environment. Despite its
historical name, this is the production publication-credential and approval
boundary; it does not mean that the workflow publishes to or verifies
Marketplace. Its initial policy requires reviewer `JoeyTeng`, keeps **Prevent
self-review** disabled, disables administrator bypass, permits only source
branch `master`, and allows the approval wait to remain pending for up to 30
days. Before approval:

- no publisher App token or signing key is available;
- no job can write the target repository or a GitHub Release; and
- the candidate artifact contains no credential or signing-key material.

Artifacts are transport between jobs, not a ledger or authoritative
publication evidence. The `plan` artifact is retained for 90 days; candidate
A/B artifacts (`candidate-a` and `candidate-b`) are retained for one day. The
assembled canonical candidate and publication plan artifacts are each retained
for 35 days, covering the Environment's maximum 30-day approval wait. Those
are the two frozen inputs to `publish`. The original push run's 90-day plan is
also the bounded persisted admission used for exact dispatch recovery; there
is no separate artifact named or classified as an admission artifact. It is
accepted only after exact run/attempt/artifact REST binding, downloaded-byte
SHA-256 verification, and Git recomputation. Artifact display names alone are
not trusted. The committed manifest plus re-read Git and Release state remain
authoritative.

GitHub does not allocate the protected job's runner while it waits for required
reviewer approval, and that wait does not consume billable runner time. The
platform limit is 30 days, not an infinite wait. If approval is rejected,
cancelled, or expires, no privileged step has run. While the original 90-day
push-plan artifact remains available, dispatch with its exact `source_sha`,
`admission_run_id`, and `admission_run_attempt` may authenticate that admission,
rematerialize under the then-current protected controls, and request fresh
approval. Only drift after the new plan is created invalidates that attempt.
Once the original admission plan expires or is unavailable, recovery fails
closed and requires a new reviewed release intent; the workflow does not
promise indefinite replay. The privileged runner has a 30-minute timeout after
approval; the Environment wait occurs before that runner time is allocated.

## Publisher identities and secrets

The only remote writer is the private GitHub App:

```text
JoeyTeng/codex-review-gate-action-publisher
App ID:          4700530
Client ID:       Iv23liW83xfaR85dKJD3
installation ID: 156186692
```

It is installed only on `JoeyTeng/codex-review-gate-action`. Before any
credential is minted, the privileged job checks out protected source control,
downloads and safely extracts the assembled artifact, and repeats exact
admission validation. Only then does it mint a just-in-time installation token
with the allowlisted official `actions/create-github-app-token@v3` Action. The
request names only the target repository and explicitly narrows the token to
Administration read and Contents write. The trusted source-repository
generator is the private key's only other consumer: it creates an in-memory
RS256 App JWT with `iat = now - 60`, `exp = now + 540`, and `iss` equal to the
configured App client ID, solely for
`GET /app/installations/{installation_id}`. That JWT is never written to a
file, `GITHUB_ENV`, an artifact, an output, a summary, or a log. The separate
installation token reads `GET /installation/repositories`, is bound to the
expected App identity and sole target repository, and is the only credential
exposed to Git. It is never passed between jobs, embedded in a remote URL,
stored in an artifact, or printed. Checkout uses `persist-credentials: false`.
Git receives it only through an owner-private temporary `GIT_ASKPASS` helper
scoped to the exact target repository. Post-step revocation is best effort;
expiry is the remaining bound if the runner is forcibly terminated.

Every `uses:` dependency in the publisher workflow must be an allowlisted
GitHub-official Action referenced by its floating major, such as `@v4`, and
never `@main`. Patch-level upstream drift is consciously accepted so official
fixes arrive automatically. Moving to immutable SHA pins later would make
Dependabot in `Joey-Tools/codex-review-gate` mandatory so important updates are
not missed. A major-alias upgrade remains an ordinary reviewed infrastructure
PR and must not share a release-intent change.

The installed App grants the implicit `Metadata: read` plus `Contents:
read/write` and `Administration: read`. The publisher requests only
Administration read and Contents write for its one-repository installation
token. It does not require Workflows write.

The `marketplace-production` Environment provides:

```text
RELEASE_PUBLISHER_APP_OWNER=JoeyTeng
RELEASE_PUBLISHER_APP_SLUG=codex-review-gate-action-publisher
RELEASE_PUBLISHER_APP_CLIENT_ID=Iv23liW83xfaR85dKJD3
RELEASE_PUBLISHER_APP_PRIVATE_KEY=<environment secret>
```

The private key exists only inside the privileged `publish` job after
credential-free admission succeeds. It is supplied to the official token
Action to mint the installation token and, for the single App-installation
identity read described above, directly to the trusted generator to construct
the short-lived JWT in memory. It is never persisted or exposed through
`GITHUB_ENV`, an artifact, an output, a summary, or a log.

Publication commits, immutable tags, and floating aliases are signed by the
dedicated `JoeyTeng-Codex <codex@mahane.me>` key:

```text
primary fingerprint: AD403DAB5377F9FA0F7D775EC2844D3367B8A71B
signing subkey:       4DD48552DDEAF6D961769DD4A49827EC48984E2C
secret:               RELEASE_SIGNING_GPG_PRIVATE_SUBKEY
```

The secret contains the signing subkey material, not the unrestricted primary
secret key. It has no passphrase, so `RELEASE_SIGNING_GPG_PASSPHRASE` remains
absent instead of being configured as an empty secret. `publish` imports it
into an owner-private temporary `GNUPGHOME`, requires the pinned primary and
signing fingerprints, performs a fixed sign/verify probe, and destroys the
keyring afterward. Public encryption-only subkey metadata is harmless; another
usable secret signing, encryption, or authentication subkey is rejected.

The current signer inventory is a live access-policy and content boundary. It
binds the pinned primary fingerprint, pinned signing-subkey fingerprint, and
exact raw public certificate; it deliberately does not bind a GitHub GPG-key
REST object ID. Every durable mutation fence must re-read and revalidate that
live primary/subkey/certificate tuple, especially the final immutable-Release
publication fence. A persistent GitHub verification result on an existing
commit or tag proves that object's signature state; it does not substitute for
proof that the pinned signer is still present in the current account inventory.

The explicit `--test-enforce-live-signer-policy` seam is test-only and doubly
environment-gated: both
`CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY=1` and `NODE_ENV=test` must be
present. It is additionally accepted only with `--publish` on the
production-shaped GitHub Release path; combining it with the filesystem
`--test-release-dir` path is rejected. When enabled, the test path executes the
real GitHub inventory validator and byte-compares its raw exported certificate
with the approved certificate at the production fences. Production has no
signer-policy skip path.

The just-in-time token is proved, before the first write, to belong to the
expected Publisher App installation and sole target repository. The target
rulesets then admit that App as the only publication bypass identity. The GPG
identity is the author, committer, and signer embedded in the publication Git
objects, and its signatures remain independently verifiable after publication.

Do not over-read the later GitHub state checks: ref, commit, signature, and
Release readback proves the resulting objects and current repository state, but
GitHub does not expose an immutable historical receipt that proves which token
pushed an already accepted ref update. Consequently post-write verification
must not claim to reconstruct historical Publisher App pusher attribution.

## Target rulesets

Repository rules provide two distinct properties and must not be collapsed into
one bypassable ruleset:

1. `publisher-master-update` restricts updates to `refs/heads/master` and
   gives only the Publisher App an `always` bypass. It answers who may publish.
2. `master-integrity` requires signed commits and linear history, blocks force
   pushes, and restricts deletion, with no bypass actors. It answers what even
   the Publisher App is allowed to publish.

The currently verified rule IDs are `16454474` for
`publisher-master-update` and `21461558` for `master-integrity`. IDs are
informational read-back evidence, not substitutes for verifying each rule's
name, target, enforcement state, rules, and bypass actors.

Tag protection uses two non-overlapping rulesets:

1. `freeze-v1-tags` covers `refs/tags/v1` and `refs/tags/v1.*`, has no bypass
   actor, and freezes existing v1 tags independently of publisher code.
2. `publisher-v2-plus-tags` covers `refs/tags/v*` while excluding both v1
   patterns. It gives only the Publisher App an `always` bypass needed to
   create signed immutable full tags and advance signed major aliases.

Both rulesets restrict creation, update, and deletion as appropriate and block
unauthorized force updates. The publisher also fails closed before its first
target write if an invocation would mutate any v1 tag, v1 GitHub Release, or v1
Release asset. Ruleset IDs are only informational read-back evidence; the
publisher verifies names, targets, enforcement, ref conditions, rules, and
bypass actors.

Repository administrators can still edit rulesets; that configuration-control
authority is outside a repository-hosted workflow. `publish` therefore
re-reads the exact named rules, ref conditions, enforcement state, and bypass
actors after approval and before its first write.

## Candidate and signed release commit

`candidate-a` and `candidate-b` start from the same exact source commit but run
independently. Each materializes, packs, and uploads its candidate before it
runs `npm run check` and the complete Node test suite from its own detached
frozen-source worktree. Source test code therefore cannot mutate the uploaded
candidate, while a failed test still fails the job and prevents assembly. Each
candidate emits a canonical inventory and digests. The
inventory byte-sorts every Git path and records its type, Git mode, logical
size, and SHA-256 content digest. Only the explicit
`src/v2/gate-runtime.mjs` v2 runtime module is admitted; reintroducing a retired
v2 module blocks candidate construction. `assemble` requires both
payloads and all identity records to be byte-identical, then independently
rebuilds and binds each candidate to the frozen manifest/source payload and
this attempt's current-control inventory. Identical tampering of both artifacts
therefore still fails before
the Environment approval boundary. Candidate directories contain exactly
`candidate.json` and the declared regular-file archive; extra entries,
directories, and symlinks are rejected before content is read. Candidate
construction also extracts the final archive under its single canonical prefix
and requires its path/type/mode/size/SHA-256 inventory to equal the frozen Git
tree exactly; committed `export-ignore` or `export-subst` attributes cannot
silently change the published payload.

`publish` treats the assembled candidate only as data. It revalidates the
artifact ID and basename, archive digest, path/type/mode/size ceilings,
complete inventory, and rebuilt Git tree, and never executes candidate content.

The immutable plan deliberately does not record a live observed target-master
snapshot. A manual retry may legitimately observe the parent, the already
published wrapper, or a later verified release, and putting that observation in
the plan would make candidate/provenance bytes change. Instead,
`target_master_before` is bound exclusively to the frozen manifest's
`target.expected_head`; every unprivileged and privileged stage rebinds that
field exactly, and `publish` separately reads and reconciles the live target
before its first mutation.

The candidate payload and Git tree are deterministic. The final release commit
is deliberately outside that deterministic byte boundary because its parent,
timestamp, and signature are established after approval. `publish` constructs
one signed wrapper commit:

```text
tree:       the verified candidate tree
parent:     the frozen manifest target.expected_head
author:     JoeyTeng-Codex <codex@mahane.me>
committer:  JoeyTeng-Codex <codex@mahane.me>
signature:  4DD48552DDEAF6D961769DD4A49827EC48984E2C
```

The message records the release version, source repository, full source commit,
and release-manifest digest. The raw subtree-split commit is evidence used to
prove tree equality; it is not pushed as target `master`.

The wrapper has exactly one parent. The publisher advances `master` with an
ordinary non-force fast-forward push from the exact re-read parent. If target
`master` moved, the run stops and reconciles; it never rewrites history or
reuses an equivalent-tree force-push path. A retry that finds the intended
signed commit already published verifies and reuses it instead of creating a
second commit with a new timestamp or signature.

## Publication order

After approval, one fail-closed publication-input preflight runs before any
target ref or Release mutation. It reconstructs the expected plan from the
frozen manifest and source tree and exactly rebinds version/prerelease/tag
policy, `target_master_before`, `previous_version`, complete signer identity,
repositories/refs, source tree, payload inventory, immutable control inventory,
and candidate archive bytes. The control inventory is the one frozen by this
attempt's plan, not the old source commit's controls. The preflight also
re-reads live source `master` to determine
whether target writes remain eligible. `publish` then repeats the target-head,
ruleset, existing-tag, and existing-Release checks and follows this order:

Ordinary durable mutation fences revalidate the live source, effective
rulesets, and current signer immediately around the mutation. The stronger
ordered sequence—complete the governing policy reads, then perform the final
exact object boundary—is enforced specifically for immutable Release
publication and major-alias mutation. Each of those critical irreversible
fences freshly re-reads immutable-Release policy; the cached first-mutation
result is not proof of the policy at either later fence. In particular,
immediately before publishing an immutable Release, the publisher completes
its source/ruleset/current-signer fence and explicit immutable-Release-policy
re-read, then performs one final exact read of the frozen draft Release ID, its
complete asset inventory, and its tag binding. It then addresses that frozen
Release ID with a direct REST `PATCH` carrying the exact intended metadata. It
must not use `gh release edit`, whose convenience implementation may perform a
hidden read after the publisher's final boundary.

The GitHub REST `2026-03-10` endpoint documents `200` only when immutable
Releases are enabled and `404` when they are disabled. A `404` is therefore
`blocked_conflict` / `immutable-release-policy-disabled`; any other API or read
failure is `inconclusive` / `immutable-release-policy-unreadable`. A `200` body
is still schema-validated as an extensible object: documented fields `enabled`
and `enforced_by_owner` must be booleans, `enabled` must be `true`, and
`enforced_by_owner=false` plus additive response fields remain valid. A
non-object or missing/wrong-typed documented field fails closed before the
protected write.

1. Construct and locally verify the signed, single-parent wrapper commit.
2. Fast-forward target `master` without force, then re-read its exact commit,
   parent, tree, and GitHub signature result. This proves the accepted Git
   state, not immutable historical pusher attribution; Publisher App identity
   was instead bound from the minted credential and effective rulesets before
   the write.
3. Create the signed annotated immutable full tag `v<version>` without force.
   It points directly to the wrapper commit and is never moved or deleted.
   Re-read the exact tag object, peeled commit, commit tree, and GitHub signature
   result. Publisher identity is bound before the first write from the minted
   token's actual App slug and installation ID, target scope, and effective
   rulesets.
4. Enumerate the complete, paginated GitHub Release inventory with the
   Publisher App. That push-authorized identity can see drafts. Require a
   nonempty outer page array (`[[]]` is the valid empty-repository result),
   safe positive globally unique numeric IDs, and zero or one exact-tag match.
   A pre-existing draft is resumed by its inventory ID. A fresh invocation
   receives draft-create authority only when the immutable full tag was absent
   at invocation start and that same invocation non-force-pushed the tag, then
   read back its exact tag object and peeled commit. Two stable complete
   inventories must still prove exact-tag Release absence before creation. The
   publisher issues exactly one create request in that invocation, captures its
   status without treating it as authoritative, and always takes two new stable
   complete inventories. If they discover exactly one Release, it freezes that
   ID and continues even when the create response was lost after GitHub applied
   the request. Stable absence after that request is `inconclusive` /
   `release-creation-unknown`; the invocation never retries create. If the full
   tag already existed at invocation start while the stable complete inventory
   has no exact-tag Release, the publisher emits `inconclusive` /
   `release-create-attempt-unknown` without issuing any create request. Upload
   release assets, canonical provenance, checksums, and
   the detached provenance signature through the numeric-ID
   `uploads.github.com/repos/{owner}/{repo}/releases/{frozen_id}/assets`
   endpoint, never through a tag-resolving upload command. Each response must
   identify one positive safe asset ID with the exact name and `uploaded`
   state before the by-ID Release boundary can admit it. Existing uploaded
   prefix assets are adopted only after a raw byte read through their frozen
   asset IDs; exact-source recovery never downloads them through a tag-resolving
   command.
5. Complete the governing policy reads, then perform the final exact draft
   Release, asset, and tag boundary described above. Publish by directly
   patching the frozen Release ID with the exact metadata, then verify the
   immutable published Release.
6. For a stable version only, collect neutral canonical raw observations A and
   B of the live alias binding and compare them before interpreting tag shape
   or expected policy. Only after A equals B, validate an absent creation
   boundary or an annotated direct/peeled binding and bind the exact previously
   observed tag object as the update lease. Then run the final
   source/ruleset/current-signer policy fence, explicitly re-read immutable-
   Release policy, and capture a fresh exact immutable Release/asset/full-tag
   boundary. Then create the signed annotated floating major tag such as `v2`,
   or update it with the exact lease. The alias may move only forward through
   version history.
7. Collect and compare neutral canonical raw post-mutation alias observations A
   and B. A difference is `inconclusive` / `remote-state-changed`. When A equals
   B, validate that the stable binding is an annotated tag with the exact
   planned direct object and peeled commit; a malformed or lightweight tag, or
   a different stable binding, is `blocked_conflict` /
   `malformed-major-alias-target`. Then re-read the immutable
   Release/asset/full-tag boundary and require it to match the pre-alias
   boundary. A prerelease stops before alias mutation and never changes `v2`.

At either pre- or post-mutation alias boundary, an unreadable command or
canonical raw projection is `inconclusive` / `remote-read-inconclusive`.

After inventory discovery within one publisher invocation, each exact Release
boundary is likewise raw-first A/B. It reads `/releases/{frozen_id}` twice together with two immutable
full-tag `ls-remote` bindings, compares the neutral canonical observations,
requires every response `.id` to equal the frozen path ID, and only then
performs structural and expected-policy validation. An ID-endpoint `404` or
other unreadable result never authorizes rebinding or recreation within that
invocation. A later exact-source retry has no persisted Release-ID ledger: it
performs a new full reconcile and, when the complete inventory selects one
unique exact-tag object, freezes that ID for the new invocation. Stable absence
does not authorize recreation when the immutable full tag existed at invocation
start. The pre-existing tag is the durable cross-run create-attempt fence, and
the retry stops as `release-create-attempt-unknown`. The trusted-owner boundary
forbids deletion or replacement between attempts; the publisher does not claim
historical ID continuity across runs. Its closed classification is:

- an unreadable API, `ls-remote`, or canonical raw projection is
  `inconclusive` / `remote-read-inconclusive`;
- raw observations A and B that differ are
  `inconclusive` / `remote-state-changed`; and
- a stable but malformed or lightweight tag, or stable Release metadata,
  author, asset, tag, frozen-draft, or planned-state mismatch, is
  `blocked_conflict` / `immutable-release-mismatch`.

This raw-first order is intentional: validating either observation against
expected policy before comparing A and B could disguise a stable wrong state
as a transient read failure.

Fresh draft creation is not an exception. Its expected-absence boundary reads
complete paginated inventory A, raw full-tag binding A, complete inventory B,
and raw full-tag binding B in that order. It compares both canonical raw pairs
first, then validates inventory completeness and the exact-tag mapping. Stable
zero-match is absence; a stable exact-tag match at this boundary or A/B drift
is `inconclusive` / `remote-state-changed`. A stable exact tag claimed by
multiple distinct IDs is `blocked_conflict` / `duplicate-release-tag`.
Outer `[]`, malformed pages, an unsafe ID, a repeated numeric ID (including
pagination overlap), or any unreadable page is incomplete evidence and becomes
`inconclusive` / `remote-read-inconclusive`. Post-create discovery runs
regardless of the create command's exit status and repeats the same two complete
inventory/tag observations. One unique exact-tag match freezes the positive
numeric ID and safely recovers a lost response in the same invocation. Stable
absence is `inconclusive` / `release-creation-unknown`, because eventual
visibility is not proof that a second create would be safe; that invocation
stops without another create. A later invocation that starts with the immutable
full tag already present also does not create: stable Release absence is
`inconclusive` / `release-create-attempt-unknown`. Neither the same
`source_sha`/admission inputs nor a new Environment approval resets this
cross-run fence. Consequently, a crash after tag push but before create, or a
create request that fails before GitHub visibly applies it, requires explicitly
reviewed manual intervention; an ordinary dispatch cannot retry the create.
Response loss remains automatically recoverable when the complete inventory
finds one unique eligible draft. Unreadable, drifting, malformed, or duplicate
observations retain the closed classifications above. The pre-create and
post-create tag A/B boundaries must also match exactly. Keeping both inventory
boundaries raw-first prevents an ambiguous create result, incomplete
enumeration, or torn enumeration from authorizing duplicate creation or object
selection.

This distinction is required by GitHub's interfaces. The REST
[release-by-tag endpoint](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#get-a-release-by-tag-name)
is published-only, so its `404` does not prove that no draft exists. The
[complete Release list](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#list-releases)
includes drafts for callers with push access. GitHub CLI's own
[`FetchRelease`](https://github.com/cli/cli/blob/trunk/pkg/cmd/release/shared/fetch.go#L179-L259)
therefore looks up published-by-tag and draft candidates separately, then reads
a selected draft through `/releases/{id}`. The publisher follows the same
identity rule without relying on porcelain: inventory selects exactly one
numeric ID, and every mutable or draft boundary stays on that ID. Only public
verification of an already published Release uses release-by-tag.

Asset upload is also an identity-bound mutation. A nonzero upload result, or
a zero-exit response that is empty, malformed, has an unsafe asset ID, names a
different asset, or does not report `state=uploaded`, is `inconclusive` /
`release-asset-upload-unknown`: bytes may already have reached the frozen
Release. After a successful POST response, the publisher first captures the
frozen by-ID Release boundary and requires the returned asset ID to belong to
that object. It then downloads bytes directly through
`/releases/assets/{asset_id}` with the binary media type and compares them to
the intended file; this post-upload path never resolves a Release by tag. A
read failure or byte mismatch is also `release-asset-upload-unknown` because
the mutation already occurred. Within the current invocation, recovery never
rebinds the Release. A later exact-source retry starts from a complete
inventory and freezes the then-unique exact-tag object under the trusted-owner
no-replacement contract.

GitHub documents that an upload `502` can leave an empty asset in `starter`
state. A retry admits that state into the neutral inventory only so its typed
identity and content fields can be compared; it is not accepted as a completed
asset. Automatic recovery is limited to exactly one `starter` on the selected
mutable draft, with the Publisher App uploader, the planned
`application/octet-stream` type, zero bytes, no digest, an expected name, and
the single next slot after the verified uploaded canonical prefix. Asset names
and numeric IDs must be unique, including asset IDs across the complete
inventory. After the final policy fence, the publisher takes a fresh stable
by-ID A/B boundary and requires it to equal the selected boundary before it
issues one unconditional DELETE for that frozen asset ID. It then reconciles
every DELETE outcome, including `204`, `404`, network failure, and response
loss, through another stable frozen-ID boundary. Publication continues only
when the exact starter ID is absent and every other protected field is
unchanged; otherwise it returns `inconclusive` /
`starter-asset-deletion-unknown` without a second DELETE in that invocation.
Uploaded, nonzero, wrong-name, wrong-slot, wrong-uploader, wrong-content-type,
or otherwise unbound assets are never deleted.

The asset DELETE endpoint has no state-predicate compare-and-swap. The final
GET-to-DELETE interval therefore retains a small race that the client cannot
eliminate. Safe automatic recovery depends on the trusted-owner/single-writer
deployment boundary and GitHub's documented empty `starter` terminal orphan
shape; another Release writer in that interval violates the deployment
contract.

GitHub's official Release REST endpoint exposes no supported conditional
compare-and-swap precondition for this `PATCH`; the publisher does not rely on
undocumented conditional headers. Consequently, the small interval between
the final draft/asset/tag read and the publish `PATCH` cannot be eliminated by
the client. Workflow concurrency serializes publisher runs but cannot serialize
an independent Release writer. The deployment contract therefore makes the
private Publisher App the only automated Release writer and treats
`JoeyTeng`, the repository owner, as the explicit trusted manual writer. Any
other concurrent Release writer violates the deployment contract. If
post-publication readback detects a mismatch, publication remains blocked and
must not claim automatic recovery. A nonzero direct `PATCH`, or a zero-exit
response that is empty, malformed, or identifies a different Release ID, is
`inconclusive` / `release-publication-unknown`, because the mutation may have
applied. Reconcile must retry the same exact source, reselect the then-unique
exact-tag object from the complete inventory, and prove either that its draft
state remains a valid prefix or that the exact Release is already immutable;
it must not blindly choose a different version or claim cross-run ID
continuity. A deterministic
post-publication mismatch remains blocked.

There is no `v2.0` alias in this contract. A floating alias does not receive a
separate GitHub Release; Releases belong only to immutable full-version tags.
Consumers use `JoeyTeng/codex-review-gate-action@v2` after the stable release
is admitted, so later v2 patches do not require edits in every consumer repo.

Provenance binds at least the release intent, exact source commit and subtree,
candidate tree and complete payload inventory, wrapper commit and parent,
signing identity, immutable tag object, assets, and observed target state. It
does not contain a self-referential digest. The floating-alias result is mutable
post-publication state rather than data forged into already immutable
provenance.

## Verification and admission

`verify` has no Environment and no publisher or signing secrets.
It performs a fresh public read of target `master`, the immutable tag and
peeled commit, signatures, Release immutability and assets, and—after a stable
release—the floating alias. Its Actions summary records the observed state and
one closed recovery result: `recovery_code=none` when verification is complete,
or a supported non-success recovery code with the exact next action when any
required state is incomplete, conflicting, or could not be proved. The summary
must not omit the recovery result or substitute an open-ended instruction to
guess at repair.

Public verification obtains both its initial and final Release-view metadata
from the direct REST release-by-tag endpoint using the GitHub REST `2026-03-10`
contract. Historical completed-Release by-tag reads use the same explicit API
version. It projects `draft`, `prerelease`, `tag_name`, `name`, and `body` into
the closed view used for comparison. Its initial and final complete Release
inventories use the same structural validator as publication: at least one
outer page, array pages, positive safe numeric IDs, and global ID uniqueness.
Outer `[]`, malformed pages, or repeated IDs are incomplete evidence and are
`inconclusive` / `remote-read-inconclusive`. A documented REST HTTP 404 is
classified as the applicable missing or disappeared Release state; other API
failures are inconclusive. Verification never infers an HTTP status from
`gh release view` porcelain stderr.

Every full SemVer, including every prerelease, minor, and patch version,
receives its immutable full tag and immutable GitHub Release. Marketplace is a
separate, manual, out-of-band operator task only for the first stable release
of each major: `v2.0.0`, later `v3.0.0`, and so on. On that Release page, a
human uses the Action Marketplace Release UI to publish the major's initial
listing version. Minor and patch releases require no Marketplace operation.

The publisher never waits for, reads back, or gates success on Marketplace.
Marketplace does not create or resolve the floating `v2` Git ref. The accepted
tradeoff is that the listing may continue to display `v2.0.0` for the lifetime
of v2 while the signed `v2` alias advances to newer immutable releases.

Before consumer rollout, the full tag must be usable, stable `v2` must peel to
the same admitted commit, and the immutable Release and provenance must match.
For the first stable release of a major, the separate Marketplace UI task may
be completed after publisher success; its completion is not machine read-back
evidence and is not a publisher admission condition. Dedicated
immutable-tag and floating-alias canary jobs are deferred and are not v2.0
publication or rollout gates. The manual default-branch RC admission bridge
below reuses the existing consumer workflows; it is not one of those deferred
dedicated canary jobs. Prereleases are never production selectors and do not
move `v2`.

### Stable v2.0 RC admission bridge

Before publishing stable `v2.0.0`, first publish one immutable
`v2.0.0-rc.N` full tag and prove a complete live gate loop in the designated
test consumer repository. Do not change the production bootstrap `@v2`
templates or their normal floating selectors. Use this owner-reviewed,
short-lived default-branch bridge instead:

Prepare the bridge manually; do not add an RC override to the production
bootstrap or activate the production v2 ruleset for this temporary admission
exercise. Existing test-repository protection and the required owner review
govern the two short-lived default-branch changes.

1. In the designated test consumer, open a selector-only PR that changes only
   the Action selectors in both installed canonical workflows—the verifier and
   the controller—from `@v2` to the exact immutable `@v2.0.0-rc.N`. Have the
   repository owner review it and merge it into the protected default branch.
2. From that updated default branch, open a separate harmless test PR. Exercise
   the complete normal `begin-review` and `reconcile` path on its exact head,
   including the required Codex evidence and final gate result.
3. Record the harmless test PR's exact head, the controller and verifier run
   IDs or URLs, and the resolved tag `v2.0.0-rc.N`. After the live gate
   succeeds, close that harmless test PR without merging it.
4. Open and merge a forward PR that removes the temporary bridge and restores
   the exact pre-bridge bytes of both default-branch workflows. If that state
   contained the canonical production verifier and controller, both selectors
   return to `@v2`; otherwise remove the temporary RC workflows rather than
   leaving an immutable RC selector behind.

A PR-local wrapper does not qualify: the trusted verifier and controller,
including the controller's manual-dispatch contract, are loaded from the
default branch. A non-default dispatch is likewise unsupported and provides no
admission evidence. This temporarily merged selector bridge is a manual use of
the existing consumer contract, not a publisher-integrated immutable-tag
canary, floating-alias canary, dedicated canary job, or canary orchestrator.

## Reconcile, retry, and cancellation

Publication is a sequence of remote operations, not one cross-service
transaction. Every privileged retry begins with a full reconcile of:

- the manifest and exact source commit;
- current target `master` and its ancestry;
- the intended wrapper commit and full tag object;
- draft or published Release state and every asset digest;
- the floating alias for stable releases;
- effective branch and tag rulesets; and
- the current pinned signer primary/subkey/raw-certificate inventory.

Reconcile returns exactly one remote-state class: `fresh`,
`resumable_partial`, `already_complete`, `superseded`, `blocked_conflict`, or
`inconclusive`. It may reuse only an exact signer/parent/tree/digest-matching
prefix of the canonical publication sequence. Every durable write is re-read.
An older partial release blocks a newer release from leapfrogging it.

The fully paginated Release-inventory stability fingerprint is a closed,
decision-relevant projection. It binds Release and asset object identities,
tag and lifecycle policy, immutable metadata, asset digests and byte metadata,
and author/uploader identities. It deliberately excludes observational or
decorative API fields such as `assets[].download_count`, timestamps, and
profile URLs.
It canonicalizes Release/page and asset array order, so pagination placement
or response ordering alone is not treated as mutation, while preserving all
protected values for A/B comparison before policy interpretation.
Downloading an asset during reconcile can change a download counter without
changing any protected publication property; treating that counter as state
mutation would make the verifier invalidate its own otherwise stable snapshot.

A completed exact step is verified and reused; an absent next step may resume
only when that mutation's contract authorizes it. Draft Release creation is the
exception: once the immutable full tag exists across invocations, stable
Release absence returns `release-create-attempt-unknown` and requires an
explicitly reviewed manual recovery rather than another ordinary dispatch.
A conflicting tag, commit, signature, Release asset, unexpected target advance,
or unknown state fails closed with a specific recovery summary. The publisher
never deletes or rewrites an immutable full tag or Release, force-pushes
`master`, or moves a major alias backward. Recovery after an immutable
conflict is a reviewed forward release, normally a new patch version.

Each attempt's immutable plan binds the frozen release intent and the current
protected control commit and complete control-file digests used for that
attempt. If a short-lived candidate, assembled-candidate, or publication-plan
artifact expires or becomes unavailable while the original 90-day push-plan
admission remains valid, the exact three-input dispatch may authenticate that
persisted admission, independently rematerialize both candidates under the
then-current protected controls, construct a fresh plan and publication plan,
and obtain Environment approval again. The new run must still classify and
reconcile every remote object before writing. It may resume only an exact valid
prefix; otherwise it stops with `blocked_conflict` or `inconclusive`. If the
original push-plan admission expires or is unavailable, recovery fails closed
and requires a new reviewed release intent rather than reconstructing admission
from Git alone. If a durable immutable conflict cannot be reconciled, preserve
it for diagnosis and publish a reviewed higher version that repairs forward.
Historically restoring earlier code is allowed only through that higher
version; the floating alias never moves backward through version history.

The workflow-level concurrency contract is:

```yaml
concurrency:
  group: codex-review-gate-action-release
  cancel-in-progress: false
```

The `false` value is intentional and must be covered by static workflow tests.
A newer run must not automatically terminate an active release between
advancing `master`, creating the immutable tag, publishing the Release, and
updating the alias. Cancellation does not roll back those remote writes, and
App-token revocation on a forcibly terminated runner is only best effort. A
pending run may be superseded by a later pending run; an active run remains
uninterrupted. The owner may still cancel it deliberately after inspecting
remote state, but the next run must perform full reconcile before continuing.

## Initial v2 scope and deferred work

Initial v2 publication deliberately keeps v1-like operational simplicity: one
source-hosted publisher, two deterministic candidate builds, one protected
publication stage, and one unprivileged public-verification stage. It does not
introduce the old pre-activation controller, three Environment wait jobs, a
scheduled consumer scan, dedicated immutable-tag or floating-alias canary jobs,
or a separate canary orchestrator as release prerequisites.

Stable `v2.0.0` admission additionally requires a published `v2.0.0-rc.N` and
the default-branch RC admission bridge described above in the designated test
consumer repository. The RC uses only its immutable full tag; it does not move
`v2`. The selector-only bridge PR is merged temporarily so both trusted
default-branch workflows resolve the RC, the separate harmless test PR is
closed unmerged after success, and a forward PR then restores both workflows'
exact pre-bridge bytes: only a consumer that originally had the canonical
production verifier and controller returns both selectors to `@v2`; otherwise
the temporary RC workflows are removed. The ordinary post-installation `@v2`
consumer canary remains separate from the publisher.

The following are explicitly deferred and must not be represented as completed
or silently promoted into the current contract:

- dedicated immutable-tag and floating-alias canary jobs, including richer
  multi-repository or multi-phase canary orchestration;
- Marketplace publication automation and machine-verifiable admission;
- detailed rollback and forward-recovery automation for every partial GitHub
  Release failure mode; and
- optional temporary numeric overrides for release or runtime soft limits.

For an unimplemented edge, stop, preserve observed state, and use reviewed
forward recovery. Do not weaken a ruleset or mutate immutable history.

## Historical v1 evidence

The following is retained as historical evidence, not as the live v2 publisher
contract:

- v1 was published in `JoeyTeng/codex-review-gate-action`, so v2 keeps the
  existing Marketplace listing instead of publishing from a second repo;
- the recorded pre-v2 target `master` was
  `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`, with tree
  `8d909dd441b28b6915c46f60e8a144e64fd5268b`;
- the recorded `v1.5.1` annotated tag object was
  `f9201d016b0abd21403550c3bf8030eb0beb76b4`, and v1.1.0 through v1.5.1
  release refs and assets remain historical target state; and
- the recorded v1 `master` was an unsigned raw subtree-split commit, while the
  verified `v1.5.1` annotated release tag had a valid GPG signature; v1 also
  used manual release evidence and an SSH deploy-key publication path.

Those facts explain migration checks but grant no current authority. v1 refs
remain frozen; v2 uses the Publisher App, signed wrapper commits, committed
SemVer intent, immutable full-version Releases, and the floating `v2` selector.
