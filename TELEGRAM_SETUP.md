# Configuración de Telegram — alertas humanas

La V0.5 usa Telegram únicamente para avisar al Dr. González cuando una conversación de WhatsApp necesita intervención humana.

## Variables privadas

- `TELEGRAM_BOT_TOKEN`: token entregado por BotFather.
- `TELEGRAM_CHAT_ID`: ID del chat privado del doctor con el bot.

Nunca guardar estos valores en Git ni compartirlos en capturas.

## Comportamiento

Cuando el motor devuelve `handoff: true`, el servidor:

1. marca la conversación como `requiresHuman=true`;
2. envía una alerta por Telegram;
3. incluye nombre si ya se conoce, teléfono y categoría administrativa;
4. incluye un botón **Abrir WhatsApp** con `https://wa.me/<telefono>`;
5. usa `protect_content=true` para reducir el riesgo de reenvío/guardado de la alerta.

Telegram no se usa para almacenar expediente clínico. Las alertas deben contener sólo la información mínima necesaria para localizar el chat.

## Categorías previstas

- 🚨 Posible urgencia médica.
- 🔴 Cita urgente.
- 🔴 Solicita al doctor.
- 🟠 Solicita atención personal.
- 🟠 Validar promoción referida.
- 🟡 Reagendamiento/cancelación que requiere revisión.
- 🟡 NOSHOW.

## Prueba local

Con las dos variables configuradas y el servidor ejecutándose:

```bash
curl -X POST http://localhost:8080/dev/telegram-test \
  -H 'content-type: application/json' \
  -d '{"phone":"5213313668975","patientName":"Paciente de prueba"}'
```

El endpoint de prueba queda deshabilitado cuando `NODE_ENV=production`.
