import fs, { appendFileSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

import { readStableInheritedLeaf } from "../packages/action/src/v2/controller-input-reader.mjs";

const [leafName, maxBytesText, selectedSizeText] = process.argv.slice(2);
const maxBytes = Number(maxBytesText);
const selectedSize = Number(selectedSizeText);
const originalFstatSync = fs.fstatSync;
let inputDescriptorStatCount = 0;
let seamTriggered = false;

fs.fstatSync = (...arguments_) => {
  const stat = originalFstatSync(...arguments_);
  if (arguments_[0] === 4 && ++inputDescriptorStatCount === 2) {
    appendFileSync(leafName, "\n", { encoding: "utf8" });
    seamTriggered = true;
  }
  return stat;
};
syncBuiltinESMExports();

try {
  readStableInheritedLeaf(
    leafName,
    maxBytes,
    selectedSize,
  );
  process.exitCode = 2;
} catch (error) {
  if (
    error?.code === "CONTENT" &&
    seamTriggered &&
    inputDescriptorStatCount === 2 &&
    statSync(leafName).size === selectedSize + 1
  ) {
    process.stdout.write("CONTENT\n");
  } else {
    process.stderr.write("UNEXPECTED\n");
    process.exitCode = 3;
  }
} finally {
  fs.fstatSync = originalFstatSync;
  syncBuiltinESMExports();
}
