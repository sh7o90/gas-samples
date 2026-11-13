// 日付のユーティリティ（Google 非依存）。GAS のスクリプトのタイムゾーンは Asia/Tokyo にする前提

const pad = (n: number) => String(n).padStart(2, "0");

/** その日の 0:00 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** n 日後（負なら前）の同じ時刻。月末・年末・うるう年をまたいでもよい */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setDate(r.getDate() + n);
  return r;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "YYYY-MM-DD" */
export function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD HH:mm:ss" */
export function formatDateTime(d: Date): string {
  return `${formatYmd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** {hour, minute} を "HH:mm" に */
export function formatHourMinute(t: { hour: number; minute: number }): string {
  return `${pad(t.hour)}:${pad(t.minute)}`;
}

/** "HH:mm" を {hour, minute} に。形が違えば null */
export function parseHourMinute(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}
