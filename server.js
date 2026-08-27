import express from 'express';
import { config, productionConfigErrors } from './config.js';
import { verifyWebhookChallenge, verifyMetaSignature, extractIncomingMessages, extractManualBusinessMessages, detectSource } from './meta.js';
import { interpretMessage } from './ai.js';
import { sendWhatsAppText } from './whatsapp.js';
import { processIntent } from './engine.js';
import { conversationStore } from './store.js';
import { humanAlertReason, sendHumanAlert } from './telegram.js';
import { beginHumanMode, recordHumanReply, shouldBotStaySilent, shouldSendHumanAlert } from './human.js';
import { normalizePhone } from './format.js';
import { safeLogContext, safeErrorBody } from './privacy.js';

const startupErrors = productionConfigErrors();
if (startupErrors.length) {
  throw new Error(`Configuración de producción incompleta: ${startupErrors.join('; ')}`);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); }
}));

app.get('/health', (_req, res) => res.json({
  ok: true,
  service: 'asistente-consultorio-cg',
  version: '0.8.1',
  environment: config.nodeEnv,
  stateBackend: config.stateBackend,
  telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
  humanPauseHours: config.humanPauseHours
}));
app.get('/webhook', verifyWebhookChallenge);

async function persist(phone) {
  try { await conversationStore.flush(phone); }
  catch (err) { console.error('[STATE FLUSH ERROR]', safeLogContext({ phone, error: err })); }
}

app.post('/webhook', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);

  try {
    // 1) Ecos de respuestas manuales desde WhatsApp Business App (coexistencia).
    for (const echo of extractManualBusinessMessages(req.body)) {
      const phone = normalizePhone(echo.to);
      try {
        await conversationStore.hydrate(phone);
        const state = recordHumanReply(phone, echo.text || null);
        await persist(phone);
        console.log('[HUMAN MESSAGE]', safeLogContext({ phone, extra: { pauseUntil: state.humanPauseUntil } }));
      } catch (err) {
        console.error('[HUMAN ECHO ERROR]', safeLogContext({ phone, error: err }));
      }
    }

    // 2) Mensajes entrantes de pacientes.
    for (const message of extractIncomingMessages(req.body)) {
      if (!message.text) continue;
      const phone = normalizePhone(message.from);
      try {
        await conversationStore.hydrate(phone);

        // Meta puede reintentar webhooks. Evitamos respuestas/citas duplicadas.
        if (message.id && conversationStore.wasMessageProcessed(phone, message.id)) {
          console.log('[DUPLICATE MESSAGE]', safeLogContext({ phone, messageId: message.id }));
          continue;
        }

        const suppression = shouldBotStaySilent(phone);
        if (suppression.suppressed) {
          console.log('[BOT SUPPRESSED]', safeLogContext({ phone, extra: { pauseUntil: suppression.pauseUntil || null } }));
          if (message.id) conversationStore.markMessageProcessed(phone, message.id);
          await persist(phone);
          continue;
        }

        const detectedSource = detectSource(message);
        if (message.referral) {
          conversationStore.patch(phone, {
            attribution: {
              source: detectedSource,
              sourceId: message.referral.source_id || null,
              sourceType: message.referral.source_type || null,
              sourceUrl: message.referral.source_url || null,
              headline: message.referral.headline || null
            }
          });
        }

        const intent = await interpretMessage(message.text);
        const result = await processIntent({ phone, text: message.text, intent, detectedSource });
        console.log('[MESSAGE]', safeLogContext({ phone, extra: { detectedSource, intent: intent.intent, handoff: result.handoff, booked: result.booked } }));

        if (result.reply) await sendWhatsAppText(phone, result.reply);

        if (result.handoff) {
          const reason = humanAlertReason({ intent, result, state: conversationStore.get(phone) || {} });
          const nextState = beginHumanMode(phone, reason.code);
          if (shouldSendHumanAlert(phone, reason.code)) {
            try {
              await sendHumanAlert({
                phone,
                patientName: nextState.fullName || message.name || null,
                reason,
                originalMessage: message.text
              });
              conversationStore.markAlertSent(phone, { reasonCode: reason.code });
            } catch (alertErr) {
              console.error('[TELEGRAM ALERT ERROR]', safeLogContext({ phone, error: alertErr }));
            }
          }
        }

        if (message.id) conversationStore.markMessageProcessed(phone, message.id);
        await persist(phone);
      } catch (err) {
        console.error('[WEBHOOK ERROR]', safeLogContext({ phone, error: err }));
        try {
          await conversationStore.hydrate(phone);
          if (!shouldBotStaySilent(phone).suppressed) {
            await sendWhatsAppText(phone, 'Permítame verificar esa información para darle una respuesta correcta.');
          }
          await persist(phone);
        } catch (nested) {
          console.error('[WEBHOOK FALLBACK ERROR]', safeLogContext({ phone, error: nested }));
        }
      }
    }

    // En Cloud Run no procesamos trabajo importante después de responder 200.
    return res.sendStatus(200);
  } catch (err) {
    console.error('[WEBHOOK FATAL]', safeLogContext({ error: err }));
    // Meta reintentará si respondemos 5xx; la deduplicación protege mensajes ya procesados.
    return res.sendStatus(500);
  }
});

