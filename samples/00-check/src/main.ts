// 00 動作確認: clasp push とシートのメニュー・ログが動くかを確かめるだけの見本
import { appendLog } from "../../../src/gas/sheet";

export function onOpen(): void {
  SpreadsheetApp.getUi().createMenu("動作確認").addItem("ログに1行書く", "runCheck").addToUi();
}

export function runCheck(): void {
  appendLog({ at: new Date(), level: "成功", action: "動作確認", message: "メニューから実行" });
  SpreadsheetApp.getActive().toast("ログタブに1行書きました", "動作確認");
}
