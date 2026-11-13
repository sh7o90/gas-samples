import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
// @ts-expect-error .mjs に型がない
import { buildSample } from "../scripts/build.mjs";

describe("build（GAS 用の1ファイル）", () => {
  it("export した関数だけが一番外の function になり、呼ぶと動く", async () => {
    const out = mkdtempSync(join(tmpdir(), "gas-build-"));
    const names: string[] = await buildSample(join(__dirname, "fixtures", "hello"), out);
    expect(names.sort()).toEqual(["onOpen", "runCheck"]);

    const code = readFileSync(join(out, "Code.js"), "utf8");
    expect(code).toMatch(/^function onOpen\(/m);
    expect(code).toMatch(/^function runCheck\(/m);
    expect(code).not.toMatch(/^function helper\(/m);
    expect(code).not.toMatch(/\bimport\b|\bexport\b/);

    // GAS と同じく、ファイルを読み込んで一番外の関数を呼ぶ
    const ctx: Record<string, unknown> = {};
    runInNewContext(`${code}\nthis.r1 = onOpen(); this.r2 = runCheck(21);`, ctx);
    expect(ctx.r1).toBe("opened 2026-10-24");
    expect(ctx.r2).toBe(42);

    expect(existsSync(join(out, "appsscript.json"))).toBe(true);
  });
});
