// 01 通知: シートの行 ⇔ Booking の変換と、メール本文づくり（Google 非依存）

import { formatDateTime } from "./date";
import type { Cell } from "./settings";
import { groupByOwner, renderTemplate, type Booking, type BookingStatus } from "./notify";

export const LIST_HEADER = ["ID", "日時", "お客様名", "担当者", "送り先メール", "状態", "通知済み", "リマインド済み"] as const;
export const COL = { id: 0, at: 1, customer: 2, owner: 3, email: 4, status: 5, notifiedAt: 6, remindedAt: 7 } as const;

const STATUSES: BookingStatus[] = ["予約中", "完了", "キャンセル"];

export interface RowProblem {
  row: number; // シートの行番号（1始まり・見出しが1行目）
  reason: string;
}

function toDate(v: Cell): Date | null {
  if (v instanceof Date) return v;
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const d = new Date(String(v).replace(/-/g, "/"));
  return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
}

/** 一覧タブの値（見出し込み）を Booking にする。row はシートの行番号 */
export function parseBookingRows(values: Cell[][]): { bookings: (Booking & { row: number })[]; problems: RowProblem[] } {
  const bookings: (Booking & { row: number })[] = [];
  const problems: RowProblem[] = [];
  values.slice(1).forEach((r, i) => {
    const row = i + 2;
    const id = String(r[COL.id] ?? "").trim();
    if (!id && r.every((c) => c === "" || c === null || c === undefined)) return; // 空行
    const status = String(r[COL.status] ?? "").trim() as BookingStatus;
    if (!STATUSES.includes(status)) {
      problems.push({ row, reason: `状態は ${STATUSES.join("・")} のどれかにしてください（今: ${status || "空"}）` });
      return;
    }
    bookings.push({
      row,
      id: id || `行${row}`,
      at: toDate(r[COL.at]) ?? new Date(NaN),
      customer: String(r[COL.customer] ?? "").trim(),
      owner: String(r[COL.owner] ?? "").trim(),
      email: String(r[COL.email] ?? "").trim(),
      status,
      notifiedAt: toDate(r[COL.notifiedAt]),
      remindedAt: toDate(r[COL.remindedAt]),
    });
  });
  return { bookings, problems };
}

/** 担当者タブ（担当者 ／ メール）を Map に */
export function parseOwnerEmails(values: Cell[][]): Map<string, string> {
  const m = new Map<string, string>();
  values.slice(1).forEach((r) => {
    const name = String(r[0] ?? "").trim();
    const mail = String(r[1] ?? "").trim();
    if (name && mail) m.set(name, mail);
  });
  return m;
}

export function bookingVars(b: Booking): Record<string, string> {
  return {
    ID: b.id,
    お客様名: b.customer,
    担当者: b.owner,
    日時: formatDateTime(b.at).slice(0, 16), // 秒は出さない
  };
}

export interface Mail {
  to: string;
  subject: string;
  body: string;
  missing: string[];
}

/** 1件ぶんのメール（相手へのリマインド・担当者への新着通知） */
export function buildMail(to: string, subjectTpl: string, bodyTpl: string, b: Booking): Mail {
  const vars = bookingVars(b);
  const s = renderTemplate(subjectTpl, vars);
  const t = renderTemplate(bodyTpl, vars);
  return { to, subject: s.text, body: t.text, missing: [...new Set([...s.missing, ...t.missing])] };
}

/** 担当者ごとに「明日の予約」を1通にまとめる。メールが分からない担当者は unknownOwners に入る */
export function buildOwnerDigests(
  targets: Booking[],
  ownerEmails: Map<string, string>,
  fallbackEmail: string,
  dayLabel: string,
): { mails: Mail[]; unknownOwners: string[] } {
  const mails: Mail[] = [];
  const unknownOwners: string[] = [];
  for (const [owner, list] of groupByOwner(targets)) {
    let to = ownerEmails.get(owner);
    if (!to) {
      unknownOwners.push(owner);
      to = fallbackEmail; // 管理者に送って取りこぼさない
    }
    const lines = list.map((b) => `・${formatDateTime(b.at).slice(11, 16)} ${b.customer} 様（${b.id}）`);
    mails.push({
      to,
      subject: `【${dayLabel}の予約】${owner} ${list.length}件`,
      body: `${owner} さん\n\n${dayLabel}の予約は ${list.length} 件です。お客様にはリマインドを送りました。\n\n${lines.join("\n")}\n`,
      missing: [],
    });
  }
  return { mails, unknownOwners };
}
