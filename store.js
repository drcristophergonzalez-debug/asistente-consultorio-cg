import { DateTime } from 'luxon';
import { config } from './config.js';
import { FAQ } from './faq.js';
import { BILLING, CONSULTORIOS, PATIENT_CLASS, APPOINTMENT_MINUTES, slotsFor } from './rules.js';
import { conversationStore } from './store.js';
import { decidePromoEligibility, classifyHistory } from './eligibility.js';
import { availableSlots, availableSlotsBothConsultorios, createAppointment, findPatientHistory, findUpcomingAppointments, isSlotAvailable, moveAppointment, cancelAppointment } from './calendar.js';
import { consultorioName, formatSlot, formatSlots, normalizePhone } from './format.js';

function sourceFor({ detectedSource, intent, state }) {
  if (state?.source === 'FACEBOOK' || detectedSource === 'FACEBOOK' || intent.sourceClaim === 'FACEBOOK') return 'FACEBOOK';
  if (state?.source === 'REFERRED_PROMO') return 'REFERRED_PROMO';
  if (intent.sourceClaim === 'REFERRED_PROMO') return 'REFERRED_PROMO';
  return 'REGULAR';
}

function billingForClass(patientClass) {
  if (patientClass === PATIENT_CLASS.FB_FIRST) return BILLING.FB_FIRST;
  if (patientClass === PATIENT_CLASS.FB_FOLLOWUP) return BILLING.FB_FOLLOWUP;
  if (patientClass === PATIENT_CLASS.REF_FIRST) return BILLING.REF_FIRST;
  if (patientClass === PATIENT_CLASS.REF_FOLLOWUP) return BILLING.REF_FOLLOWUP;
  return BILLING.REGULAR;
}

async function ensurePatientClassification({ phone, state, intent, detectedSource }) {
  const source = sourceFor({ detectedSource, intent, state });
  const fullName = intent.fullName || state.fullName || null;

  if (source === 'FACEBOOK') {
    const byPhone = await findPatientHistory({ phone });
    if (byPhone.events.length) {
      const decision = decidePromoEligibility({ source, history: byPhone.events, historyMatchType: byPhone.matchType });
      const patch = { source, fullName, historyMatchType: byPhone.matchType, patientClass: decision.patientClass, code: decision.code, price: decision.price };
      conversationStore.patch(phone, patch);
      return { source, history: byPhone, decision, state: { ...state, ...patch } };
    }

    if (!fullName) {
      const decision = { requiresName: true, reason: 'PROMO_NAME_CHECK' };
      const patch = { source, fullName: null, historyMatchType: 'NONE' };
      conversationStore.patch(phone, patch);
      return { source, history: byPhone, decision, state: { ...state, ...patch } };
    }

    const byName = await findPatientHistory({ fullName });
    const decision = decidePromoEligibility({ source, history: byName.events, historyMatchType: byName.matchType });
    const patch = { source, fullName, historyMatchType: byName.matchType, patientClass: decision.patientClass, code: decision.code, price: decision.price };
    conversationStore.patch(phone, patch);
    return { source, history: byName, decision, state: { ...state, ...patch } };
  }

  const history = await findPatientHistory({ phone, fullName });
  const decision = decidePromoEligibility({ source, history: history.events, historyMatchType: history.matchType });
  const patch = { source, fullName, historyMatchType: history.matchType, patientClass: decision.patientClass, code: decision.code, price: decision.price };
  conversationStore.patch(phone, patch);
  return { source, history, decision, state: { ...state, ...patch } };
}

function appointmentType(history) {
  return history?.events?.length ? 'Subsecuente' : 'Primera consulta';
}

function isAllowedExactSlot(patientClass, consultorio, dt) {
  return slotsFor(patientClass, consultorio, dt.weekday).includes(dt.toFormat('HH:mm'));
}

function filterByIntent(slots, intent) {
  return slots.filter(slot => {
    if (intent.requestedDateISO && slot.start.toISODate() !== intent.requestedDateISO) return false;
    if (intent.requestedTimeHHMM && slot.start.toFormat('HH:mm') !== intent.requestedTimeHHMM) return false;
    if (intent.dayPart === 'MORNING' && slot.start.hour >= 13) return false;
    if (intent.dayPart === 'AFTERNOON' && (slot.start.hour < 13 || slot.start.hour >= 19)) return false;
    if (intent.dayPart === 'EVENING' && slot.start.hour < 19) return false;
    return true;
  });
}

