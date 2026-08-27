import { BILLING, PATIENT_CLASS } from './rules.js';
import { parseAppointmentSummary } from './format.js';

function billingFromCode(code) {
  const upper = String(code || '').toUpperCase();
  if (upper === 'REG8') return { patientClass: PATIENT_CLASS.REGULAR, ...BILLING.REGULAR, historyType: 'REGULAR' };
  if (upper === 'FB4' || upper === 'FB6') return { patientClass: PATIENT_CLASS.FB_FOLLOWUP, ...BILLING.FB_FOLLOWUP, historyType: 'FACEBOOK' };
  if (upper === 'REF4' || upper === 'REF6') return { patientClass: PATIENT_CLASS.REF_FOLLOWUP, ...BILLING.REF_FOLLOWUP, historyType: 'REFERRED' };
  return null;
}

export function classifyHistory(events = []) {
  const parsed = events.map(e => ({ event: e, parsed: parseAppointmentSummary(e.summary) }));

  // NOSHOW sólo se considera incidencia pendiente si es la cita codificada más
  // reciente. Si existe una cita posterior, asumimos que el caso ya fue
  // resuelto por el doctor/consultorio y no debe bloquear al paciente de por vida.
  const byDateDesc = [...parsed].sort((a, b) => {
    const ad = new Date(a.event?.start?.dateTime || a.event?.start?.date || a.event?.created || 0).getTime();
    const bd = new Date(b.event?.start?.dateTime || b.event?.start?.date || b.event?.created || 0).getTime();
    return bd - ad;
  });
  const latestCoded = byDateDesc.find(x => ['REG8', 'FB4', 'FB6', 'REF4', 'REF6'].includes(x.parsed.code));
  if (latestCoded?.parsed.status === 'NOSHOW') {
    const billing = billingFromCode(latestCoded.parsed.code) || { patientClass: PATIENT_CLASS.REGULAR, ...BILLING.REGULAR, historyType: 'REGULAR' };
    return { ...billing, requiresHuman: true, reason: 'NOSHOW', noShowEvent: latestCoded.event };
  }

  const codes = parsed.map(x => x.parsed.code);

  // El origen promocional es histórico y permanente.
  // Si el paciente alguna vez tuvo FB4/FB6, una cita REG8 intermedia (por elegir
  // un horario regular) no lo convierte en paciente regular para futuras citas.
  // Un paciente que sólo tiene REG8, en cambio, nunca adquiere promoción sólo
  // por volver a entrar desde un anuncio de Facebook.
  if (codes.includes('FB4') || codes.includes('FB6')) return { patientClass: PATIENT_CLASS.FB_FOLLOWUP, ...BILLING.FB_FOLLOWUP, historyType: 'FACEBOOK' };
  if (codes.includes('REF4') || codes.includes('REF6')) return { patientClass: PATIENT_CLASS.REF_FOLLOWUP, ...BILLING.REF_FOLLOWUP, historyType: 'REFERRED' };
  if (codes.includes('REG8')) return { patientClass: PATIENT_CLASS.REGULAR, ...BILLING.REGULAR, historyType: 'REGULAR' };
  return null;
}

export function decidePromoEligibility({ source, history, historyMatchType }) {
  const previous = classifyHistory(history);
  if (previous?.requiresHuman) return previous;

  if (source === 'FACEBOOK') {
    // Teléfono o nombre exacto: el historial manda. Un regular previo no puede volverse promo.
    if (previous && ['PHONE', 'NAME_EXACT'].includes(historyMatchType)) return previous;
    if (historyMatchType === 'NAME_AMBIGUOUS') return { requiresHuman: true, reason: 'AMBIGUOUS_NAME_MATCH' };
    return { patientClass: PATIENT_CLASS.FB_FIRST, ...BILLING.FB_FIRST };
  }

  if (source === 'REFERRED_PROMO') return { requiresHuman: true, reason: 'VERIFY_REFERRED_PROMO' };
  return previous || { patientClass: PATIENT_CLASS.REGULAR, ...BILLING.REGULAR };
}
