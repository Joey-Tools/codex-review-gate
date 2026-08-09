# Releasing the Action Package

The Marketplace repository is a subtree split of `packages/action`. Keep every file that must appear at the root of `JoeyTeng/codex-review-gate-action` inside that directory.

## Preconditions

- The source repository is on the release commit.
- Both `package.json` and `packages/action/package.json` contain the same
  release version.
- `packages/action/producer-receipt.schema.json` and the machine-readable
  [decision table](../packages/action/decision-table.json) are present; the
  latter declares `policy_version: 1.4.0`. `packages/action/action.yml`
  exact-pins `actions/upload-artifact` at
  `ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4.6.2`).
- The action repository has a write-enabled deploy key, and the source repository stores the private key as an `ACTION_REPO_DEPLOY_KEY` secret. The sync workflow also accepts the legacy `ACTION_REPO_PUSH_TOKEN` secret name for this private key while existing repo configuration catches up.
- For local manual publishing, the action remote is configured, for example:

```bash
set -euo pipefail

git remote add action git@github.com:JoeyTeng/codex-review-gate-action.git
```

## Automatic Default-Branch Sync

`.github/workflows/sync-action-subtree.yml` runs on pushes to `master` that touch `packages/action/**`, the sync workflow, or the release split script. It checks out full history, runs `scripts/release-action-subtree.sh --remote action --branch master --push --force-if-equivalent-parent`, and pushes only the computed subtree split commit to `JoeyTeng/codex-review-gate-action:master`.

The workflow does not create GitHub Releases and does not create or move tags. It normally uses a fast-forward push. It uses `--force-with-lease` only when the action repository branch is not an ancestor of the computed split commit and its tree exactly matches either the split commit tree or the split commit's parent tree, which covers equivalent subtree histories created by source-repository squash merges. If no deploy-key secret is configured, the action repository rejects direct pushes, or the action repository branch has diverged in content, the workflow fails instead of forcing an unsafe update.

Manual workflow dispatch validates the split by default. Set `push_to_action_repo=true` only when you intentionally want the workflow to push the split commit.

## Manual Validate and Split

From the source repository root:

```bash
set -euo pipefail

npm run release:split
```

The script runs the source checks, action package checks, tests, and whitespace validation, then prints the subtree split commit.

To also push the split commit to the action repository default branch:

```bash
set -euo pipefail

scripts/release-action-subtree.sh --remote action --branch master --push
```

## Publish the Canonical Action Pin

The canonical consumer reference is the exact 40-hex commit in the action
repository, not the source commit and not a tag. Source documentation uses
`<v1.4.0-action-commit-sha>` because that action-repository commit does not
exist until the source release is merged and the subtree is synchronised.

After sync, require the action repository default-branch SHA to equal the
verified split commit. Publish that exact value in both the v1.4.0 release notes
and release provenance manifest in this form:

```yaml
- uses: JoeyTeng/codex-review-gate-action@<exact-action-repository-40-sha>
```

Consumers may use `@v1.4` or `@v1` for convenience, but those floating aliases
are never canonical and cannot establish invocation provenance.

Release notes must also identify producer receipt schema v1 and its
`producer-receipt-artifact-id`, `producer-receipt-artifact-url`, and
`producer-receipt-artifact-digest` outputs. State that the receipt is
GitHub.com-only causal producer evidence, artifacts can expire or be deleted,
and consumers must still independently reduce provider evidence. Do not
describe the receipt or digest as a signature, OIDC attestation, or
content-addressed storage guarantee.

## Minor Release Tags and GitHub Release

Action consumer tags must point at commits in the action repository history, not source-repository commits. After validating the pushed action repository commit, create or update release tags in the action repository deliberately.

For the 1.4 minor release, first confirm that the action repository default
branch is the verified subtree split commit and that the split checks passed.
The provenance generator resolves an executable GnuPG from an absolute `PATH`
entry, clears inherited `GIT_*` variables and global/system Git configuration,
forces OpenPGP through
`gpg.format`, `gpg.program`, and `gpg.openpgp.program`, and accepts each tag
only when `verify-tag --raw` emits its closed status contract: exactly one
`GOODSIG`, exactly one identity-consistent `VALIDSIG`, and no rejecting GnuPG
status. A standalone `git verify-tag` is useful diagnostics, but it is not the
release admission gate.

Run the following fail-fast sequence from the final source checkout. Keep
`PATH` and the GnuPG keyring unchanged for the whole sequence. It creates all
three local signed annotated tags first, captures the current remote `v1` tag
object for an exact lease, and runs the complete provenance generator before
any tag is pushed. Only a successful generator exit admits the three pushes.
`v1.4.0` and `v1.4` are pushed normally; only `v1` uses the exact lease. Never
move `v1.4.0`, and leave the existing `v1.3` compatibility tag and every
`v1.3.x` immutable tag unchanged.