async function offerAvailability({ phone, state, intent, classification }) {
  if (classification.decision.requiresName) {
    conversationStore.patch(phone, {
      next: 'WAITING_PROMO_NAME',
      resumeIntent: intent,
      resumeSource: classification.source
    });

    return {
      reply: FAQ.askName,
      next: 'WAITING_PROMO_NAME'
    };
  }

  if (classification.decision.requiresHuman) {
    if (classification.decision.reason === 'NOSHOW') {
      const prev = classifyHistory(classification.history.events);
      const billing = billingForClass(prev?.patientClass || PATIENT_CLASS.REGULAR);

      return {
        reply: `Con gusto podemos ayudarle a programar una nueva cita. Debido a que tenemos registrada una inasistencia en su cita anterior, para realizar una nueva reservación se requiere un anticipo del 50% del costo de la consulta (*$${billing.price / 2}*). Este anticipo se abona al total al acudir a su cita y, en caso de no presentarse, no es reembolsable. Permítame canalizar su mensaje para ayudarle con el proceso.`,
        handoff: true
      };
    }

    if (classification.decision.reason === 'VERIFY_REFERRED_PROMO') {
      return {
        reply: FAQ.referredPromo,
        handoff: false,
        next: 'WAITING_REFERRER'
      };
    }

    return {
      reply: FAQ.verifyPromo,
      handoff: true
    };
  }

  const patientClass = classification.decision.patientClass;
  const from = intent.requestedDateISO || DateTime.now().setZone(config.timezone).toISODate();
  const days = intent.requestedDateISO ? 1 : 14;

  let slots;

  if (intent.consultorio) {
    slots = await availableSlots({
      patientClass,
      consultorio: intent.consultorio,
      from,
      days,
      limit: 20
    });
  } else {
    slots = await availableSlotsBothConsultorios({
      patientClass,
      from,
      days,
      limit: 20
    });
  }

  slots = filterByIntent(slots, intent);

  if (!slots.length) {
    return {
      reply: FAQ.noAvailability
    };
  }

  conversationStore.patch(phone, {
    offeredSlots: slots.map(s => ({
      consultorio: s.consultorio,
      start: s.start.toISO(),
      end: s.end.toISO()
    })),
    patientClass,
    code: classification.decision.code,
    price: classification.decision.price
  });

  const priorRegularPromoNotice =
    classification.source === 'FACEBOOK' &&
    classification.decision.patientClass === PATIENT_CLASS.REGULAR &&
    classification.history.events.length
      ? `${FAQ.previousRegularNoPromo}\n\n`
      : '';

  return {
    reply: `${priorRegularPromoNotice}${formatSlots(slots)}\n\n¿Cuál de estos horarios le funciona mejor?`
  };
}

function selectedSlotFromState(state, intent) {
  const offered = state.offeredSlots || [];

  const candidates = offered.filter(s => {
    const dt = DateTime.fromISO(s.start, {
      zone: config.timezone
    });

    if (intent.consultorio && s.consultorio !== intent.consultorio) return false;
    if (intent.requestedDateISO && dt.toISODate() !== intent.requestedDateISO) return false;
    if (intent.requestedTimeHHMM && dt.toFormat('HH:mm') !== intent.requestedTimeHHMM) return false;

    return true;
  });

  return candidates.length === 1 ? candidates[0] : null;
}

