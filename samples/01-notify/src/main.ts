// 01 通知・リマインド（GAS の層）
// 一覧の新着を担当者に知らせ、前日に相手へリマインドを自動送信、担当者には翌日分を1通にまとめる

import { addDays, formatDateTime } from "../../../src/core/date";
import { describeError } from "../../../src/core/log";
import { reminderTargetDay, selectForReminder, selectNewForNotify } from "../../../src/core/notify";
import {
  buildMail,
  buildOwnerDigests,
  COL,
  LIST_HEADER,
  parseBookingRows,
  parseOwnerEmails,
  type Mail,
} from "../../../src/core/notify-sheet";
import { SettingsError } from "../../../src/core/settings";
import { appendLog, ensureSameTimeZone, getOrCreateSheet, readSettings } from "../../../src/gas/sheet";

const LIST = "一覧";
const OWNERS = "担当者";

const SCHEMA = {
  リマインドの時刻: { type: "time", default: "18:00" },
  何日前に送るか: { type: "number", default: 1, min: 0, max: 30 },
  管理者メール: { type: "string" },
  相手への件名: { type: "string", default: "【ご予約のお知らせ】{日時}" },
  相手への本文: { type: "string", default: "{お客様名} 様\n\n{日時} のご予約をお待ちしております。\n担当: {担当者}\n\n※このメールは自動送信の見本です。" },
  新着の件名: { type: "string", default: "【新しい予約】{お客様名} 様 {日時}" },
  新着の本文: { type: "string", default: "{担当者} さん\n\n新しい予約が入りました。\n{日時} {お客様名} 様（{ID}）" },
} as const;

type S = ReturnType<typeof settings>;
function settings() {
  return readSettings(SCHEMA);
}

/** 同時に2つ動いて二重送信しないように */
function withLock<T>(fn: () => T): T | undefined {
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(30 * 1000)) {
    appendLog({ at: new Date(), level: "警告", action: "実行", message: "ほかの処理が動いているため見送りました" });
    return undefined;
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush(); // 「送信済み」の書き込みを確定させてからロックを外す（次の実行が古い値を読まない）
    lock.releaseLock();
  }
}

/** 1通送る。失敗しても例外を投げず false を返す（1件の失敗で残りを止めない） */
function send(m: Mail, action: string, target: string): boolean {
  try {
    MailApp.sendEmail(m.to, m.subject, m.body);
  } catch (e) {
    appendLog({ at: new Date(), level: "失敗", action, target, message: `→ ${m.to}: ${describeError(e)}` });
    return false;
  }
  appendLog({ at: new Date(), level: "成功", action, target, message: `→ ${m.to}` });
  if (m.missing.length) {
    appendLog({ at: new Date(), level: "警告", action, target, message: `ひな形の {${m.missing.join("}・{")}} に値がありません` });
  }
  return true;
}

function loadList() {
  ensureSameTimeZone();
  const sheet = getOrCreateSheet(LIST, LIST_HEADER);
  const parsed = parseBookingRows(sheet.getDataRange().getValues());
  for (const p of parsed.problems) appendLog({ at: new Date(), level: "警告", action: "一覧の読み取り", target: `${p.row}行目`, message: p.reason });
  return { sheet, ...parsed };
}

function ownerEmails(): Map<string, string> {
  return parseOwnerEmails(getOrCreateSheet(OWNERS, ["担当者", "メール"]).getDataRange().getValues());
}

function onFailure(action: string, err: unknown, s?: S): void {
  const msg = err instanceof SettingsError ? err.message : describeError(err);
  appendLog({ at: new Date(), level: "失敗", action, message: msg });
  const admin = s?.管理者メール;
  if (admin) MailApp.sendEmail(admin, `【失敗】${action}`, msg);
}

// ---- GAS から呼ぶ関数（export したものが GAS の関数になる） ----

export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("通知・リマインド")
    .addItem("見本データを入れる", "setupSample")
    .addSeparator()
    .addItem("新着を今すぐ通知", "runNewNotify")
    .addItem("リマインドを今すぐ送る", "runReminder")
    .addSeparator()
    .addItem("自動で動かす（新着10分ごと・リマインド毎日）", "installTriggers")
    .addItem("自動で動かすのを止める", "removeTriggers")
    .addToUi();
}

/** 新着を担当者に知らせる */
export function runNewNotify(): void {
  let s: S | undefined;
  try {
    s = settings();
    const conf = s;
    withLock(() => {
      const { sheet, bookings } = loadList();
      const emails = ownerEmails();
      const { targets, skipped } = selectNewForNotify(bookings);
      for (const k of skipped) appendLog({ at: new Date(), level: "警告", action: "新着通知", target: k.id, message: k.reason });
      for (const b of targets) {
        const to = emails.get(b.owner) ?? conf.管理者メール;
        // 送れたものだけすぐ記録（二重送信防止）。失敗した行は記録しないので次回また送る
        if (send(buildMail(to, conf.新着の件名, conf.新着の本文, b), "新着通知", b.id)) {
          sheet.getRange(b.row, COL.notifiedAt + 1).setValue(new Date());
        }
      }
      if (!targets.length) appendLog({ at: new Date(), level: "成功", action: "新着通知", message: "新着はありません" });
    });
  } catch (e) {
    onFailure("新着通知", e, s);
  }
}

