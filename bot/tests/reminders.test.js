const assert = require('assert');
const { parseHeuristicReminder } = require('../src/groq');
const {
  formatReminderDate,
  getReminderTypeBadge,
  getReminderTypesInfo,
} = require('../src/reminderManager');
const { activeJobs, cancelReminderJobs } = require('../src/scheduler');

async function runReminderTests() {
  console.log('🧪 === INICIANDO PRUEBAS DE GESTIÓN Y TIPOS DE RECORDATORIOS ===\n');

  // Test 1: getReminderTypesInfo
  console.log('Test 1: Guía y visualización de Tipos de Recordatorios...');
  const typesInfo = getReminderTypesInfo();
  assert.ok(typesInfo.includes('TIPOS DE RECORDATORIOS DISPONIBLES'));
  assert.ok(typesInfo.includes('Puntuales (De una sola vez)'));
  assert.ok(typesInfo.includes('Recurrentes Diarios'));
  assert.ok(typesInfo.includes('Recurrentes Semanales'));
  assert.ok(typesInfo.includes('Relativos / Cuenta Regresiva'));
  assert.ok(typesInfo.includes('Por Nota de Voz'));
  console.log('  ✅ getReminderTypesInfo genera la información completa de tipos.');

  // Test 2: Badges descriptivos de tipos de recordatorios
  console.log('Test 2: Badges descriptivos de cada recordatorio...');
  const punctual = getReminderTypeBadge({ isRecurring: false });
  assert.strictEqual(punctual, '⏰ Puntual (Único)');

  const daily = getReminderTypeBadge({ isRecurring: true, recurrenceDays: 1 });
  assert.strictEqual(daily, '🔄 Recurrente Diario');

  const weekly = getReminderTypeBadge({ isRecurring: true, recurrenceDays: 7 });
  assert.strictEqual(weekly, '📅 Recurrente Semanal');
  console.log('  ✅ Badges descriptivos generados correctamente.');

  // Test 3: Detección de consultar Tipos de Recordatorios
  console.log('Test 3: Detección de "tipos de recordatorios"...');
  const resTypes1 = parseHeuristicReminder('tipos de recordatorios');
  assert.ok(resTypes1);
  assert.strictEqual(resTypes1.intent, 'reminder_types');

  const resTypes2 = parseHeuristicReminder('¿qué tipos de recordatorios hay?');
  assert.ok(resTypes2);
  assert.strictEqual(resTypes2.intent, 'reminder_types');

  const resTypes3 = parseHeuristicReminder('como funcionan los recordatorios');
  assert.ok(resTypes3);
  assert.strictEqual(resTypes3.intent, 'reminder_types');
  console.log('  ✅ Consultas de tipos de recordatorios clasificadas al 100%.');

  // Test 4: Detección de Listar Recordatorios ("mis recordatorios")
  console.log('Test 4: Detección de consultar y ver recordatorios...');
  const resList1 = parseHeuristicReminder('mis recordatorios');
  assert.ok(resList1);
  assert.strictEqual(resList1.intent, 'list_reminders');

  const resList2 = parseHeuristicReminder('ver recordatorios');
  assert.ok(resList2);
  assert.strictEqual(resList2.intent, 'list_reminders');

  const resList3 = parseHeuristicReminder('¿qué recordatorios tengo?');
  assert.ok(resList3);
  assert.strictEqual(resList3.intent, 'list_reminders');

  const resList4 = parseHeuristicReminder('lista de recordatorios pendientes');
  assert.ok(resList4);
  assert.strictEqual(resList4.intent, 'list_reminders');
  console.log('  ✅ Consultas de lista de recordatorios clasificadas al 100%.');

  // Test 5: Detección de Eliminar Recordatorio
  console.log('Test 5: Detección de comandos para eliminar recordatorios...');
  const resDel1 = parseHeuristicReminder('borra el recordatorio 1');
  assert.ok(resDel1);
  assert.strictEqual(resDel1.intent, 'delete_reminder');
  assert.strictEqual(resDel1.reminderTarget, '1');

  const resDel2 = parseHeuristicReminder('elimina el recordatorio de las pastillas');
  assert.ok(resDel2);
  assert.strictEqual(resDel2.intent, 'delete_reminder');
  assert.ok(resDel2.reminderTarget.includes('pastillas'));

  const resDel3 = parseHeuristicReminder('cancela el recordatorio del médico');
  assert.ok(resDel3);
  assert.strictEqual(resDel3.intent, 'delete_reminder');
  assert.ok(resDel3.reminderTarget.includes('médico'));

  const resDelAll = parseHeuristicReminder('borra todos los recordatorios');
  assert.ok(resDelAll);
  assert.strictEqual(resDelAll.intent, 'delete_reminder');
  assert.strictEqual(resDelAll.reminderTarget, 'all');

  const resDelLast = parseHeuristicReminder('elimina el último recordatorio');
  assert.ok(resDelLast);
  assert.strictEqual(resDelLast.intent, 'delete_reminder');
  assert.strictEqual(resDelLast.reminderTarget, 'last');
  console.log('  ✅ Comandos de eliminación clasificados al 100%.');

  // Test 6: Cancelación de cron jobs en activeJobs
  console.log('Test 6: Cancelación de cron jobs en memoria...');
  const fakeId = 'rem-test-xyz';
  let wasCancelled = false;
  activeJobs.set(`${fakeId}_exact`, { cancel: () => { wasCancelled = true; } });
  activeJobs.set(`${fakeId}_-1h`, { cancel: () => {} });

  const cancelledCount = cancelReminderJobs(fakeId);
  assert.strictEqual(cancelledCount, 2);
  assert.strictEqual(wasCancelled, true);
  assert.strictEqual(activeJobs.has(`${fakeId}_exact`), false);
  console.log('  ✅ Cron jobs cancelados y limpiados de memoria con éxito.');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE RECORDATORIOS PASARON EXITOSAMENTE!');
}

runReminderTests().catch((err) => {
  console.error('❌ Error en prueba de recordatorios:', err);
  process.exit(1);
});
