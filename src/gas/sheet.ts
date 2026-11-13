// GAS 側の薄い層: シートの読み書き（ここは手元テストしない。ロジックは src/core に置く）

import { LOG_HEADER, toLogRow, type LogEntry } from "../core/log";
import { parseSettings, type Schema, type Settings } from "../core/settings";

/** シートを取得。なければ作って見出しを入れる */
export function getOrCreateSheet(name: string, header: readonly string[]): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([[...header]]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * シートのタイムゾーンをスクリプト（appsscript.json の timeZone）にそろえる。
 * 新しく作ったシートは別のタイムゾーンのことがあり、日時の読み書きがずれる（2026-10-25 01 通知で16時間ずれた）
 */
export function ensureSameTimeZone(): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const want = Session.getScriptTimeZone();
  const now = ss.getSpreadsheetTimeZone();
  if (now !== want) {
    ss.setSpreadsheetTimeZone(want);
    appendLog({ at: new Date(), level: "警告", action: "タイムゾーン", message: `シートを ${now} から ${want} に合わせました` });
  }
}

export function readSettings<S extends Schema>(schema: S, sheetName = "設定"): Settings<S> {
  const sheet = getOrCreateSheet(sheetName, ["項目", "値"]);
  return parseSettings(sheet.getDataRange().getValues(), schema);
}

export function appendLog(entry: LogEntry, sheetName = "ログ"): void {
  getOrCreateSheet(sheetName, LOG_HEADER).appendRow(toLogRow(entry));
}
