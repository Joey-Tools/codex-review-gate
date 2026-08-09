# Releasing the Action Package

Languages: [British English (en-GB)](RELEASING.md) | [简体中文 (zh-CN)](RELEASING.zh-CN.md)

The Marketplace repository is a subtree split of `packages/action`. Everything
needed at the root of `JoeyTeng/codex-review-gate-action`, including the
reusable workflow, must live inside that directory.

## Two-Phase Rollout Boundary

This procedure prepares a future v1.5.0 release; completing source changes does
not mean that the release has occurred.

The release PR stages the reusable workflow only in `packages/action`. It must
not activate the source-root caller, the repository template, or their root
documentation. After the immutable v1.5.0 release and provenance are published,
the `v1.5` and `v1` aliases are verified, and a live `@v1` canary passes, use a
separate activation PR for those caller/template changes.

This order ensures that no active source or template caller delegates
pre-execution trust to `@v1` before immutable post-run authority exists.

## Preconditions

- The source release commit is merged to the exact `master` tip.
- Root `package.json` and `packages/action/package.json` both declare `1.5.0`.
- `packages/action/decision-table.json` declares `schema_version: 1`,
  `policy_major: 1`, and `policy_version: 1.4.0`; its reviewed frozen raw
  SHA-256 is
  `3f0032df69e2015c1dfe198c20a141652b2dcaba520e8749a5d049d31ffd7ad3`.
- Producer protocol major 1 and producer receipt schema v1 remain compatible.
- `packages/action/.github/workflows/codex-review-gate.yml` exists. Its runtime
  closure contains only full-SHA-pinned
  `actions/checkout@11d5960a326750d5838078e36cf38b85af677262` and
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`,
  plus the local `./.codex-review-gate-action` use.
- The called workflow checkout uses exact
  `repository: ${{ job.workflow_repository }}`,
  `ref: ${{ job.workflow_sha }}`, path `.codex-review-gate-action`, and
  `persist-credentials: false`. It contains no bare or PR checkout.
- The other reviewed frozen raw SHA-256 values match the generator constants:
  `action.yml` is
  `3b73835ec0e8dfb2305f0801ebaa7b3f9ea04e02c72392e822aabcd25d2093be`,
  the reusable workflow is
  `91720b868b972d947a65fa3cc408d8c866d83cf4d75032f6bfb597b014752bce`,
  and `producer-receipt.schema.json` is
  `89decfcabeeab817a975b1118498375c4eafe730b35e2cb9aa5c4abde6637b77`.
- Source checks, package checks, tests, and the release split validation pass.
- The action repository default branch can receive the verified subtree split.
- The release operator has the trusted OpenPGP key available and has obtained
  its expected primary-key fingerprint from the independently controlled
  signer policy. Do not derive trust from a fingerprint first seen in the
  candidate manifest.
- The release operator's GitHub credential can read repository Administration
  state for the immutable-release preflight.

The action repository must have immutable releases enabled before any release
ref is published. With GitHub REST API version `2026-03-10`, require HTTP 200
and exact top-level `enabled: true` from
`GET /repos/JoeyTeng/codex-review-gate-action/immutable-releases`; 404 or any
other value fails closed. `enforced_by_owner` may be recorded but does not
change admission. See GitHub's
[repository endpoint](https://docs.github.com/en/rest/repos/repos?apiVersion=2026-03-10#check-if-immutable-releases-are-enabled-for-a-repository)
and [immutable-release guidance](https://docs.github.com/en/enterprise-cloud@latest/code-security/concepts/supply-chain-security/immutable-releases).

```bash
set -euo pipefail

test "$(
  gh api \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    repos/JoeyTeng/codex-review-gate-action/immutable-releases \
    --jq '.enabled'
)" = true
```

The provenance generator records signature verification and fingerprints, but
it does not decide which primary signer is trusted and it does not perform a
revocation-freshness service check. Those are consumer/operator policy inputs.

## Synchronise and Prove the Subtree

The canonical path is the automatic sync workflow. After the source release
commit merges, select the exact `sync-action-subtree.yml` push run whose
`headSha` equals that source commit, watch it to terminal `success`, and retain
the run ID/URL/head SHA as release evidence. The workflow pushes only the
computed `packages/action` split to
`JoeyTeng/codex-review-gate-action:master`; it does not create releases or move
tags. It normally fast-forwards and uses its guarded equivalent-parent lease
path only for the documented squash-merge case.

Independently, in a fresh full-history checkout of the exact source commit,
run the split validation and record the computed split commit:

```bash
set -euo pipefail

