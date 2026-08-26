# Checklist previo a producción — V0.8.0

## Ya validado localmente
- Motor conversacional y reglas de negocio.
- V0.7 aprobó 32/32 pruebas locales.
- Telegram entrega alertas reales al teléfono.
- HUMAN_MODE silencia al bot y reinicia la pausa con cada respuesta manual simulada.

## Seguridad antes de Cloud Run
1. Rotar tokens/API keys que hayan aparecido en capturas durante desarrollo.
2. No copiar `.env` a la imagen ni al repositorio.
3. Mantener `TELEGRAM_INCLUDE_MESSAGE=false`.
4. Usar Secret Manager para `OPENAI_API_KEY`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` y `TELEGRAM_BOT_TOKEN`.
5. Revisar `npm audit` en el equipo de desarrollo y resolver actualizaciones compatibles sin `--force` a ciegas.
6. Ejecutar `npm test` y exigir `fail 0`.

## Google Cloud
1. Habilitar Cloud Run y Firestore en `asistente-consultorio-cg`.
2. Desplegar con la identidad de servicio del proyecto, sin JSON key descargada.
3. Configurar `NODE_ENV=production` y `STATE_BACKEND=firestore`.
4. Confirmar acceso a los 3 calendarios.
5. Configurar estrategia de retención/TTL para Firestore antes de tráfico real.
6. Crear presupuesto/alertas cuando Billing quede activo.

## Meta / WhatsApp
1. Configurar URL pública `/webhook` y verify token.
2. Configurar `META_APP_SECRET`, token de WhatsApp y `WHATSAPP_PHONE_NUMBER_ID`.
3. Confirmar coexistencia con la app WhatsApp Business del teléfono.
4. Capturar webhook real `smb_message_echoes` y validar la pausa humana.
5. Probar deduplicación con reintento del mismo message ID.

## Agenda / Confirmafy
1. Probar lectura real de disponibilidad cruzada.
2. Crear una cita controlada con `REG8 NOMBRE 10DIGITOS`.
3. Confirmar que Confirmafy procesa el evento y el reagendamiento.
4. Probar FB4, FB6, REG8, NOSHOW y cambio <24 h con números de prueba.

## Go-live
- Empezar con números controlados.
- Revisar logs sin datos clínicos sensibles.
- Mantener opción de apagar automatización rápidamente si aparece un comportamiento inesperado.
