# Asistente Consultorio CG — V0.8.0

Versión de preproducción endurecida para el WhatsApp profesional del Dr. Cristopher González.

## Componentes
- OpenAI: interpreta lenguaje natural; no decide tarifas ni reglas de negocio.
- Google Calendar: disponibilidad y citas.
- Meta WhatsApp Cloud API/coexistencia: entrada/salida de mensajes.
- Telegram: alertas privadas cuando se requiere intervención humana.
- Firestore: estado persistente en producción; memoria local durante desarrollo.

## Cambios V0.8
- Redacción de teléfonos y mensajes en logs de producción.
- Errores de producción sin stack trace hacia el cliente.
- Telegram ya no incluye el mensaje original por defecto (`TELEGRAM_INCLUDE_MESSAGE=false`).
- `.dockerignore` y `.gcloudignore` impiden subir `.env`, logs y `node_modules`.
- Documentos `SECURITY.md` y `DATA_POLICY.md`.
- Cierre ordenado ante SIGTERM/SIGINT para Cloud Run.
- Checklist de preproducción actualizado.

## Calendarios
- Doctor: `dr.cristopher.gonzalez@gmail.com` — bloquea disponibilidad personal.
- México Americano: `consultoriomexicoamericano@gmail.com`.
- San Serafín: `consultoriosanserafin@gmail.com`.

Un espacio sólo se ofrece cuando está libre tanto en el calendario personal del doctor como en el calendario del consultorio correspondiente.

## Desarrollo local
```bash
npm install
copy .env.example .env
npm test
npm start
```

El `.env` real no debe compartirse ni incluirse en despliegues.

## Producción
Usar:
```text
NODE_ENV=production
STATE_BACKEND=firestore
TELEGRAM_INCLUDE_MESSAGE=false
```

Leer `SECURITY.md`, `DATA_POLICY.md` y `PREDEPLOY_CHECKLIST.md` antes de conectar pacientes reales.
