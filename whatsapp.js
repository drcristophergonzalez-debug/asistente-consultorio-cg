import { config } from './config.js';

export async function sendWhatsAppText(to, body) {
  if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
    console.log('[DEV WhatsApp]', { to, body });
    return { dev: true, body };
  }
  const url = `https://graph.facebook.com/${config.graphApiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body }
    })
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  return res.json();
}
