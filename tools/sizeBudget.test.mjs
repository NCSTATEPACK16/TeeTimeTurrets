import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUDGET, checkBudget } from "./sizeBudget.mjs";

/**
 * The size budget's rules (Stage 4b), on a small made-up `dist/` with a small budget. The real
 * build is checked by `npm run build` itself, which ends with `tools/sizeBudget.mjs`.
 */

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakeDist(files) {
  const dir = mkdtempSync(join(tmpdir(), "budget-"));
  dirs.push(dir);
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, Buffer.alloc(bytes));
  }
  return dir;
}

const small = { totalBytes: 1000, assetBytes: 300, scriptBytes: 400 };

describe("the size budget", () => {
  it("passes a build inside every limit", () => {
    const r = checkBudget(fakeDist({ "a.bin": 300, "assets/b.js": 400, "c.json": 10 }), small);
    expect(r).toEqual({ total: 710, over: [], totalOver: false });
  });

  it("names a data file over the asset limit, and holds scripts to their own", () => {
    const r = checkBudget(fakeDist({ "textures/big.bin": 301, "assets/app.js": 400 }), small);
    expect(r.over).toEqual([{ file: join("textures", "big.bin"), bytes: 301, limit: 300 }]);
    expect(checkBudget(fakeDist({ "assets/app.js": 401 }), small).over).toHaveLength(1);
  });

  it("fails a build over its total even when every file is inside its own limit", () => {
    const r = checkBudget(fakeDist({ "a.bin": 300, "b.bin": 300, "c.bin": 300, "d.bin": 300 }), small);
    expect(r.over).toEqual([]);
    expect(r.totalOver).toBe(true);
  });

  it("keeps the spec's 5 MB a file for data", () => {
    expect(BUDGET.assetBytes).toBe(5 * 1024 * 1024);
  });
});
