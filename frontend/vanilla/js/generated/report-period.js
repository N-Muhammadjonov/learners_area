// RIWI Reporter — report windows. Every window is computed in the centre's explicit
// timezone (TIMEZONE) and is half-open: [from, to). Periodic reports cover the last
// COMPLETED period, so a weekly report generated on Wednesday covers the previous
// Monday–Sunday and is reproducible: the same request returns the same window.
import { TIMEZONE } from "./time.js";
export const PERIOD_KINDS = ["on_demand", "weekly", "monthly", "yearly", "custom"];
export const MAX_CUSTOM_DAYS = 366;
export const ON_DEMAND_DAYS = 30;
const DAY_MS = 86_400_000;
function localParts(at) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    }).formatToParts(at);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
    return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}
/** The UTC offset of TIMEZONE at `at`, e.g. "+05:00" (read from the tz database, not hardcoded). */
function offsetAt(at) {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, timeZoneName: "longOffset" })
        .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const match = /GMT([+-]\d{2}:\d{2})?/.exec(name);
    return match?.[1] ?? "+00:00";
}
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
/** Local midnight of a calendar date in TIMEZONE, as a UTC instant. */
export function localMidnight(date) {
    const probe = new Date(`${date}T12:00:00Z`);
    return new Date(`${date}T00:00:00${offsetAt(probe)}`);
}
function addDays(date, days) {
    const t = new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS;
    return new Date(t).toISOString().slice(0, 10);
}
function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const t = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === value;
}
function window(kind, fromDate, lastDate) {
    return {
        kind, timezone: TIMEZONE,
        from: localMidnight(fromDate).toISOString(),
        to: localMidnight(addDays(lastDate, 1)).toISOString(),
        fromDate, toDate: lastDate,
    };
}
export function resolvePeriod(kind, now, custom) {
    const today = localParts(now);
    const todayDate = ymd(today.y, today.m, today.d);
    switch (kind) {
        case "on_demand": {
            // Trailing window ending at the moment of generation.
            const fromDate = addDays(todayDate, -(ON_DEMAND_DAYS - 1));
            return { ok: true, window: { ...window(kind, fromDate, todayDate), to: now.toISOString() } };
        }
        case "weekly": {
            const thisMonday = addDays(todayDate, -today.weekday);
            return { ok: true, window: window(kind, addDays(thisMonday, -7), addDays(thisMonday, -1)) };
        }
        case "monthly": {
            const firstThis = ymd(today.y, today.m, 1);
            const prevY = today.m === 1 ? today.y - 1 : today.y;
            const prevM = today.m === 1 ? 12 : today.m - 1;
            return { ok: true, window: window(kind, ymd(prevY, prevM, 1), addDays(firstThis, -1)) };
        }
        case "yearly":
            return { ok: true, window: window(kind, ymd(today.y - 1, 1, 1), ymd(today.y - 1, 12, 31)) };
        case "custom": {
            const from = custom?.from ?? "";
            const to = custom?.to ?? "";
            if (!isCalendarDate(from) || !isCalendarDate(to))
                return { ok: false, error: "invalid_date" };
            if (from > to)
                return { ok: false, error: "range_reversed" };
            if (to > todayDate)
                return { ok: false, error: "range_in_future" };
            const days = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS) + 1;
            if (days > MAX_CUSTOM_DAYS)
                return { ok: false, error: "range_too_long" };
            return { ok: true, window: window(kind, from, to) };
        }
    }
}