async function bookSelected({ phone, state, intent, detectedSource }) {
  const classification = await ensurePatientClassification({
    phone,
    state,
    intent,
    detectedSource
  });

  if (classification.decision.requiresName || classification.decision.requiresHuman) {
    return offerAvailability({
      phone,
      state,
      intent,
      classification
    });
  }

  let slot = state.pendingSlot || selectedSlotFromState(
    { ...state, ...classification.state },
    intent
  );

  if (!slot && intent.consultorio && intent.requestedDateISO && intent.requestedTimeHHMM) {
    const start = DateTime.fromISO(
      `${intent.requestedDateISO}T${intent.requestedTimeHHMM}`,
      { zone: config.timezone }
    );

    const minStart = DateTime.now()
      .setZone(config.timezone)
      .plus({ hours: 12 });

    if (
      start >= minStart &&
      isAllowedExactSlot(
        classification.decision.patientClass,
        intent.consultorio,
        start
      )
    ) {
      slot = {
        consultorio: intent.consultorio,
        start: start.toISO(),
        end: start.plus({ minutes: APPOINTMENT_MINUTES }).toISO()
      };
    }
  }

  if (!slot) {
    return offerAvailability({
      phone,
      state: classification.state,
      intent,
      classification
    });
  }

  const fullName = intent.fullName || classification.state.fullName;

  if (!fullName) {
    conversationStore.patch(phone, {
      pendingSlot: slot,
      patientClass: classification.decision.patientClass,
      code: classification.decision.code,
      price: classification.decision.price,
      next: 'WAITING_NAME'
    });

    return {
      reply: FAQ.askName,
      next: 'WAITING_NAME'
    };
  }

  const reason = intent.reason || classification.state.reason;

  if (!reason) {
    conversationStore.patch(phone, {
      fullName,
      pendingSlot: slot,
      next: 'WAITING_REASON'
    });

    return {
      reply: FAQ.askReason,
      next: 'WAITING_REASON'
    };
  }

  const free = await isSlotAvailable({
    consultorio: slot.consultorio,
    start: slot.start,
    end: slot.end
  });

  if (!free) {
    conversationStore.patch(phone, {
      offeredSlots: [],
      pendingSlot: null
    });

    const alternatives = await availableSlots({
      patientClass: classification.decision.patientClass,
      consultorio: slot.consultorio,
      from: DateTime.fromISO(slot.start).toISODate(),
      days: 7,
      limit: 8
    });

    return {
      reply: `Ese horario acaba de dejar de estar disponible. Estos son otros horarios que podemos ofrecerle:\n\n${formatSlots(alternatives)}`
    };
  }

  const event = await createAppointment({
    consultorio: slot.consultorio,
    start: slot.start,
    end: slot.end,
    fullName,
    phone,
    reason,
    appointmentType: appointmentType(classification.history)
  });

  conversationStore.patch(phone, {
    fullName,
    reason,
    pendingSlot: null,
    offeredSlots: [],
    next: null,
    lastBookedEventId: event.id
  });

  return {
    reply: `Listo. Su cita quedó agendada en *${consultorioName(slot.consultorio)}* el *${formatSlot({
      start: DateTime.fromISO(slot.start),
      end: DateTime.fromISO(slot.end)
    })}*.\n\nSi posteriormente necesita realizar algún cambio, puede escribirnos por este mismo medio.`,
    booked: true,
    event
  };
}

async function continuePending({ phone, state, intent, text, detectedSource }) {
  if (state.next === 'WAITING_PROMO_NAME') {
    const fullName = intent.fullName || text.trim();

    const resumeIntent = {
      ...(state.resumeIntent || {}),
      fullName
    };

    conversationStore.patch(phone, {
      fullName,
      next: null,
      resumeIntent: null
    });

    return processIntent({
      phone,
      text,
      intent: resumeIntent,
      detectedSource: state.resumeSource || detectedSource
    });
  }

  if (state.next === 'WAITING_REFERRER') {
    conversationStore.patch(phone, {
      referrerName: text,
      next: null,
      requiresHuman: true
    });

    return {
      reply: FAQ.verifyPromo,
      handoff: true
    };
  }

  if (state.next === 'WAITING_NAME') {
    const fullName = intent.fullName || text.trim();

    conversationStore.patch(phone, {
      fullName,
      next: state.reason ? null : 'WAITING_REASON'
    });

    if (!state.reason) {
      return {
        reply: FAQ.askReason,
        next: 'WAITING_REASON'
      };
    }

    return bookSelected({
      phone,
      state: { ...state, fullName },
      intent: { ...intent, fullName, reason: state.reason },
      detectedSource
    });
  }

  if (state.next === 'WAITING_REASON') {
    const reason = intent.reason || text.trim();

    conversationStore.patch(phone, {
      reason,
      next: null
    });

    return bookSelected({
      phone,
      state: { ...state, reason },
      intent: {
        ...intent,
        fullName: state.fullName,
        reason
      },
      detectedSource
    });
  }

  return null;
}