npm run release:split
```

Then use a fresh full checkout of the action repository to require
`master` to equal that recorded computed split commit and prove tree equality.
Do not perform a second manual push after the automatic sync succeeds.

Manual publication is an explicit fallback only when the automatic workflow
cannot be used. It requires a separately verified `action` remote and the same
fresh/full source checkout and split proof:

```bash
set -euo pipefail

git remote get-url action
scripts/release-action-subtree.sh --remote action --branch master --push
```

After sync, require all of the following:

- source `master` is the intended source release commit;
- the selected sync run has that exact `headSha` and terminal `success`;
- action `master` is the intended split commit;
- the source commit's `packages/action` tree OID exactly equals the action
  commit's root tree OID; and
- neither default ref changes during tag/provenance preparation.

## Create and Verify Local Release Tags

Create three direct signed annotated tags in the action repository, all peeling
to the same verified action commit:

1. immutable release tag `v1.5.0`;
2. minor compatibility alias `v1.5`; and
3. major compatibility alias `v1`.

Never move `v1.5.0`. Leave all existing immutable and older compatibility tags
untouched. A generic `git push -f --tags` is prohibited.

The generator resolves an absolute GnuPG executable, clears inherited `GIT_*`
and global/system Git configuration, and accepts each tag only when
`git verify-tag --raw` yields exactly one identity-consistent `GOODSIG` and
`VALIDSIG` with no rejecting status. It records both
`signing_key_fingerprint` and `primary_key_fingerprint` for each tag.

Before publication, require every tag's recorded
`primary_key_fingerprint` to equal the independently predeclared trusted
primary fingerprint. A signing subkey fingerprint may differ; that is why the
primary fingerprint is the trust anchor.

At the start of this release session, before replacing the local `v1` alias,
freshly probe the remote and require strictly empty output for both
`refs/tags/v1.5.0` and `refs/tags/v1.5`; require both local refs to be absent as
well. If any exists, stop and audit it—never overwrite an immutable or minor
release ref. Then read the remote `v1` tag-object OID once and persist it as
release evidence. That previously observed value—not a fresh value first seen
immediately before the alias push—is the exact lease expectation used later.

Use the same resolved GnuPG executable and unchanged keyring for all three
local tags:

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
release_evidence_path="v1.5.0-expected-remote-v1-tag-object.txt"
test ! -e "$release_evidence_path"
remote_immutable_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5.0
)"
remote_minor_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1.5
)"
test -z "$remote_immutable_record"
test -z "$remote_minor_record"
for release_ref in refs/tags/v1.5.0 refs/tags/v1.5; do
  if git -C "$action_repo_path" show-ref --verify --quiet "$release_ref"; then
    exit 1
  else
    test "$?" -eq 1
  fi
done
remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1
)"
expected_remote_v1_tag_object_oid="${remote_v1_record%%$'\t'*}"
test "$remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]
printf '%s\n' "$expected_remote_v1_tag_object_oid" > "$release_evidence_path"

action_release_commit="$(
  git -C "$action_repo_path" rev-parse 'refs/heads/master^{commit}'
)"
release_gpg_path="$(realpath "$(command -v gpg)")"
test -x "$release_gpg_path"

git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.5.0 "$action_release_commit" \
  -m "codex-review-gate-action v1.5.0"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.5 "$action_release_commit" \
  -m "codex-review-gate-action v1.5"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -f -s -a v1 "$action_release_commit" \
  -m "codex-review-gate-action v1"
```

## Generate Provenance Schema v2

Run the complete generator against the frozen default refs and all three local
tag refs:

