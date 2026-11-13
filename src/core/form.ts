// 03 フォームで受付・管理のロジック（Google 非依存）
// シナリオ: イベント・教室の申込（回ごとに定員と締切がある）

export type ApplicationStatus = "受付" | "キャンセル待ち" | "取消";

export interface Session {
  name: string; // 回の名前（フォームの選択肢と同じ文字）
  at: Date; // 開催日時
  capacity: number; // 定員（人）
  deadline: Date; // 申込の締切（この時刻ちょうどまで受け付ける）
}

export interface Application {
  no: string; // 受付番号
  session: string;
  people: number;
  status: ApplicationStatus;
}

export interface Request {
  session: string;
  people: number;
  at: Date; // フォームの送信日時
}

export type Decision =
  | { result: "受付" | "キャンセル待ち"; remaining: number } // remaining: この申込のあとの残り席
  | { result: "満席" | "締切" | "回が見つからない" | "人数が正しくない"; remaining?: number };

const PREFIX = "A-";

/** 受付番号を振る（A-0001 形式）。今ある番号の最大の次。形が違う番号は無視する */
export function nextReceiptNo(existing: string[]): string {
  let max = 0;
  for (const s of existing) {
    const m = /^A-(\d+)$/.exec(s.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${PREFIX}${String(max + 1).padStart(4, "0")}`;
}

/** その回で埋まっている席（「受付」の人数の合計。キャンセル待ち・取消は数えない） */
export function usedSeats(apps: Application[], session: string): number {
  return apps.filter((a) => a.session === session && a.status === "受付").reduce((n, a) => n + a.people, 0);
}

export function remainingSeats(s: Session, apps: Application[]): number {
  return Math.max(0, s.capacity - usedSeats(apps, s.name));
}

/**
 * 1件の申込を判定する。
 * - 締切は「ちょうど」まで受け付ける
 * - 残り席に全員が入れなければ、waitlist なら「キャンセル待ち」、そうでなければ「満席」（一部だけの受付はしない）
 */
export function decide(req: Request, sessions: Session[], apps: Application[], waitlist: boolean): Decision {
  const s = sessions.find((x) => x.name === req.session);
  if (!s) return { result: "回が見つからない" };
  if (!Number.isInteger(req.people) || req.people < 1) return { result: "人数が正しくない" };
  if (req.at.getTime() > s.deadline.getTime()) return { result: "締切" };
  const left = remainingSeats(s, apps);
  if (req.people <= left) return { result: "受付", remaining: left - req.people };
  return waitlist ? { result: "キャンセル待ち", remaining: left } : { result: "満席", remaining: left };
}

/**
 * まとめて届いた申込を、送信日時の順に1件ずつ判定する（同時に送られても定員を超えて「受付」にしない）。
 * 受付・キャンセル待ちになったものは申込一覧に加えた状態で次を判定する。
 */
export function decideAll(
  reqs: Request[],
  sessions: Session[],
  apps: Application[],
  waitlist: boolean,
): { req: Request; no?: string; decision: Decision }[] {
  const list = [...apps];
  return [...reqs]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((req) => {
      const decision = decide(req, sessions, list, waitlist);
      if (decision.result !== "受付" && decision.result !== "キャンセル待ち") return { req, decision };
      const no = nextReceiptNo(list.map((a) => a.no));
      list.push({ no, session: req.session, people: req.people, status: decision.result });
      return { req, no, decision };
    });
}

/** フォームの選択肢に残す回: 締切前で、残り席がある回（開催日時の順） */
export function openSessions(sessions: Session[], apps: Application[], now: Date): Session[] {
  return sessions
    .filter((s) => now.getTime() <= s.deadline.getTime() && remainingSeats(s, apps) > 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** フォームの更新内容（受付中の日程名から決める）。0件ならフォームを閉じて締切メッセージを出す */
export const CLOSED_MESSAGE = "現在お申込みいただける日程はありません。";
export type FormPlan =
  | { accepting: true; choices: string[]; summary: string }
  | { accepting: false; closedMessage: string; summary: string };
export function planForm(openNames: string[]): FormPlan {
  return openNames.length
    ? { accepting: true, choices: openNames, summary: `受付中: ${openNames.join("、")}` }
    : { accepting: false, closedMessage: CLOSED_MESSAGE, summary: "受付中の日程はありません（フォームを閉じました）" };
}