After all pushes, the same sequence proves every remote tag-object OID and
peeled commit against the admitted local values, then reruns the generator to
produce the final release asset. The pre-push output is admission evidence,
not the release asset. `gh release create --verify-tag` checks that a remote
tag exists; it does not replace either generator run or the remote OID proofs.

```bash
set -euo pipefail

source_repo_path="$(pwd -P)"
action_repo_path="../codex-review-gate-action"
action_remote="origin"
source_release_commit="$(git rev-parse refs/heads/master^{commit})"
action_release_commit="$(
  git -C "$action_repo_path" rev-parse refs/heads/master^{commit}
)"
split_commit="$action_release_commit"

release_gpg_path="$(command -v gpg)"
test -n "$release_gpg_path"
release_gpg_path="$(realpath "$release_gpg_path")"
test -x "$release_gpg_path"
"$release_gpg_path" --version
release_path_snapshot="$PATH"

remote_v1_record="$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" refs/tags/v1
)"
expected_remote_v1_tag_object_oid="${remote_v1_record%%$'\t'*}"
test "$remote_v1_record" = \
  "$expected_remote_v1_tag_object_oid"$'\trefs/tags/v1'
test "${#expected_remote_v1_tag_object_oid}" -eq 40
[[ "$expected_remote_v1_tag_object_oid" != *[!0-9a-f]* ]]

git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.4.0 "$split_commit" -m "codex-review-gate-action v1.4.0"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -s -a v1.4 "$split_commit" -m "codex-review-gate-action v1.4"
git -C "$action_repo_path" \
  -c gpg.format=openpgp \
  -c "gpg.program=$release_gpg_path" \
  -c "gpg.openpgp.program=$release_gpg_path" \
  tag -f -s -a v1 "$split_commit" -m "codex-review-gate-action v1"

immutable_tag_object_oid="$(
  git -C "$action_repo_path" rev-parse refs/tags/v1.4.0
)"
minor_tag_object_oid="$(
  git -C "$action_repo_path" rev-parse refs/tags/v1.4
)"
v1_tag_object_oid="$(
  git -C "$action_repo_path" rev-parse refs/tags/v1
)"
test "$immutable_tag_object_oid" = "$(
  git -C "$action_repo_path" rev-parse v1.4.0^{tag}
)"
test "$minor_tag_object_oid" = "$(
  git -C "$action_repo_path" rev-parse v1.4^{tag}
)"
test "$v1_tag_object_oid" = "$(
  git -C "$action_repo_path" rev-parse v1^{tag}
)"
test "$(git -C "$action_repo_path" cat-file -t "$immutable_tag_object_oid")" = tag
test "$(git -C "$action_repo_path" cat-file -t "$minor_tag_object_oid")" = tag
test "$(git -C "$action_repo_path" cat-file -t "$v1_tag_object_oid")" = tag
test "$(git -C "$action_repo_path" rev-parse v1.4.0^{commit})" = "$split_commit"
test "$(git -C "$action_repo_path" rev-parse v1.4^{commit})" = "$split_commit"
test "$(git -C "$action_repo_path" rev-parse v1^{commit})" = "$split_commit"
test "$PATH" = "$release_path_snapshot"

generate_release_provenance() {
  npm run release:provenance -- \
    --source-repo "$source_repo_path" \
    --source-repository JoeyTeng/codex-review-gate \
    --source-commit "$source_release_commit" \
    --source-default-ref refs/heads/master \
    --action-repo "$action_repo_path" \
    --action-repository JoeyTeng/codex-review-gate-action \
    --action-commit "$action_release_commit" \
    --action-default-ref refs/heads/master \
    --immutable-tag-ref refs/tags/v1.4.0 \
    --minor-tag-ref refs/tags/v1.4 \
    --major-tag-ref refs/tags/v1 \
    --output "$1"
}

prepush_provenance_path="v1.4.0-release-provenance.pre-push.json"
generate_release_provenance "$prepush_provenance_path"

git -C "$action_repo_path" push "$action_remote" refs/tags/v1.4.0
git -C "$action_repo_path" push "$action_remote" refs/tags/v1.4
git -C "$action_repo_path" push \
  --force-with-lease="refs/tags/v1:$expected_remote_v1_tag_object_oid" \
  "$action_remote" refs/tags/v1

test "$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" refs/tags/v1.4.0
)" = "$immutable_tag_object_oid"$'\trefs/tags/v1.4.0'
test "$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" 'refs/tags/v1.4.0^{}'
)" = "$split_commit"$'\trefs/tags/v1.4.0^{}'
test "$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" refs/tags/v1.4
)" = "$minor_tag_object_oid"$'\trefs/tags/v1.4'
test "$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" 'refs/tags/v1.4^{}'
)" = "$split_commit"$'\trefs/tags/v1.4^{}'
test "$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" refs/tags/v1
)" = "$v1_tag_object_oid"$'\trefs/tags/v1'
test "$(
  git -C "$action_repo_path" ls-remote --tags \
    "$action_remote" 'refs/tags/v1^{}'
)" = "$split_commit"$'\trefs/tags/v1^{}'

generate_release_provenance v1.4.0-release-provenance.json
rm -f -- "$prepush_provenance_path"
```

