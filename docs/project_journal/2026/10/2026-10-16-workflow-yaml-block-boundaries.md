---
id: 20261016-workflow-yaml-block-boundaries
title: Sequence Mapping Boundaries in Workflow Block Scalars
status: completed
created: 2026-10-16
updated: 2026-10-16
branch: codex/yaml-block-scalar-boundaries
pr:
supersedes: []
superseded_by:
---

# Sequence Mapping Boundaries in Workflow Block Scalars

## Evidence and Decision

- Installer PR #123 introduced a limited workflow structure tokenizer. Review
  comment [4298677913](https://github.com/Joey-Tools/codex-review-gate/pull/123#discussion_r4298677913)
  showed that `- run: |` consumed sibling `env` and `shell` fields because its
  block boundary used the dash indentation instead of the mapping-key
  indentation after the sequence marker.
- Joey requested a separate repair PR merged before #123. A stacked PR was
  unsuitable: the production v2 verifier requires the repository default
  branch as the PR base and returned `unsupported_target`. Do not bypass or
  relax that boundary merely to land the fix.
- Extract the corrected tokenizer and its mapping parser as an independently
  tested prerequisite on `master`. The module recognises only the limited
  structure needed by the installer; it is not a general YAML parser or a
  proof of arbitrary workflow/script safety. #123 can replace its private
  tokenizer with this module after the prerequisite lands.
- Preserve existing tokenizer admission and token shape. Sequence mappings
  measure scalar bodies from the mapping key, ordinary mappings from their
  existing indentation. Sibling fields remain visible, including forbidden
  execution dependencies that the caller must reject.
- This prerequisite does not enable reviewed status writers, change existing
  scanner policy, alter runtime action bytes or consumer templates, or require
  a runtime release. Keep HDR installation and #123 landing after this fix.

## Validation

- Node v24.15.0: all 74 selected lexer, CI-inventory, workflow-security,
  v2-workflow and required-CI contract tests passed. The focused canonical
  bootstrap workflow-validation test also passed (75 tests total).
- `npm run check`, project journal validation and `git diff --check` passed.
  The existing bootstrap registration count stays 165; the new five-test
  suite is included in both existing Node 20/24 core CI cells.
- HDR hardware tests and prior migration-cohort replays are outside this
  parser prerequisite. No consumer assets or production settings changed.

## Integration Boundary

- Adopt the shared parser in #123, rerun its policy and CLI regressions, and
  refresh current-head remote review and CI before merging the installer PR.
- Do not count a stacked-PR `unsupported_target` result as a code-test failure
  or attempt to reconcile it into a pass.
