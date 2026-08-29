import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");

if (
  typeof electronExecutable !== "string" ||
  !fs.existsSync(electronExecutable) ||
  !fs.statSync(electronExecutable).isFile()
) {
  throw new Error("Electron executable is unavailable after installation");
}

console.log(`Electron executable ready: ${electronExecutable}`);
