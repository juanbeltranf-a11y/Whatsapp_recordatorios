const assert = require('assert');
const { parseHeuristicReminder } = require('../src/groq');
const {
  formatReminderDate,
  getReminderTypeBadge,
  getReminderTypesInfo,
} = require('../src/reminderManager');

async function runReminderFlowTest() {
  console.log('🧪 === SIMULACIÓN DE FLUJO: RECORDATORIOS Y TIPOS ===\n');

  // Simulación de base de datos en memoria para recordatorios
  let mockReminders = [];

  let lastReply = '';
  function mockReply(text) {
    lastReply = text;
  }

  async function simulateWhatsAppMessage(userText) {
    const analysis = parseHeuristicReminder(userText);
    if (!analysis) {
      mockReply('Mensaje no reconocido');
      return;
    }

    // A. Consultar Tipos de recordatorios
    if (analysis.intent === 'reminder_types') {
      mockReply(getReminderTypesInfo());
      return;
    }

    // B. Listar recordatorios
    if (analysis.intent === 'list_reminders') {
      if (mockReminders.length === 0) {
        mockReply('⏰ No tienes recordatorios activos en este momento.');
        return;
      }

      let text = `⏰ *TUS RECORDATORIOS ACTIVOS (${mockReminders.length}):*\n`;
      mockReminders.forEach((r, idx) => {
        text += `#${idx + 1} | ${getReminderTypeBadge(r)} - "${r.texto}"\n`;
      });
      mockReply(text);
      return;
    }

    // C. Eliminar recordatorios
    if (analysis.intent === 'delete_reminder') {
      const target = (analysis.reminderTarget || '').toLowerCase().trim();

      if (target === 'all' || target === 'todos') {
        const count = mockReminders.length;
        mockReminders = [];
        mockReply(`🗑️ Se eliminaron todos tus recordatorios activos (${count}).`);
        return;
      }

      const num = parseInt(target.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num >= 1 && num <= mockReminders.length) {
        const deleted = mockReminders.splice(num - 1, 1)[0];
        mockReply(`🗑️ Recordatorio #${num} eliminado: "${deleted.texto}"`);
        return;
      }

      const query = target.replace(/^(el\s+|la\s+|mi\s+|del\s+|de\s+|recordatorio\s+)*/gi, '').trim();
      const foundIdx = mockReminders.findIndex((r) => r.texto.toLowerCase().includes(query));
      if (foundIdx !== -1) {
        const deleted = mockReminders.splice(foundIdx, 1)[0];
        mockReply(`🗑️ Recordatorio eliminado: "${deleted.texto}"`);
        return;
      }

      mockReply(`No encontré ningún recordatorio para eliminar.`);
      return;
    }

    // D. Crear recordatorio
    if (analysis.intent === 'reminder') {
      const rem = {
        id: `rem-${Date.now()}-${Math.random()}`,
        texto: userText,
        targetDate: analysis.extractedDate || new Date().toISOString(),
        isRecurring: !!analysis.recurringDays,
        recurrenceDays: analysis.recurringDays,
        status: 'pending',
      };
      mockReminders.push(rem);
      mockReply(`¡Listo! Agendé tu recordatorio: "${userText}"`);
      return;
    }
  }

  // Paso 1: Usuario crea 3 recordatorios de tipos distintos
  console.log('Paso 1: Agendando 3 recordatorios de tipos distintos...');
  mockReminders.push({
    id: 'rem-1',
    texto: 'Cita con el médico',
    targetDate: new Date(Date.now() + 86400000).toISOString(),
    isRecurring: false,
    recurrenceDays: null,
    status: 'pending',
  });
  mockReminders.push({
    id: 'rem-2',
    texto: 'Tomar vitaminas',
    targetDate: new Date(Date.now() + 3600000).toISOString(),
    isRecurring: true,
    recurrenceDays: 1,
    status: 'pending',
  });
  mockReminders.push({
    id: 'rem-3',
    texto: 'Reunión de equipo',
    targetDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    isRecurring: true,
    recurrenceDays: 7,
    status: 'pending',
  });
  assert.strictEqual(mockReminders.length, 3);
  console.log('  ✅ 3 recordatorios registrados en BD simulada.');

  // Paso 2: Usuario pide ver los tipos de recordatorios
  console.log('Paso 2: Usuario pide: "tipos de recordatorios"');
  await simulateWhatsAppMessage('tipos de recordatorios');
  console.log('  Bot responde guía completa:\n' + lastReply.split('\n').slice(0, 5).join('\n') + '...');
  assert.ok(lastReply.includes('Puntuales (De una sola vez)'));
  assert.ok(lastReply.includes('Recurrentes Diarios'));
  assert.ok(lastReply.includes('Recurrentes Semanales'));

  // Paso 3: Usuario pide ver sus recordatorios
  console.log('Paso 3: Usuario pide: "mis recordatorios"');
  await simulateWhatsAppMessage('mis recordatorios');
  console.log('  Bot responde lista:\n' + lastReply);
  assert.ok(lastReply.includes('#1 | ⏰ Puntual (Único) - "Cita con el médico"'));
  assert.ok(lastReply.includes('#2 | 🔄 Recurrente Diario - "Tomar vitaminas"'));
  assert.ok(lastReply.includes('#3 | 📅 Recurrente Semanal - "Reunión de equipo"'));

  // Paso 4: Usuario elimina por número: "borra el recordatorio 2"
  console.log('Paso 4: Usuario dice: "borra el recordatorio 2"');
  await simulateWhatsAppMessage('borra el recordatorio 2');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('Recordatorio #2 eliminado: "Tomar vitaminas"'));
  assert.strictEqual(mockReminders.length, 2);

  // Paso 5: Usuario elimina por texto: "borra el recordatorio del médico"
  console.log('Paso 5: Usuario dice: "borra el recordatorio del médico"');
  await simulateWhatsAppMessage('borra el recordatorio del médico');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('Recordatorio eliminado: "Cita con el médico"'));
  assert.strictEqual(mockReminders.length, 1);

  // Paso 6: Usuario elimina todos los restantes: "borra todos los recordatorios"
  console.log('Paso 6: Usuario dice: "borra todos los recordatorios"');
  await simulateWhatsAppMessage('borra todos los recordatorios');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('Se eliminaron todos tus recordatorios activos'));
  assert.strictEqual(mockReminders.length, 0);

  // Paso 7: Usuario consulta de nuevo: "ver recordatorios"
  console.log('Paso 7: Usuario consulta: "ver recordatorios"');
  await simulateWhatsAppMessage('ver recordatorios');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('No tienes recordatorios activos'));

  console.log('\n🎉 ¡FLUJO DE TIPOS Y ELIMINACIÓN DE RECORDATORIOS VALIDADO AL 100%!');
}

runReminderFlowTest().catch((err) => {
  console.error('❌ Error en test de flujo de recordatorios:', err);
  process.exit(1);
});
