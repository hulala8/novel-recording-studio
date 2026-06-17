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

// Electron's framework binary is linker-signed by Apple's toolchain. Re-signing
// it ad-hoc can make dyld reject Electron Framework on newer macOS versions.
// For this local development build, remove quarantine attributes only and leave
// electron-builder's generated signatures intact.
run("xattr", ["-cr", appPath]);
