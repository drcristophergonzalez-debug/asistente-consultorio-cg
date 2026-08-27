import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8080),
  timezone: process.env.TZ || 'America/Mexico_City',
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.6',
  metaVerifyToken: process.env.META_VERIFY_TOKEN || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  whatsappAccessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v25.0',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  humanPauseHours: Number(process.env.HUMAN_PAUSE_HOURS || 2),
  telegramAlertDedupMinutes: Number(process.env.TELEGRAM_ALERT_DEDUP_MINUTES || 30),
  telegramIncludeMessage: String(process.env.TELEGRAM_INCLUDE_MESSAGE || 'false').toLowerCase() === 'true',
  logLevel: process.env.LOG_LEVEL || 'info',
  stateRetentionDays: Number(process.env.STATE_RETENTION_DAYS || 90),
  stateBackend: process.env.STATE_BACKEND || 'memory',
  gcpProjectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '',
  firestoreDatabase: process.env.FIRESTORE_DATABASE || '(default)',
  firestoreCollection: process.env.FIRESTORE_COLLECTION || 'whatsapp_conversations',
  calendars: {
    doctor: process.env.DOCTOR_CALENDAR_ID || 'dr.cristopher.gonzalez@gmail.com',
    mexicoAmericano: process.env.MEXICO_AMERICANO_CALENDAR_ID || 'consultoriomexicoamericano@gmail.com',
    sanSerafin: process.env.SAN_SERAFIN_CALENDAR_ID || 'consultoriosanserafin@gmail.com'
  }
};

export function productionConfigErrors() {
  if (config.nodeEnv !== 'production') return [];
  const required = {
    OPENAI_API_KEY: config.openaiApiKey,
    META_VERIFY_TOKEN: config.metaVerifyToken,
    META_APP_SECRET: config.metaAppSecret,
    WHATSAPP_ACCESS_TOKEN: config.whatsappAccessToken,
    WHATSAPP_PHONE_NUMBER_ID: config.whatsappPhoneNumberId,
    TELEGRAM_BOT_TOKEN: config.telegramBotToken,
    TELEGRAM_CHAT_ID: config.telegramChatId
  };
  const errors = Object.entries(required).filter(([, value]) => !value).map(([key]) => `Falta ${key}`);
  if (config.stateBackend !== 'firestore') errors.push('En producción STATE_BACKEND debe ser firestore');
  return errors;
}
