// ビルドのテスト用の小さな見本
import { formatYmd } from "../../../../src/core/date";

export function onOpen(): string {
  return `opened ${formatYmd(new Date(2026, 9, 24))}`;
}

export function runCheck(x: number): number {
  return x * 2;
}

// export しない関数は GAS の一番外には出ない
function helper(): void {}
helper();
