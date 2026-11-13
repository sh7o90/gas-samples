// 「ログ」タブに書く1行を作る（Google 非依存）

import { formatDateTime } from "./date";

export type LogLevel = "成功" | "警告" | "失敗";

export const LOG_HEADER = ["日時", "結果", "処理", "対象", "内容"] as const;

export interface LogEntry {
  at: Date;
  level: LogLevel;
  action: string; // 例: リマインド送信
  target?: string; // 例: 予約ID
  message?: string;
}

const MAX_MESSAGE = 500; // セルが長くなりすぎないように切る

export function toLogRow(e: LogEntry): string[] {
  const msg = e.message ?? "";
  return [
    formatDateTime(e.at),
    e.level,
    e.action,
    e.target ?? "",
    msg.length > MAX_MESSAGE ? `${msg.slice(0, MAX_MESSAGE)}…` : msg,
  ];
}

/** 例外をログの内容にする（Error 以外が投げられても文字にする） */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
