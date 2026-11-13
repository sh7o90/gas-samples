import { describe, expect, it } from "vitest";
import { formatYmd } from "../src/core/date";
import {
  groupByOwner,
  NO_OWNER,
  reminderTargetDay,
  renderTemplate,
  selectForReminder,
  selectNewForNotify,
  type Booking,
} from "../src/core/notify";

const bk = (id: string, at: Date, over: Partial<Booking> = {}): Booking => ({
  id,
  at,
  customer: `客${id}`,
  owner: "佐藤",
  email: `c${id}@example.com`,
  status: "予約中",
  notifiedAt: null,
  remindedAt: null,
  ...over,
});

describe("reminderTargetDay（◯日後）", () => {
  it("月末・年末・うるう年をまたぐ", () => {
    expect(formatYmd(reminderTargetDay(new Date(2026, 0, 31, 18), 1))).toBe("2026-02-01");
    expect(formatYmd(reminderTargetDay(new Date(2026, 11, 31, 18), 1))).toBe("2027-01-01");
    expect(formatYmd(reminderTargetDay(new Date(2028, 1, 28, 18), 1))).toBe("2028-02-29");
    expect(formatYmd(reminderTargetDay(new Date(2027, 1, 28, 18), 1))).toBe("2027-03-01");
    expect(formatYmd(reminderTargetDay(new Date(2026, 9, 24, 18), 0))).toBe("2026-10-24");
  });
});

describe("selectForReminder（送る対象）", () => {
  const now = new Date(2026, 9, 24, 18, 0);
  const tomorrow10 = new Date(2026, 9, 25, 10, 0);

  it("明日・予約中・未送信だけを日時順に選ぶ", () => {
    const r = selectForReminder(
      [
        bk("A", new Date(2026, 9, 25, 15, 0)),
        bk("B", tomorrow10),
        bk("C", new Date(2026, 9, 26, 10, 0)), // 明後日
        bk("D", new Date(2026, 9, 24, 20, 0)), // 今日
      ],
      now,
      1,
    );
    expect(r.targets.map((b) => b.id)).toEqual(["B", "A"]);
    expect(r.skipped).toEqual([]);
  });

  it("キャンセル・完了は送らない", () => {
    const r = selectForReminder(
      [bk("A", tomorrow10, { status: "キャンセル" }), bk("B", tomorrow10, { status: "完了" })],
      now,
      1,
    );
    expect(r.targets).toEqual([]);
  });

  it("二重送信しない（送信済みは対象外）", () => {
    const r = selectForReminder([bk("A", tomorrow10, { remindedAt: new Date(2026, 9, 24, 18, 0) })], now, 1);
    expect(r.targets).toEqual([]);
  });

  it("送れない行は理由つきで飛ばす", () => {
    const r = selectForReminder(
      [
        bk("A", tomorrow10, { email: "メールなし" }),
        bk("C", new Date("not a date")),
      ],
      now,
      1,
    );
    expect(r.targets).toEqual([]);
    expect(r.skipped).toEqual([
      { id: "A", reason: "送り先のメールが正しくありません" },
      { id: "C", reason: "日時が読めません" },
    ]);
  });

  it("担当者が空でも、相手へのリマインドは送る", () => {
    const r = selectForReminder([bk("B", tomorrow10, { owner: " " })], now, 1);
    expect(r.targets.map((b) => b.id)).toEqual(["B"]);
  });

  it("年末: 12/31 の夜に 1/1 の予約を選ぶ", () => {
    const r = selectForReminder([bk("A", new Date(2027, 0, 1, 9, 0))], new Date(2026, 11, 31, 18, 0), 1);
    expect(r.targets.map((b) => b.id)).toEqual(["A"]);
  });
});

describe("selectNewForNotify（新着通知）", () => {
  it("未通知かつキャンセルでないものだけ。二重に通知しない", () => {
    const at = new Date(2026, 9, 30, 10);
    const r = selectNewForNotify([
      bk("A", at),
      bk("B", at, { notifiedAt: new Date() }),
      bk("C", at, { status: "キャンセル" }),
      bk("D", at, { owner: "" }),
    ]);
    expect(r.targets.map((b) => b.id)).toEqual(["A"]);
    expect(r.skipped).toEqual([{ id: "D", reason: "担当者が空です" }]);
  });
});

describe("renderTemplate（ひな形の差し込み）", () => {
  it("値を差し込み、ない項目はそのまま残して知らせる", () => {
    const r = renderTemplate("{お客様名}様 {日時}のご予約です。{場所}でお待ちしています。{お客様名}様", {
      お客様名: "山田",
      日時: "10/25 10:00",
    });
    expect(r.text).toBe("山田様 10/25 10:00のご予約です。{場所}でお待ちしています。山田様");
    expect(r.missing).toEqual(["場所"]);
  });
  it("値が空文字なら空で差し込む（未定義とは区別）", () => {
    expect(renderTemplate("[{備考}]", { 備考: "" })).toEqual({ text: "[]", missing: [] });
  });
});

describe("groupByOwner（担当者ごとのまとめ）", () => {
  it("担当者ごと・日時順。前後の空白は同じ担当者とみなす", () => {
    const g = groupByOwner([
      bk("A", new Date(2026, 9, 25, 15), { owner: "佐藤" }),
      bk("B", new Date(2026, 9, 25, 9), { owner: "鈴木" }),
      bk("C", new Date(2026, 9, 25, 10), { owner: "佐藤 " }),
    ]);
    expect([...g.keys()].sort()).toEqual(["佐藤", "鈴木"].sort());
    expect(g.get("佐藤")!.map((b) => b.id)).toEqual(["C", "A"]);
    expect(g.get("鈴木")!.map((b) => b.id)).toEqual(["B"]);
  });
  it("担当者が空の行は「（担当者なし）」にまとめる", () => {
    const g = groupByOwner([bk("A", new Date(2026, 9, 25, 9), { owner: "" })]);
    expect(g.get(NO_OWNER)!.map((b) => b.id)).toEqual(["A"]);
  });
});
