const { Groq } = require('groq-sdk');
const { getGroqApiKey } = require('./config');

/**
 * Returns formatted current date and time string in Colombia timezone (UTC-5).
 */
function getCurrentColombiaDateTime() {
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const isoColombia = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-05:00`;

  return {
    now,
    readable: formatter.format(now),
    iso: isoColombia,
    dateOnly: `${parts.year}-${parts.month}-${parts.day}`,
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

/**
 * Heuristic parser: extracts reminders even if Groq is down or offline.
 */
function parseHeuristicReminder(text) {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase().trim();

  // 1. Check if text has a Scribd document link to download as PDF
  const scribdUrlMatch = text.match(/https?:\/\/(?:[a-zA-Z0-9_-]+\.)?scribd\.com\/(?:document|doc|embeds|presentation|d)\/[^\s]+/i);
  if (scribdUrlMatch && !lower.includes('guarda')) {
    const url = scribdUrlMatch[0];
    return {
      intent: 'scribd_download',
      linkUrl: url,
      responseMessage: '📄 Procesando y descargando el documento PDF de Scribd, dame unos segundos...',
    };
  }

  // 2. Check if text has a social media video/photo/story link to download
  const socialUrlMatch = text.match(/https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com|instagram\.com|facebook\.com|fb\.watch|fb\.com|youtube\.com\/shorts|x\.com|twitter\.com)\/[^\s]+/i);
  if (socialUrlMatch && !lower.includes('guarda')) {
    const url = socialUrlMatch[0];
    return {
      intent: 'social_media_download',
      linkUrl: url,
      responseMessage: '📥 Descargando el contenido de la red social, dame unos segundos...',
    };
  }

  // 3. Check if text is asking for music (e.g. "enviame X de Y", "pon X", "ponme X", "descarga la cancion X")
  const musicMatch = lower.match(/^(?:enviame|mandame|pon|descarga|ponme|quiero escuchar)\s+(?:la\s+cancion\s+|el\s+tema\s+|la\s+musica\s+|cancion\s+)?(.+)/i);
  if (musicMatch) {
    const candidate = musicMatch[1].trim();
    const isOther = lower.includes('imagen') || lower.includes('foto') || lower.includes('enlace') || lower.includes('link') || lower.includes('recordatorio') || lower.includes('recuerda') || lower.includes('video') || lower.includes('tiktok') || lower.includes('reel') || lower.includes('historia');
    if (!isOther && candidate.length > 2) {
      return {
        intent: 'music',
        query: candidate,
        responseMessage: `🎵 Buscando tu canción "${candidate}", dame unos momentos mientras preparo el audio...`,
      };
    }
  }

  // 3b. Check for Reminder Types Info
  if (
    lower.includes('tipos de recordatorio') ||
    lower.includes('tipo de recordatorio') ||
    lower.includes('tipos de alarma') ||
    lower.includes('tipo de alarma') ||
    lower.includes('como funcionan los recordatorio') ||
    lower.includes('cómo funcionan los recordatorio')
  ) {
    return {
      intent: 'reminder_types',
      responseMessage: 'Aquí tienes los tipos de recordatorios disponibles.',
    };
  }

  // 3c. Check for Delete Reminder
  const deleteRemMatch = lower.match(/^(?:borra|elimina|anula|cancela|quitar?)\s+(?:el\s+|los\s+|mi\s+|mis\s+|todos\s+los\s+|todos\s+mis\s+|todos\s+)?(?:[uú]ltimo\s+|[uú]ltima\s+)?(?:recordatorios?|alarmas?)\s*(.*)/i);
  if (deleteRemMatch) {
    let rawTarget = deleteRemMatch[1].trim();
    let target = rawTarget || 'last';
    if (lower.includes('todos')) target = 'all';
    else if (lower.includes('ultimo') || lower.includes('último') || !rawTarget) target = 'last';

    return {
      intent: 'delete_reminder',
      reminderTarget: target,
      responseMessage: `Eliminando recordatorio ${target}...`,
    };
  }

  // 3d. Check for List Reminders
  if (
    lower.includes('mis recordatorio') ||
    lower.includes('ver recordatorio') ||
    lower.includes('ver mis recordatorio') ||
    lower.includes('que recordatorio') ||
    lower.includes('qué recordatorio') ||
    lower.includes('lista de recordatorio') ||
    lower.includes('listar recordatorio') ||
    lower.includes('cuales son mis recordatorio') ||
    lower.includes('cuáles son mis recordatorio') ||
    lower.includes('recordatorios activos') ||
    lower.includes('recordatorios pendientes')
  ) {
    return {
      intent: 'list_reminders',
      responseMessage: 'Consultando tus recordatorios activos...',
    };
  }

  // Check if text is asking for a reminder
  const hasReminderIntent =
    lower.includes('recuerda') ||
    lower.includes('recordar') ||
    lower.includes('recuérdame') ||
    lower.includes('avisa') ||
    lower.includes('alarma') ||
    lower.startsWith('en ') ||
    lower.includes(' a las ');

  // 4. Check for Finance Reports
  const reportMatch = lower.match(/(?:dame|ver|mostrar|sacar|pasame|generar)?\s*(?:el\s+)?(?:reporte|balance|resumen|gastos?)\s*(?:de\s+(?:la\s+|el\s+|este\s+|esta\s+)?|del\s+|en\s+)?(ayer|d[ií]a\s+anterior|dia\s+anterior|hoy|d[ií]a|dia|semana|mes)/i);
  const spentQueryMatch = lower.match(/(?:cu[aá]nto\s+(?:he\s+gastado|me\s+he\s+gastado|gast[eé]))\s*(?:el\s+|en\s+|de\s+(?:la\s+|el\s+|este\s+|esta\s+)?)?(ayer|d[ií]a\s+anterior|dia\s+anterior|hoy|semana|mes)?/i);
  if (reportMatch || spentQueryMatch) {
    const rawPeriod = (reportMatch ? reportMatch[1] : (spentQueryMatch[1] || 'hoy')).toLowerCase();
    let period = 'today';
    if (rawPeriod.includes('ayer') || rawPeriod.includes('anterior')) period = 'yesterday';
    else if (rawPeriod.includes('semana')) period = 'week';
    else if (rawPeriod.includes('mes')) period = 'month';

    return {
      intent: 'finance_report',
      period,
      responseMessage: `Generando tu reporte de ${period === 'today' ? 'hoy' : (period === 'yesterday' ? 'ayer' : (period === 'week' ? 'esta semana' : 'este mes'))}...`,
    };
  }

  // 5. Check for Finance Delete Last Transaction
  if (
    lower.includes('borra el ultimo') ||
    lower.includes('borra el último') ||
    lower.includes('elimina el ultimo') ||
    lower.includes('elimina el último') ||
    lower.includes('borra la ultima') ||
    lower.includes('borra la última') ||
    lower.includes('elimina la ultima') ||
    lower.includes('elimina la última') ||
    lower.includes('borra la transaccion') ||
    lower.includes('borra el gasto') ||
    lower.includes('borra lo ultimo') ||
    lower.includes('borra lo último')
  ) {
    return {
      intent: 'finance_delete_last',
      responseMessage: 'Eliminando tu última transacción...',
    };
  }

  // Helper to parse numbers like 100.000, 10,000, 10k, 10 mil
  function extractAmount(str) {
    if (!str) return null;
    const kMatch = str.match(/(\d+(?:[.,]\d+)?)\s*(k|mil|millon|millones)/i);
    if (kMatch) {
      let val = parseFloat(kMatch[1].replace(',', '.'));
      const unit = kMatch[2].toLowerCase();
      if (unit === 'k' || unit === 'mil') val *= 1000;
      else if (unit.startsWith('millon')) val *= 1000000;
      return val;
    }
    const numMatch = str.match(/\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)/);
    if (numMatch) {
      const clean = numMatch[1].replace(/\./g, '').replace(/,/g, '');
      const val = parseFloat(clean);
      return isNaN(val) ? null : val;
    }
    return null;
  }

  // 6. Check for Finance Income (Ingreso)
  const incomeRegex = /(?:me\s+dieron|me\s+tra(?:n|ns)f[ií]rieron|me\s+tra(?:n|ns)ferieron|me\s+pagaron|me\s+consignaron|recib[ií]|ingres[eé]|me\s+lleg[oó]|me\s+entr[oó])\s+(\$?\s*\d[\d.,]*\s*(?:k|mil|millon|millones)?)/i;
  const incomeMatch = text.match(incomeRegex);
  if (incomeMatch) {
    const amount = extractAmount(incomeMatch[1]);
    if (amount && amount > 0) {
      const isCash = lower.includes('efectivo');
      const isTransfer = lower.includes('transfer') || lower.includes('cuenta') || lower.includes('nequi') || lower.includes('daviplata');
      const method = isCash ? 'efectivo' : (isTransfer ? 'transferencia' : null);

      // Extract description after amount or method
      let description = text.substring(incomeMatch.index + incomeMatch[0].length).trim();
      description = description.replace(/^(en\s+efectivo|a\s+la\s+cuenta|por\s+transferencia|en\s+cuenta)\s*/i, '').trim();
      if (!description) {
        description = isCash ? 'en efectivo' : (isTransfer ? 'transferencia a la cuenta' : 'Ingreso');
      }

      return {
        intent: 'finance_income',
        amount,
        description,
        paymentMethod: method,
        needsDescription: false,
        responseMessage: `💰 Ingreso anotado de $${amount.toLocaleString('es-CO')}: ${description}`,
      };
    }
  }

  // 7. Check for Finance Expense (Egreso)
  // E.g.: "le di $20.000 a Carlos"
  const giveMoneyMatch = text.match(/le\s+di\s+(\$?\s*\d[\d.,]*\s*(?:k|mil|millon|millones)?)\s+a\s+([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+)/i);
  if (giveMoneyMatch) {
    const amount = extractAmount(giveMoneyMatch[1]);
    const person = giveMoneyMatch[2].trim();
    if (amount && amount > 0) {
      return {
        intent: 'finance_expense',
        amount,
        description: `le di a ${person}`,
        person,
        category: 'prestamo/persona',
        needsDescription: false,
        responseMessage: `💸 Gasto anotado de $${amount.toLocaleString('es-CO')}: le di a ${person}`,
      };
    }
  }

  // E.g.: "me gasté $100.000" or "acabé de gastar $10.000 en un pollo" or "pagué 20.000 en comida"
  const expenseRegex = /(?:hoy\s+)?(?:me\s+gast[eé]|acab[eé]\s+de\s+gastar|gast[eé]|pagu[eé]|compr[eé])\s+(\$?\s*\d[\d.,]*\s*(?:k|mil|millon|millones)?)/i;
  const expenseMatch = text.match(expenseRegex);
  if (expenseMatch) {
    const amount = extractAmount(expenseMatch[1]);
    if (amount && amount > 0) {
      let remainder = text.substring(expenseMatch.index + expenseMatch[0].length).trim();
      const inMatch = remainder.match(/^(?:en|de|por)\s+(.+)/i);
      let description = inMatch ? inMatch[1].trim() : remainder;

      const needsDescription = !description || description.length < 2;
      return {
        intent: 'finance_expense',
        amount,
        description: needsDescription ? null : description,
        needsDescription,
        responseMessage: needsDescription
          ? `¿En qué te gastaste esos $${amount.toLocaleString('es-CO')}? Cuéntame para anotarlo bien. 📝`
          : `💸 Gasto anotado de $${amount.toLocaleString('es-CO')}: ${description}`,
      };
    }
  }

  if (!hasReminderIntent) return null;

  const current = getCurrentColombiaDateTime();
  const now = current.now;

  const wordToNum = {
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15,
    veinte: 20, media: 30, treinta: 30, cuarenta: 40, cincuenta: 50
  };

  // Pattern 1: "en X minutos" / "en X mins"
  const minMatch = lower.match(/en\s+(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|media|treinta|cuarenta|cincuenta)\s*(?:de\s+)?(minutos?|mins?)/);
  if (minMatch) {
    const raw = minMatch[1];
    const mins = isNaN(raw) ? (wordToNum[raw] || 5) : parseInt(raw, 10);
    const target = new Date(now.getTime() + mins * 60 * 1000);
    return {
      intent: 'reminder',
      extractedDate: target.toISOString(),
      recurringDays: null,
      reminders: [{
        text,
        extractedDate: target.toISOString(),
        recurringDays: null,
        isRecurring: false
      }],
      responseMessage: `¡Listo! Te recordaré esto en ${mins} minuto${mins > 1 ? 's' : ''}.`
    };
  }

  // Pattern 2: "en X horas"
  const hrMatch = lower.match(/en\s+(\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|media)\s*(?:de\s+)?(horas?|hrs?)/);
  if (hrMatch) {
    const raw = hrMatch[1];
    const hrs = isNaN(raw) ? (wordToNum[raw] || 1) : parseInt(raw, 10);
    const target = new Date(now.getTime() + hrs * 60 * 60 * 1000);
    return {
      intent: 'reminder',
      extractedDate: target.toISOString(),
      recurringDays: null,
      reminders: [{
        text,
        extractedDate: target.toISOString(),
        recurringDays: null,
        isRecurring: false
      }],
      responseMessage: `¡Listo! Te recordaré esto en ${hrs} hora${hrs > 1 ? 's' : ''}.`
    };
  }

  // Pattern 3: "a las H(:M)? (am/pm)?"
  const timeMatch = lower.match(/a\s+las\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3] ? timeMatch[3].replace(/\./g, '') : null;

    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;

    const isTomorrow = lower.includes('mañana') || (hour < current.hour || (hour === current.hour && minute <= current.minute));
    
    const targetDateObj = new Date(now);
    if (isTomorrow) {
      targetDateObj.setDate(targetDateObj.getDate() + 1);
    }
    targetDateObj.setHours(hour, minute, 0, 0);

    const isDaily = lower.includes('todos los d') || lower.includes('diario') || lower.includes('cada d');
    const isWeekly = lower.includes('cada semana') || lower.includes('semanal');
    const recurringDays = isWeekly ? 7 : (isDaily ? 1 : null);

    const formattedTime12 = `${hour % 12 || 12}:${minute.toString().padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;

    return {
      intent: 'reminder',
      extractedDate: targetDateObj.toISOString(),
      recurringDays,
      reminders: [{
        text,
        extractedDate: targetDateObj.toISOString(),
        recurringDays,
        isRecurring: !!recurringDays
      }],
      responseMessage: `¡Entendido! Te recordaré esto ${isTomorrow ? 'mañana ' : ''}a las ${formattedTime12}${recurringDays ? ' (de forma recurrente)' : ''}.`
    };
  }

  return null;
}

