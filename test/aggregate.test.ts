import { describe, expect, it } from "vitest";
import {
  achievementRate,
  averageByHour,
  averageByWeekday,
  bucketKey,
  changeRate,
  sumBy,
  type Sale,
} from "../src/core/aggregate";

const sale = (channel: string, iso: string, amount: number, hasTime = true): Sale => ({
  channel,
  at: new Date(iso),
  hasTime,
  amount,
});

describe("bucketKey", () => {
  it("週は月曜始まり（2026-10-25 日曜 → 10-19 の週）", () => {
    expect(bucketKey(new Date("2026-10-25T10:00:00"), "week")).toBe("2026-10-19");
    expect(bucketKey(new Date("2026-10-26T10:00:00"), "week")).toBe("2026-10-26");
  });
  it("週の始まりを日曜にも変えられる", () => {
    expect(bucketKey(new Date("2026-10-25T10:00:00"), "week", 0)).toBe("2026-10-25");
  });
  it("年またぎの週は前の年の月曜になる", () => {
    expect(bucketKey(new Date("2027-01-01T10:00:00"), "week")).toBe("2026-12-28");
  });
  it("月・年", () => {
    expect(bucketKey(new Date("2026-03-05T00:00:00"), "month")).toBe("2026-03");
    expect(bucketKey(new Date("2026-03-05T00:00:00"), "year")).toBe("2026");
  });
});

describe("sumBy", () => {
  it("期間 × 売り場で合計し、期間の昇順に並ぶ", () => {
    const r = sumBy(
      [
        sale("店舗", "2026-02-10T12:00:00", 1000),
        sale("ネット", "2026-01-03T12:00:00", 500),
        sale("店舗", "2026-02-20T12:00:00", 300),
      ],
      "month",
    );
    expect([...r.keys()]).toEqual(["2026-01", "2026-02"]);
    expect(r.get("2026-02")?.get("店舗")).toBe(1300);
    expect(r.get("2026-01")?.get("ネット")).toBe(500);
  });
});

describe("changeRate / achievementRate", () => {
  it("前の値が 0 なら比較できない（null）", () => {
    expect(changeRate(100, 0)).toBeNull();
    expect(changeRate(120, 100)).toBeCloseTo(0.2);
  });
  it("目標なしは null", () => {
    expect(achievementRate(50, 0)).toBeNull();
    expect(achievementRate(50, 200)).toBe(0.25);
  });
});

describe("averageByWeekday", () => {
  it("同じ日の複数売上はまとめてから平均する", () => {
    const r = averageByWeekday([
      sale("店舗", "2026-10-19T10:00:00", 100), // 月
      sale("ネット", "2026-10-19T15:00:00", 100), // 月（同日）
      sale("店舗", "2026-10-26T10:00:00", 400), // 月
    ]);
    expect(r[1]).toBe(300); // (200 + 400) / 2
    expect(r[0]).toBe(0);
  });
});

describe("averageByHour", () => {
  it("時刻のない手入力分は除く", () => {
    const r = averageByHour([
      sale("店舗", "2026-10-19T10:30:00", 1000),
      sale("イベント", "2026-10-19T00:00:00", 9999, false),
    ]);
    expect(r[10]).toBe(1000);
    expect(r[0]).toBe(0);
  });
});
