# 发布 Action Package

Marketplace 仓库是 `packages/action` 的 subtree split。任何需要出现在 `JoeyTeng/codex-review-gate-action` root 的文件，都应保留在这个目录内。

## 前置条件

- 源码仓库位于要发布的 commit。
- `package.json` 与 `packages/action/package.json` 包含相同的发布版本。
- `packages/action/producer-receipt.schema.json` 与机器可读
  [decision table](../packages/action/decision-table.json) 已存在；后者声明
  `policy_version: 1.4.0`。`packages/action/action.yml` 把 `actions/upload-artifact`
  exact-pin 到
  `ea165f8d65b6e75b540449e92b4886f43607fa02`（`v4.6.2`）。
- action 仓库已配置 write-enabled deploy key，且源码仓库把 private key 存为 `ACTION_REPO_DEPLOY_KEY` secret。同步 workflow 也兼容既有 `ACTION_REPO_PUSH_TOKEN` secret 名称，可在当前 repo 配置迁移完成前继续用它保存 private key。
- 如果要本地手动发布，action remote 已配置，例如：

```bash
set -euo pipefail

git remote add action git@github.com:JoeyTeng/codex-review-gate-action.git
```

## 自动同步 Default Branch

`.github/workflows/sync-action-subtree.yml` 会在 `master` push 且变更触及 `packages/action/**`、同步 workflow 或 release split 脚本时运行。它会 checkout 完整历史，执行 `scripts/release-action-subtree.sh --remote action --branch master --push --force-if-equivalent-parent`，只把计算出的 subtree split commit 推到 `JoeyTeng/codex-review-gate-action:master`。

该 workflow 不创建 GitHub Releases，也不创建或移动 tags。它通常使用 fast-forward push；只有当 action 仓库分支不是 computed split commit 的祖先、且该分支 tree 和 split commit tree 或 split commit 的 parent tree 完全一致时，才会使用 `--force-with-lease`，用于处理源码仓 squash merge 造成的等价 subtree histories。如果缺少 deploy-key secret、action 仓库拒绝 direct push，或 action 仓库分支内容已经偏离，workflow 会失败而不是执行不安全的强制更新。

Manual workflow dispatch 默认只校验 split。只有明确设置 `push_to_action_repo=true` 时，才会让 workflow 推送 split commit。

## 手动校验和 Split

在源码仓库 root 运行：

```bash
set -euo pipefail

npm run release:split
```

脚本会运行源码检查、action package 检查、测试和 whitespace validation，然后打印 subtree split commit。

如果要同时把 split commit 推到 action 仓库 default branch：

```bash
set -euo pipefail

scripts/release-action-subtree.sh --remote action --branch master --push
```

## 发布 Canonical Action Pin

Canonical consumer reference 是 action 仓库中的 exact 40-hex commit，不是 source
commit，也不是 tag。源码文档使用 `<v1.4.0-action-commit-sha>`，因为该 action-repository
commit 只有 source release merge 且 subtree 同步完成后才存在。

同步后，必须确认 action 仓库 default-branch SHA 与已校验 split commit 相等。把该 exact
value 同时发布到 v1.4.0 release notes 和 release provenance manifest，格式如下：

```yaml
- uses: JoeyTeng/codex-review-gate-action@<exact-action-repository-40-sha>
```

消费者可以为 convenience 使用 `@v1.4` 或 `@v1`，但这些 floating aliases 绝不是
canonical，也不能建立 invocation provenance。

Release notes 还必须标明 producer receipt schema v1，以及
`producer-receipt-artifact-id`、`producer-receipt-artifact-url` 和
`producer-receipt-artifact-digest` outputs。说明 receipt 只是 GitHub.com-only causal
producer evidence、artifact 可能过期或被删除，consumer 仍必须独立归约 provider
evidence。不得把 receipt 或 digest 描述成 signature、OIDC attestation 或
content-addressed storage guarantee。

## Minor Release Tags 和 GitHub Release

Action consumer tags 必须指向 action 仓库历史里的 commit，而不是源码仓库 commit。推送并校验 action 仓库 commit 后，再有意地创建或更新 release tags。

发布 1.4 minor line 时，先确认 action 仓库 default branch 正是已校验的 subtree split
commit，且 split checks 已通过。Provenance generator 会从 absolute `PATH` entry 解析
executable GnuPG，清除继承的 `GIT_*` variables 与 global/system Git configuration，
通过 `gpg.format`、`gpg.program` 与
`gpg.openpgp.program` 强制 OpenPGP，并且只在每个 tag 的 `verify-tag --raw` 满足 closed
status contract 时接受它：恰好一个 `GOODSIG`、恰好一个 identity 一致的 `VALIDSIG`，且
没有 rejecting GnuPG status。独立 `git verify-tag` 可用于 diagnostics，但它不是 release
admission gate。

从 final source checkout 运行下面的 fail-fast sequence，并在整个 sequence 中保持 `PATH`
和 GnuPG keyring 不变。它先创建全部三个 local signed annotated tags，记录当前 remote
`v1` tag object 以建立 exact lease，然后在任何 tag push 之前运行完整 provenance
generator。只有 generator 成功退出，包含三个 refs 的单次 atomic push 才获准执行。在该
transaction 内，`v1.4.0` 与 `v1.4` 是普通更新，只有 `v1` 由 exact lease 授权。任一 ref
被拒绝或远端不支持 atomic push 时，整个 transaction 必须失败且不得发布三个 tags 中的
任何一个。`v1.4.0` 永远不得移动，既有 `v1.3` compatibility tag 与所有 `v1.3.x`
immutable tags 保持不变。

