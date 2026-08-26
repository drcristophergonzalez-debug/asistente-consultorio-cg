# Changelog

## 0.8.1
- Mensajes fuera del flujo habitual se canalizan automáticamente a atención personal.
- Padecimientos claramente ajenos a Neurocirugía/Columna también generan handoff.
- Telegram identifica estas alertas como `OUT_OF_SCOPE`.
- Los mensajes ambiguos pueden escalarse mediante `needsHuman=true`.

## 0.8.0
- Endurecimiento de privacidad y seguridad para preproducción.
- Redacción de identificadores en logs.
- Sin stack traces en respuestas HTTP de producción.
- Telegram minimiza datos y no incluye mensaje original por defecto.
- Exclusión explícita de `.env`, logs y `node_modules` en Cloud/Docker.
- Documentación de seguridad, datos y despliegue.
- Cierre ordenado para Cloud Run.

## 0.7.0
- Persistencia Firestore, deduplicación Meta y consolidación candidata a despliegue.
