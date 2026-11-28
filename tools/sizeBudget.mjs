// The build's size budget (Stage 4b, `docs/ASSET_BUDGETS.md`). It protects the web deploy and the
// iOS app bundle, which ships the same `dist/`. `npm run build` ends with it, so a Netlify deploy
// preview fails when a change goes over; `tools/sizeBudget.test.mjs` holds the rules.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const MIB = 1024 * 1024;

/** Keep in step with `docs/ASSET_BUDGETS.md`. */
export const BUDGET = {
  /** All of `dist/`: 25.4 MB measured on 28 Nov 2026, plus 10%. */
  totalBytes: 28_000_000,
  /** Any one data file: textures, level data, models. */
  assetBytes: 5 * MIB,
  /** Any one JavaScript chunk. Higher than a data file's, because free drive's bundle is 5.3 MiB. */
  scriptBytes: 6 * MIB,
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Every file in `dir` against `budget`: the total, and each file over its own limit. */
export function checkBudget(dir, budget = BUDGET) {
  let total = 0;
  const over = [];
  for (const path of walk(dir)) {
    const bytes = statSync(path).size;
    total += bytes;
    const limit = /\.(m?js)$/.test(path) ? budget.scriptBytes : budget.assetBytes;
    if (bytes > limit) over.push({ file: relative(dir, path), bytes, limit });
  }
  return { total, over, totalOver: total > budget.totalBytes };
}

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? "dist";
  const { total, over, totalOver } = checkBudget(dir);
  console.log(`size budget: ${dir} is ${mb(total)} of ${mb(BUDGET.totalBytes)}`);
  for (const o of over) console.error(`size budget: ${o.file} is ${mb(o.bytes)}, over its ${mb(o.limit)}`);
  if (totalOver) console.error(`size budget: ${dir} is over its total of ${mb(BUDGET.totalBytes)}`);
  if (totalOver || over.length > 0) process.exit(1);
}
