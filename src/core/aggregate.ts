// 集計ロジック（Google の API に依存しない。手元でテストする）

export type Unit = "day" | "week" | "month" | "year";

export interface Sale {
  /** 売り場（店舗 / ネットショップ / イベント・卸 など） */
  channel: string;
  /** 発生日時。手入力分は時刻なし（hasTime=false） */
  at: Date;
  hasTime: boolean;
  amount: number;
  category?: string;
}

/** 期間の先頭日を "YYYY-MM-DD" / "YYYY-MM" / "YYYY" のキーで返す */
export function bucketKey(d: Date, unit: Unit, weekStartsOn = 1): string {
  const y = d.getFullYear();
  const m = d.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (unit) {
    case "day":
      return `${y}-${pad(m + 1)}-${pad(d.getDate())}`;
    case "week": {
      const diff = (d.getDay() - weekStartsOn + 7) % 7;
      const start = new Date(y, m, d.getDate() - diff);
      return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    }
    case "month":
      return `${y}-${pad(m + 1)}`;
    case "year":
      return `${y}`;
  }
}

/** 期間 × 売り場 の売上合計。キーは期間の昇順 */
export function sumBy(
  sales: Sale[],
  unit: Unit,
  weekStartsOn = 1,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of sales) {
    const k = bucketKey(s.at, unit, weekStartsOn);
    const row = out.get(k) ?? new Map<string, number>();
    row.set(s.channel, (row.get(s.channel) ?? 0) + s.amount);
    out.set(k, row);
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** 増減率。前の値が 0 のときは null（「比較できない」を画面に出す） */
export function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** 目標達成率。目標が未設定（0以下）なら null */
export function achievementRate(actual: number, target: number): number | null {
  if (target <= 0) return null;
  return actual / target;
}

/** 曜日別の平均売上（0=日〜6=土）。売上ゼロの日は数に入らない点に注意 */
export function averageByWeekday(sales: Sale[]): number[] {
  const perDay = new Map<string, { wd: number; total: number }>();
  for (const s of sales) {
    const k = bucketKey(s.at, "day");
    const cur = perDay.get(k) ?? { wd: s.at.getDay(), total: 0 };
    cur.total += s.amount;
    perDay.set(k, cur);
  }
  const sum = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (const { wd, total } of perDay.values()) {
    sum[wd] += total;
    cnt[wd] += 1;
  }
  return sum.map((v, i) => (cnt[i] ? v / cnt[i] : 0));
}

/** 時間帯別（0〜23時）の平均売上。時刻のない手入力分は除く */
export function averageByHour(sales: Sale[]): number[] {
  const timed = sales.filter((s) => s.hasTime);
  const days = new Set(timed.map((s) => bucketKey(s.at, "day"))).size;
  const sum = Array(24).fill(0);
  for (const s of timed) sum[s.at.getHours()] += s.amount;
  return sum.map((v) => (days ? v / days : 0));
}