Do not use a generic forced tag push. The exact lease must fail if another
publisher moved `v1` after the remote OID was recorded. If any pre-push
generator check fails, publish no tag; correct the local release state and run
the complete admission sequence again.

Prepare `v1.4.0-release-notes.md` before creating the release. After the source
release is merged, the action split is synchronized, and all three action tags
are created and verified, replace the documentation placeholder in that file
with the exact action-repository 40-SHA. The final notes must contain no
`<v1.4.0-action-commit-sha>` or `<exact-action-repository-40-sha>` placeholder
or any other angle-bracket SHA placeholder, and must carry the canonical pin
and receipt contract described above.

The post-push generator rerun in the fail-fast sequence above creates the
canonical `v1.4.0-release-provenance.json` asset only after all remote proofs
succeed. Its complete 12-option invocation derives both exact default-branch
tips rather than accepting placeholder SHAs and repeats the strict OpenPGP
verification for all three local tag objects.

The generated asset must contain at least:

- the exact source release commit OID and its root tree OID;
- the `packages/action` tree OID at that exact source commit;
- the exact action release commit OID and its root tree OID, plus the proof
  that this root tree OID exactly equals the source commit's `packages/action`
  tree OID;
- the signed annotated tag-object OIDs for `v1.4.0`, `v1.4`, and the moved
  `v1`, plus successful generator-compatible OpenPGP `verify-tag --raw`
  evidence and proof that the immutable tag peels to the exact action release
  commit;
- a complete recursive action-tree manifest with exact `path`, `mode`, `type`,
  and `blob_oid` for every published path, plus the SHA-256 of the deterministic
  NUL-delimited bytes from
  `git ls-tree -rz --full-tree <action-release-commit>`;
- the exact expected status context (`codex/review-gate` by default), the
  Commit Status REST create/list API routes, and the GraphQL `StatusContext`
  node re-read contract;
- source path `packages/action/action.yml`, published path `action.yml`, and
  that published blob's Git OID and raw-file SHA-256;
- receipt schema source path `packages/action/producer-receipt.schema.json`,
  published path `producer-receipt.schema.json`, schema ID, published blob Git
  OID, and raw-file SHA-256, plus exact uploader commit
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`;
- decision-table source path
  [`packages/action/decision-table.json`](../packages/action/decision-table.json),
  published path `decision-table.json`, `policy_version: 1.4.0`, published blob
  Git OID, raw-file SHA-256, and immutable consumer link
  `https://github.com/JoeyTeng/codex-review-gate-action/blob/<exact-action-repository-40-sha>/decision-table.json`.

Every raw-file SHA-256 is computed over the exact blob bytes in the final
action release commit. The final release notes and handoff must report these
commit/tree/tag/blob identities, digests, equality and signature-verification
results, and the concrete canonical workflow line with an actual lower-case
40-hex action commit—not a placeholder:

```yaml
- uses: JoeyTeng/codex-review-gate-action@<actual-lower-case-40-hex-action-commit>
```

Do not generate or claim this manifest before the source merge and action
split: the action commit, tree, and tag-object OIDs do not exist yet. Verify the
generated manifest against the final action repository and tags, then create
the GitHub Release explicitly from the immutable tag with both prepared files:

```bash
set -euo pipefail

gh release create v1.4.0 \
  --repo JoeyTeng/codex-review-gate-action \
  --verify-tag \
  --title "codex-review-gate-action v1.4.0" \
  --notes-file v1.4.0-release-notes.md \
  v1.4.0-release-provenance.json
```

## Why Subtree

`packages/action` is a stable package boundary whose contents are complete as a repository root. That makes `git subtree split --prefix=packages/action` a direct release operation. Tests, CI workflows, and source-repository coordination stay outside the published action package.