/**
 * Evaluates user message using Groq model with heuristic fallback.
 */
async function parseUserMessage(userMessageText, context = {}) {
  const heuristic = parseHeuristicReminder(userMessageText);
  if (heuristic && (
    heuristic.intent === 'social_media_download' ||
    heuristic.intent === 'music' ||
    heuristic.intent === 'scribd_download' ||
    heuristic.intent === 'list_reminders' ||
    heuristic.intent === 'delete_reminder' ||
    heuristic.intent === 'reminder_types' ||
    heuristic.intent === 'finance_report' ||
    heuristic.intent === 'finance_delete_last' ||
    (heuristic.intent === 'finance_expense' && !heuristic.needsDescription) ||
    (heuristic.intent === 'finance_income' && !heuristic.needsDescription) ||
    (heuristic.intent === 'finance_expense' && heuristic.needsDescription) ||
    (heuristic.intent === 'finance_income' && heuristic.needsDescription)
  )) {
    console.log(`[Groq] Fast deterministic path: intent=${heuristic.intent}`);
    return heuristic;
  }

  try {
    const apiKey = await getGroqApiKey();
    const groq = new Groq({ apiKey });

    const currentDateTime = getCurrentColombiaDateTime();

    const systemPrompt = `Eres un asistente de WhatsApp inteligente, útil y empático.
La fecha y hora actual en Colombia (Zona Horaria UTC-5 America/Bogota) es:
- Fecha y hora legible: ${currentDateTime.readable}
- Fecha y hora ISO (UTC-5): ${currentDateTime.iso}
- Fecha actual: ${currentDateTime.dateOnly}

Tu trabajo es clasificar la intención del usuario y responder ÚNICAMENTE con un JSON válido siguiendo este schema:
{
  "intent": "reminder" | "list_reminders" | "delete_reminder" | "reminder_types" | "save_item" | "get_item" | "list_items" | "music" | "social_media_download" | "scribd_download" | "finance_expense" | "finance_income" | "finance_report" | "finance_delete_last" | "venting" | "other",
  "reminders": [
    {
      "text": "descripción de la tarea específica",
      "extractedDate": "ISO8601 string con offset -05:00",
      "recurringDays": number | null,
      "isRecurring": boolean
    }
  ],
  "reminderTarget": "string o null",
  "itemType": "image" | "link" | "text" | "all" | null,
  "description": "string o null",
  "linkUrl": "string o null",
  "query": "string o null",
  "amount": number | null,
  "category": "string o null",
  "paymentMethod": "efectivo" | "cuenta" | "transferencia" | null,
  "person": "string o null",
  "needsDescription": boolean,
  "period": "today" | "yesterday" | "week" | "month" | null,
  "responseMessage": "string"
}

REGLAS DE CLASIFICACIÓN:

1. intent = "reminder":
   - El usuario solicita agendar/recordar una o varias cosas.
   - "extractedDate" SIEMPRE en formato ISO con offset -05:00.

2. intent = "list_reminders":
   - El usuario pide consultar, listar o ver sus recordatorios programados (ej: "mis recordatorios", "ver recordatorios", "¿qué recordatorios tengo?", "lista de recordatorios", "cuáles son mis recordatorios").
   - "responseMessage": "Consultando tus recordatorios activos...".

3. intent = "delete_reminder":
   - El usuario pide borrar, eliminar o cancelar uno o todos sus recordatorios.
   - Ejemplos: "borra el recordatorio 1" -> reminderTarget: "1"
   - "borra el recordatorio de las pastillas" -> reminderTarget: "pastillas"
   - "cancela el recordatorio del médico" -> reminderTarget: "médico"
   - "borra todos los recordatorios" -> reminderTarget: "all"
   - "borra el último recordatorio" -> reminderTarget: "last"

4. intent = "reminder_types":
   - El usuario pide ver, conocer o consultar qué tipos de recordatorios existen (ej: "tipos de recordatorios", "¿qué tipos de recordatorios hay?", "cómo funcionan los recordatorios").
   - "responseMessage": "Aquí tienes los tipos de recordatorios disponibles:".

5. intent = "save_item":
   - El usuario pide guardar un enlace, una imagen o una nota con contexto.

6. intent = "get_item":
   - El usuario pide recuperar una imagen o enlace guardado.

7. intent = "list_items":
   - El usuario quiere saber qué cosas tiene guardadas ("¿qué tengo guardado?").

8. intent = "music":
   - El usuario pide que le envíen una canción en audio.

9. intent = "social_media_download":
   - Descarga de redes sociales (TikTok, Instagram, Facebook, etc.).

10. intent = "scribd_download":
    - Descarga de documentos o PDFs de Scribd.

11. intent = "finance_expense":
    - Salida de dinero, gasto, compra, pago o haberle dado dinero a alguien.

12. intent = "finance_income":
    - Dinero recibido, cobro, transferencia entrante o pago recibido.

13. intent = "finance_report":
    - Reporte, balance o resumen financiero ("today", "yesterday", "week", "month").

14. intent = "finance_delete_last":
    - Borrar o anular la última transacción registrada.

15. intent = "venting":
    - Expresión emocional o desahogo.

16. intent = "other":
    - Preguntas generales, saludos o conversación normal.

IMPORTANTE: Responde ÚNICA Y EXCLUSIVAMENTE con el JSON.`;

    const userContent = context.hasMedia 
      ? `[Adjunto archivo multimedia: ${context.mediaType || 'media'}]\nMensaje: ${userMessageText || '(sin texto)'}`
      : userMessageText;

    const primaryModel = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      model: primaryModel,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const rawResponse = chatCompletion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(rawResponse);

    const validIntents = [
      'reminder', 'list_reminders', 'delete_reminder', 'reminder_types',
      'save_item', 'get_item', 'list_items', 'music',
      'social_media_download', 'scribd_download', 'venting', 'other',
      'finance_expense', 'finance_income', 'finance_report', 'finance_delete_last'
    ];
    const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'other';

    // Normalize reminders array
    let reminders = Array.isArray(parsed.reminders) ? parsed.reminders : [];
    if (intent === 'reminder' && reminders.length === 0 && parsed.extractedDate) {
      reminders.push({
        text: userMessageText,
        extractedDate: parsed.extractedDate,
        recurringDays: parsed.recurringDays || null,
        isRecurring: !!parsed.recurringDays,
      });
    }

    // Extract first date for backward compatibility
    const firstReminder = reminders[0];
    const extractedDate = firstReminder?.extractedDate || parsed.extractedDate || (heuristic ? heuristic.extractedDate : null);
    const recurringDays = typeof firstReminder?.recurringDays === 'number' ? firstReminder.recurringDays : (typeof parsed.recurringDays === 'number' ? parsed.recurringDays : null);

    return {
      intent,
      reminders,
      extractedDate,
      recurringDays,
      reminderTarget: parsed.reminderTarget || heuristic?.reminderTarget || null,
      itemType: parsed.itemType || null,
      description: parsed.description || heuristic?.description || null,
      linkUrl: parsed.linkUrl || null,
      query: parsed.query || null,
      amount: typeof parsed.amount === 'number' ? parsed.amount : (heuristic?.amount || null),
      category: parsed.category || heuristic?.category || null,
      paymentMethod: parsed.paymentMethod || heuristic?.paymentMethod || null,
      person: parsed.person || heuristic?.person || null,
      needsDescription: typeof parsed.needsDescription === 'boolean' ? parsed.needsDescription : Boolean(heuristic?.needsDescription),
      period: parsed.period || heuristic?.period || 'today',
      responseMessage: parsed.responseMessage || (intent === 'other' ? '¿En qué te puedo ayudar hoy? Puedo ayudarte a controlar tus finanzas y gastos, agendar recordatorios, guardar enlaces/fotos o buscar canciones.' : 'Entendido.')
    };
  } catch (error) {
    console.error('[Groq] Error calling Groq API, using fallback:', error.message || error);
    
    if (heuristic) {
      return heuristic;
    }

    return {
      intent: 'other',
      reminders: [],
      extractedDate: null,
      recurringDays: null,
      reminderTarget: null,
      itemType: null,
      description: null,
      linkUrl: null,
      query: null,
      amount: null,
      category: null,
      paymentMethod: null,
      person: null,
      needsDescription: false,
      period: null,
      responseMessage: '¿En qué te puedo ayudar hoy? Puedo ayudarte a controlar tus finanzas y gastos, agendar recordatorios, guardar enlaces/fotos o buscar canciones.'
    };
  }
}

module.exports = {
  getCurrentColombiaDateTime,
  parseUserMessage,
  parseHeuristicReminder,
};