```bash
set -euo pipefail

source_repo_path="$(pwd -P)"
action_repo_path="../codex-review-gate-action"
source_release_commit="$(git rev-parse 'refs/heads/master^{commit}')"
action_release_commit="$(
  git -C "$action_repo_path" rev-parse 'refs/heads/master^{commit}'
)"

npm run release:provenance -- \
  --source-repo "$source_repo_path" \
  --source-repository JoeyTeng/codex-review-gate \
  --source-commit "$source_release_commit" \
  --source-default-ref refs/heads/master \
  --action-repo "$action_repo_path" \
  --action-repository JoeyTeng/codex-review-gate-action \
  --action-commit "$action_release_commit" \
  --action-default-ref refs/heads/master \
  --immutable-tag-ref refs/tags/v1.5.0 \
  --minor-tag-ref refs/tags/v1.5 \
  --major-tag-ref refs/tags/v1 \
  --output v1.5.0-release-provenance.json
```

The generator checks the source/action default refs and all three local tag
refs twice before create-only output publication, with the second check
immediately before the final atomic hard link. It never overwrites or removes
an existing output path. Together with its
in-generation ref checks, this narrows the local TOCTOU window only; it does
not create an atomic snapshot across the source and action repositories or
across multiple refs. Remote publication must still use the exact leases/CAS
boundaries below and re-read remote ref, tag-object, and peeled-commit values
both before and after mutation.

`--test-only-skip-signature-verification` is forbidden in production. It is
accepted only by hermetic tests under both explicit test guards.

The deterministic asset has schema
`urn:joeyteng:codex-review-gate:release-provenance:2`, `schema_version: 2`, and
`release: 1.5.0`. Its exact top-level map is `compatibility`, `source`,
`action`, `runtime_closure`, `tags`, `proofs`, `released_tree`,
`critical_files`, and `contracts` in addition to those identity fields.

Verify at least this complete evidence:

- `compatibility.producer_protocol_major == 1` and
  `compatibility.github_immutable_release_required == true`;
- receipt schema ID/version 1 and decision table schema 1,
  `policy_major: 1`, `policy_version: 1.4.0`;
- called workflow repository/path and caller selector `v1`;
- exact source/action commit and tree OIDs, with source subtree tree equal to
  action root tree;
- all three direct annotated tag-object OIDs, their common peeled action
  commit, verified signatures, signing-key fingerprints, and trusted primary
  fingerprints;
- the complete NUL-delimited released-tree inventory and digest;
- critical file blob OIDs/raw SHA-256 values for `package.json`, `action.yml`,
  `.github/workflows/codex-review-gate.yml`,
  `producer-receipt.schema.json`, and `decision-table.json`;
- the frozen admission digest for `action.yml`, the reusable workflow, the
  receipt schema, and the decision table, plus the decision table's immutable
  action-SHA URL;
- `runtime_closure.called_workflow.caller_reference` binding canonical `@v1`
  and its `immutable_reference` binding the exact action SHA; exact
  `source_checkout`, exact local action use, and the closed two-entry external
  action list; `contracts.producer_receipt.source_checkout` must copy the same
  checkout object;
- `referenced_workflows` exact-attempt selection and the cross-bind from its
  selected SHA and receipt `job.workflow_sha` to
  `release-provenance.action.commit_oid`;
- the exact four-item SHA-domain prohibition: neither exact run-attempt
  `head_sha` nor Artifact API `workflow_run.head_sha` may be required to equal
  the selected receipt status head; exact run-attempt `head_sha` may not be
  required to equal `GITHUB_WORKFLOW_SHA`; and `GITHUB_WORKFLOW_SHA` may not be
  required to equal `job.workflow_sha`; and
- `proofs.revocation_freshness_checked == false` and
  `proofs.release_asset_is_signed_attestation == false`.

The signed tags authenticate their tag objects; the JSON asset is not itself a
signature, OIDC attestation, or signed attestation. Immutable-release controls
protect the published tag and assets after publication. Point-in-time
verification still does not prove historical or future revocation freshness.

## Publish in the Safe Order

Prepare `v1.5.0-release-notes.md` with no SHA placeholders. It must state:

- canonical post-activation caller
  `jobs.<job>.uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`;
- floating `@v1` is the centralised pre-execution trust boundary, while
  post-run authority comes from exact `job.workflow_sha`, exact-attempt
  `referenced_workflows`, and the trusted-signer immutable release/provenance;
- the actual lower-case action commit for audit and direct composite/GHES
  compatibility;
- producer protocol major 1, receipt schema v1, decision `policy_major: 1` and
  `policy_version: 1.4.0`;
- receipt output names and their causal/integrity-only limitations; and
- the separate post-release activation gate.

