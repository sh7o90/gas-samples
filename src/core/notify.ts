// 01 通知・リマインドのロジック（Google 非依存）
// シナリオ: 予約・面談の一覧から、新着を担当者に知らせ、前日に相手へリマインドを送る

import { addDays, isSameDay, startOfDay } from "./date";

export type BookingStatus = "予約中" | "完了" | "キャンセル";

export interface Booking {
  id: string;
  at: Date; // 予約の日時
  customer: string; // お客様・応募者の名前
  owner: string; // 担当者
  email: string; // 相手の送り先
  status: BookingStatus;
  notifiedAt: Date | null; // 担当者への新着通知を送った日時
  remindedAt: Date | null; // 相手へのリマインドを送った日時
}

export interface Skipped {
  id: string;
  reason: string;
}

export interface Selection<T extends Booking = Booking> {
  targets: T[];
  skipped: Skipped[]; // 送らなかった理由（ログに残す）
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 送る前の共通チェック。問題があれば理由を返す */
function problemOf(b: Booking): string | null {
  if (Number.isNaN(b.at.getTime())) return "日時が読めません";
  if (!b.owner.trim()) return "担当者が空です";
  return null;
}

/** 新着通知の対象: まだ通知していない・キャンセルでない */
export function selectNewForNotify<T extends Booking>(rows: T[]): Selection<T> {
  const targets: T[] = [];
  const skipped: Skipped[] = [];
  for (const b of rows) {
    if (b.notifiedAt || b.status === "キャンセル") continue; // 対象外（理由は残さない）
    const p = problemOf(b);
    if (p) skipped.push({ id: b.id, reason: p });
    else targets.push(b);
  }
  return { targets, skipped };
}

/** リマインドを送る日（今日から daysBefore 日後）の 0:00 */
export function reminderTargetDay(now: Date, daysBefore: number): Date {
  return startOfDay(addDays(now, daysBefore));
}

/** リマインドの対象: 予約が「今日から daysBefore 日後」・予約中・まだ送っていない */
export function selectForReminder<T extends Booking>(rows: T[], now: Date, daysBefore: number): Selection<T> {
  const day = reminderTargetDay(now, daysBefore);
  const targets: T[] = [];
  const skipped: Skipped[] = [];
  for (const b of rows) {
    if (b.status !== "予約中" || b.remindedAt) continue;
    if (Number.isNaN(b.at.getTime())) {
      skipped.push({ id: b.id, reason: "日時が読めません" });
      continue;
    }
    if (!isSameDay(b.at, day)) continue;
    // 相手へのリマインドなので、担当者が空でも送る（担当者向けのまとめでは「担当者なし」に入る）
    if (!EMAIL.test(b.email.trim())) skipped.push({ id: b.id, reason: "送り先のメールが正しくありません" });
    else targets.push(b);
  }
  targets.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { targets, skipped };
}

export interface Rendered {
  text: string;
  missing: string[]; // ひな形にあるのに値がない項目（そのまま残し、ログで警告する）
}

/** ひな形の {項目名} を差し込む。値がない項目は空にせず {項目名} のまま残す */
export function renderTemplate(template: string, vars: Record<string, string>): Rendered {
  const missing = new Set<string>();
  const text = template.replace(/\{([^{}\s]+)\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    missing.add(key);
    return whole;
  });
  return { text, missing: [...missing] };
}

export const NO_OWNER = "（担当者なし）";

/** 担当者ごとにまとめる（担当者の名前順・各担当の中は日時順）。担当者が空の行は NO_OWNER に入れる */
export function groupByOwner(rows: Booking[]): Map<string, Booking[]> {
  const m = new Map<string, Booking[]>();
  for (const b of rows) {
    const k = b.owner.trim() || NO_OWNER;
    m.set(k, [...(m.get(k) ?? []), b]);
  }
  for (const list of m.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
  return new Map([...m.entries()].sort(([a], [b]) => a.localeCompare(b, "ja")));
}
