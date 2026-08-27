import OpenAI from 'openai';
import { DateTime } from 'luxon';
import { config } from './config.js';

const client = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null;

const intentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: {
      type: 'string',
      enum: ['GREETING', 'BOOK', 'AVAILABILITY', 'PRICE', 'LOCATION', 'PAYMENT', 'INSURANCE', 'WHAT_TO_BRING', 'SURGERY_PRICE', 'RESCHEDULE', 'CANCEL', 'HUMAN', 'DOCTOR', 'URGENT_APPOINTMENT', 'MEDICAL_EMERGENCY', 'CONDITION', 'OTHER']
    },
    consultorio: { type: ['string', 'null'], enum: ['MEXICO_AMERICANO', 'SAN_SERAFIN', null] },
    requestedDateISO: { type: ['string', 'null'] },
    requestedTimeHHMM: { type: ['string', 'null'] },
    dayPart: { type: ['string', 'null'], enum: ['MORNING', 'AFTERNOON', 'EVENING', null] },
    firstTime: { type: ['boolean', 'null'] },
    sourceClaim: { type: ['string', 'null'], enum: ['FACEBOOK', 'REFERRED_PROMO', 'REGULAR', null] },
    fullName: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
    conditionCategory: { type: ['string', 'null'], enum: ['CLEAR_NEUROSURGERY', 'INITIAL_ASSESSMENT', 'OTHER_SPECIALTY', 'UNKNOWN', null] },
    otherSpecialty: { type: ['string', 'null'] },
    needsHuman: { type: 'boolean' }
  },
  required: ['intent', 'consultorio', 'requestedDateISO', 'requestedTimeHHMM', 'dayPart', 'firstTime', 'sourceClaim', 'fullName', 'reason', 'conditionCategory', 'otherSpecialty', 'needsHuman']
};

function instructionsNow() {
  const now = DateTime.now().setZone(config.timezone);
  return `Eres un clasificador de mensajes para el WhatsApp de un consultorio de Neurocirugía y Cirugía de Columna en México. No respondas al paciente, no diagnostiques y no inventes datos. Sólo devuelve la estructura solicitada.
Fecha/hora local actual: ${now.toISO()} (${config.timezone}).

Reglas críticas:
- Si pide explícitamente una cita urgente, que lo vean hoy, lo antes posible, que le hagan un espacio, "aunque sea entre pacientes" o equivalente: URGENT_APPOINTMENT y needsHuman=true. No importa si aparentemente hay disponibilidad.
- Si describe signos de alarma neurológica claros como pérdida súbita de fuerza, dificultad súbita para hablar, pérdida de conciencia, convulsiones prolongadas/repetidas sin recuperación, cefalea súbita extremadamente intensa o deterioro neurológico rápidamente progresivo: MEDICAL_EMERGENCY y needsHuman=true.
- "México Americano", "Colomos", Guadalajara => MEXICO_AMERICANO. "San Serafín", "La Tijera", "sur" => SAN_SERAFIN.
- Si dice que viene de Facebook/promoción/anuncio, sourceClaim=FACEBOOK. Si dice que otro paciente le compartió promoción, sourceClaim=REFERRED_PROMO.
- No infieras firstTime si no está claro.
- Cualquier mensaje que no corresponda claramente a citas, disponibilidad, precios, ubicaciones, pagos, aseguradoras, qué llevar a consulta, costos quirúrgicos, cambios/cancelaciones, padecimientos atendidos o urgencias debe clasificarse como OTHER y needsHuman=true.
- Si el mensaje es ambiguo o no estás seguro de que el asistente pueda resolverlo dentro de esos flujos, usa OTHER y needsHuman=true.
- Para OTHER_SPECIALTY usa needsHuman=true para que el consultorio pueda revisar personalmente el mensaje.
- Convierte fechas relativas (mañana, este miércoles, próximo sábado) a YYYY-MM-DD usando la fecha local actual. Si no hay fecha concreta, null.
- Convierte horas concretas a HH:mm en formato 24 horas. Si sólo dice mañana/tarde/noche, usa dayPart.
- Para CONDITION: CLEAR_NEUROSURGERY para hernia discal, ciática/radiculopatía, estenosis, mielopatía, espondilolistesis, tumor cerebral/medular/columna, meningioma, hipófisis, hidrocefalia, aneurisma, malformación vascular/Chiari, neuralgia del trigémino, craneosinostosis/TCE neuroquirúrgico. INITIAL_ASSESSMENT para cefalea/migraña, vértigo, tinnitus, dolor neuropático, parestesias, debilidad sin diagnóstico, alteración de marcha, dolor de cuello/espalda sin diagnóstico, neuropatía, convulsiones, hallazgo incidental. OTHER_SPECIALTY para motivos inequívocamente ajenos (rodilla aislada, dermatología, urología, gastrointestinal, cardiología, etc.).`;
}

export async function interpretMessage(text) {
  if (!client) throw new Error('OPENAI_API_KEY no está configurada');
  const response = await client.responses.create({
    model: config.openaiModel,
    instructions: instructionsNow(),
    input: text,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'consultorio_intent',
        strict: true,
        schema: intentSchema
      }
    }
  });
  return JSON.parse(response.output_text);
}
