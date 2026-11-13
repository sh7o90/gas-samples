// 03 フォームで受付・管理（GAS の層）
// Google フォームの申込 → 受付番号を振って申込一覧へ → 申込者に受付メール → 管理者に通知
// 満席・締切の回はフォームの選択肢から自動で外す

import { addDays } from "../../../src/core/date";
import { decide, openSessions, planForm, nextReceiptNo, remainingSeats, usedSeats, type Request } from "../../../src/core/form";
import {
  APP_HEADER,
  buildApplicantMail,
  parseApplicationRows,
  parsePeople,
  parseSessionRows,
  Q,
  SESSION_HEADER,
} from "../../../src/core/form-sheet";
import { describeError } from "../../../src/core/log";
import { SettingsError } from "../../../src/core/settings";
import { appendLog, ensureSameTimeZone, getOrCreateSheet, readSettings } from "../../../src/gas/sheet";

const SESSIONS = "開催日程";
const APPS = "申込一覧";
const FORM_ID_KEY = "FORM_ID";

const SCHEMA = {
  主催者: { type: "string", default: "ひだまり料理教室" },
  連絡先: { type: "string", default: "TEL 052-000-0000（受付 10:00〜18:00）" },
  管理者メール: { type: "string" },
  // 空でなければ、すべてのメールをここへ送る（見本・動作確認用。本番では空にする）
  テスト送信先: { type: "string", default: "" },
  受付の件名: { type: "string", default: "【{主催者}】お申込みを受け付けました（{受付番号}）" },
  受付の本文: {
    type: "string",
    default:
      "{お名前} 様\n\nこのたびは{主催者}にお申込みいただき、ありがとうございます。\n以下の内容で受け付けました。\n\n" +
      "■ 受付番号：{受付番号}\n■ 日程：{日程}\n■ 開催日時：{開催日時}\n■ 人数：{人数}\n\n" +
      "当日お会いできるのを楽しみにしております。\nご都合が悪くなった場合は、下記までご連絡ください。\n\n{主催者}\n{連絡先}",
  },
  お断りの件名: { type: "string", default: "【{主催者}】お申込みについて" },
  お断りの本文: {
    type: "string",
    default: "{お名前} 様\n\nお申込みありがとうございます。\n{お断りの理由}\n\nほかの日程へのお申込みや、ご不明な点は下記までお問い合わせください。\n\n{主催者}\n{連絡先}",
  },
  満席のときの文: { type: "string", default: "申し訳ございません。ご希望の日程は、お申込みの人数分のお席がございませんでした。" },
  締切のときの文: { type: "string", default: "申し訳ございません。ご希望の日程は申込の締切を過ぎております。" },
} as const;

const VARS_ALL = "{お名前} {日程} {開催日時} {人数} {受付番号} {主催者} {連絡先}";
/** 設定タブの「説明」列 */
const NOTES: Record<keyof typeof SCHEMA, string> = {
  主催者: "メールに入る主催者・教室の名前",
  連絡先: "メールの最後に入る電話番号・受付時間など",
  管理者メール: "申込の通知と、失敗したときの知らせが届くメール",
  テスト送信先: "ここが空でなければ、すべてのメールをここへ送ります（試す用）。本番では空にする",
  受付の件名: `使える { }：${VARS_ALL}`,
  受付の本文: `使える { }：${VARS_ALL}`,
  お断りの件名: "使える { }：{お名前} {日程} {人数} {主催者} {連絡先}",
  お断りの本文: "使える { }：{お名前} {日程} {人数} {主催者} {連絡先} {お断りの理由}　※{お断りの理由} には下の「満席のときの文」「締切のときの文」が入ります",
  満席のときの文: "お席が足りない（満席・残りの席より人数が多い）ときに、{お断りの理由} に入る文",
  締切のときの文: "締切後の申込をお断りするとき、{お断りの理由} に入る文",
};

