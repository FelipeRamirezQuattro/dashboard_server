/// <reference types="node" />
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const dir = __dirname;
const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith(".fixtures.ts"))
  .sort();

for (const file of files) {
  const result = spawnSync("npx", ["ts-node", path.join(dir, file)], {
    stdio: "inherit",
    cwd: path.resolve(dir, "../../.."),
  });
  if (result.status !== 0) {
    console.error(`FAIL ${file}`);
    process.exit(1);
  }
  console.log(`PASS ${file}`);
}
