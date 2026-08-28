import { google } from 'googleapis';
import { DateTime } from 'luxon';
import { config } from './config.js';
import { CONSULTORIOS } from './rules.js';
import { candidateSlots, overlaps } from './schedule.js';
import { normalizeName, normalizePhone, parseAppointmentSummary } from './format.js';

const auth = new google.auth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/calendar'] });
const calendar = google.calendar({ version: 'v3', auth });

export function calendarIdForConsultorio(consultorio) {
  if (consultorio === CONSULTORIOS.MEXICO_AMERICANO) return config.calendars.mexicoAmericano;
  if (consultorio === CONSULTORIOS.SAN_SERAFIN) return config.calendars.sanSerafin;
  throw new Error(`Consultorio desconocido: ${consultorio}`);
}

export async function busyWindows({ consultorio, timeMin, timeMax }) {
  const consultorioCalendar = calendarIdForConsultorio(consultorio);
  const ids = [config.calendars.doctor, consultorioCalendar];
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toUTC().toISO(),
      timeMax: timeMax.toUTC().toISO(),
      timeZone: config.timezone,
      items: ids.map(id => ({ id }))
    }
  });

  const all = [];
  for (const id of ids) {
    const block = res.data.calendars?.[id];
    if (block?.errors?.length) throw new Error(`No se pudo consultar libre/ocupado de ${id}: ${JSON.stringify(block.errors)}`);
    for (const item of block?.busy || []) {
      all.push({
        start: DateTime.fromISO(item.start, { setZone: true }).setZone(config.timezone),
        end: DateTime.fromISO(item.end, { setZone: true }).setZone(config.timezone)
      });
    }
  }
  return all;
}

export function filterAvailableCandidates(candidates, busy = [], limit = 12) {
  return candidates.filter(slot => !busy.some(b => overlaps(slot.start, slot.end, b.start, b.end))).slice(0, limit);
}

export async function availableSlots({ patientClass, consultorio, from, days = 14, limit = 12 }) {
  const candidates = candidateSlots({ patientClass, consultorio, from, days });
  if (!candidates.length) return [];
  const busy = await busyWindows({ consultorio, timeMin: candidates[0].start.startOf('day'), timeMax: candidates.at(-1).end.endOf('day') });
  return filterAvailableCandidates(candidates, busy, limit);
}

export async function availableSlotsBothConsultorios({ patientClass, from, days = 14, limit = 12 }) {
  const [ma, ss] = await Promise.all([
    availableSlots({ patientClass, consultorio: CONSULTORIOS.MEXICO_AMERICANO, from, days, limit }),
    availableSlots({ patientClass, consultorio: CONSULTORIOS.SAN_SERAFIN, from, days, limit })
  ]);
  return [...ma, ...ss].sort((a, b) => a.start.toMillis() - b.start.toMillis()).slice(0, limit);
}

export async function isSlotAvailable({ consultorio, start, end }) {
  const s = DateTime.fromISO(start, { zone: config.timezone });
  const e = DateTime.fromISO(end, { zone: config.timezone });
  const busy = await busyWindows({ consultorio, timeMin: s, timeMax: e });
  return !busy.some(b => overlaps(s, e, b.start, b.end));
}

function eventDescription({ type, origin, price, consultorio, reason, phone, extra = [] }) {
  return [
    `Tipo: ${type || 'No especificado'}`,
    `Origen: ${origin || 'No especificado'}`,
    `Tarifa: $${price} MXN`,
    `Consultorio: ${consultorio === CONSULTORIOS.MEXICO_AMERICANO ? 'Hospital México Americano' : 'Hospital San Serafín'}`,
    `Motivo: ${reason || 'No especificado'}`,
    `Teléfono: ${phone}`,
    'Agendado por WhatsApp',
    ...extra
  ].join('\n');
}

export async function createAppointment({ consultorio, code, fullName, phone, start, end, type, origin, price, reason }) {
  const targetCalendar = calendarIdForConsultorio(consultorio);
  const normalizedPhone = normalizePhone(phone);
  const summary = `${code} ${normalizeName(fullName)} ${normalizedPhone}`.replace(/\s+/g, ' ').trim();

  const startData = {
    dateTime: DateTime.fromISO(start, { zone: config.timezone }).toISO(),
    timeZone: config.timezone
  };

  const endData = {
    dateTime: DateTime.fromISO(end, { zone: config.timezone }).toISO(),
    timeZone: config.timezone
  };

  const requestBody = {
    summary,
    description: eventDescription({
      type,
      origin,
      price,
      consultorio,
      reason,
      phone: normalizedPhone
    }),
    start: startData,
    end: endData
  };

  const res = await calendar.events.insert({
    calendarId: targetCalendar,
    requestBody
  });

  let doctorEvent = null;

  if (consultorio === CONSULTORIOS.MEXICO_AMERICANO) {
    const doctorRes = await calendar.events.insert({
      calendarId: config.calendars.doctor,
      requestBody: {
        ...requestBody,
        description: `${requestBody.description}\nCopia para Confirmafy`
      }
    });

    doctorEvent = doctorRes.data;
  }

  return {
    ...res.data,
    doctorEventId: doctorEvent?.id || null
  };
}

