import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_CONTROLLER_WORKFLOW_PATH,
  DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
  DEFAULT_WORKFLOW_PATH,
  FROZEN_HANDOFF_V2_WORKFLOW_IDENTITIES,
  validateCanonicalV2WorkflowInventory,
  validateFrozenHandoffV2WorkflowInventory,
  validateReviewedStatusWriters,
} from "../src/bootstrap.mjs";

const CANONICAL_WORKFLOWS = {
  verifier: readFileSync(
    new URL(
      "../templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
      import.meta.url,
    ),
    "utf8",
  ),
  controller: readFileSync(
    new URL(
      "../templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml",
      import.meta.url,
    ),
    "utf8",
  ),
};

const FROZEN_HANDOFF_WORKFLOWS = {
  verifier: readFileSync(
    new URL(
      "./fixtures/organization-review-gate-handoff/codex-review-gate.verifier.v2-with-request-author-variable.yml",
      import.meta.url,
    ),
    "utf8",
  ),
  controller: readFileSync(
    new URL(
      "./fixtures/organization-review-gate-handoff/codex-review-gate-controller.v2-with-edited.yml",
      import.meta.url,
    ),
    "utf8",
  ),
};

const DEFAULT_REVIEWED_WRITER_PATH =
  ".github/workflows/reviewed-status-writer.yml";
const TOP_LEVEL_STATUS_WRITER = [
  "name: Reviewed status writer",
  "on: push",
  "permissions:",
  "  contents: read",
  "  statuses: write",
  "jobs:",
  "  publish:",
  "    runs-on: ubuntu-latest",
  "    steps: []",
  "",
].join("\n");
const JOB_LEVEL_STATUS_WRITER = [
  "name: Reviewed job-level status writer",
  "on: push",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  publish:",
  "    permissions:",
  "      statuses: write",
  "    runs-on: ubuntu-slim",
  "    steps:",
  "      - name: Publish",
  '        env:',
  '          BASH_ENV: ""',
  '          ENV: ""',
  "          GH_TOKEN: ${{ github.token }}",
  "        shell: bash",
  "        run: |",
  "          set -euo pipefail",
  "          printf 'Reviewed inline publisher\\n'",
  "",
].join("\n");
const RUN_FIRST_STATUS_WRITER = [
  "name: Reviewed run-first status writer",
  "on: push",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  publish:",
  "    permissions:",
  "      statuses: write",
  "    runs-on: ubuntu-slim",
  "    steps:",
  "      - run: |",
  "          set -euo pipefail",
  "          printf 'Reviewed inline publisher\\n'",
  '        env:',
  '          BASH_ENV: ""',
  '          ENV: ""',
  "          GH_TOKEN: ${{ github.token }}",
  "        shell: bash",
  "",
].join("\n");
const ENV_FIRST_STATUS_WRITER = [
  "name: Reviewed env-first status writer",
  "on: push",
  "permissions:",
  "  contents: read",
  "jobs:",
  "  publish:",
  "    permissions:",
  "      statuses: write",
  "    runs-on: ubuntu-slim",
  "    steps:",
  "      - env:",
  '          BASH_ENV: ""',
  '          ENV: ""',
  "          GH_TOKEN: ${{ github.token }}",
  "        shell: bash",
  "        run: |",
  "          set -euo pipefail",
  "          printf 'Reviewed inline publisher\\n'",
  "",
].join("\n");
const ENV_FIRST_RUN_BEFORE_SHELL_STATUS_WRITER = ENV_FIRST_STATUS_WRITER.replace(
  "        shell: bash\n        run: |\n",
  "        run: |\n",
).replace(
  "          printf 'Reviewed inline publisher\\n'\n",
  "          printf 'Reviewed inline publisher\\n'\n        shell: bash\n",
);
const SPLIT_JOB_STATUS_WRITER = [
  "name: Reviewed split status writer",
  "on: push",
  "permissions:",
  "  contents: read",
  "env:",
  "  SIGNING_MODE: reviewed",
  "jobs:",
  "  inspect:",
  "    runs-on: ubuntu-latest",
  "    permissions:",
  "      contents: read",
  "    steps:",
  "      - uses: actions/checkout@v4",
  "  pending:",
  "    needs: inspect",
  "    permissions:",
  "      statuses: write",
  "    runs-on: ubuntu-slim",
  "    outputs:",
  "      target_sha: ${{ steps.publish.outputs.target_sha }}",
  "    steps:",
  "      - id: publish",
  "        env:",
  '          BASH_ENV: ""',
  '          ENV: ""',
  "          GH_TOKEN: ${{ github.token }}",
  "          TARGET_SHA: ${{ needs.inspect.result }}",
  "        shell: bash",
  "        run: |",
  "          set -euo pipefail",
  "          printf 'Reviewed inline publisher\\n'",
  "  final:",
  "    needs: [inspect, pending]",
  "    if: always()",
  "    permissions:",
  "      statuses: write",
  "    runs-on: ubuntu-slim",
  "    steps:",
  "      - name: Publish final",
  "        env:",
  '          BASH_ENV: ""',
  '          ENV: ""',
  "          GH_TOKEN: ${{ github.token }}",
  "          PENDING_RESULT: ${{ needs.pending.result }}",
  "        shell: bash",
  "        run: |",
  "          set -euo pipefail",
  "          printf 'Reviewed inline publisher\\n'",
  "",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function writerRecord(path, content, digest = sha256(content)) {
  return { path, sha256: digest };
}

function canonicalInventory(extraFiles = []) {
  return [
    { path: DEFAULT_WORKFLOW_PATH, content: CANONICAL_WORKFLOWS.verifier },
    {
      path: DEFAULT_CONTROLLER_WORKFLOW_PATH,
      content: CANONICAL_WORKFLOWS.controller,
    },
    ...extraFiles,
  ];
}

function assertReviewedWriterRejected(callback, message) {
  assert.throws(callback, /reviewed status writer/iu, message);
}

test("reviewed status writers are denied by default and explicitly returned as paths", () => {
  const file = {
    path: DEFAULT_REVIEWED_WRITER_PATH,
    content: TOP_LEVEL_STATUS_WRITER,
  };

  assert.deepEqual(validateReviewedStatusWriters([file]), new Set());
  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        canonicalInventory([file]),
        CANONICAL_WORKFLOWS,
      ),
    /single-producer policy.*reviewed-status-writer\.yml.*statuses: write/iu,
  );

  assertReviewedWriterRejected(
    () =>
      validateReviewedStatusWriters([file], [
        writerRecord(file.path, file.content),
      ]),
    "workflow-level statuses: write is not an isolated publisher",
  );

  const isolatedFile = {
    path: DEFAULT_REVIEWED_WRITER_PATH,
    content: JOB_LEVEL_STATUS_WRITER,
  };
  assert.deepEqual(
    validateReviewedStatusWriters([isolatedFile], [
      writerRecord(isolatedFile.path, isolatedFile.content),
    ]),
    new Set([isolatedFile.path]),
  );
});

