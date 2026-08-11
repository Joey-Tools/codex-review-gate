# Security Policy

Report security issues privately by using GitHub's private vulnerability reporting for this repository when available, or by contacting the repository owner through GitHub.

Do not include sensitive repository data, private source code, or secrets in public issues.

This action coordinates Codex review requests and commit statuses. It does not execute pull request code, but target repositories should still review their `pull_request_target` workflow carefully and keep the workflow file on the trusted default branch.

The reserved workflow-dispatch value `scheduled-target-v1` selects stricter
scheduled-scan behavior; it is not proof that a trusted scheduler created the
run. Supplying it does not grant permissions or expand the Action input
surface. Repositories should keep the schedule-only dispatcher minimally
privileged and keep all commit-status writes in the per-PR main workflow.

Every manual or targeted `workflow_dispatch` that names a PR has an additional
identity boundary: caller event input `pull_request` and `PR_NUMBER` must be
byte-for-byte identical canonical safe positive decimal ASCII strings matching
`[1-9][0-9]*`, with a value that is a positive JavaScript safe integer. Leading
zeros, signs, exponent notation, and whitespace are invalid. This prevents
alternate spellings from separating the caller's per-PR concurrency key from
the runtime target. A missing counterpart, mismatch, or non-canonical value
fails before any GitHub API read or write.
