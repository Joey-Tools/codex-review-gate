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
  "    runs-on: ubuntu-latest",
  "    steps: []",
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

  assert.deepEqual(
    validateReviewedStatusWriters([file], [
      writerRecord(file.path, file.content),
    ]),
    new Set([file.path]),
  );
});

test("canonical inventory accepts explicitly reviewed top-level or job-level status writes", () => {
  for (const [index, content] of [
    TOP_LEVEL_STATUS_WRITER,
    JOB_LEVEL_STATUS_WRITER,
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
    sha256: sha256(TOP_LEVEL_STATUS_WRITER),
  };
  assert.throws(() =>
    validateReviewedStatusWriters(
      [{ path: DEFAULT_REVIEWED_WRITER_PATH, content: TOP_LEVEL_STATUS_WRITER }],
      [duplicate, duplicate],
    ),
    /reviewed status writer.*duplicate path/iu,
  );
});

test("reviewed status writer digest binds one exact workflow file", () => {
  const content = TOP_LEVEL_STATUS_WRITER;
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
      `${TOP_LEVEL_STATUS_WRITER}jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n`,
    ],
    [
      "reserved native job name",
      TOP_LEVEL_STATUS_WRITER.replace(
        "  publish:\n    runs-on:",
        "  publish:\n    name: codex/github-review-gate\n    runs-on:",
      ),
    ],
    [
      "additional write permission",
      TOP_LEVEL_STATUS_WRITER.replace(
        "  contents: read\n",
        "  actions: write\n",
      ),
    ],
    [
      "read-only no-op",
      TOP_LEVEL_STATUS_WRITER.replace("  statuses: write\n", "  statuses: read\n"),
    ],
    [
      "malformed permission mapping",
      TOP_LEVEL_STATUS_WRITER.replace(
        "  statuses: write\n",
        "  statuses: write\n    contents: read\n",
      ),
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