test("canonical inventory accepts isolated publishers alongside split read-only jobs", () => {
  const readOnlyEnvBlock = SPLIT_JOB_STATUS_WRITER.replace(
    "    permissions:\n      contents: read\n",
    "    permissions:\n      contents: read\n    env:\n      statuses: write\n",
  );
  const readOnlyEnvFlow = SPLIT_JOB_STATUS_WRITER.replace(
    "    permissions:\n      contents: read\n",
    "    permissions:\n      contents: read\n    env: { statuses: write }\n",
  );
  const outputStatusMetadata = JOB_LEVEL_STATUS_WRITER.replace(
    "    runs-on: ubuntu-slim\n",
    "    runs-on: ubuntu-slim\n    outputs:\n      statuses: write\n",
  );
  const readOnlyOutputStatusMetadata = SPLIT_JOB_STATUS_WRITER.replace(
    "    permissions:\n      contents: read\n",
    "    permissions:\n      contents: read\n    outputs:\n      statuses: write\n",
  );
  const quotedRootOn = JOB_LEVEL_STATUS_WRITER.replace(
    /^on: push$/mu,
    '"on": push',
  );

  for (const [index, content] of [
    JOB_LEVEL_STATUS_WRITER,
    RUN_FIRST_STATUS_WRITER,
    ENV_FIRST_STATUS_WRITER,
    ENV_FIRST_RUN_BEFORE_SHELL_STATUS_WRITER,
    SPLIT_JOB_STATUS_WRITER,
    readOnlyEnvBlock,
    readOnlyEnvFlow,
    outputStatusMetadata,
    readOnlyOutputStatusMetadata,
    quotedRootOn,
    quotedRootOn.replace('"on"', "'on'"),
  ].entries()) {
    const path = `.github/workflows/reviewed-status-writer-${index}.yml`;
    const file = { path, content };
    assert.equal(
      validateCanonicalV2WorkflowInventory(
        canonicalInventory([file]),
        CANONICAL_WORKFLOWS,
        { reviewedStatusWriters: [writerRecord(path, content)] },
      ),
      CANONICAL_WORKFLOWS,
    );
  }
});

