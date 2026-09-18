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

  // Check if text is asking for a reminder
  const hasReminderIntent =
    lower.includes('recuerda') ||
    lower.includes('recordar') ||
    lower.includes('recuérdame') ||
    lower.includes('avisa') ||
    lower.includes('alarma') ||
    lower.startsWith('en ') ||
    lower.includes(' a las ');

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
  if (heuristic && (heuristic.intent === 'social_media_download' || heuristic.intent === 'music' || heuristic.intent === 'scribd_download')) {
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
  "intent": "reminder" | "save_item" | "get_item" | "list_items" | "music" | "social_media_download" | "scribd_download" | "venting" | "other",
  "reminders": [
    {
      "text": "descripción de la tarea específica",
      "extractedDate": "ISO8601 string con offset -05:00",
      "recurringDays": number | null,
      "isRecurring": boolean
    }
  ],
  "itemType": "image" | "link" | "text" | "all" | null,
  "description": "string o null",
  "linkUrl": "string o null",
  "query": "string o null",
  "responseMessage": "string"
}

REGLAS DE CLASIFICACIÓN:

1. intent = "reminder":
   - El usuario solicita recordar una o varias cosas.
   - Si el usuario pide MÚLTIPLES recordatorios en un solo mensaje (ej: "recuérdame los lunes lavar la ropa a las 8am, los martes hacer compras a las 10am, y mañana a las 3pm cita con el dentista"):
     * Genera un elemento en el array "reminders" para CADA recordatorio.
     * Para días de la semana ("los lunes", "los martes"), calcula la fecha del PRÓXIMO lunes o martes a partir de hoy (${currentDateTime.readable}) y pon "recurringDays": 7, "isRecurring": true.
     * Para "todos los días": "recurringDays": 1, "isRecurring": true.
     * "extractedDate" SIEMPRE en formato ISO con offset -05:00.
   - En "responseMessage", confirma de forma amable y estructurada con viñetas todos los recordatorios agendados.

2. intent = "save_item":
   - El usuario pide guardar un enlace, una imagen o una nota con contexto (ej: "guárdame esta imagen que es de donde vivo", "guarda este enlace de la receta de pollo: https://...", "guárdame este link").
   - "itemType": "image" si el usuario adjuntó imagen o menciona guardar imagen/foto; "link" si contiene un URL http/https o pide guardar enlace.
   - "description": Lo que representa el elemento (ej: "donde vivo", "receta de pollo").
   - "linkUrl": la URL extraída si la hay, o null.
   - "responseMessage": Mensaje cordial confirmando que se guardó bajo esa descripción.

3. intent = "get_item":
   - El usuario pide recuperar una imagen o enlace guardado (ej: "pásame la imagen de donde vivo", "cuál era el link de las recetas", "dame la foto de mi perro").
   - "itemType": "image" | "link" | null.
   - "query": El término de búsqueda que identifica lo que pide (ej: "donde vivo", "receta", "perro").
   - "responseMessage": Mensaje introductorio breve (ej: "¡Aquí tienes la imagen de donde vivo!").

4. intent = "list_items":
   - El usuario quiere saber qué cosas tiene guardadas (ej: "¿qué tengo guardado?", "muéstrame mis enlaces y fotos", "lista de cosas guardadas").
   - "itemType": "all" | "image" | "link".
   - "responseMessage": "Aquí tienes tus elementos guardados:".

5. intent = "music":
   - El usuario pide que le envíen una canción en audio (ej: "envíame la canción Fuentes de Ortiz", "pon la canción de Michael Jackson Billie Jean", "descárgame la canción X").
   - "query": El nombre de la canción y/o artista (ej: "Fuentes de Ortiz").
   - "responseMessage": "🎵 Buscando y preparando el audio de tu canción, dame unos momentos...".

6. intent = "social_media_download":
   - El usuario envía un enlace o pide descargar un video, reel, historia, tiktok, foto o publicación de redes sociales (TikTok, Instagram, Facebook, YouTube Shorts, Twitter/X, Pinterest).
   - Ejemplos: "descárgame este video https://www.tiktok.com/...", "bájame este reel https://www.instagram.com/reel/...", "descarga esta historia https://...", o simplemente cuando el mensaje incluye un enlace de tiktok, instagram, facebook (fb.watch), youtube shorts, etc.
   - "linkUrl": la URL extraída del contenido a descargar.
   - "responseMessage": "📥 Descargando el contenido de la red social, dame unos segundos...".

7. intent = "scribd_download":
   - El usuario envía un enlace o pide descargar un documento o PDF de Scribd (ej: "descárgame este pdf https://www.scribd.com/document/...", "bájame este documento de scribd https://...", o al pegar un enlace de scribd.com).
   - "linkUrl": la URL extraída del documento Scribd.
   - "responseMessage": "📄 Procesando y descargando el PDF de Scribd, dame unos momentos...".

8. intent = "venting":
   - El usuario expresa sentimientos, problemas personales, tristeza o busca desahogo emocional.
   - "responseMessage": Sumamente empático, cálido, comprensivo y sin juzgar.

9. intent = "other":
   - Preguntas generales, saludos o conversación normal.
   - "responseMessage": Respuesta natural y amigable recordando brevemente en qué puede ayudarle (recordatorios, guardar fotos/links, música, descargar videos de redes, descargar PDFs de Scribd o escucharlo).

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

    const validIntents = ['reminder', 'save_item', 'get_item', 'list_items', 'music', 'social_media_download', 'scribd_download', 'venting', 'other'];
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
      itemType: parsed.itemType || null,
      description: parsed.description || null,
      linkUrl: parsed.linkUrl || null,
      query: parsed.query || null,
      responseMessage: parsed.responseMessage || (intent === 'other' ? '¿En qué te puedo ayudar hoy? Puedo agendar recordatorios, guardar enlaces/fotos, buscar canciones o simplemente escucharte.' : 'Entendido.')
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
      itemType: null,
      description: null,
      linkUrl: null,
      query: null,
      responseMessage: '¿En qué te puedo ayudar hoy? Puedo agendar recordatorios, guardar enlaces/fotos, buscar canciones o simplemente escucharte.'
    };
  }
}

module.exports = {
  getCurrentColombiaDateTime,
  parseUserMessage,
  parseHeuristicReminder,
};
