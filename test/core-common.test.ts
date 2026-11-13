import { describe, expect, it } from "vitest";
import { addDays, formatDateTime, formatYmd, isSameDay, parseHourMinute, startOfDay } from "../src/core/date";
import { describeError, toLogRow } from "../src/core/log";
import { parseSettings, SettingsError } from "../src/core/settings";

describe("date", () => {
  it("addDays は月末・年末・うるう年をまたぐ", () => {
    expect(formatYmd(addDays(new Date(2026, 0, 31), 1))).toBe("2026-02-01");
    expect(formatYmd(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
    expect(formatYmd(addDays(new Date(2028, 1, 28), 1))).toBe("2028-02-29");
    expect(formatYmd(addDays(new Date(2026, 2, 1), -1))).toBe("2026-02-28");
  });
  it("startOfDay / isSameDay", () => {
    const d = new Date(2026, 9, 24, 23, 59);
    expect(formatDateTime(startOfDay(d))).toBe("2026-10-24 00:00:00");
    expect(isSameDay(d, new Date(2026, 9, 24, 0, 0))).toBe(true);
    expect(isSameDay(d, new Date(2026, 9, 25, 0, 0))).toBe(false);
  });
  it("parseHourMinute", () => {
    expect(parseHourMinute("18:00")).toEqual({ hour: 18, minute: 0 });
    expect(parseHourMinute("7:05")).toEqual({ hour: 7, minute: 5 });
    expect(parseHourMinute("24:00")).toBeNull();
    expect(parseHourMinute("18時")).toBeNull();
  });
});

describe("parseSettings", () => {
  const schema = {
    送る時刻: { type: "time" },
    何日前: { type: "number", default: 1, min: 0, max: 30 },
    管理者メール: { type: "string" },
    キャンセル待ち: { type: "boolean", default: false },
    通貨: { type: "list", default: ["USD"] },
  } as const;

  it("値を型にそろえ、空なら初期値", () => {
    const s = parseSettings(
      [
        ["項目", "値"],
        ["送る時刻", "8:30"],
        ["管理者メール", " admin@example.com "],
        ["キャンセル待ち", "はい"],
        ["通貨", "USD、EUR,GBP"],
      ],
      schema,
    );
    expect(s).toEqual({
      送る時刻: "08:30",
      何日前: 1,
      管理者メール: "admin@example.com",
      キャンセル待ち: true,
      通貨: ["USD", "EUR", "GBP"],
    });
  });

  it("シートで時刻として入った値（Date）も読める", () => {
    const s = parseSettings(
      [["項目", "値"], ["送る時刻", new Date(1899, 11, 30, 18, 0)], ["管理者メール", "a@example.com"]],
      schema,
    );
    expect(s.送る時刻).toBe("18:00");
  });

  it("問題はまとめて1つのエラーで返す", () => {
    try {
      parseSettings(
        [["項目", "値"], ["送る時刻", "18時"], ["何日前", "99"], ["キャンセル待ち", "たぶん"]],
        schema,
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SettingsError);
      const p = (e as SettingsError).problems;
      expect(p).toHaveLength(4); // 時刻・範囲外・はい/いいえ・管理者メールが空
      expect(p.some((x) => x.includes("管理者メール"))).toBe(true);
    }
  });
});

describe("log", () => {
  it("1行の形と長い内容の切り詰め", () => {
    const row = toLogRow({ at: new Date(2026, 9, 24, 9, 5, 7), level: "失敗", action: "送信", message: "x".repeat(600) });
    expect(row.slice(0, 4)).toEqual(["2026-10-24 09:05:07", "失敗", "送信", ""]);
    expect(row[4]).toHaveLength(501);
  });
  it("describeError", () => {
    expect(describeError(new TypeError("bad"))).toBe("TypeError: bad");
    expect(describeError("oops")).toBe("oops");
  });
});
