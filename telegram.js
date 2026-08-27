import { config } from './config.js';
import { normalizePhone } from './format.js';

function enabled() {
  return Boolean(config.telegramBotToken && config.telegramChatId);
}

function whatsappUrl(phone) {
  const digits = normalizePhone(phone).replace(/\D/g, '');
  return `https://wa.me/${digits}`;
}

export function humanAlertReason({ intent, result, state }) {
  if (result?.emergency) return { code: 'MEDICAL_EMERGENCY', title: '🚨 POSIBLE URGENCIA MÉDICA' };
  if (result?.urgent) return { code: 'URGENT_APPOINTMENT', title: '🔴 CITA URGENTE' };
  if (intent?.intent === 'DOCTOR') return { code: 'DOCTOR_REQUEST', title: '🔴 SOLICITA AL DOCTOR' };
  if (intent?.intent === 'HUMAN') return { code: 'HUMAN_REQUEST', title: '🟠 SOLICITA ATENCIÓN PERSONAL' };
  if (result?.outOfScope || intent?.intent === 'OTHER' || intent?.conditionCategory === 'OTHER_SPECIALTY') return { code: 'OUT_OF_SCOPE', title: '🟠 MENSAJE FUERA DEL FLUJO HABITUAL' };
  if (intent?.intent === 'RESCHEDULE') return { code: 'RESCHEDULE_REVIEW', title: '🟡 REAGENDAMIENTO REQUIERE REVISIÓN' };
  if (intent?.intent === 'CANCEL') return { code: 'CANCEL_REVIEW', title: '🟡 CANCELACIÓN REQUIERE REVISIÓN' };
  if (state?.referrerName || state?.source === 'REFERRED_PROMO') return { code: 'PROMO_VALIDATION', title: '🟠 VALIDAR PROMOCIÓN REFERIDA' };
  if (/inasistencia|NOSHOW/i.test(result?.reply || '')) return { code: 'NOSHOW', title: '🟡 PACIENTE CON NOSHOW' };
  if (/promoci[oó]n|registro previo/i.test(result?.reply || '')) return { code: 'PROMO_REVIEW', title: '🟠 VALIDAR PROMOCIÓN' };
  return { code: 'HUMAN_REQUIRED', title: '🟠 WHATSAPP REQUIERE ATENCIÓN' };
}

export async function sendHumanAlert({ phone, patientName, reason, originalMessage }) {
  if (!enabled()) {
    console.warn('[TELEGRAM] No configurado; alerta omitida', { phone, reason: reason?.code });
    return { skipped: true };
  }

  const safeName = patientName || 'Paciente sin nombre confirmado';
  const text = [
    reason?.title || '🟠 WHATSAPP REQUIERE ATENCIÓN',
    '',
    `Paciente: ${safeName}`,
    `Teléfono: ${normalizePhone(phone)}`,
    `Motivo: ${reason?.code || 'HUMAN_REQUIRED'}`,
    config.telegramIncludeMessage && originalMessage ? `Mensaje: ${String(originalMessage).slice(0, 280)}` : null,
    '',
    'El asistente quedó marcado para atención humana.'
  ].filter(Boolean).join('\n');

  const payload = {
    chat_id: config.telegramChatId,
    text,
    disable_notification: false,
    protect_content: true,
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [[
        { text: 'Abrir WhatsApp', url: whatsappUrl(phone) }
      ]]
    }
  };

  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram sendMessage falló (${res.status}): ${body.description || 'sin detalle'}`);
  }
  return body.result;
}
