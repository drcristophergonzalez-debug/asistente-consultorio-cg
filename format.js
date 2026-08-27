import { DateTime } from 'luxon';
import { config } from './config.js';
import { CONSULTORIOS } from './rules.js';

export function consultorioName(c) {
  return c === CONSULTORIOS.MEXICO_AMERICANO ? 'Hospital México Americano' : 'Hospital San Serafín';
}

export function formatSlot(slot) {
  const dt = slot.start.setZone(config.timezone).setLocale('es-MX');
  return `${dt.toFormat("cccc d 'de' LLLL, HH:mm")} h — ${consultorioName(slot.consultorio)}`;
}

export function formatSlots(slots, max = 10) {
  if (!slots?.length) return 'Por el momento no encontramos espacios disponibles dentro de ese periodo.';
  const grouped = new Map();
  for (const slot of slots.slice(0, max)) {
    const key = `${slot.consultorio}|${slot.start.toISODate()}`;
    const existing = grouped.get(key) || { consultorio: slot.consultorio, date: slot.start, times: [] };
    existing.times.push(slot.start.toFormat('HH:mm'));
    grouped.set(key, existing);
  }
  return [...grouped.values()].map(g => {
    const date = g.date.setLocale('es-MX').toFormat("cccc d 'de' LLLL");
    return `*${consultorioName(g.consultorio)}*\n${date}: ${g.times.join(', ')} h`;
  }).join('\n\n');
}

export function isoFromDateAndTime(dateISO, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return DateTime.fromISO(dateISO, { zone: config.timezone }).set({ hour, minute, second: 0, millisecond: 0 });
}

export function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  // Meta suele entregar 521XXXXXXXXXX en México. El título de Confirmafy usa 10 dígitos.
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeName(name = '') {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-zÑñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function parseAppointmentSummary(summary = '') {
  const cleaned = String(summary).trim().replace(/\s+/g, ' ');
  const upper = cleaned.toUpperCase();
  const tokens = upper.split(' ');
  const status = tokens[0] === 'NOSHOW' ? 'NOSHOW' : null;
  const codeIndex = status ? 1 : 0;
  const code = tokens[codeIndex] || null;
  const phone = tokens.at(-1)?.replace(/\D/g, '') || '';
  const nameTokens = tokens.slice(codeIndex + 1, -1);
  return {
    status,
    code,
    name: normalizeName(nameTokens.join(' ')),
    phone: normalizePhone(phone)
  };
}