type S = ReturnType<typeof settings>;
let testTo = "";
function settings() {
  const s = readSettings(SCHEMA);
  testTo = s.テスト送信先;
  return s;
}

function send(to: string, subject: string, body: string, action: string, target: string): boolean {
  try {
    if (testTo) MailApp.sendEmail(testTo, `[テスト→${to}] ${subject}`, body);
    else MailApp.sendEmail(to, subject, body);
  } catch (e) {
    appendLog({ at: new Date(), level: "失敗", action, target, message: `→ ${to}: ${describeError(e)}` });
    return false;
  }
  appendLog({ at: new Date(), level: "成功", action, target, message: `→ ${to}` });
  return true;
}

function onFailure(action: string, err: unknown, s?: S): void {
  const msg = err instanceof SettingsError ? err.message : describeError(err);
  appendLog({ at: new Date(), level: "失敗", action, message: msg });
  if (s?.管理者メール) MailApp.sendEmail(s.管理者メール, `【失敗】${action}`, msg);
}

function load() {
  ensureSameTimeZone();
  const sSheet = getOrCreateSheet(SESSIONS, SESSION_HEADER);
  const aSheet = getOrCreateSheet(APPS, APP_HEADER);
  const ss = parseSessionRows(sSheet.getDataRange().getValues());
  const aa = parseApplicationRows(aSheet.getDataRange().getValues());
  for (const p of [...ss.problems.map((x) => ({ ...x, t: SESSIONS })), ...aa.problems.map((x) => ({ ...x, t: APPS }))]) {
    appendLog({ at: new Date(), level: "警告", action: `${p.t}の読み取り`, target: `${p.row}行目`, message: p.reason });
  }
  return { sSheet, aSheet, sessions: ss.sessions, apps: aa.apps };
}

function getForm(): GoogleAppsScript.Forms.Form | null {
  const id = PropertiesService.getScriptProperties().getProperty(FORM_ID_KEY);
  return id ? FormApp.openById(id) : null;
}

/** 開催日程の「申込数」「残り」を書き、フォームの選択肢を受付中の日程だけにする */
function refresh(now = new Date()): void {
  const { sSheet, sessions, apps } = load();
  for (const s of sessions) {
    sSheet.getRange(s.row, 4, 1, 2).setValues([[usedSeats(apps, s.name), remainingSeats(s, apps)]]);
  }
  const form = getForm();
  if (!form) return;
  const open = openSessions(sessions, apps, now).map((s) => s.name);
  const item = form.getItems(FormApp.ItemType.LIST).find((i) => i.getTitle() === Q.session);
  if (!item) throw new Error(`フォームに「${Q.session}」の質問がありません`);
  const plan = planForm(open);
  if (plan.accepting) {
    item.asListItem().setChoiceValues(plan.choices);
    form.setAcceptingResponses(true);
  } else {
    form.setAcceptingResponses(false);
    // 締切メッセージは見た目だけ。失敗しても受付は止まっている（Google 既定の文が出る）ので、警告にとどめる（#27）
    try {
      form.setCustomClosedFormMessage(plan.closedMessage);
    } catch (err) {
      appendLog({ at: now, level: "警告", action: "締切メッセージの設定", message: `既定の文で表示されます: ${describeError(err)}` });
    }
  }
  appendLog({ at: now, level: "成功", action: "選択肢の更新", message: plan.summary });
}

