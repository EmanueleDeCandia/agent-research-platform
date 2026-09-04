import { cpSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

execSync("tsc -p tsconfig.json", { stdio: "inherit" });

const src = "src/web/public";
const dest = "dist/web/public";
if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${src} -> ${dest}`);
}
