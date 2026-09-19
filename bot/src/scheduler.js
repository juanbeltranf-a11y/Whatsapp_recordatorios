const schedule = require('node-schedule');
const prisma = require('./db');

// In-memory registry of scheduled jobs
const activeJobs = new Map();

/**
 * Sends a WhatsApp message safely
 */
async function sendWhatsAppMessage(whatsappClient, phone, message) {
  try {
    if (!whatsappClient) {
      console.warn('[Scheduler] WhatsApp client not initialized.');
      return;
    }

    let chatId = phone;
    if (!chatId.includes('@')) {
      chatId = `${phone.replace(/\D/g, '')}@c.us`;
    }
    await whatsappClient.sendMessage(chatId, message);
    console.log(`[Scheduler] Message delivered to ${chatId}: ${message.slice(0, 40)}...`);
  } catch (error) {
    console.error(`[Scheduler] Failed to send message to ${phone}:`, error.message);
  }
}

/**
 * Updates scheduledAlerts tracking in database
 */
async function markAlertStatus(reminderId, alertType, status = 'sent') {
  try {
    const reminder = await prisma.reminder.findUnique({ where: { id: reminderId } });
    if (!reminder) return;

    let alerts = Array.isArray(reminder.scheduledAlerts) ? [...reminder.scheduledAlerts] : [];
    const existingIndex = alerts.findIndex((a) => a.type === alertType);

    if (existingIndex >= 0) {
      alerts[existingIndex].status = status;
      alerts[existingIndex].triggeredAt = new Date().toISOString();
    } else {
      alerts.push({
        type: alertType,
        status,
        triggeredAt: new Date().toISOString(),
      });
    }

    await prisma.reminder.update({
      where: { id: reminderId },
      data: { scheduledAlerts: alerts },
    });
  } catch (error) {
    console.error(`[Scheduler] Error marking alert status for ${reminderId}:`, error.message);
  }
}

/**
 * Schedules all alerts for a given reminder based on delta
 */
function scheduleReminder(reminder, whatsappClient) {
  const targetDate = new Date(reminder.targetDate);
  const now = new Date();
  const deltaMs = targetDate.getTime() - now.getTime();

  if (reminder.status !== 'pending') {
    return;
  }

  const phone = reminder.user?.phone;
  if (!phone) {
    console.warn(`[Scheduler] Reminder ${reminder.id} missing user phone.`);
    return;
  }

  const hoursRemaining = deltaMs / (1000 * 60 * 60);

  const alertsToSchedule = [];

  // Alert definitions
  const date24h = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
  const date1h = new Date(targetDate.getTime() - 60 * 60 * 1000);

  // Business Rules:
  // Si faltan > 24h: Programa 3 cron jobs (-24h, -1h, hora exacta)
  // Si faltan entre 1h y 24h: Programa 2 cron jobs (-1h, hora exacta)
  // Si falta < 1h: Programa 1 cron job (hora exacta)
  if (hoursRemaining > 24) {
    alertsToSchedule.push({ type: '-24h', date: date24h });
    alertsToSchedule.push({ type: '-1h', date: date1h });
    alertsToSchedule.push({ type: 'exact', date: targetDate });
  } else if (hoursRemaining > 1) {
    alertsToSchedule.push({ type: '-1h', date: date1h });
    alertsToSchedule.push({ type: 'exact', date: targetDate });
  } else {
    alertsToSchedule.push({ type: 'exact', date: targetDate });
  }

  alertsToSchedule.forEach(({ type, date }) => {
    const jobKey = `${reminder.id}_${type}`;

    // Cancel existing job if re-scheduling
    if (activeJobs.has(jobKey)) {
      activeJobs.get(jobKey).cancel();
      activeJobs.delete(jobKey);
    }

    // Only schedule future dates
    if (date.getTime() > Date.now()) {
      const job = schedule.scheduleJob(date, async () => {
        try {
          if (type === '-24h') {
            await sendWhatsAppMessage(
              whatsappClient,
              phone,
              `⚠️ *Recordatorio anticipado (24h)*\nMañana a esta hora tienes programado:\n📌 "${reminder.texto}"`
            );
            await markAlertStatus(reminder.id, '-24h', 'sent');
          } else if (type === '-1h') {
            await sendWhatsAppMessage(
              whatsappClient,
              phone,
              `⏳ *Recordatorio anticipado (1 hora)*\nEn 1 hora tienes programado:\n📌 "${reminder.texto}"`
            );
            await markAlertStatus(reminder.id, '-1h', 'sent');
          } else if (type === 'exact') {
            await sendWhatsAppMessage(
              whatsappClient,
              phone,
              `⏰ *¡RECORDATORIO AHORA!*\n\n📌 "${reminder.texto}"`
            );
            await markAlertStatus(reminder.id, 'exact', 'sent');

            // Mark as completed
            await prisma.reminder.update({
              where: { id: reminder.id },
              data: { status: 'completed' },
            });

            // Handle recurrence
            if (reminder.isRecurring && reminder.recurrenceDays && reminder.recurrenceDays > 0) {
              const nextTargetDate = new Date(targetDate.getTime() + reminder.recurrenceDays * 24 * 60 * 60 * 1000);
              console.log(`[Scheduler] Creating recurring reminder for ${nextTargetDate.toISOString()}`);

              const newReminder = await prisma.reminder.create({
                data: {
                  texto: reminder.texto,
                  targetDate: nextTargetDate,
                  status: 'pending',
                  isRecurring: true,
                  recurrenceDays: reminder.recurrenceDays,
                  userId: reminder.userId,
                  scheduledAlerts: [],
                },
                include: { user: true },
              });

              // Schedule the new recurrence
              scheduleReminder(newReminder, whatsappClient);
            }
          }
        } catch (jobErr) {
          console.error(`[Scheduler] Error running job ${jobKey}:`, jobErr);
        } finally {
          activeJobs.delete(jobKey);
        }
      });

      if (job) {
        activeJobs.set(jobKey, job);
      }
    }
  });

  console.log(`[Scheduler] Reminder ${reminder.id} scheduled (${alertsToSchedule.length} alerts planned).`);
}

/**
 * Restores pending reminders from DB on startup
 */
async function initScheduler(whatsappClient) {
  try {
    const pendingReminders = await prisma.reminder.findMany({
      where: { status: 'pending' },
      include: { user: true },
    });

    console.log(`[Scheduler] Initializing scheduler: found ${pendingReminders.length} pending reminders.`);
    for (const reminder of pendingReminders) {
      scheduleReminder(reminder, whatsappClient);
    }
  } catch (error) {
    console.error('[Scheduler] Error restoring reminders on startup:', error.message);
  }
}

/**
 * Cancels all scheduled node-schedule jobs for a specific reminder ID
 */
function cancelReminderJobs(reminderId) {
  let count = 0;
  for (const [key, job] of activeJobs.entries()) {
    if (key.startsWith(`${reminderId}_`)) {
      job.cancel();
      activeJobs.delete(key);
      count++;
    }
  }
  console.log(`[Scheduler] Cancelled ${count} cron jobs for reminder ${reminderId}`);
  return count;
}

module.exports = {
  scheduleReminder,
  initScheduler,
  cancelReminderJobs,
  activeJobs,
};

