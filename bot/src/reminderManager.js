const prisma = require('./db');
const { cancelReminderJobs } = require('./scheduler');

/**
 * Formatea una fecha a formato legible en Colombia (UTC-5)
 */
function formatReminderDate(date) {
  const colombiaOffsetMs = -5 * 60 * 60 * 1000;
  const colDate = new Date(new Date(date).getTime() + colombiaOffsetMs);

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const dayName = days[colDate.getUTCDay()];
  const dayNum = colDate.getUTCDate();
  const monthName = months[colDate.getUTCMonth()];
  
  let hours = colDate.getUTCHours();
  const minutes = colDate.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${dayName} ${dayNum} ${monthName}, ${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

/**
 * Obtiene el tipo descriptivo de un recordatorio
 */
function getReminderTypeBadge(reminder) {
  if (!reminder.isRecurring) {
    return '⏰ Puntual (Único)';
  }
  if (reminder.recurrenceDays === 1) {
    return '🔄 Recurrente Diario';
  }
  if (reminder.recurrenceDays === 7) {
    return '📅 Recurrente Semanal';
  }
  return `🔁 Recurrente (Cada ${reminder.recurrenceDays} días)`;
}

/**
 * Retorna la guía completa de tipos de recordatorios que soporta el bot
 */
function getReminderTypesInfo() {
  return `📋 *TIPOS DE RECORDATORIOS DISPONIBLES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ ⏰ *Puntuales (De una sola vez)*
Para eventos con fecha y hora específica. Cuentan con pre-alertas automáticas 24h antes y 1h antes para que estés preparado.
👉 *Ejemplos:*
• _"Recuérdame la cita del médico mañana a las 10am"_
• _"Recuérdame el 25 de octubre a las 3pm pagar la tarjeta"_

2️⃣ 🔄 *Recurrentes Diarios*
Para hábitos, medicamentos o rutinas de todos los días.
👉 *Ejemplo:*
• _"Recuérdame todos los días a las 8am tomar las vitaminas"_

3️⃣ 📅 *Recurrentes Semanales*
Para actividades que se repiten ciertos días de la semana.
👉 *Ejemplos:*
• _"Recuérdame los lunes a las 9am reunión de equipo"_
• _"Recuérdame los sábados a las 10am lavar la ropa"_

4️⃣ ⏳ *Relativos / Cuenta Regresiva*
Para tareas inmediatas con conteo de tiempo.
👉 *Ejemplos:*
• _"Recuérdame en 20 minutos sacar el pollo del horno"_
• _"Recuérdame en 2 horas llamar a mi mamá"_

5️⃣ 🎙️ *Por Nota de Voz*
¡Puedes enviarme un audio de WhatsApp diciendo cualquiera de las frases anteriores y lo programaré al instante!

━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *¿Cómo gestionarlos?*
• _"Ver mis recordatorios"_ (para ver los que tienes activos).
• _"Borra el recordatorio 1"_ o _"Borra el recordatorio de [tarea]"_.
• _"Borra todos los recordatorios"_.`;
}

/**
 * Obtiene la lista formateada de recordatorios pendientes del usuario
 */
async function listUserReminders({ userId }) {
  const reminders = await prisma.reminder.findMany({
    where: {
      userId,
      status: 'pending',
    },
    orderBy: { targetDate: 'asc' },
  });

  if (reminders.length === 0) {
    return {
      count: 0,
      reminders: [],
      text: `⏰ *No tienes recordatorios activos en este momento.*\n\nPuedes programar uno diciendo por ejemplo:\n• _"Recuérdame mañana a las 9am cita con el médico"_\n• _"Recuérdame todos los días a las 8am tomar pastillas"_\n\nPara ver las opciones disponibles escribe: *'Tipos de recordatorios'*`,
    };
  }

  let text = `⏰ *TUS RECORDATORIOS ACTIVOS (${reminders.length}):*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  reminders.forEach((rem, idx) => {
    const num = idx + 1;
    const typeBadge = getReminderTypeBadge(rem);
    const dateStr = formatReminderDate(rem.targetDate);

    text += `*#${num}* | ${typeBadge}\n`;
    text += `📌 *Tarea:* "${rem.texto}"\n`;
    text += `🗓️ *Próximo aviso:* ${dateStr}\n`;
    if (!rem.isRecurring) {
      text += `🔔 *Pre-alertas:* 24h antes y 1h antes activas\n`;
    }
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💡 *Para eliminar alguno escribe:*\n`;
  text += `• _"Borra el recordatorio 1"_ (por número)\n`;
  text += `• _"Borra el recordatorio de [palabra clave]"_\n`;
  text += `• _"Borra todos los recordatorios"_`;

  return {
    count: reminders.length,
    reminders,
    text,
  };
}

/**
 * Elimina uno o todos los recordatorios del usuario
 */
async function deleteUserReminder({ userId, target }) {
  const cleanTarget = (target || '').toString().trim().toLowerCase();

  // Caso A: Eliminar todos los recordatorios
  if (cleanTarget === 'all' || cleanTarget === 'todos' || cleanTarget.includes('todos')) {
    const reminders = await prisma.reminder.findMany({
      where: { userId, status: 'pending' },
    });

    if (reminders.length === 0) {
      return { success: false, message: 'No tienes recordatorios pendientes para eliminar.' };
    }

    for (const rem of reminders) {
      cancelReminderJobs(rem.id);
      await prisma.reminder.delete({ where: { id: rem.id } });
    }

    return {
      success: true,
      message: `🗑️ *Se eliminaron todos tus recordatorios activos (${reminders.length} en total).*`,
    };
  }

  // Obtener la lista ordenada actual
  const reminders = await prisma.reminder.findMany({
    where: { userId, status: 'pending' },
    orderBy: { targetDate: 'asc' },
  });

  if (reminders.length === 0) {
    return { success: false, message: 'No tienes recordatorios pendientes para eliminar.' };
  }

  // Caso B: Eliminar el último
  if (cleanTarget === 'last' || cleanTarget === 'ultimo' || cleanTarget === 'último') {
    const lastRem = reminders[reminders.length - 1];
    cancelReminderJobs(lastRem.id);
    await prisma.reminder.delete({ where: { id: lastRem.id } });
    return {
      success: true,
      message: `🗑️ *Recordatorio eliminado exitosamente:*\n📌 "${lastRem.texto}"`,
    };
  }

  // Caso C: Eliminar por número de índice (ej: "1", "2")
  const numIndex = parseInt(cleanTarget.replace(/\D/g, ''), 10);
  if (!isNaN(numIndex) && numIndex >= 1 && numIndex <= reminders.length) {
    const selectedRem = reminders[numIndex - 1];
    cancelReminderJobs(selectedRem.id);
    await prisma.reminder.delete({ where: { id: selectedRem.id } });
    return {
      success: true,
      message: `🗑️ *Recordatorio #${numIndex} eliminado exitosamente:*\n📌 "${selectedRem.texto}"`,
    };
  }

  // Caso D: Buscar por texto / palabra clave
  const query = cleanTarget
    .replace(/^(el\s+|la\s+|mi\s+|del\s+|de\s+|recordatorio\s+|recordatorio\s+de\s+)*/gi, '')
    .trim();

  let matched = null;
  if (query.length > 0) {
    matched = reminders.find((r) => r.texto.toLowerCase().includes(query));
  }

  if (matched) {
    cancelReminderJobs(matched.id);
    await prisma.reminder.delete({ where: { id: matched.id } });
    return {
      success: true,
      message: `🗑️ *Recordatorio eliminado exitosamente:*\n📌 "${matched.texto}"`,
    };
  }

  return {
    success: false,
    message: `🔍 No encontré ningún recordatorio que coincida con *"${target}"*.\n\nPuedes escribir *"Ver mis recordatorios"* para ver la lista numerada y decirme por ejemplo: _"Borra el recordatorio 1"_.`,
  };
}

module.exports = {
  formatReminderDate,
  getReminderTypeBadge,
  getReminderTypesInfo,
  listUserReminders,
  deleteUserReminder,
};
