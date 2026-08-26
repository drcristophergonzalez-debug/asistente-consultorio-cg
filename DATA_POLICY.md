# Política técnica de datos — preproducción

## Google Calendar
Fuente de verdad para disponibilidad y citas. Los títulos usan el formato administrativo acordado (`REG8`, `FB4`, `FB6`, etc.). Evitar texto clínico extenso en descripción.

## Firestore
Puede almacenar: teléfono normalizado, nombre cuando sea necesario, origen administrativo, estado de promoción, estado de handoff, anticipos pendientes, IDs de mensajes procesados y atribución de campaña.

No debe almacenar por defecto: imágenes, estudios médicos, diagnósticos extensos, transcripciones completas de WhatsApp ni documentos clínicos.

Retención objetivo inicial: 90 días para estado conversacional no necesario. El historial administrativo duradero debe mantenerse únicamente cuando sea necesario para reglas como promoción, NOSHOW o anticipo. Antes de producción debe definirse la estrategia TTL/archivo para no borrar esos indicadores por accidente.

## Telegram
Canal de aviso, no expediente. Por defecto no incluye el texto original del paciente.

## OpenAI
Se solicita `store:false` en Responses API. El modelo se utiliza para clasificación/estructuración del mensaje; las tarifas, horarios y reglas críticas se ejecutan en código.
