// 03 フォーム: シートの行 ⇔ 日程・申込 の変換と、メールの文面（Google 非依存）

import { formatDateTime } from "./date";
import type { Application, ApplicationStatus, Decision, Session } from "./form";
import { renderTemplate } from "./notify";
import type { Cell } from "./settings";

export const SESSION_HEADER = ["日程", "開催日時", "定員", "申込数", "残り", "締切"] as const;
export const APP_HEADER = ["受付番号", "受付日時", "お名前", "メール", "ご希望の日程", "人数", "状態"] as const;

/** フォームの質問（この文字で回答を取り出す） */
export const Q = { name: "お名前", email: "メールアドレス", session: "ご希望の日程", people: "人数" } as const;

const STATUSES: ApplicationStatus[] = ["受付", "キャンセル待ち", "取消"];

function toDate(v: Cell): Date {
  if (v instanceof Date) return v;
  return new Date(String(v ?? "").replace(/-/g, "/"));
}

export interface RowProblem {
  row: number;
  reason: string;
}

/** 開催日程（見出し込み）を読む。読めない行は行番号つきで返す */
export function parseSessionRows(values: Cell[][]): { sessions: (Session & { row: number })[]; problems: RowProblem[] } {
  const sessions: (Session & { row: number })[] = [];
  const problems: RowProblem[] = [];
  values.slice(1).forEach((r, i) => {
    const row = i + 2;
    const name = String(r[0] ?? "").trim();
    if (!name) return;
    const at = toDate(r[1]);
    const capacity = Number(r[2]);
    const deadline = toDate(r[5]);
    if (Number.isNaN(at.getTime())) return void problems.push({ row, reason: "開催日時が読めません" });
    if (!Number.isInteger(capacity) || capacity < 1) return void problems.push({ row, reason: "定員は1以上の整数にしてください" });
    if (Number.isNaN(deadline.getTime())) return void problems.push({ row, reason: "締切が読めません" });
    sessions.push({ row, name, at, capacity, deadline });
  });
  return { sessions, problems };
}

/** 申込一覧（見出し込み）を読む。状態が空・不明の行は数えない（問題として返す） */
export function parseApplicationRows(values: Cell[][]): { apps: Application[]; problems: RowProblem[] } {
  const apps: Application[] = [];
  const problems: RowProblem[] = [];
  values.slice(1).forEach((r, i) => {
    const row = i + 2;
    const no = String(r[0] ?? "").trim();
    if (!no) return;
    const status = String(r[6] ?? "").trim() as ApplicationStatus;
    if (!STATUSES.includes(status)) return void problems.push({ row, reason: `状態は ${STATUSES.join("・")} のどれかにしてください` });
    apps.push({ no, session: String(r[4] ?? "").trim(), people: Number(r[5]) || 0, status });
  });
  return { apps, problems };
}

/** フォームの回答（namedValues）から人数を読む。「2名」「2人」「2」を受け付ける */
export function parsePeople(v: string): number {
  const m = /^\s*(\d+)\s*(名|人)?\s*$/.exec(v);
  return m ? Number(m[1]) : NaN;
}

export interface Templates {
  受付の件名: string;
  受付の本文: string;
  キャンセル待ちの件名?: string;
  キャンセル待ちの本文?: string;
  お断りの件名: string;
  お断りの本文: string;
  満席のときの文?: string;
  締切のときの文?: string;
}

/** 判定の結果に合わせて、申込者へのメールを作る */
export function buildApplicantMail(
  d: Decision,
  t: Templates,
  vars: { お名前: string; 日程: string; 人数: number; 受付番号?: string; 主催者: string; 連絡先: string; 開催日時?: Date },
): { subject: string; body: string; missing: string[] } {
  const reason: Record<string, string> = {
    満席: t.満席のときの文 || "申し訳ございません。ご希望の日程は満席となりました。",
    締切: t.締切のときの文 || "申し訳ございません。ご希望の日程は申込の締切を過ぎております。",
    回が見つからない: "ご希望の日程が見つかりませんでした。",
    人数が正しくない: "人数の入力をご確認ください。",
  };
  const v: Record<string, string> = {
    お名前: vars.お名前,
    日程: vars.日程,
    人数: `${vars.人数}名`,
    受付番号: vars.受付番号 ?? "",
    主催者: vars.主催者,
    連絡先: vars.連絡先,
    開催日時: vars.開催日時 ? formatDateTime(vars.開催日時).slice(0, 16) : "",
    お断りの理由: reason[d.result] ?? "",
  };
  const pick =
    d.result === "受付"
      ? [t.受付の件名, t.受付の本文]
      : d.result === "キャンセル待ち"
        ? [t.キャンセル待ちの件名 ?? "", t.キャンセル待ちの本文 ?? ""]
        : [t.お断りの件名, t.お断りの本文];
  const s = renderTemplate(pick[0], v);
  const b = renderTemplate(pick[1], v);
  return { subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])] };
}
