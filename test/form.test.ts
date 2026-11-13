import { describe, expect, it } from "vitest";
import {
  decide,
  decideAll,
  nextReceiptNo,
  openSessions,
  planForm,
  CLOSED_MESSAGE,
  remainingSeats,
  type Application,
  type Session,
} from "../src/core/form";

const sessions: Session[] = [
  { name: "11/1 体験教室", at: new Date(2026, 10, 1, 10), capacity: 5, deadline: new Date(2026, 9, 30, 23, 59) },
  { name: "11/8 体験教室", at: new Date(2026, 10, 8, 10), capacity: 3, deadline: new Date(2026, 10, 6, 23, 59) },
];
const app = (no: string, session: string, people: number, status: Application["status"] = "受付"): Application => ({ no, session, people, status });
const before = new Date(2026, 9, 25, 12);

describe("nextReceiptNo（受付番号）", () => {
  it("最大の次を振る。形が違う番号は無視", () => {
    expect(nextReceiptNo([])).toBe("A-0001");
    expect(nextReceiptNo(["A-0001", "A-0007", "A-0003"])).toBe("A-0008");
    expect(nextReceiptNo(["A-0002", "手入力", "B-9999", " A-0004 "])).toBe("A-0005");
  });
});

describe("remainingSeats", () => {
  it("受付の人数だけ数える（キャンセル待ち・取消は数えない）", () => {
    const apps = [app("A-0001", "11/1 体験教室", 2), app("A-0002", "11/1 体験教室", 1, "取消"), app("A-0003", "11/1 体験教室", 4, "キャンセル待ち")];
    expect(remainingSeats(sessions[0], apps)).toBe(3);
  });
});

describe("decide（1件の判定）", () => {
  const full4 = [app("A-0001", "11/1 体験教室", 4)];

  it("定員ちょうどまで受け付ける", () => {
    expect(decide({ session: "11/1 体験教室", people: 1, at: before }, sessions, full4, true)).toEqual({ result: "受付", remaining: 0 });
  });
  it("入りきらなければ キャンセル待ち（設定オン）／ 満席（設定オフ）。一部だけの受付はしない", () => {
    const r = { session: "11/1 体験教室", people: 2, at: before };
    expect(decide(r, sessions, full4, true)).toEqual({ result: "キャンセル待ち", remaining: 1 });
    expect(decide(r, sessions, full4, false)).toEqual({ result: "満席", remaining: 1 });
  });
  it("締切ちょうどは受け付け、1分過ぎたら締切", () => {
    const dl = sessions[0].deadline;
    expect(decide({ session: "11/1 体験教室", people: 1, at: dl }, sessions, [], true).result).toBe("受付");
    expect(decide({ session: "11/1 体験教室", people: 1, at: new Date(dl.getTime() + 60_000) }, sessions, [], true).result).toBe("締切");
  });
  it("回が見つからない・人数がおかしい", () => {
    expect(decide({ session: "存在しない回", people: 1, at: before }, sessions, [], true).result).toBe("回が見つからない");
    for (const p of [0, -1, 1.5, NaN]) expect(decide({ session: "11/1 体験教室", people: p, at: before }, sessions, [], true).result).toBe("人数が正しくない");
  });
});

describe("decideAll（同時送信）", () => {
  it("残り1席に2件が同時に来たら、先に送った方だけ受付", () => {
    const apps = [app("A-0001", "11/8 体験教室", 2)];
    const r = decideAll(
      [
        { session: "11/8 体験教室", people: 1, at: new Date(2026, 9, 25, 12, 0, 5) },
        { session: "11/8 体験教室", people: 1, at: new Date(2026, 9, 25, 12, 0, 3) },
      ],
      sessions,
      apps,
      true,
    );
    // 送信日時の順に並ぶ
    expect(r.map((x) => [x.req.at.getSeconds(), x.no, x.decision.result])).toEqual([
      [3, "A-0002", "受付"],
      [5, "A-0003", "キャンセル待ち"],
    ]);
  });
  it("満席・締切には受付番号を振らない", () => {
    const r = decideAll([{ session: "11/8 体験教室", people: 9, at: before }], sessions, [], false);
    expect(r[0].no).toBeUndefined();
    expect(r[0].decision.result).toBe("満席");
  });
});

describe("openSessions（フォームの選択肢）", () => {
  it("締切前で残り席がある回だけ、開催日時の順", () => {
    const apps = [app("A-0001", "11/8 体験教室", 3)]; // 11/8 は満席
    expect(openSessions(sessions, apps, before).map((s) => s.name)).toEqual(["11/1 体験教室"]);
    // 11/1 の締切を過ぎると、残った回もなくなる
    expect(openSessions(sessions, [], new Date(2026, 9, 31, 0, 0)).map((s) => s.name)).toEqual(["11/8 体験教室"]);
    expect(openSessions(sessions, [], new Date(2026, 10, 7, 0, 0))).toEqual([]);
  });
});

describe("planForm（0件のとき・戻ったとき）", () => {
  it("0件ならフォームを閉じ、締切メッセージを出す", () => {
    const p = planForm([]);
    expect(p.accepting).toBe(false);
    if (!p.accepting) expect(p.closedMessage).toBe(CLOSED_MESSAGE);
  });
  it("1件以上なら開き、選択肢はその日程だけ", () => {
    expect(planForm(["11/29 パン作り体験（午前）"])).toMatchObject({ accepting: true, choices: ["11/29 パン作り体験（午前）"] });
  });
  it("締切を過ぎると0件→閉じる、締切を戻すと1件→開き直る", () => {
    const s: Session[] = [{ name: "11/29 パン作り体験（午前）", at: new Date("2026-11-29T10:00:00"), deadline: new Date("2026-11-27T23:00:00"), capacity: 8 }];
    const after = new Date("2026-11-28T00:04:00");
    expect(planForm(openSessions(s, [], after).map((x) => x.name)).accepting).toBe(false);
    s[0].deadline = new Date("2026-11-28T23:00:00");
    expect(planForm(openSessions(s, [], after).map((x) => x.name)).accepting).toBe(true);
  });
});