/** 相手へリマインド、担当者には翌日分を1通にまとめる */
export function runReminder(): void {
  let s: S | undefined;
  try {
    s = settings();
    const conf = s;
    withLock(() => {
      const now = new Date();
      const { sheet, bookings } = loadList();
      const { targets, skipped } = selectForReminder(bookings, now, conf.何日前に送るか);
      for (const k of skipped) appendLog({ at: now, level: "警告", action: "リマインド", target: k.id, message: k.reason });
      const sent = targets.filter((b) => {
        const ok = send(buildMail(b.email, conf.相手への件名, conf.相手への本文, b), "リマインド", b.id);
        if (ok) sheet.getRange(b.row, COL.remindedAt + 1).setValue(new Date());
        return ok;
      });
      const failed = targets.length - sent.length;
      if (failed) onFailure("リマインド", new Error(`${failed} 件のリマインドが送れませんでした（ログタブに詳細）`), conf);
      const day = reminderTargetDay(now, conf.何日前に送るか);
      const label = conf.何日前に送るか === 1 ? "明日" : formatDateTime(day).slice(0, 10);
      const { mails, unknownOwners } = buildOwnerDigests(sent, ownerEmails(), conf.管理者メール, label);
      for (const m of mails) send(m, "担当者まとめ", m.subject);
      for (const o of unknownOwners) appendLog({ at: now, level: "警告", action: "担当者まとめ", target: o, message: "担当者タブにメールがないため管理者へ送りました" });
      if (!targets.length) appendLog({ at: now, level: "成功", action: "リマインド", message: `${label}の対象はありません` });
    });
  } catch (e) {
    onFailure("リマインド", e, s);
  }
}

/** 時間トリガーを入れ直す（同じものが重ならないよう、先に消す） */
export function installTriggers(): void {
  let s: S | undefined;
  try {
    s = settings();
    removeTriggers();
    const [h, m] = s.リマインドの時刻.split(":").map(Number);
    ScriptApp.newTrigger("runNewNotify").timeBased().everyMinutes(10).create();
    ScriptApp.newTrigger("runReminder").timeBased().everyDays(1).atHour(h).nearMinute(m).create();
    appendLog({ at: new Date(), level: "成功", action: "自動実行の設定", message: `新着: 10分ごと ／ リマインド: 毎日 ${s.リマインドの時刻} ごろ` });
    SpreadsheetApp.getActive().toast(`リマインドは毎日 ${s.リマインドの時刻} ごろに動きます`, "自動実行を設定しました");
  } catch (e) {
    onFailure("自動実行の設定", e, s);
  }
}

export function removeTriggers(): void {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (["runNewNotify", "runReminder"].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  }
  appendLog({ at: new Date(), level: "成功", action: "自動実行の停止" });
}

/** 見本データ（架空）。送り先はすべて実行している本人のメール */
export function setupSample(): void {
  ensureSameTimeZone();
  const me = Session.getEffectiveUser().getEmail();
  const now = new Date();
  const at = (days: number, h: number, mi = 0) => {
    const d = addDays(now, days);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi);
  };
  const tomorrowDays = 1;

  const settingsSheet = getOrCreateSheet("設定", ["項目", "値"]);
  if (settingsSheet.getLastRow() < 2) {
    const rows = Object.entries(SCHEMA).map(([k, v]) => [k, k === "管理者メール" ? me : (v as { default?: unknown }).default ?? ""]);
    settingsSheet.getRange(2, 1, rows.length, 2).setValues(rows);
    settingsSheet.autoResizeColumns(1, 2);
  }

  const owners = getOrCreateSheet(OWNERS, ["担当者", "メール"]);
  if (owners.getLastRow() < 2) owners.getRange(2, 1, 2, 2).setValues([["佐藤", me], ["鈴木", me]]);

  const list = getOrCreateSheet(LIST, LIST_HEADER);
  if (list.getLastRow() < 2) {
    const rows = [
      ["R-001", at(tomorrowDays, 10), "山田 花子", "佐藤", me, "予約中", "", ""],
      ["R-002", at(tomorrowDays, 14, 30), "田中 一郎", "佐藤", me, "予約中", "", ""],
      ["R-003", at(tomorrowDays, 11), "高橋 次郎", "鈴木", me, "予約中", "", ""],
      ["R-004", at(tomorrowDays, 16), "伊藤 三郎", "鈴木", me, "キャンセル", "", ""],
      ["R-005", at(3, 13), "渡辺 さくら", "佐藤", me, "予約中", "", ""],
    ];
    list.getRange(2, 1, rows.length, LIST_HEADER.length).setValues(rows);
    list.getRange(2, COL.at + 1, rows.length, 1).setNumberFormat("yyyy-mm-dd hh:mm");
    list.getRange(2, COL.notifiedAt + 1, 100, 2).setNumberFormat("yyyy-mm-dd hh:mm");
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(["予約中", "完了", "キャンセル"]).build();
    list.getRange(2, COL.status + 1, 100, 1).setDataValidation(rule);
    list.autoResizeColumns(1, LIST_HEADER.length);
  }
  appendLog({ at: now, level: "成功", action: "見本データ", message: `送り先はすべて ${me}` });
  SpreadsheetApp.getActive().toast("一覧・担当者・設定に見本データを入れました", "準備できました");
}