Publish in this order so an `@v1` consumer never sees new runtime code before
its immutable release authority is available:

1. Push only `refs/tags/v1.5.0`, without force, then verify its remote tag-object
   OID and peeled action commit.
2. Create a draft GitHub Release for `v1.5.0`; attach the final notes and
   `v1.5.0-release-provenance.json` while it is still draft.
3. Recheck the immutable-release repository setting, draft tag, asset name,
   asset SHA-256, and notes; then publish the draft.
4. Require the release REST object to report exact `immutable: true`. Run
   `gh release verify v1.5.0 --repo JoeyTeng/codex-review-gate-action` and
   `gh release verify-asset v1.5.0 v1.5.0-release-provenance.json --repo JoeyTeng/codex-review-gate-action`, and
   independently re-download and digest-check the asset.
5. Only after those checks succeed, atomically publish `v1.5` and move `v1` to
   their admitted signed tag objects. Use an exact `--force-with-lease` for the
   previously observed remote `v1` tag-object OID. Require atomic push support;
   a rejected ref leaves both aliases unchanged.
6. Re-read both remote alias tag-object OIDs and peeled commits. Rerun the
   generator to a verification file and require byte-for-byte equality with
   the already published provenance asset.

The immutable tag and draft-to-published release steps have this shape:

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
git -C "$action_repo_path" push origin \
  refs/tags/v1.5.0:refs/tags/v1.5.0

gh release create v1.5.0 \
  --repo JoeyTeng/codex-review-gate-action \
  --draft \
  --verify-tag \
  --title "codex-review-gate-action v1.5.0" \
  --notes-file v1.5.0-release-notes.md \
  v1.5.0-release-provenance.json

gh release edit v1.5.0 \
  --repo JoeyTeng/codex-review-gate-action \
  --draft=false

test "$(
  gh api \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    repos/JoeyTeng/codex-review-gate-action/releases/tags/v1.5.0 \
    --jq '.immutable'
)" = true

gh release verify v1.5.0 \
  --repo JoeyTeng/codex-review-gate-action
gh release verify-asset \
  v1.5.0 \
  v1.5.0-release-provenance.json \
  --repo JoeyTeng/codex-review-gate-action
```

The alias push shape is deliberately separate from the immutable tag/release:

```bash
set -euo pipefail

action_repo_path="../codex-review-gate-action"
release_evidence_path="v1.5.0-expected-remote-v1-tag-object.txt"
expected_remote_v1_tag_object_oid="$(sed -n '1p' "$release_evidence_path")"
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]
current_remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags origin refs/tags/v1
)"
test "$current_remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'

git -C "$action_repo_path" push --atomic \
  --force-with-lease="refs/tags/v1:$expected_remote_v1_tag_object_oid" \
  origin \
  refs/tags/v1.5:refs/tags/v1.5 \
  refs/tags/v1:refs/tags/v1
```

Do not fall back to separate alias pushes if the atomic update fails. Re-read
remote state, resolve the conflict, and rerun the full admission proof. Retain
the persisted pre-release `v1` tag-object OID with the other release evidence.

## Live Canary and Activation

Run a GitHub.com canary through the published canonical caller at `@v1`. Require
all of the following before activation:

- the called job's `job.workflow_repository/file_path/ref/sha` is the canonical
  tuple and exact v1.5.0 action commit;
- the receipt maps that job repository/SHA to `producer.action` with
  `immutable: true`;
- the exact run-attempt response contains exactly one canonical
  `referenced_workflows` member whose SHA matches the receipt and release
  provenance;
- the receipt artifact, status membership, GraphQL status re-read, and
  independently reduced provider evidence all pass their stable checks; and
- the canary did not checkout or execute PR code.

Only then open the separate activation PR that changes the source-root caller,
template caller, and root/template consumer documentation to `@v1`.

Future compatible v1.x Action-only releases can advance `v1` without changing
the caller or Skill, provided the same dynamic admission accepts their signed
immutable release/provenance and `policy_major: 1`. A producer protocol or
policy major change is breaking and requires a coordinated Skill/caller plan.

## Why Subtree

`packages/action` is a stable package boundary whose contents are complete as
a repository root. `git subtree split --prefix=packages/action` is therefore a
direct release operation; source-only tests, CI, and rollout coordination stay
outside the published package.