export async function readAppointment({ consultorio, eventId }) {
  const res = await calendar.events.get({ calendarId: calendarIdForConsultorio(consultorio), eventId });
  return res.data;
}

export async function moveAppointment({ fromConsultorio, toConsultorio, eventId, newStart, newEnd }) {
  const sourceId = calendarIdForConsultorio(fromConsultorio);
  const targetId = calendarIdForConsultorio(toConsultorio);
  const original = await calendar.events.get({ calendarId: sourceId, eventId });
  const start = { dateTime: DateTime.fromISO(newStart, { zone: config.timezone }).toISO(), timeZone: config.timezone };
  const end = { dateTime: DateTime.fromISO(newEnd, { zone: config.timezone }).toISO(), timeZone: config.timezone };

  if (sourceId === targetId) {
    const res = await calendar.events.patch({ calendarId: sourceId, eventId, requestBody: { start, end } });
    return res.data;
  }

  const src = original.data;
  const inserted = await calendar.events.insert({
    calendarId: targetId,
    requestBody: {
      summary: src.summary,
      description: `${src.description || ''}\nReagendada desde: ${fromConsultorio}`.trim(),
      start,
      end
    }
  });
  await calendar.events.delete({ calendarId: sourceId, eventId });
  return inserted.data;
}

export async function cancelAppointment({ consultorio, eventId }) {
  await calendar.events.delete({ calendarId: calendarIdForConsultorio(consultorio), eventId });
}

async function searchCalendar(calendarId, query, timeMin, timeMax) {
  const res = await calendar.events.list({
    calendarId,
    q: query,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250
  });
  return (res.data.items || []).map(e => ({ ...e, _calendarId: calendarId }));
}

function dedupe(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${e._calendarId || ''}|${e.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findPatientHistory({ phone, fullName, yearsBack = 5 }) {
  const now = DateTime.now().setZone(config.timezone);
  const timeMin = now.minus({ years: yearsBack }).startOf('day').toUTC().toISO();
  const timeMax = now.plus({ years: 1 }).endOf('day').toUTC().toISO();
  const ids = [config.calendars.mexicoAmericano, config.calendars.sanSerafin];
  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone) {
    const results = [];
    for (const id of ids) results.push(...await searchCalendar(id, normalizedPhone, timeMin, timeMax));
    const exact = dedupe(results).filter(e => parseAppointmentSummary(e.summary).phone === normalizedPhone);
    if (exact.length) return { matchType: 'PHONE', events: exact };
  }

  if (fullName) {
    const normalized = normalizeName(fullName);
    const results = [];
    for (const id of ids) results.push(...await searchCalendar(id, fullName, timeMin, timeMax));
    const exact = dedupe(results).filter(e => parseAppointmentSummary(e.summary).name === normalized);
    if (exact.length) return { matchType: exact.length ? 'NAME_EXACT' : 'NONE', events: exact };
    if (results.length) return { matchType: 'NAME_AMBIGUOUS', events: dedupe(results) };
  }

  return { matchType: 'NONE', events: [] };
}

export async function findUpcomingAppointments({ phone, fullName, daysAhead = 365 }) {
  const now = DateTime.now().setZone(config.timezone);
  const timeMin = now.minus({ minutes: 1 }).toUTC().toISO();
  const timeMax = now.plus({ days: daysAhead }).toUTC().toISO();
  const ids = [
    [CONSULTORIOS.MEXICO_AMERICANO, config.calendars.mexicoAmericano],
    [CONSULTORIOS.SAN_SERAFIN, config.calendars.sanSerafin]
  ];
  const query = normalizePhone(phone) || fullName;
  if (!query) return [];
  const out = [];
  for (const [consultorio, id] of ids) {
    for (const e of await searchCalendar(id, query, timeMin, timeMax)) {
      const parsed = parseAppointmentSummary(e.summary);
      if (normalizePhone(phone) && parsed.phone !== normalizePhone(phone)) continue;
      out.push({ ...e, consultorio });
    }
  }
  return out.sort((a, b) => DateTime.fromISO(a.start?.dateTime || a.start?.date).toMillis() - DateTime.fromISO(b.start?.dateTime || b.start?.date).toMillis());
}