async function handleReschedule({ phone, state, intent, detectedSource }) {
  const upcoming = await findUpcomingAppointments({
    phone,
    fullName: state.fullName
  });

  if (!upcoming.length) {
    return {
      reply: 'No encontramos una cita futura asociada a este número. Permítame canalizar su mensaje para revisarlo.',
      handoff: true
    };
  }

  if (upcoming.length > 1) {
    return {
      reply: 'Encontramos más de una cita futura asociada a este número. Permítame canalizar su mensaje para confirmar cuál desea cambiar.',
      handoff: true
    };
  }

  const current = upcoming[0];

  if (!intent.requestedDateISO || !intent.requestedTimeHHMM) {
    conversationStore.patch(phone, {
      rescheduleEventId: current.id,
      rescheduleFromConsultorio: current.consultorio,
      next: 'RESCHEDULE_SLOT'
    });

    const slots = await availableSlots({
      patientClass: PATIENT_CLASS.REGULAR,
      consultorio: current.consultorio,
      from: DateTime.now().setZone(config.timezone).toISODate(),
      days: 14,
      limit: 20
    });

    return {
      reply: `Claro. Su cita actual es el *${formatSlot({
        start: DateTime.fromISO(current.start.dateTime),
        end: DateTime.fromISO(current.end.dateTime)
      })}*.\n\nEstos son los próximos horarios disponibles:\n\n${formatSlots(slots)}\n\n¿Cuál le funciona mejor?`
    };
  }

  const targetStart = DateTime.fromISO(
    `${intent.requestedDateISO}T${intent.requestedTimeHHMM}`,
    { zone: config.timezone }
  );

  const target = {
    consultorio: intent.consultorio || current.consultorio,
    start: targetStart,
    end: targetStart.plus({ minutes: APPOINTMENT_MINUTES })
  };

  const free = await isSlotAvailable({
    consultorio: target.consultorio,
    start: target.start.toISO(),
    end: target.end.toISO()
  });

  if (!free) {
    return {
      reply: 'Ese horario acaba de dejar de estar disponible. Permítame revisar otras opciones.'
    };
  }

  const moved = await moveAppointment({
    fromConsultorio: current.consultorio,
    toConsultorio: target.consultorio,
    eventId: current.id,
    newStart: target.start.toISO(),
    newEnd: target.end.toISO()
  });

  conversationStore.patch(phone, {
    rescheduleEventId: null,
    rescheduleFromConsultorio: null,
    offeredSlots: [],
    next: null
  });

  return {
    reply: `Listo. Su cita quedó reagendada para el *${formatSlot(target)}*.`,
    moved
  };
}

async function handleCancel({ phone, state }) {
  const upcoming = await findUpcomingAppointments({
    phone,
    fullName: state.fullName
  });

  if (!upcoming.length) {
    return {
      reply: 'No encontramos una cita futura asociada a este número. Permítame canalizar su mensaje para revisarlo.',
      handoff: true
    };
  }

  if (upcoming.length > 1) {
    return {
      reply: 'Encontramos más de una cita futura asociada a este número. Permítame canalizar su mensaje para confirmar cuál desea cancelar.',
      handoff: true
    };
  }

  const current = upcoming[0];

  const currentStart = DateTime.fromISO(
    current.start.dateTime,
    { zone: config.timezone }
  );

  const hours = currentStart.diff(
    DateTime.now().setZone(config.timezone),
    'hours'
  ).hours;

  if (hours < 24) {
    const parsed = classifyHistory([current]);
    const billing = billingForClass(parsed?.patientClass);

    await cancelAppointment({
      consultorio: current.consultorio,
      eventId: current.id
    });

    conversationStore.markDepositRequired(phone, {
      reason: 'LATE_CANCEL',
      amount: billing.price / 2,
      tariffCode: billing.code
    });

    return {
      reply: `Hemos cancelado su cita y el horario ha quedado liberado. Debido a que la cancelación se realiza con menos de 24 horas de anticipación, para una nueva reservación se solicitará un anticipo del 50% del costo de la consulta (*$${billing.price / 2}*), mismo que se abona al total cuando acuda. Permítame canalizar su mensaje para ayudarle con el proceso.`,
      handoff: true,
      cancelled: true,
      lateCancellation: true
    };
  }

  await cancelAppointment({
    consultorio: current.consultorio,
    eventId: current.id
  });

  return {
    reply: 'Claro. Hemos cancelado su cita y el horario ha quedado liberado. Cuando guste podemos ayudarle a programar una nueva fecha.',
    cancelled: true
  };
}

