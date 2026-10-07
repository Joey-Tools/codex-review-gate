---
id: 20261007-v218-consumer-completion-wave
title: v2.1.8 Consumer Controller Completion Wave
status: completed
created: 2026-10-07
updated: 2026-10-07
branch:
pr:
supersedes: []
superseded_by:
---

# v2.1.8 Consumer Controller Completion Wave

## Summary

- This is a bounded completion wave for 11 existing consumer controller-completion PRs. It updates the controller completion observer template; it is not unfinished core v2 or v1 migration work.

## Current State

- The v2.1.8 publication is complete; its release evidence is in [the release intent journal](2026-10-06-action-v2-1-8-release-intent.md).
- All 11 consumer PRs have verified squash-merge receipts:
  - [Joey-Tools/codex-review-workflows #128](https://github.com/Joey-Tools/codex-review-workflows/pull/128) — `7a8ed7562f006c10a32806d4416db1e83186fb88`.
  - [Joey-Tools/codex-gated-repo-template #7](https://github.com/Joey-Tools/codex-gated-repo-template/pull/7) — `9157454b01bf4bcba127c393cd3fab6f6157bcc0`.
  - [Joey-Tools/codex-host-workflows #8](https://github.com/Joey-Tools/codex-host-workflows/pull/8) — `a80cd75c63a3a5f1a85b9b2a976d9b2c17cb24af`.
  - [Joey-Project/ASCII-art-creator #14](https://github.com/Joey-Project/ASCII-art-creator/pull/14) — `a760b1a2ab64ebd868c44eeaf7c2e5491d3a6b93`.
  - [Joey-Project/Telegram-Video-Downloader #28](https://github.com/Joey-Project/Telegram-Video-Downloader/pull/28) — `2b44bdb0bfa621fb3d9affb8700ed3bda2810d3b`.
  - [Joey-Project/Webex-generic-account-bot #34](https://github.com/Joey-Project/Webex-generic-account-bot/pull/34) — `91250e6b26a6a38616bbf6b05e81b8afbe7cb17f`.
  - [Joey-Project/macos-edr-virtual-display-fixture #20](https://github.com/Joey-Project/macos-edr-virtual-display-fixture/pull/20) — `b68aa5bba7d06e78523fcb5d8bc04b50b6b0effe`.
  - [Joey-Project/Webex-headless-messenger #19](https://github.com/Joey-Project/Webex-headless-messenger/pull/19) — `1516b9704fda748b8496a5c176cebba93103cc03`.
  - [JoeyTeng/website-checking #11](https://github.com/JoeyTeng/website-checking/pull/11) — `ddc7d4f07533d595c02d3c6ccf13f3774b6a5f5d`; master and merge commit match, and the unchanged reviewed head was `73b9e7f44d0410d073730b0b7985b40752b271aa`. The exact-head verifier check `101128205358` passed in run `37336317938`; terminal clean comment `6026477699` attested that head. It merged at `2026-10-07T08:27:23Z` after Joey explicitly accepted the unprotected-base race for this ordinary squash. This one-time boundary acceptance was not a bypass and did not add protection.
- [Joey-Project/BBDown-rust #84](https://github.com/Joey-Project/BBDown-rust/pull/84) — squash/master commit `d28b2c7539b564c6e492bbdb5b103817ececd0e9`; unchanged PR head `2806f8ed60201b476bb96880a9c0e736e833846d`. The signed base-merge commit was pushed by ordinary non-force HTTPS. Fresh review-request comment `6034167480` was followed by trusted-bot current-head comment `6034198765` at `08:36:37Z`; gate attempt 2 run `37594253637`, job `112705146064`, and the Rust check succeeded. It merged at `2026-10-07T08:48:50Z`. GitHub preserved the existing `APPROVED` review across the base-only update; no owner-token approval or additional human approval was required.
- [Joey-Project/tvOS-net-player #70](https://github.com/Joey-Project/tvOS-net-player/pull/70) — squash/default-master commit `828e28ec3919c225b061a132535aa0862d4149aa`; unchanged reviewed head `83a081e10d43bb69d86e884bb89a1cd38e865994`. Its live-master base update was signed and pushed normally. Current-head clean comment `6034256927` at `08:40:26Z` attested to that head. Codex gate attempt 2 run `37593846812`, job `112706537382`, succeeded with no unresolved findings; build-and-tests run `37593846392`, attempt 1, job `112701534253`, passed 15 steps at `08:56:33Z`. Final readback showed all required contexts successful, one current-head approval, and zero review threads. It merged at `2026-10-07T09:00:32Z` by JoeyTeng-Codex; default-branch tip matches the squash commit.
- The earlier `No pinentry` result came from a diagnostic that explicitly used `--batch --pinentry-mode error`; it was not equivalent to normal Git signing. Normal elevated signing succeeded for both base merges, and no GPG configuration changed.
- The already-completed Private Overlay Release run [37446856133](https://github.com/Joey-Tools/codex-private-workflows/actions/runs/37446856133) succeeded on `master` before #128 merged and belongs to the separate #212 push. The #128 diff changes only its controller workflow and journal; neither path is selected by the canonical overlay export, so no follow-on overlay sync or release is required for #128.
- No Marketplace listing status is asserted here. The existing deferred Marketplace and automation items remain in `docs/PROJECT_TODO.md`.

## Completion

- The 11-controller completion wave is closed. Core v2/v1 migration was completed earlier and is not outstanding work in this wave.

## Evidence

- [Published Action v2.1.8](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.8).
- [Private Overlay Release run 37446856133](https://github.com/Joey-Tools/codex-private-workflows/actions/runs/37446856133).
