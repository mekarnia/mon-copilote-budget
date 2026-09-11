export function todayIso(now: Date = new Date()): string {
  return toIso(now);
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(now: Date = new Date()): string {
  return toIso(now).slice(0, 7);
}

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toIso(dt);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return toIso(dt).slice(0, 7);
}

/** Prochaine occurrence >= from pour une règle mensuelle (jour du mois, borné à la fin du mois) ou hebdo (0=dimanche). */
export function nextOccurrence(frequency: "monthly" | "weekly", day: number, from: string): string {
  const [y, m, d] = from.split("-").map(Number);
  if (frequency === "weekly") {
    const dt = new Date(y, m - 1, d);
    const diff = (day - dt.getDay() + 7) % 7;
    return toIso(new Date(y, m - 1, d + diff));
  }
  const candidate = (yy: number, mm: number) => {
    const last = new Date(yy, mm + 1, 0).getDate();
    return new Date(yy, mm, Math.min(day, last));
  };
  let c = candidate(y, m - 1);
  if (toIso(c) < from) c = candidate(y, m);
  return toIso(c);
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

export const MONTH_LABELS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const today = toIso(now);
  if (iso === today) return "Aujourd'hui";
  if (iso === addDays(today, -1)) return "Hier";
  const [y, m, d] = iso.split("-").map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
