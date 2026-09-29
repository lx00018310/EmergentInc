import { BusinessPlan } from "./business.js";

/** Skip missed occurrences, including nonexistent DST times. Never catch up in a burst. */
export function nextBusinessOccurrence(schedule: NonNullable<BusinessPlan["schedule"]>, after: number): number {
  if (schedule.kind === "interval") return after + schedule.everyMinutes * 60000;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (at: number) => Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value]));
  const previous = parts(after);
  const previousDate = `${previous.year}-${previous.month}-${previous.day}`;
  const alreadyRanToday = `${previous.hour}:${previous.minute}` >= schedule.time;
  // Bounded minute search handles offset changes without assuming days are always 24 hours.
  for (let at = Math.floor(after / 60000) * 60000 + 60000; at <= after + 3 * 86400000; at += 60000) {
    const p = parts(at);
    if (`${p.hour}:${p.minute}` === schedule.time && (!alreadyRanToday || `${p.year}-${p.month}-${p.day}` !== previousDate)) return at;
  }
  throw new Error("SCHEDULE_TIME_UNAVAILABLE");
}