test("reviewed status writer declarations have a bounded exact schema", () => {
  assertReviewedWriterRejected(() => validateReviewedStatusWriters([], null));
  assertReviewedWriterRejected(() =>
    validateReviewedStatusWriters(
      [],
      Array.from({ length: 33 }, (_, index) => ({
        path: `.github/workflows/writer-${index}.yml`,
        sha256: "0".repeat(64),
      })),
    ),
  );
  for (const invalidEntry of [
    null,
    [],
    { path: DEFAULT_REVIEWED_WRITER_PATH },
    {
      path: DEFAULT_REVIEWED_WRITER_PATH,
      sha256: "0".repeat(64),
      owner: "@JoeyTeng",
    },
    {
      path: DEFAULT_REVIEWED_WRITER_PATH,
      sha256: "A".repeat(64),
    },
  ]) {
    assertReviewedWriterRejected(() =>
      validateReviewedStatusWriters([], [invalidEntry]),
    );
  }

  const validDigest = "0".repeat(64);
  for (const path of [
    ".github/workflows/nested/writer.yml",
    ".github/workflows/writer.yaml.bak",
    ".github/workflows/with space.yml",
    ".github/workflows/back\\slash.yml",
    ".github/workflows/writer@sha.yml",
    " .github/workflows/writer.yml ",
    DEFAULT_WORKFLOW_PATH,
    DEFAULT_CONTROLLER_WORKFLOW_PATH,
    DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
  ]) {
    assertReviewedWriterRejected(() =>
      validateReviewedStatusWriters([], [{ path, sha256: validDigest }]),
    );
  }

  const duplicate = {
    path: DEFAULT_REVIEWED_WRITER_PATH,
    sha256: sha256(JOB_LEVEL_STATUS_WRITER),
  };
  assert.throws(() =>
    validateReviewedStatusWriters(
      [{ path: DEFAULT_REVIEWED_WRITER_PATH, content: JOB_LEVEL_STATUS_WRITER }],
      [duplicate, duplicate],
    ),
    /reviewed status writer.*duplicate path/iu,
  );
});

test("reviewed status writer digest binds one exact workflow file", () => {
  const content = JOB_LEVEL_STATUS_WRITER;
  const record = writerRecord(DEFAULT_REVIEWED_WRITER_PATH, content);
  const file = { path: DEFAULT_REVIEWED_WRITER_PATH, content };

  assert.deepEqual(
    validateReviewedStatusWriters([file], [record]),
    new Set([DEFAULT_REVIEWED_WRITER_PATH]),
  );
  assertReviewedWriterRejected(() =>
    validateReviewedStatusWriters(
      [{ ...file, content: `${content}# changed\n` }],
      [record],
    ),
  );
  assertReviewedWriterRejected(() =>
    validateReviewedStatusWriters([], [record]),
  );
  assertReviewedWriterRejected(() =>
    validateReviewedStatusWriters([file, file], [record]),
  );
  assertReviewedWriterRejected(() =>
    validateReviewedStatusWriters([{ path: file.path }], [record]),
  );
  assertReviewedWriterRejected(() =>
    validateReviewedStatusWriters(
      [{ ...file, content: undefined }],
      [record],
    ),
  );
});

