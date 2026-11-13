import { describe, expect, it } from "vitest";
import {
  APP_HEADER,
  buildApplicantMail,
  parseApplicationRows,
  parsePeople,
  parseSessionRows,
  SESSION_HEADER,
  type Templates,
} from "../src/core/form-sheet";

describe("parseSessionRows", () => {
  it("回を読み、読めない行は行番号つき", () => {
    const r = parseSessionRows([
      [...SESSION_HEADER],
      ["11/1 体験", new Date(2026, 10, 1, 10), 5, "", "", "2026-10-30 23:59"],
      ["", "", "", "", "", ""],
      ["11/8 体験", "あした", 5, "", "", "2026-11-06 23:59"],
      ["11/15 体験", new Date(2026, 10, 15, 10), 0, "", "", "2026-11-13 23:59"],
    ]);
    expect(r.sessions.map((s) => [s.row, s.name, s.capacity, s.deadline.getDate()])).toEqual([[2, "11/1 体験", 5, 30]]);
    expect(r.problems).toEqual([
      { row: 4, reason: "開催日時が読めません" },
      { row: 5, reason: "定員は1以上の整数にしてください" },
    ]);
  });
});

describe("parseApplicationRows", () => {
  it("状態が不明な行は数えない", () => {
    const r = parseApplicationRows([
      [...APP_HEADER],
      ["A-0001", new Date(), "山田", "y@example.com", "11/1 体験", 2, "受付"],
      ["A-0002", new Date(), "田中", "t@example.com", "11/1 体験", 1, "保留"],
    ]);
    expect(r.apps).toEqual([{ no: "A-0001", session: "11/1 体験", people: 2, status: "受付" }]);
    expect(r.problems[0].row).toBe(3);
  });
});

describe("parsePeople", () => {
  it("「2名」「2人」「2」", () => {
    expect(parsePeople("2名")).toBe(2);
    expect(parsePeople("3人")).toBe(3);
    expect(parsePeople(" 1 ")).toBe(1);
    expect(parsePeople("二人")).toBeNaN();
  });
});

describe("buildApplicantMail", () => {
  const t: Templates = {
    受付の件名: "【{主催者}】お申込みを受け付けました（{受付番号}）",
    受付の本文: "{お名前} 様 {日程} {開催日時} {人数}",
    キャンセル待ちの件名: "【{主催者}】キャンセル待ちで受け付けました（{受付番号}）",
    キャンセル待ちの本文: "{お名前} 様 空きが出たらご連絡します",
    お断りの件名: "【{主催者}】お申込みについて",
    お断りの本文: "{お名前} 様 {お断りの理由} {連絡先}",
  };
  const vars = { お名前: "山田", 日程: "11/1 体験", 人数: 2, 受付番号: "A-0003", 主催者: "ひだまり料理教室", 連絡先: "TEL 0", 開催日時: new Date(2026, 10, 1, 10) };

  it("受付", () => {
    const m = buildApplicantMail({ result: "受付", remaining: 1 }, t, vars);
    expect(m.subject).toBe("【ひだまり料理教室】お申込みを受け付けました（A-0003）");
    expect(m.body).toBe("山田 様 11/1 体験 2026-11-01 10:00 2名");
  });
  it("キャンセル待ち", () => {
    expect(buildApplicantMail({ result: "キャンセル待ち", remaining: 0 }, t, vars).subject).toContain("キャンセル待ち");
  });
  it("満席・締切は理由を差し込む", () => {
    expect(buildApplicantMail({ result: "満席" }, t, { ...vars, 受付番号: undefined }).body).toBe("山田 様 申し訳ございません。ご希望の日程は満席となりました。 TEL 0");
    expect(buildApplicantMail({ result: "締切" }, t, vars).body).toContain("締切を過ぎて");
  });
});

describe("お断りの理由を設定で変える", () => {
  it("満席・締切のときの文が設定にあれば、それを差し込む", () => {
    const t2 = {
      受付の件名: "", 受付の本文: "", キャンセル待ちの件名: "", キャンセル待ちの本文: "",
      お断りの件名: "x", お断りの本文: "{お断りの理由}",
      満席のときの文: "満席のため、次回の開催をお待ちください。", 締切のときの文: "",
    };
    const v = { お名前: "山田", 日程: "11/1", 人数: 1, 主催者: "教室", 連絡先: "TEL" };
    expect(buildApplicantMail({ result: "満席" }, t2, v).body).toBe("満席のため、次回の開催をお待ちください。");
    // 空なら元の文
    expect(buildApplicantMail({ result: "締切" }, t2, v).body).toContain("締切を過ぎて");
  });
});