function withLock(fn: () => void): void {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error("ほかの処理が動いているため実行できませんでした");
  try {
    fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---- GAS から呼ぶ関数 ----

export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("申込フォーム")
    .addItem("見本を作る（フォームと見本データ）", "setupSample")
    .addItem("フォームを開く", "showFormLinks")
    .addSeparator()
    .addItem("申込数と選択肢を今すぐ更新", "runRefresh")
    .addToUi();
}

/** フォームが送信されたとき（インストール型トリガー） */
export function onFormSubmitHandler(e: GoogleAppsScript.Events.SheetsOnFormSubmit): void {
  let s: S | undefined;
  try {
    s = settings();
    const conf = s;
    const nv = e.namedValues;
    const val = (k: string) => String(nv[k]?.[0] ?? "").trim();
    const req: Request = { session: val(Q.session), people: parsePeople(val(Q.people)), at: new Date() };
    const name = val(Q.name);
    const email = val(Q.email);
    withLock(() => {
      const { aSheet, sessions, apps } = load();
      // 満席の日程は選択肢から消えるので、キャンセル待ちは使わない（席が足りなければお断り）
      const d = decide(req, sessions, apps, false);
      const session = sessions.find((x) => x.name === req.session);
      let no: string | undefined;
      if (d.result === "受付" || d.result === "キャンセル待ち") {
        no = nextReceiptNo(apps.map((a) => a.no));
        aSheet.appendRow([no, req.at, name, email, req.session, req.people, d.result]);
        aSheet.getRange(aSheet.getLastRow(), 2).setNumberFormat("yyyy-mm-dd hh:mm");
      }
      appendLog({ at: new Date(), level: d.result === "受付" ? "成功" : "警告", action: "申込", target: no ?? name, message: `${req.session} ${req.people}名 → ${d.result}` });
      const m = buildApplicantMail(d, conf, { お名前: name, 日程: req.session, 人数: req.people, 受付番号: no, 主催者: conf.主催者, 連絡先: conf.連絡先, 開催日時: session?.at });
      if (m.missing.length) {
        appendLog({ at: new Date(), level: "警告", action: "申込者へのメール", target: no ?? name, message: `ひな形の {${m.missing.join("}・{")}} に値がありません（設定タブの文面を確認）` });
      }
      send(email, m.subject, m.body, "申込者へのメール", no ?? name);
      send(conf.管理者メール, `【申込】${d.result}：${req.session} ${name} 様 ${req.people}名`, `受付番号：${no ?? "なし"}\nお名前：${name}\nメール：${email}\n日程：${req.session}\n人数：${req.people}名\n結果：${d.result}`, "管理者への通知", no ?? name);
    });
  } catch (err) {
    onFailure("申込", err, s);
    return;
  }
  // 申込は済んでいるので、選択肢の更新の失敗は「申込の失敗」として知らせない
  try {
    withLock(() => refresh());
  } catch (err) {
    onFailure("選択肢の更新（申込のあと）", err, s);
  }
}

/** 申込数と選択肢を更新（メニュー・毎日のトリガー） */
export function runRefresh(): void {
  let s: S | undefined;
  try {
    s = settings();
    withLock(() => refresh());
  } catch (err) {
    onFailure("選択肢の更新", err, s);
  }
}

export function showFormLinks(): void {
  const form = getForm();
  const ui = SpreadsheetApp.getUi();
  if (!form) return void ui.alert("まだフォームがありません。「見本を作る」を押してください。");
  ui.alert("フォーム", `回答用（申込者に送るURL）:\n${form.getPublishedUrl()}\n\n編集用:\n${form.getEditUrl()}`, ui.ButtonSet.OK);
}

/** 見本: フォームを作ってこのシートにつなぎ、回と設定を入れ、トリガーを入れる */
export function setupSample(): void {
  let s: S | undefined;
  try {
    ensureSameTimeZone();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const me = Session.getEffectiveUser().getEmail();

    const set = getOrCreateSheet("設定", ["項目", "値", "説明"]);
    if (set.getLastRow() < 2) {
      const rows = Object.entries(SCHEMA).map(([k, v]) => {
        const d = k === "管理者メール" || k === "テスト送信先" ? me : (v as { default?: unknown }).default ?? "";
        return [k, typeof d === "boolean" ? (d ? "はい" : "いいえ") : d, NOTES[k as keyof typeof SCHEMA]];
      });
      set.getRange(2, 2, rows.length, 1).setNumberFormat("@");
      set.getRange(1, 1, rows.length + 1, 3).setValues([["項目", "値", "説明"], ...rows]);
      set.getRange(1, 1, 1, 3).setFontWeight("bold");
      set.getRange(2, 3, rows.length, 1).setFontColor("#666666").setWrap(true);
      set.setColumnWidth(1, 200).setColumnWidth(2, 360).setColumnWidth(3, 420);
      set.getRange(2, 2, rows.length, 1).setWrap(true);
    }
    s = settings();

    const now = new Date();
    const day = (d: number, h: number) => {
      const x = addDays(now, d);
      return new Date(x.getFullYear(), x.getMonth(), x.getDate(), h, 0);
    };
    const sSheet = getOrCreateSheet(SESSIONS, SESSION_HEADER);
    if (sSheet.getLastRow() < 2) {
      const label = (d: Date, t: string) => `${d.getMonth() + 1}/${d.getDate()} ${t}`;
      const rows = [
        [label(day(7, 10), "パン作り体験（午前）"), day(7, 10), 6, "", "", day(5, 23)],
        [label(day(7, 14), "パン作り体験（午後）"), day(7, 14), 2, "", "", day(5, 23)],
        [label(day(14, 10), "お菓子作り体験"), day(14, 10), 4, "", "", day(12, 23)],
      ];
      sSheet.getRange(2, 1, rows.length, SESSION_HEADER.length).setValues(rows);
      sSheet.getRange(2, 2, rows.length, 1).setNumberFormat("yyyy-mm-dd hh:mm");
      sSheet.getRange(2, 6, rows.length, 1).setNumberFormat("yyyy-mm-dd hh:mm");
      sSheet.autoResizeColumns(1, SESSION_HEADER.length);
    }
    getOrCreateSheet(APPS, APP_HEADER);

    // 前の版のフォーム（質問の名前が違う）が残っていたら、つなぎを外して作り直す
    const old = getForm();
    if (old && !old.getItems(FormApp.ItemType.LIST).some((i) => i.getTitle() === Q.session)) {
      old.removeDestination();
      PropertiesService.getScriptProperties().deleteProperty(FORM_ID_KEY);
      appendLog({ at: new Date(), level: "警告", action: "見本", message: "前の版のフォームのつなぎを外し、新しいフォームを作ります" });
    }
    if (!getForm()) {
      const form = FormApp.create(`${s.主催者} 体験教室のお申込み`)
        .setDescription("ご希望の日程と人数を選んでお申込みください。受付後、確認のメールをお送りします。")
        .setConfirmationMessage("お申込みありがとうございます。確認のメールをお送りしました。");
      form.addTextItem().setTitle(Q.name).setRequired(true);
      const emailRule = FormApp.createTextValidation().requireTextIsEmail().build();
      form.addTextItem().setTitle(Q.email).setRequired(true).setValidation(emailRule);
      form.addListItem().setTitle(Q.session).setChoiceValues(["（準備中）"]).setRequired(true);
      form.addListItem().setTitle(Q.people).setChoiceValues(["1名", "2名", "3名", "4名"]).setRequired(true);
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
      PropertiesService.getScriptProperties().setProperty(FORM_ID_KEY, form.getId());
    }

    for (const t of ScriptApp.getProjectTriggers()) {
      if (["onFormSubmitHandler", "runRefresh"].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
    }
    ScriptApp.newTrigger("onFormSubmitHandler").forSpreadsheet(ss).onFormSubmit().create();
    ScriptApp.newTrigger("runRefresh").timeBased().everyDays(1).atHour(0).nearMinute(5).create(); // 締切を過ぎた回を外す

    withLock(() => refresh());
    appendLog({ at: new Date(), level: "成功", action: "見本", message: "フォーム・開催日程・設定を作り、自動処理を入れました。メールは設定の「テスト送信先」へ届きます" });
    showFormLinks();
  } catch (err) {
    onFailure("見本の作成", err, s);
  }
}
