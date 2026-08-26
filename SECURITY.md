# Seguridad — V0.8.0

## Secretos
- Nunca incluir `.env`, API keys, tokens o credenciales dentro del ZIP, Git o imágenes de contenedor.
- En Cloud Run usar Secret Manager para OpenAI, Meta/WhatsApp y Telegram.
- Rotar antes de producción cualquier secreto que haya aparecido en capturas durante desarrollo.

## Webhook Meta
- En producción `META_APP_SECRET` es obligatorio.
- Cada POST a `/webhook` valida `X-Hub-Signature-256` contra el cuerpo crudo.
- `META_VERIFY_TOKEN` se usa únicamente para el challenge GET.

## Logs
- V0.8 no registra números de teléfono completos ni texto de pacientes en los logs normales.
- Los teléfonos se representan mediante un identificador hash corto.
- En producción los endpoints de desarrollo responden 404.
- Los errores HTTP de producción no devuelven stack traces.

## Telegram
- Por defecto `TELEGRAM_INCLUDE_MESSAGE=false`.
- La alerta contiene identificación mínima y motivo administrativo; el botón abre WhatsApp.
- No enviar síntomas, diagnósticos, estudios ni conversaciones completas a Telegram.

## Datos persistentes
- Firestore guarda sólo estado administrativo/conversacional necesario para operar.
- `STATE_RETENTION_DAYS` documenta la retención objetivo; la eliminación automática debe configurarse mediante una política TTL/limpieza en Google Cloud antes de producción.