test("reviewed status writer entries cannot excuse callers, other violations, or malformed permissions", () => {
  const invalidContents = [
    [
      "Codex gate caller",
      JOB_LEVEL_STATUS_WRITER.replace(
        "      - name: Publish\n",
        "      - name: Publish\n        uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
      ),
    ],
    [
      "reserved native job name",
      JOB_LEVEL_STATUS_WRITER.replace(
        "  publish:\n    permissions:",
        "  publish:\n    name: codex/github-review-gate\n    permissions:",
      ),
    ],
    [
      "additional write permission",
      JOB_LEVEL_STATUS_WRITER.replace(
        "  contents: read\n",
        "  actions: write\n",
      ),
    ],
    [
      "read-only no-op",
      JOB_LEVEL_STATUS_WRITER.replace("      statuses: write\n", "      statuses: read\n"),
    ],
    [
      "quoted protected permissions key",
      JOB_LEVEL_STATUS_WRITER.replace(/^permissions:$/mu, '"permissions":'),
    ],
    [
      "quoted protected status permission",
      JOB_LEVEL_STATUS_WRITER.replace("      statuses: write", '      "statuses": write'),
    ],
    [
      "duplicate plain and quoted root key",
      JOB_LEVEL_STATUS_WRITER.replace("on: push\n", 'on: push\n"on": push\n'),
    ],
    [
      "malformed permission mapping",
      JOB_LEVEL_STATUS_WRITER.replace(
        "      statuses: write\n",
        "      statuses: write\n        contents: read\n",
      ),
    ],
    [
      "workflow-level statuses write",
      JOB_LEVEL_STATUS_WRITER.replace(
        "  contents: read\n",
        "  contents: read\n  statuses: write\n",
      ),
    ],
    [
      "self-hosted privileged runner",
      JOB_LEVEL_STATUS_WRITER.replace("runs-on: ubuntu-slim", "runs-on: self-hosted"),
    ],
    [
      "runner-label array",
      JOB_LEVEL_STATUS_WRITER.replace("runs-on: ubuntu-slim", "runs-on: [ubuntu-slim]"),
    ],
    [
      "privileged job action dependency",
      JOB_LEVEL_STATUS_WRITER.replace(
        "      - name: Publish\n",
        "      - name: Publish\n        uses: actions/checkout@v4\n",
      ),
    ],
    [
      "run-first step sibling action dependency",
      RUN_FIRST_STATUS_WRITER.replace(
        "        env:\n",
        "        uses: actions/checkout@v4\n        env:\n",
      ),
    ],
    [
      "env-first step sibling action dependency",
      ENV_FIRST_STATUS_WRITER.replace(
        "        shell: bash\n",
        "        uses: actions/checkout@v4\n        shell: bash\n",
      ),
    ],
    [
      "env-first nested environment",
      ENV_FIRST_STATUS_WRITER.replace(
        "          GH_TOKEN: ${{ github.token }}\n",
        "          GH_TOKEN:\n            nested: value\n",
      ),
    ],
    [
      "privileged job container",
      JOB_LEVEL_STATUS_WRITER.replace(
        "    steps:\n",
        "    container: node:24\n    steps:\n",
      ),
    ],
    [
      "workflow default shell",
      JOB_LEVEL_STATUS_WRITER.replace(
        "jobs:\n",
        "defaults:\n  run:\n    shell: bash\njobs:\n",
      ),
    ],
    [
      "step path override",
      JOB_LEVEL_STATUS_WRITER.replace(
        '          ENV: ""\n',
        '          ENV: ""\n          PATH: /tmp/bin\n',
      ),
    ],
    [
      "non-empty BASH_ENV",
      JOB_LEVEL_STATUS_WRITER.replace('BASH_ENV: ""', "BASH_ENV: ${{ github.event_path }}"),
    ],
    [
      "scalar run command",
      JOB_LEVEL_STATUS_WRITER.replace("        run: |\n", "        run: echo unsafe\n"),
    ],
    [
      "flow permissions mapping",
      JOB_LEVEL_STATUS_WRITER.replace(
        "    permissions:\n      statuses: write\n",
        "    permissions: { statuses: write }\n",
      ),
    ],
    [
      "unattributable irregular-indentation status writer",
      `${SPLIT_JOB_STATUS_WRITER}  extra:\n     permissions:\n      statuses: write\n`,
    ],
    [
      "status writer hidden under an opaque job field",
      `${SPLIT_JOB_STATUS_WRITER}  extra:\n    opaque:\n      permissions:\n        statuses: write\n`,
    ],
    [
      "quoted job header cannot hide a status writer",
      `${JOB_LEVEL_STATUS_WRITER}  \"extra\":\n    permissions:\n      statuses: write\n`,
    ],
    [
      "sequence job header cannot hide a status writer",
      `${JOB_LEVEL_STATUS_WRITER}  - extra:\n    permissions:\n      statuses: write\n`,
    ],
    [
      "flow job header cannot hide a status writer",
      `${JOB_LEVEL_STATUS_WRITER}  extra: { permissions: { statuses: write } }\n`,
    ],
  ];

  for (const [label, content] of invalidContents) {
    const file = { path: DEFAULT_REVIEWED_WRITER_PATH, content };
    assertReviewedWriterRejected(
      () =>
        validateReviewedStatusWriters(
          [file],
          [writerRecord(file.path, file.content)],
        ),
      label,
    );
  }
});

test("frozen historical inventory validation retains default denial", () => {
  const extraPath = DEFAULT_REVIEWED_WRITER_PATH;
  const extraFile = { path: extraPath, content: TOP_LEVEL_STATUS_WRITER };
  const frozenInventory = [
    {
      path: FROZEN_HANDOFF_V2_WORKFLOW_IDENTITIES.verifier.path,
      content: FROZEN_HANDOFF_WORKFLOWS.verifier,
    },
    {
      path: FROZEN_HANDOFF_V2_WORKFLOW_IDENTITIES.controller.path,
      content: FROZEN_HANDOFF_WORKFLOWS.controller,
    },
    extraFile,
  ];

  assert.throws(
    () =>
      validateFrozenHandoffV2WorkflowInventory(
        frozenInventory,
        FROZEN_HANDOFF_WORKFLOWS,
        { reviewedStatusWriters: [writerRecord(extraPath, extraFile.content)] },
      ),
    /single-producer policy.*statuses: write/iu,
  );
});
