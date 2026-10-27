"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : [path.join(dir, e.name)],
    );
}
for (const file of ["backend", "frontend", "scripts", "tests"]
  .flatMap(files)
  .filter((f) => /\.(js|cjs)$/.test(f))) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status) process.exit(result.status);
}
for (const file of [
  "backend/src/app.js",
  "backend/src/server.js",
  "backend/scripts/migrate.js",
  "backend/scripts/admin.js",
])
  require(path.resolve(file));
if (
  fs.existsSync(".env") &&
  require("node:child_process").spawnSync(
    "git",
    ["ls-files", "--error-unmatch", ".env"],
    { stdio: "ignore" },
  ).status === 0
)
  throw new Error("Never track .env files.");
console.log("JavaScript syntax and module imports passed.");
