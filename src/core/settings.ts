// 「設定」タブの読み取り（Google 非依存）
// シートは2列: A=項目名 ／ B=値。1行目は見出し（「項目」「値」）で読み飛ばす

import { formatHourMinute, parseHourMinute } from "./date";

export type Cell = string | number | boolean | Date | null | undefined;

export type FieldSpec =
  | { type: "string"; default?: string }
  | { type: "number"; default?: number; min?: number; max?: number }
  | { type: "boolean"; default?: boolean }
  | { type: "time"; default?: string } // "HH:mm"
  | { type: "list"; default?: readonly string[] }; // 「、」「,」改行で区切る

export type Schema = Record<string, FieldSpec>;

type ValueOf<F extends FieldSpec> = F extends { type: "string" }
  ? string
  : F extends { type: "number" }
    ? number
    : F extends { type: "boolean" }
      ? boolean
      : F extends { type: "time" }
        ? string
        : string[];

export type Settings<S extends Schema> = { [K in keyof S]: ValueOf<S[K]> };

export class SettingsError extends Error {
  constructor(public readonly problems: string[]) {
    super(`設定タブに直すところがあります:\n- ${problems.join("\n- ")}`);
    this.name = "SettingsError";
  }
}

const TRUE_WORDS = ["はい", "true", "on", "する", "1", "yes"];
const FALSE_WORDS = ["いいえ", "false", "off", "しない", "0", "no"];

/** 2次元配列（getValues の結果）から設定を読む。問題はまとめて SettingsError にする */
export function parseSettings<S extends Schema>(rows: Cell[][], schema: S): Settings<S> {
  const raw = new Map<string, Cell>();
  rows.slice(1).forEach((r) => {
    const key = String(r[0] ?? "").trim();
    if (key) raw.set(key, r[1]);
  });

  const out: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const [key, spec] of Object.entries(schema)) {
    const v = raw.get(key);
    const empty = v === undefined || v === null || String(v).trim() === "";
    if (empty) {
      if (spec.default === undefined) problems.push(`「${key}」が空です`);
      else out[key] = Array.isArray(spec.default) ? [...spec.default] : spec.default;
      continue;
    }
    const s = String(v).trim();
    switch (spec.type) {
      case "string":
        out[key] = s;
        break;
      case "number": {
        const n = typeof v === "number" ? v : Number(s.replace(/,/g, ""));
        if (Number.isNaN(n)) problems.push(`「${key}」は数字にしてください（今: ${s}）`);
        else if (spec.min !== undefined && n < spec.min) problems.push(`「${key}」は ${spec.min} 以上にしてください`);
        else if (spec.max !== undefined && n > spec.max) problems.push(`「${key}」は ${spec.max} 以下にしてください`);
        else out[key] = n;
        break;
      }
      case "boolean": {
        if (typeof v === "boolean") out[key] = v;
        else if (TRUE_WORDS.includes(s.toLowerCase())) out[key] = true;
        else if (FALSE_WORDS.includes(s.toLowerCase())) out[key] = false;
        else problems.push(`「${key}」は「はい」か「いいえ」にしてください（今: ${s}）`);
        break;
      }
      case "time": {
        // シートで時刻として入力された場合は Date で来る
        const hm = v instanceof Date ? { hour: v.getHours(), minute: v.getMinutes() } : parseHourMinute(s);
        if (hm) out[key] = formatHourMinute(hm);
        else problems.push(`「${key}」は 18:00 のような形にしてください（今: ${s}）`);
        break;
      }
      case "list":
        out[key] = s.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean);
        break;
    }
  }

  if (problems.length) throw new SettingsError(problems);
  return out as Settings<S>;
}
