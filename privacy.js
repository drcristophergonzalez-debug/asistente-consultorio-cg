import crypto from 'node:crypto';
import { config } from './config.js';

export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `***${digits.slice(-4)}`;
}

export function hashIdentifier(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

export function safeLogContext({ phone, messageId, error, extra = {} } = {}) {
  const out = { ...extra };
  if (phone) out.patientRef = hashIdentifier(phone);
  if (messageId) out.messageId = String(messageId).slice(0, 80);
  if (error) out.error = String(error.message || error).slice(0, 300);
  return out;
}

export function safeErrorBody(err) {
  if (config.nodeEnv === 'production') return { error: 'internal_error' };
  return { error: err?.message || String(err), stack: err?.stack || null };
}