export async function processIntent({
  phone,
  text,
  intent,
  detectedSource = 'REGULAR'
}) {
  phone = normalizePhone(phone);

  let state = conversationStore.get(phone) || { phone };

  if (intent.fullName) {
    state = conversationStore.patch(phone, {
      fullName: intent.fullName
    });
  }

  if (intent.reason) {
    state = conversationStore.patch(phone, {
      reason: intent.reason
    });
  }

  const pending = await continuePending({
    phone,
    state,
    intent,
    text,
    detectedSource
  });

  if (pending) {
    if (pending.next) {
      conversationStore.patch(phone, {
        next: pending.next
      });
    }

    return pending;
  }

  if (
    state.rescheduleEventId &&
    ['BOOK', 'AVAILABILITY', 'RESCHEDULE'].includes(intent.intent)
  ) {
    return handleReschedule({
      phone,
      state,
      intent,
      detectedSource
    });
  }

  if (
    state.depositRequired &&
    ['BOOK', 'AVAILABILITY', 'PRICE'].includes(intent.intent)
  ) {
    const upcomingAfterManualReview =
      await findUpcomingAppointments({
        phone,
        fullName: state.fullName
      });

    if (upcomingAfterManualReview.length) {
      state = conversationStore.clearDepositRequirement(phone);
    } else {
      const amount = Number(state.depositAmount || 0);
      const amountText =
        amount > 0 ? ` (*$${amount}*)` : '';

      return {
        reply: `Con gusto podemos ayudarle. Debido a un antecedente administrativo en una cita previa, para realizar una nueva reservación se requiere un anticipo del 50% del costo de la consulta${amountText}. Este anticipo se abona al total al acudir a su cita. Permítame canalizar su mensaje para ayudarle con el proceso.`,
        handoff: true,
        depositRequired: true
      };
    }
  }

  if (intent.intent === 'MEDICAL_EMERGENCY') {
    return {
      reply: FAQ.emergency,
      handoff: true,
      emergency: true
    };
  }

  if (intent.intent === 'URGENT_APPOINTMENT') {
    return {
      reply: FAQ.urgentAppointment,
      handoff: true,
      urgent: true
    };
  }

  if (intent.intent === 'HUMAN') {
    return {
      reply: FAQ.human,
      handoff: true
    };
  }

  if (intent.intent === 'DOCTOR') {
    return {
      reply: FAQ.doctor,
      handoff: true
    };
  }

  if (intent.intent === 'GREETING') {
    return {
      reply: FAQ.greeting
    };
  }

  if (intent.intent === 'INSURANCE') {
    return {
      reply: FAQ.insurance
    };
  }

  if (intent.intent === 'WHAT_TO_BRING') {
    return {
      reply: FAQ.whatToBring
    };
  }

  if (intent.intent === 'SURGERY_PRICE') {
    return {
      reply: FAQ.surgeryPrice
    };
  }

  if (intent.intent === 'PAYMENT') {
    return {
      reply: 'El pago de la consulta puede realizarse en *efectivo, transferencia, tarjeta de débito o tarjeta de crédito*.'
    };
  }

  if (intent.intent === 'LOCATION') {
    if (intent.consultorio === CONSULTORIOS.SAN_SERAFIN) {
      return {
        reply: FAQ.sanSerafinLocation
      };
    }

    if (intent.consultorio === CONSULTORIOS.MEXICO_AMERICANO) {
      return {
        reply: FAQ.mexicoLocation
      };
    }

    return {
      reply: `${FAQ.mexicoLocation}\n\n${FAQ.sanSerafinLocation}`
    };
  }

  if (intent.intent === 'CONDITION') {
    if (intent.conditionCategory === 'CLEAR_NEUROSURGERY') {
      return {
        reply: FAQ.conditionClear
      };
    }

    if (intent.conditionCategory === 'INITIAL_ASSESSMENT') {
      return {
        reply: FAQ.conditionInitial
      };
    }

    if (intent.conditionCategory === 'OTHER_SPECIALTY') {
      return {
        reply: 'Gracias por escribirnos. Permítame canalizar su mensaje para revisarlo personalmente y orientarle de la forma adecuada.',
        handoff: true,
        outOfScope: true
      };
    }

    return {
      reply: 'Los síntomas que describe pueden tener diferentes causas y es necesario realizar una valoración para determinar su origen. Si gusta, podemos revisar los próximos horarios disponibles.'
    };
  }

  if (intent.intent === 'OTHER') {
    return {
      reply: 'Gracias por escribirnos. Permítame canalizar su mensaje para atenderlo personalmente.',
      handoff: true,
      outOfScope: true
    };
  }

  if (intent.needsHuman) {
    return {
      reply: 'Gracias por escribirnos. Permítame canalizar su mensaje para atenderlo personalmente.',
      handoff: true,
      outOfScope: true
    };
  }

  if (intent.intent === 'RESCHEDULE') {
    return handleReschedule({
      phone,
      state,
      intent,
      detectedSource
    });
  }

  if (intent.intent === 'CANCEL') {
    return handleCancel({
      phone,
      state
    });
  }

  if (intent.intent === 'PRICE') {
    const classification = await ensurePatientClassification({
      phone,
      state,
      intent,
      detectedSource
    });

    if (classification.decision.requiresName) {
      conversationStore.patch(phone, {
        next: 'WAITING_PROMO_NAME',
        resumeIntent: intent,
        resumeSource: classification.source
      });

      return {
        reply: FAQ.askName
      };
    }

    if (classification.decision.requiresHuman) {
      if (classification.decision.reason === 'VERIFY_REFERRED_PROMO') {
        conversationStore.patch(phone, {
          next: 'WAITING_REFERRER'
        });

        return {
          reply: FAQ.referredPromo
        };
      }

      if (classification.decision.reason === 'NOSHOW') {
        return {
          reply: 'Para poder confirmar la tarifa y una nueva reservación, permítame canalizar su mensaje debido al antecedente registrado.',
          handoff: true
        };
      }

      return {
        reply: FAQ.verifyPromo,
        handoff: true
      };
    }

    if (classification.decision.patientClass === PATIENT_CLASS.FB_FIRST) {
      return {
        reply: FAQ.fbFirstPrice
      };
    }

    if (classification.decision.patientClass === PATIENT_CLASS.FB_FOLLOWUP) {
      return {
        reply: FAQ.fbFollowupPrice
      };
    }

    if (
      classification.decision.patientClass === PATIENT_CLASS.REGULAR &&
      classification.source === 'FACEBOOK' &&
      classification.history.events.length
    ) {
      return {
        reply: FAQ.previousRegularNoPromo
      };
    }

    return {
      reply: FAQ.regularPrice
    };
  }

  if (
    intent.intent === 'BOOK' ||
    intent.intent === 'AVAILABILITY'
  ) {
    const classification = await ensurePatientClassification({
      phone,
      state,
      intent,
      detectedSource
    });

    if (
      classification.source === 'REFERRED_PROMO' &&
      classification.decision.requiresHuman
    ) {
      conversationStore.patch(phone, {
        next: 'WAITING_REFERRER'
      });

      return {
        reply: FAQ.referredPromo
      };
    }

    if (
      intent.requestedDateISO &&
      intent.requestedTimeHHMM
    ) {
      return bookSelected({
        phone,
        state: classification.state,
        intent,
        detectedSource
      });
    }

    return offerAvailability({
      phone,
      state: classification.state,
      intent,
      classification
    });
  }

  return {
    reply: FAQ.unknown,
    handoff: true
  };
}
