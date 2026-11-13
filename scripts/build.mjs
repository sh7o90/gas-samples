// 見本ごとに TypeScript を GAS 用の1ファイル（samples/<見本>/dist/Code.js）にまとめる
// （clasp 3 は rootDir がプロジェクトのフォルダの中にないと push できないため、見本のフォルダの中に出す）
//
// 決まり: samples/<見本>/src/main.ts で export した関数が、GAS から呼べる関数になる
//   （onOpen・トリガーの関数・メニューの関数など）。
// GAS はモジュールを使えず、トリガーやメニューは「ファイルの一番外の function」しか見つけないので、
// 中身は iife にまとめ、export した名前ごとに外側に function を書き出す。
//
// 使い方: node scripts/build.mjs [見本のフォルダ名...]（省略で全部）
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GLOBAL = "__app";

/** export されている名前を調べる（esm で一度まとめて metafile を見る） */
async function exportedNames(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, format: "esm", write: false, metafile: true, logLevel: "silent" });
  const out = Object.values(r.metafile.outputs)[0];
  return out.exports.filter((n) => n !== "default");
}

/** 1本の見本をまとめる。戻り値: 書き出した関数名 */
export async function buildSample(sampleDir, outDir) {
  const entry = join(sampleDir, "src", "main.ts");
  const names = await exportedNames(entry);
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    globalName: GLOBAL,
    target: "es2020", // GAS の V8 ランタイム
    charset: "utf8",
    write: false,
    logLevel: "silent",
  });
  const stubs = names
    .map((n) => `function ${n}(...args) { return ${GLOBAL}.${n}(...args); }`)
    .join("\n");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "Code.js"), `${r.outputFiles[0].text}\n${stubs}\n`);
  const manifest = join(sampleDir, "appsscript.json");
  if (existsSync(manifest)) copyFileSync(manifest, join(outDir, "appsscript.json"));
  return names;
}

async function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const samplesRoot = join(root, "samples");
  const wanted = process.argv.slice(2);
  const all = existsSync(samplesRoot)
    ? readdirSync(samplesRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(samplesRoot, d.name, "src", "main.ts")))
        .map((d) => d.name)
    : [];
  const targets = wanted.length ? wanted : all;
  if (!targets.length) {
    console.log("まとめる見本はまだありません（samples/<見本>/src/main.ts）");
    return;
  }
  for (const name of targets) {
    const fns = await buildSample(join(samplesRoot, name), join(samplesRoot, name, "dist"));
    console.log(`✓ ${name} → samples/${name}/dist/Code.js（関数: ${fns.join(", ") || "なし"}）`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