// Herramientas de desarrollo local.
app.post('/dev/simulate', async (req, res) => {
  if (config.nodeEnv === 'production') return res.sendStatus(404);
  try {
    const phone = normalizePhone(req.body.phone || '3330000000');
    const text = req.body.text || '';
    await conversationStore.hydrate(phone);

    const suppression = shouldBotStaySilent(phone, { now: req.body.now ? new Date(req.body.now) : new Date() });
    if (suppression.suppressed) {
      return res.json({ phone, text, suppressed: true, reason: suppression.awaitingHumanReply ? 'AWAITING_HUMAN_REPLY' : 'HUMAN_PAUSE_ACTIVE', pauseUntil: suppression.pauseUntil || null, state: conversationStore.get(phone) });
    }

    const detectedSource = req.body.detectedSource || 'REGULAR';
    const intent = req.body.intent || await interpretMessage(text);
    const result = await processIntent({ phone, text, intent, detectedSource });
    let alert = null;
    if (result.handoff) {
      const reason = humanAlertReason({ intent, result, state: conversationStore.get(phone) || {} });
      beginHumanMode(phone, reason.code, { now: req.body.now ? new Date(req.body.now) : new Date() });
      const wouldSend = shouldSendHumanAlert(phone, reason.code, { now: req.body.now ? new Date(req.body.now) : new Date() });
      alert = { reason, wouldSend, sent: false };
      if (wouldSend) {
        const nextState = conversationStore.get(phone) || {};
        const telegramResult = await sendHumanAlert({ phone, patientName: nextState.fullName || req.body.patientName || null, reason, originalMessage: text });
        conversationStore.markAlertSent(phone, { reasonCode: reason.code, now: req.body.now ? new Date(req.body.now) : new Date() });
        alert.sent = true;
        alert.telegramMessageId = telegramResult?.message_id || null;
      }
    }
    await persist(phone);
    res.json({ phone, text, intent, result, alert, state: conversationStore.get(phone) });
  } catch (err) {
    res.status(500).json(safeErrorBody(err));
  }
});

app.post('/dev/human-message', async (req, res) => {
  if (config.nodeEnv === 'production') return res.sendStatus(404);
  const phone = normalizePhone(req.body.phone || '3330000000');
  await conversationStore.hydrate(phone);
  const state = recordHumanReply(phone, req.body.text || null, { now: req.body.now ? new Date(req.body.now) : new Date() });
  await persist(phone);
  res.json({ ok: true, state });
});

app.get('/dev/state/:phone', async (req, res) => {
  if (config.nodeEnv === 'production') return res.sendStatus(404);
  const phone = normalizePhone(req.params.phone);
  await conversationStore.hydrate(phone);
  res.json({ phone, state: conversationStore.get(phone), suppression: shouldBotStaySilent(phone) });
});

app.delete('/dev/state/:phone', async (req, res) => {
  if (config.nodeEnv === 'production') return res.sendStatus(404);
  const phone = normalizePhone(req.params.phone);
  await conversationStore.hydrate(phone);
  conversationStore.clear(phone);
  await persist(phone);
  res.json({ ok: true, phone });
});

app.post('/dev/telegram-test', async (req, res) => {
  if (config.nodeEnv === 'production') return res.sendStatus(404);
  try {
    const result = await sendHumanAlert({ phone: req.body.phone || '5213313668975', patientName: req.body.patientName || 'Paciente de prueba', reason: { code: 'TEST', title: '🧪 PRUEBA DE ALERTA' }, originalMessage: req.body.message || 'Esta es una prueba de notificación del asistente.' });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, ...safeErrorBody(err) });
  }
});

const server = app.listen(config.port, () => console.log(`Asistente Consultorio CG V0.8.1 escuchando en :${config.port}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`[SHUTDOWN] ${signal}`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
