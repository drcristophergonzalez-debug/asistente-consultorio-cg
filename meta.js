import crypto from 'node:crypto';
import { config } from './config.js';

export function verifyWebhookChallenge(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && token === config.metaVerifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
}

export function verifyMetaSignature(req) {
  if (!config.metaAppSecret) return true; // sólo desarrollo; exigir en producción
  const signature = req.get('x-hub-signature-256');
  if (!signature || !req.rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', config.metaAppSecret).update(req.rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function extractIncomingMessages(body) {
  const messages = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const msg of value.messages || []) {
        const contact = (value.contacts || []).find(c => c.wa_id === msg.from) || value.contacts?.[0];
        messages.push({
          id: msg.id,
          from: msg.from,
          name: contact?.profile?.name || null,
          text: msg.text?.body || null,
          referral: msg.referral || null,
          raw: msg
        });
      }
    }
  }
  return messages;
}

/**
 * Parser tolerante para ecos de mensajes enviados manualmente desde la app
 * WhatsApp Business en modo coexistencia. Meta puede encapsular estos eventos
 * en smb_message_echoes de distintas formas; mantenemos la extracción aislada
 * para poder ajustarla fácilmente con el primer webhook real que recibamos.
 */
export function extractManualBusinessMessages(body) {
  const echoes = [];

  const pushEcho = (raw, value = {}) => {
    if (!raw) return;
    const text = raw.text?.body || raw.message?.text?.body || raw.body || null;
    const to = raw.to || raw.recipient_id || raw.recipient || raw.wa_id || raw.message?.to || null;
    const from = raw.from || raw.sender_id || raw.message?.from || value.metadata?.display_phone_number || null;
    if (!to) return;
    echoes.push({
      id: raw.id || raw.message_id || raw.message?.id || null,
      to: String(to),
      from: from ? String(from) : null,
      text,
      timestamp: raw.timestamp || raw.message?.timestamp || null,
      raw
    });
  };

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      for (const echo of value.smb_message_echoes || []) pushEcho(echo, value);
      for (const echo of value.message_echoes || []) pushEcho(echo, value);

      if (change.field === 'smb_message_echoes') {
        if (Array.isArray(value.messages)) for (const echo of value.messages) pushEcho(echo, value);
        if (Array.isArray(value.echoes)) for (const echo of value.echoes) pushEcho(echo, value);
        if (value.message) pushEcho(value.message, value);
      }
    }
  }

  // Deduplicar por id o por combinación básica.
  const seen = new Set();
  return echoes.filter(e => {
    const key = e.id || `${e.to}|${e.timestamp || ''}|${e.text || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function detectSource(message) {
  const referral = message.referral || {};
  const sourceType = String(referral.source_type || '').toLowerCase();
  const sourceUrl = String(referral.source_url || '').toLowerCase();
  const text = String(message.text || '').toLowerCase();
  if (sourceType.includes('ad') || sourceType.includes('post') || sourceUrl.includes('facebook.com') || sourceUrl.includes('fb.me')) return 'FACEBOOK';
  if (text.includes('facebook') || text.includes('promoción') || text.includes('promocion')) return 'FACEBOOK';
  return 'REGULAR';
}
