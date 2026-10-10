import { describe, expect, it } from "vitest";
import { generateSlots, utcToZoned, zonedToUtc, type Interval, type SlotQuery } from "@/booking-engine";

const TZ = "Africa/Cairo";
const THU = "2026-10-08"; // Thursday, summer time (UTC+3)
const NOW = new Date("2026-10-01T00:00:00Z");

function q(over: Partial<SlotQuery>): SlotQuery {
  return {
    timezone: TZ,
    dates: [THU],
    locationId: 1,
    windows: [{ weekday: 4, startMin: 16 * 60, endMin: 18 * 60, locationId: 1 }],
    blocked: [],
    durationMin: 30,
    bufferMin: 0,
    stepMin: 30,
    now: NOW,
    minNoticeMin: 60,
    ...over,
  };
}
const block = (date: string, fromMin: number, toMin: number): Interval => ({
  start: zonedToUtc(date, fromMin, TZ).getTime(),
  end: zonedToUtc(date, toMin, TZ).getTime(),
});
const label = (s: { startMin: number; available: boolean }) => `${Math.floor(s.startMin / 60)}:${String(s.startMin % 60).padStart(2, "0")}${s.available ? "" : "x"}`;

describe("timezone (Cairo)", () => {
  it("converts local wall clock to UTC in summer and winter time", () => {
    expect(zonedToUtc("2026-10-08", 17 * 60, TZ).toISOString()).toBe("2026-10-08T14:00:00.000Z");
    expect(zonedToUtc("2026-11-05", 17 * 60, TZ).toISOString()).toBe("2026-11-05T15:00:00.000Z");
  });
  it("round-trips and reports weekday", () => {
    const z = utcToZoned(new Date("2026-10-08T14:30:00Z"), TZ);
    expect(z).toEqual({ date: "2026-10-08", minutes: 17 * 60 + 30, weekday: 4 });
  });
  it("keeps 17:00 local across the end of summer time (29 → 30 Oct 2026)", () => {
    const windows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 17 * 60, endMin: 17 * 60 + 30, locationId: 1 }));
    const slots = generateSlots(q({ dates: ["2026-10-29", "2026-10-30", "2026-10-31"], windows }));
    expect(slots.map((s) => s.start.toISOString())).toEqual(["2026-10-29T14:00:00.000Z", "2026-10-30T15:00:00.000Z", "2026-10-31T15:00:00.000Z"]);
    expect(slots.every((s) => utcToZoned(s.start, TZ).minutes === 17 * 60)).toBe(true);
  });
});

describe("generateSlots", () => {
  it("slices a working window by the service duration", () => {
    expect(generateSlots(q({})).map(label)).toEqual(["16:00", "16:30", "17:00", "17:30"]);
  });

  it("does not offer a slot that would run past the end of the window", () => {
    expect(generateSlots(q({ durationMin: 45 })).map(label)).toEqual(["16:00", "16:30", "17:00"]);
  });

  it("respects breaks between two windows", () => {
    const windows = [
      { weekday: 4, startMin: 16 * 60, endMin: 17 * 60, locationId: 1 },
      { weekday: 4, startMin: 18 * 60, endMin: 19 * 60, locationId: 1 },
    ];
    expect(generateSlots(q({ windows })).map(label)).toEqual(["16:00", "16:30", "18:00", "18:30"]);
  });

  it("marks slots that overlap an existing booking (incl. its buffer) as taken", () => {
    // existing 60-min implant at 16:00 + 15-min buffer => busy until 17:15
    const slots = generateSlots(q({ blocked: [block(THU, 16 * 60, 17 * 60 + 15)] }));
    expect(slots.map(label)).toEqual(["16:00x", "16:30x", "17:00x", "17:30"]);
  });

  it("applies the new service's own buffer against the following booking", () => {
    // 45-min filling + 15 buffer = 60 min footprint; next booking at 17:00
    const slots = generateSlots(q({ durationMin: 45, bufferMin: 15, blocked: [block(THU, 17 * 60, 17 * 60 + 30)] }));
    expect(slots.map(label)).toEqual(["16:00", "16:30x", "17:00x"]);
  });

  it("handles overlapping services of different lengths", () => {
    // a 60-min booking at 16:30 blocks 16:00 for a 45-min service but not 17:30
    const slots = generateSlots(q({ durationMin: 45, windows: [{ weekday: 4, startMin: 16 * 60, endMin: 19 * 60, locationId: 1 }], blocked: [block(THU, 16 * 60 + 30, 17 * 60 + 30)] }));
    expect(slots.map(label)).toEqual(["16:00x", "16:30x", "17:00x", "17:30", "18:00"]);
  });

  it("omits past slots and slots inside the minimum notice", () => {
    const now = zonedToUtc(THU, 16 * 60 + 10, TZ); // 16:10 local, 60 min notice
    expect(generateSlots(q({ now })).map(label)).toEqual(["17:30"]);
  });

  it("only uses windows at the requested branch (branch switching)", () => {
    const windows = [
      { weekday: 4, startMin: 16 * 60, endMin: 17 * 60, locationId: 1 },
      { weekday: 1, startMin: 17 * 60, endMin: 18 * 60, locationId: 2 },
    ];
    expect(generateSlots(q({ windows, locationId: 2 }))).toEqual([]);
    expect(generateSlots(q({ windows, locationId: 2, dates: ["2026-10-12"] })).map(label)).toEqual(["17:00", "17:30"]);
  });

  it("returns nothing on a day without working hours (Friday)", () => {
    expect(generateSlots(q({ dates: ["2026-10-09"] }))).toEqual([]);
  });
});
