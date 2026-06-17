const { execFileSync } = require("child_process");
const path = require("path");

const appPath = path.join(
  __dirname,
  "..",
  "dist-electron",
  "mac-arm64",
  "Novel Recording Studio.app"
);

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

run("xattr", ["-cr", appPath]);
run("codesign", ["--force", "--sign", "-", appPath]);
run("codesign", ["--verify", "--strict", "--verbose=2", appPath]);
