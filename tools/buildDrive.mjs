/**
 * Builds free drive (drive/, its own pnpm workspace) and puts it in the site at dist/drive/.
 *
 * Runs at the end of `npm run build`, after vite has written dist/, so Netlify's one build command
 * ships both: the arena at /, free drive at /drive/. drive/ keeps its own dependencies (a newer
 * three and Rapier than the arena's), which is why this shells out to pnpm instead of being one
 * more vite entry.
 *
 * pnpm: the one on PATH if any, else the exact version drive/package.json pins, through npx, so a
 * fresh build host needs nothing but Node. SKIP_DRIVE=1 skips it for a quick local arena build;
 * the title's free-drive rides then lead to a missing page, and this says so.
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const drive = join(root, "drive");
const out = join(root, "dist", "drive");

if (process.env.SKIP_DRIVE === "1") {
  console.log("buildDrive: SKIP_DRIVE=1, so dist/drive/ is not built (free drive will 404 in this build)");
  process.exit(0);
}
if (!existsSync(join(root, "dist", "index.html"))) {
  throw new Error("buildDrive: dist/index.html is missing; run vite build first");
}

const pinned = JSON.parse(readFileSync(join(drive, "package.json"), "utf8")).packageManager; // "pnpm@x.y.z"
let pnpm = "pnpm";
try {
  execSync("pnpm --version", { stdio: "ignore" });
} catch {
  pnpm = `npx --yes ${pinned}`;
}

const run = (cmd, env = {}) => {
  console.log(`buildDrive: ${cmd}`);
  execSync(cmd, { cwd: drive, stdio: "inherit", env: { ...process.env, ...env } });
};
run(`${pnpm} install --frozen-lockfile`);
run(`${pnpm} -r build`, { DRIVE_BASE: "/drive/" });

rmSync(out, { recursive: true, force: true });
cpSync(join(drive, "apps", "web", "dist"), out, { recursive: true });
console.log(`buildDrive: free drive -> ${out}`);
