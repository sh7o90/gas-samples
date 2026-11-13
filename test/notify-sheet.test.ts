import { describe, expect, it } from "vitest";
import { buildMail, buildOwnerDigests, LIST_HEADER, parseBookingRows, parseOwnerEmails } from "../src/core/notify-sheet";
import type { Booking } from "../src/core/notify";

describe("parseBookingRows", () => {
  it("行を Booking に。空行は飛ばし、状態がおかしい行は行番号つきで返す", () => {
    const r = parseBookingRows([
      [...LIST_HEADER],
      ["R1", new Date(2026, 9, 25, 10), "山田", "佐藤", "a@example.com", "予約中", "", ""],
      ["", "", "", "", "", "", "", ""],
      ["R3", "2026-10-25 14:00", "田中", "鈴木", "b@example.com", "保留", "", ""],
      ["R4", "2026/10/26 9:30", "高橋", "佐藤", "c@example.com", "キャンセル", new Date(2026, 9, 24, 9), ""],
    ]);
    expect(r.bookings.map((b) => [b.row, b.id, b.status])).toEqual([
      [2, "R1", "予約中"],
      [5, "R4", "キャンセル"],
    ]);
    expect(r.bookings[1].at.getHours()).toBe(9);
    expect(r.bookings[1].notifiedAt).toBeInstanceOf(Date);
    expect(r.bookings[0].notifiedAt).toBeNull();
    expect(r.problems).toEqual([{ row: 4, reason: "状態は 予約中・完了・キャンセル のどれかにしてください（今: 保留）" }]);
  });

  it("日時が読めない行は Invalid Date にする（あとで理由つきで飛ばされる）", () => {
    const r = parseBookingRows([[...LIST_HEADER], ["R1", "あした", "山田", "佐藤", "a@example.com", "予約中", "", ""]]);
    expect(Number.isNaN(r.bookings[0].at.getTime())).toBe(true);
  });
});

describe("parseOwnerEmails", () => {
  it("担当者とメールの対応", () => {
    const m = parseOwnerEmails([["担当者", "メール"], ["佐藤", "s@example.com"], ["鈴木", ""]]);
    expect([...m]).toEqual([["佐藤", "s@example.com"]]);
  });
});

const b = (id: string, h: number, owner: string, customer = `客${id}`): Booking => ({
  id, at: new Date(2026, 9, 25, h, 0), customer, owner, email: `${id}@example.com`, status: "予約中", notifiedAt: null, remindedAt: null,
});

describe("buildMail", () => {
  it("件名と本文に差し込み、足りない項目をまとめる", () => {
    const m = buildMail("x@example.com", "【リマインド】{日時}", "{お客様名}様\n{場所}でお待ちしています", b("R1", 10, "佐藤", "山田"));
    expect(m.subject).toBe("【リマインド】2026-10-25 10:00");
    expect(m.body).toBe("山田様\n{場所}でお待ちしています");
    expect(m.missing).toEqual(["場所"]);
  });
});

describe("buildOwnerDigests", () => {
  it("担当者ごとに1通。メールが分からない担当者は管理者へ送り、名前を返す", () => {
    const { mails, unknownOwners } = buildOwnerDigests(
      [b("R2", 15, "佐藤"), b("R1", 10, "佐藤"), b("R3", 9, "鈴木")],
      new Map([["佐藤", "sato@example.com"]]),
      "admin@example.com",
      "明日",
    );
    expect(mails).toHaveLength(2);
    const sato = mails.find((m) => m.to === "sato@example.com")!;
    expect(sato.subject).toBe("【明日の予約】佐藤 2件");
    expect(sato.body.indexOf("10:00")).toBeLessThan(sato.body.indexOf("15:00"));
    expect(mails.find((m) => m.to === "admin@example.com")!.subject).toContain("鈴木");
    expect(unknownOwners).toEqual(["鈴木"]);
  });
});
