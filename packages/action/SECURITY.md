# Security Policy

Report security issues privately by using GitHub's private vulnerability reporting for this repository when available, or by contacting the repository owner through GitHub.

Do not include sensitive repository data, private source code, or secrets in public issues.

This action coordinates Codex review requests and the
`codex/github-review-gate` commit status through GitHub APIs only. Install the
canonical copied workflow on the protected default branch and retain its
closed `pull_request_target` `edited`, `issue_comment`, and `workflow_dispatch`
triggers, pre-runner event filtering, and least-privilege permissions:
`contents: read`, `issues: write`, `pull-requests: read`, and `statuses: write`.

Treat pull request text and metadata as untrusted. The workflow must not check
out or execute pull request or consumer repository code, and installations must
not broaden `pull_request_target` beyond the canonical actual-base-retarget
filter, add PR-code execution, or broaden permissions.
