#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createReleasePlan } from "./generate-action-release-provenance.mjs";

const ACTION_PACKAGE = "packages/action/package.json";

export function isVersionOnlyRelease(paths, beforePackage, afterPackage) {
  const { version: beforeVersion, ...beforeMetadata } = beforePackage;
  const { version: afterVersion, ...afterMetadata } = afterPackage;
  return paths.includes(ACTION_PACKAGE) && paths.includes("release-manifest.json") &&
    paths.every((path) => path === ACTION_PACKAGE || path === "release-manifest.json" ||
      (path.startsWith("docs/project_journal/") && path.endsWith(".md"))) &&
    typeof afterVersion === "string" && afterVersion !== beforeVersion &&
    isDeepStrictEqual(beforeMetadata, afterMetadata);
}

export function hasSuccessfulBaseCi(run, baseSha) {
  return run?.head_sha === baseSha && run.head_branch === "master" &&
    run.event === "push" && run.status === "completed" && run.conclusion === "success";
}

export function selectReleaseOnlyCi(repo, baseSha, headSha, runs) {
  if (!/^[0-9a-f]{40}$/u.test(baseSha ?? "") ||
      !/^[0-9a-f]{40}$/u.test(headSha ?? "") ||
      !hasSuccessfulBaseCi(runs?.workflow_runs?.[0], baseSha)) return false;
  const git = (...args) => execFileSync("git", args, {
    cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const paths = git("diff", "--name-only", "--no-renames", "-z", baseSha, headSha)
    .split("\0").filter(Boolean);
  if (!isVersionOnlyRelease(paths,
    JSON.parse(git("show", `${baseSha}:${ACTION_PACKAGE}`)),
    JSON.parse(git("show", `${headSha}:${ACTION_PACKAGE}`)))) return false;
  // Reuse the publisher's exact intent/inventory checks, including its supported
  // commit shape. An unsupported shape keeps the ordinary full CI route.
  createReleasePlan({ repo, sourceRef: headSha, controlRef: headSha, admissionBeforeRef: baseSha });
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let releaseOnly = false;
  try {
    const [baseSha, headSha, runsPath] = process.argv.slice(2);
    if (baseSha && headSha) {
      releaseOnly = selectReleaseOnlyCi(process.cwd(), baseSha, headSha,
        JSON.parse(readFileSync(runsPath, "utf8")));
    }
  } catch (error) {
    console.error(`Using full CI: ${error.message}`);
  }
  console.log(`release_only=${releaseOnly}`);
}
