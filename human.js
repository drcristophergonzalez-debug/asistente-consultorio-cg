import { config } from './config.js';
import { conversationStore } from './store.js';

const ALERT_PRIORITY = {
  HUMAN_REQUIRED: 10,
  OUT_OF_SCOPE: 40,
  PROMO_REVIEW: 20,
  PROMO_VALIDATION: 20,
  NOSHOW: 30,
  RESCHEDULE_REVIEW: 30,
  CANCEL_REVIEW: 30,
  HUMAN_REQUEST: 40,
  DOCTOR_REQUEST: 50,
  URGENT_APPOINTMENT: 80,
  MEDICAL_EMERGENCY: 100
};

export function beginHumanMode(phone, reasonCode, { now = new Date() } = {}) {
  return conversationStore.startHumanHandoff(phone, { reasonCode, now });
}

export function recordHumanReply(phone, text, { now = new Date() } = {}) {
  return conversationStore.recordManualHumanMessage(phone, {
    text,
    now,
    pauseHours: config.humanPauseHours
  });
}

export function shouldBotStaySilent(phone, { now = new Date() } = {}) {
  return conversationStore.botSuppressionStatus(phone, { now });
}

/**
 * Evita una cascada de notificaciones de Telegram mientras el paciente sigue
 * escribiendo durante el mismo episodio de handoff. Permite escalar si aparece
 * un motivo más crítico (p. ej. de HUMAN_REQUEST a MEDICAL_EMERGENCY).
 */
export function shouldSendHumanAlert(phone, reasonCode, { now = new Date() } = {}) {
  const state = conversationStore.get(phone);
  if (!state?.lastAlertAt) return true;

  const prevRank = ALERT_PRIORITY[state.lastAlertReasonCode] || 0;
  const nextRank = ALERT_PRIORITY[reasonCode] || 0;
  if (nextRank > prevRank) return true;

  const last = new Date(state.lastAlertAt);
  const date = now instanceof Date ? now : new Date(now);
  const elapsedMinutes = (date.getTime() - last.getTime()) / 60000;
  return elapsedMinutes >= config.telegramAlertDedupMinutes;
}
