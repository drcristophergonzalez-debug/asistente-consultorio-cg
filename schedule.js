import { DateTime } from 'luxon';
import { APPOINTMENT_MINUTES, MIN_ADVANCE_HOURS, slotsFor } from './rules.js';
import { config } from './config.js';

export function candidateSlots({ from, days = 14, patientClass, consultorio, now = DateTime.now().setZone(config.timezone) }) {
  const start = (from ? DateTime.fromISO(from, { zone: config.timezone }) : now).startOf('day');
  const minStart = now.plus({ hours: MIN_ADVANCE_HOURS });
  const out = [];

  for (let i = 0; i < days; i += 1) {
    const day = start.plus({ days: i });
    for (const hhmm of slotsFor(patientClass, consultorio, day.weekday)) {
      const [hour, minute] = hhmm.split(':').map(Number);
      const slotStart = day.set({ hour, minute, second: 0, millisecond: 0 });
      if (slotStart < minStart) continue;
      out.push({
        consultorio,
        start: slotStart,
        end: slotStart.plus({ minutes: APPOINTMENT_MINUTES })
      });
    }
  }
  return out;
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
