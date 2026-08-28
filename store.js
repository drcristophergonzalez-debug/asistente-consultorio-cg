import { config } from './config.js';

/**
 * Estado conversacional con caché local y persistencia opcional en Firestore.
 *
 * - En desarrollo: STATE_BACKEND=memory (predeterminado).
 * - En Cloud Run/producción: STATE_BACKEND=firestore.
 *
 * La interfaz de mutación se mantiene síncrona después de hydrate() para no
 * complicar el motor conversacional. Cada petición debe llamar hydrate(phone)
 * antes de leer el estado y flush(phone) antes de finalizar.
 */
class ConversationStore {
  constructor() {
    this.conversations = new Map();
    this.hydrated = new Set();
    this.dirty = new Set();
    this.deleted = new Set();
    this.firestore = null;
    this.collection = null;
  }

  nowIso(now = new Date()) {
    return (now instanceof Date ? now : new Date(now)).toISOString();
  }

  async init() {
    if (config.stateBackend !== 'firestore' || this.firestore) return;

    const { Firestore } = await import('@google-cloud/firestore');

    this.firestore = new Firestore({
      projectId: config.gcpProjectId || undefined,
      databaseId: config.firestoreDatabase || '(default)'
    });

    this.collection = this.firestore.collection(
      config.firestoreCollection
    );
  }

  async hydrate(phone) {
    /*
     * En Firestore SIEMPRE volvemos a leer el estado persistido.
     *
     * Esto evita que una instancia de Cloud Run conserve en memoria un estado
     * antiguo (por ejemplo humanMode=true) después de que Firestore haya sido
     * actualizado.
     *
     * En memoria seguimos utilizando el caché local.
     */
    if (config.stateBackend !== 'firestore') {
      if (this.hydrated.has(phone)) {
        return this.get(phone);
      }

      this.hydrated.add(phone);
      return this.get(phone);
    }

    await this.init();

    const snap = await this.collection.doc(phone).get();

    if (snap.exists) {
      this.conversations.set(phone, snap.data());
    } else {
      this.conversations.delete(phone);
    }

    this.hydrated.add(phone);

    return this.get(phone);
  }

  get(phone) {
    return this.conversations.get(phone) || null;
  }

  set(phone, value, { now } = {}) {
    const next = {
      ...value,
      phone,
      updatedAt: this.nowIso(now)
    };

    this.conversations.set(phone, next);
    this.dirty.add(phone);
    this.deleted.delete(phone);

    return next;
  }

  patch(phone, partial, { now } = {}) {
    return this.set(
      phone,
      {
        ...(this.get(phone) || {}),
        ...partial
      },
      { now }
    );
  }

  clear(phone) {
    this.conversations.delete(phone);
    this.dirty.delete(phone);
    this.deleted.add(phone);
    this.hydrated.add(phone);
  }

  clearAll() {
    this.conversations.clear();
    this.hydrated.clear();
    this.dirty.clear();
    this.deleted.clear();
  }

  async flush(phone) {
    if (config.stateBackend !== 'firestore') return;

    await this.init();

    if (this.deleted.has(phone)) {
      await this.collection.doc(phone).delete().catch(() => {});
      this.deleted.delete(phone);
      return;
    }

    if (!this.dirty.has(phone)) return;

    const value = this.get(phone);

    if (value) {
      await this.collection.doc(phone).set(value, {
        merge: false
      });
    }

    this.dirty.delete(phone);
  }

  startHumanHandoff(
    phone,
    {
      reasonCode = 'HUMAN_REQUIRED',
      now = new Date()
    } = {}
  ) {
    const iso = this.nowIso(now);

    return this.patch(
      phone,
      {
        humanMode: true,
        requiresHuman: true,
        humanModeReason: reasonCode,
        humanSince: this.get(phone)?.humanSince || iso,
        lastHumanMessageAt: null,
        humanPauseUntil: null,
        handoffResolvedAt: null
      },
      { now }
    );
  }

  recordManualHumanMessage(
    phone,
    {
      text = null,
      now = new Date(),
      pauseHours = 2
    } = {}
  ) {
    const date = now instanceof Date ? now : new Date(now);

    const pauseUntil = new Date(
      date.getTime() + pauseHours * 60 * 60 * 1000
    );

    return this.patch(
      phone,
      {
        humanMode: true,
        requiresHuman: false,
        lastHumanMessageAt: date.toISOString(),
        humanPauseUntil: pauseUntil.toISOString(),
        lastManualMessagePreview: text
          ? String(text).slice(0, 280)
          : null,
        handoffResolvedAt: date.toISOString()
      },
      { now: date }
    );
  }

  botSuppressionStatus(
    phone,
    {
      now = new Date()
    } = {}
  ) {
    const state = this.get(phone);

    if (!state?.humanMode) {
      return {
        suppressed: false,
        state
      };
    }

    const date = now instanceof Date
      ? now
      : new Date(now);

    if (!state.humanPauseUntil) {
      return {
        suppressed: true,
        awaitingHumanReply: true,
        state
      };
    }

    const until = new Date(state.humanPauseUntil);

    if (
      Number.isNaN(until.getTime()) ||
      date < until
    ) {
      return {
        suppressed: true,
        awaitingHumanReply: false,
        pauseUntil: state.humanPauseUntil,
        state
      };
    }

    const next = this.patch(
      phone,
      {
        humanMode: false,
        requiresHuman: false,
        humanModeReason: null,
        humanPauseUntil: null,
        humanSince: null,
        lastAlertReasonCode: null,
        lastAlertAt: null
      },
      { now: date }
    );

    return {
      suppressed: false,
      reactivated: true,
      state: next
    };
  }

  markAlertSent(
    phone,
    {
      reasonCode,
      now = new Date()
    } = {}
  ) {
    return this.patch(
      phone,
      {
        lastAlertReasonCode:
          reasonCode || 'HUMAN_REQUIRED',
        lastAlertAt: this.nowIso(now)
      },
      { now }
    );
  }

  markDepositRequired(
    phone,
    {
      reason,
      amount,
      tariffCode = null,
      now = new Date()
    } = {}
  ) {
    return this.patch(
      phone,
      {
        depositRequired: true,
        depositReason: reason || 'ADMINISTRATIVE',
        depositAmount: Number(amount || 0),
        depositTariffCode: tariffCode,
        depositSince: this.nowIso(now)
      },
      { now }
    );
  }

  clearDepositRequirement(
    phone,
    {
      now = new Date()
    } = {}
  ) {
    return this.patch(
      phone,
      {
        depositRequired: false,
        depositReason: null,
        depositAmount: null,
        depositTariffCode: null,
        depositSince: null
      },
      { now }
    );
  }

  wasMessageProcessed(
    phone,
    messageId
  ) {
    if (!messageId) {
      return false;
    }

    return (
      this.get(phone)?.processedMessageIds || []
    ).includes(messageId);
  }

  markMessageProcessed(
    phone,
    messageId,
    {
      now = new Date(),
      keep = 30
    } = {}
  ) {
    if (!messageId) {
      return this.get(phone);
    }

    const ids = [
      ...(this.get(phone)?.processedMessageIds || []),
      messageId
    ];

    return this.patch(
      phone,
      {
        processedMessageIds: [
          ...new Set(ids)
        ].slice(-keep)
      },
      { now }
    );
  }
}

export const conversationStore =
  new ConversationStore();
