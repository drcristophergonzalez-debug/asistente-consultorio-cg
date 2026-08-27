export const APPOINTMENT_MINUTES = 45;
export const MIN_ADVANCE_HOURS = 12;

export const CONSULTORIOS = {
  MEXICO_AMERICANO: 'MEXICO_AMERICANO',
  SAN_SERAFIN: 'SAN_SERAFIN'
};

export const PATIENT_CLASS = {
  REGULAR: 'REGULAR',
  FB_FIRST: 'FB_FIRST',
  FB_FOLLOWUP: 'FB_FOLLOWUP',
  REF_FIRST: 'REF_FIRST',
  REF_FOLLOWUP: 'REF_FOLLOWUP'
};

export const BILLING = {
  REGULAR: { code: 'REG8', price: 800 },
  FB_FIRST: { code: 'FB4', price: 400 },
  FB_FOLLOWUP: { code: 'FB6', price: 600 },
  REF_FIRST: { code: 'REF4', price: 400 },
  REF_FOLLOWUP: { code: 'REF6', price: 600 }
};

// 1 = lunes, 3 = miércoles, 5 = viernes, 6 = sábado (Luxon weekday)
export const REGULAR_SLOTS = {
  [CONSULTORIOS.MEXICO_AMERICANO]: {
    1: ['10:00', '10:45', '11:30', '12:15', '19:00', '19:45', '20:30'],
    3: ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '19:00', '19:45', '20:30'],
    5: ['10:00', '10:45', '11:30', '12:15']
  },
  [CONSULTORIOS.SAN_SERAFIN]: {
    6: ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '13:30']
  }
};

export const PROMO_SLOTS = {
  [CONSULTORIOS.MEXICO_AMERICANO]: {
    3: ['09:00', '09:45', '10:30', '11:15', '12:00']
  },
  [CONSULTORIOS.SAN_SERAFIN]: {
    6: ['09:00', '09:45', '10:30', '11:15', '12:00', '12:45', '13:30']
  }
};

export function isPromoClass(patientClass) {
  return [PATIENT_CLASS.FB_FIRST, PATIENT_CLASS.FB_FOLLOWUP, PATIENT_CLASS.REF_FIRST, PATIENT_CLASS.REF_FOLLOWUP].includes(patientClass);
}

export function slotsFor(patientClass, consultorio, weekday) {
  const table = isPromoClass(patientClass) ? PROMO_SLOTS : REGULAR_SLOTS;
  return table[consultorio]?.[weekday] || [];
}