Atomic push 完成后，同一个 sequence 会把每个 remote tag-object OID 及 peeled commit
与获准的 local values 精确比较，然后重跑 generator 来生成 final release asset。
Pre-push output 只是 admission evidence，不是 release asset。`gh release create --verify-tag` 只确认
remote tag 存在，不能替代任一 generator run 或 remote OID proofs。

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

git -C "$action_repo_path" push --atomic \
  --force-with-lease="refs/tags/v1:$expected_remote_v1_tag_object_oid" \
  "$action_remote" \
  refs/tags/v1.4.0:refs/tags/v1.4.0 \
  refs/tags/v1.4:refs/tags/v1.4 \
  refs/tags/v1:refs/tags/v1

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

不得使用 generic forced tag push。如果记录 OID 后其他发布者移动了 `v1`，exact lease
必须使本次推送失败。如果任何 pre-push generator check 失败，则不得发布任何 tag；修正
local release state 后，重新运行完整 admission sequence。如果任一 ref update 或 exact
lease 被拒绝，`--atomic` 必须让三个 remote refs 全部保持不变；不得改成分别重试各 tag。

创建 release 前先准备 `v1.4.0-release-notes.md`。只有 source release 已 merge、action
split 已同步，且三个 action tags 都已创建并校验后，才把该文件中的 documentation
placeholder 替换为 exact action-repository 40-SHA。Final notes 中不得残留
`<v1.4.0-action-commit-sha>` 或 `<exact-action-repository-40-sha>` placeholder，并且
不得残留任何其他 angle-bracket SHA placeholder；同时必须包含上面说明的 canonical pin
与 receipt contract。

上面 fail-fast sequence 中的 post-push generator rerun 只有在全部 remote proofs 成功后，
才会创建 canonical `v1.4.0-release-provenance.json` asset。其完整 12-option invocation 会
自行解析两个 exact default-branch tips，不接受 placeholder SHA，并对三个 local tag
objects 重复执行 strict OpenPGP verification。

生成的 asset 至少必须包含：

- exact source release commit OID 及其 root tree OID；
- 该 exact source commit 中的 `packages/action` tree OID；
- exact action release commit OID 及其 root tree OID，并证明该 root tree OID 与 source
  commit 的 `packages/action` tree OID 精确相等；
- `v1.4.0`、`v1.4` 与已移动 `v1` 的 signed annotated tag-object OIDs；
- generator-compatible OpenPGP `verify-tag --raw` 成功 evidence，并证明 immutable tag
  peel 到 exact action release commit；
- 完整递归 action-tree manifest，其中每个 published path 都有 exact `path`、`mode`、
  `type` 与 `blob_oid`，另记录 deterministic NUL-delimited
  `git ls-tree -rz --full-tree <action-release-commit>` bytes 的 SHA-256；
- exact expected status context（默认为 `codex/review-gate`）、Commit Status REST
  create/list API routes 与 GraphQL `StatusContext` node re-read contract；
- source path `packages/action/action.yml`、published path `action.yml`，以及该 published
  blob 的 Git OID 与 raw-file SHA-256；
- receipt schema source path `packages/action/producer-receipt.schema.json`、published path
  `producer-receipt.schema.json`、schema ID、published blob Git OID 与 raw-file SHA-256，
  以及 exact uploader commit
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`；
- decision-table source path
  [`packages/action/decision-table.json`](../packages/action/decision-table.json)、published
  path `decision-table.json`、`policy_version: 1.4.0`、published blob Git OID、raw-file
  SHA-256，以及 immutable consumer link
  `https://github.com/JoeyTeng/codex-review-gate-action/blob/<exact-action-repository-40-sha>/decision-table.json`。

每个 raw-file SHA-256 都必须基于 final action release commit 中的 exact blob bytes 计算。
Final release notes 与 handoff 必须报告这些 commit/tree/tag/blob identities、digests、
equality 与 signature-verification results，并给出使用 actual lower-case 40-hex action
commit、而不是 placeholder 的 concrete canonical workflow line：

```yaml
- uses: JoeyTeng/codex-review-gate-action@<actual-lower-case-40-hex-action-commit>
```

不得在 source merge 和 action split 之前生成或声称已有该 manifest：此时 action
commit、tree 与 tag-object OIDs 还不存在。用最终 action repository 和 tags 校验生成的
manifest 后，再从 immutable tag 显式创建 GitHub Release，并同时交付这两个已准备文件：

```bash
set -euo pipefail

gh release create v1.4.0 \
  --repo JoeyTeng/codex-review-gate-action \
  --verify-tag \
  --title "codex-review-gate-action v1.4.0" \
  --notes-file v1.4.0-release-notes.md \
  v1.4.0-release-provenance.json
```

## 为什么用 Subtree

`packages/action` 是稳定 package 边界，目录内容可以直接作为 repository root。因此 `git subtree split --prefix=packages/action` 就是直接的发布操作。测试、CI workflows 和源码仓库协作内容留在发布包之外。
