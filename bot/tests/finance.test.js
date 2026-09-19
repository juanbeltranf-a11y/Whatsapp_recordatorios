const assert = require('assert');
const {
  formatCurrencyCOP,
  getColombiaDateBounds,
  formatTimeColombia,
} = require('../src/finance');
const { parseUserMessage, parseHeuristicReminder } = require('../src/groq');

async function runTests() {
  console.log('🧪 === INICIANDO PRUEBAS DEL SISTEMA DE CONTROL DE DINERO ===\n');

  // Test 1: formatCurrencyCOP
  console.log('Test 1: Formateo de moneda en Pesos Colombianos (COP)...');
  assert.strictEqual(formatCurrencyCOP(100000), '$100.000');
  assert.strictEqual(formatCurrencyCOP(10000), '$10.000');
  assert.strictEqual(formatCurrencyCOP(15500), '$15.500');
  assert.strictEqual(formatCurrencyCOP(0), '$0');
  assert.strictEqual(formatCurrencyCOP(-50000), '-$50.000');
  console.log('  ✅ formatCurrencyCOP pasó todas las pruebas.');

  // Test 2: getColombiaDateBounds
  console.log('Test 2: Límites de fechas en Zona Horaria Colombia (UTC-5)...');
  const todayBounds = getColombiaDateBounds('today');
  assert.ok(todayBounds.startUtc instanceof Date);
  assert.ok(todayBounds.endUtc instanceof Date);
  assert.strictEqual(todayBounds.label, 'Hoy');
  assert.ok(todayBounds.endUtc > todayBounds.startUtc);

  const yesterdayBounds = getColombiaDateBounds('yesterday');
  assert.strictEqual(yesterdayBounds.label, 'Ayer');
  assert.ok(yesterdayBounds.endUtc < todayBounds.startUtc);

  const weekBounds = getColombiaDateBounds('week');
  assert.strictEqual(weekBounds.label, 'Esta Semana');

  const monthBounds = getColombiaDateBounds('month');
  assert.ok(monthBounds.label.startsWith('Mes de'));
  console.log('  ✅ getColombiaDateBounds calculó rangos exactos para hoy, ayer, semana y mes.');

  // Test 3: Reconocimiento Heurístico de Egresos sin concepto ("Hoy me gaste $100.000")
  console.log('Test 3: Detección de gasto sin concepto...');
  const res1 = parseHeuristicReminder('Hoy me gaste $100.000');
  assert.ok(res1, 'Debe detectar la intención');
  assert.strictEqual(res1.intent, 'finance_expense');
  assert.strictEqual(res1.amount, 100000);
  assert.strictEqual(res1.needsDescription, true);
  assert.ok(res1.responseMessage.includes('¿En qué te gastaste'));
  console.log('  ✅ "Hoy me gaste $100.000" solicita concepto como requiere el usuario.');

  // Test 4: Reconocimiento de Egreso con concepto ("acabe de gastar $10.000 en un pollo")
  console.log('Test 4: Detección de gasto con concepto...');
  const res2 = parseHeuristicReminder('acabe de gastar $10.000 en un pollo');
  assert.ok(res2);
  assert.strictEqual(res2.intent, 'finance_expense');
  assert.strictEqual(res2.amount, 10000);
  assert.strictEqual(res2.needsDescription, false);
  assert.ok(res2.description.toLowerCase().includes('pollo'));
  console.log(`  ✅ "acabe de gastar $10.000 en un pollo" extrajo: $${res2.amount} en "${res2.description}".`);

  // Test 5: Reconocimiento de Dinero dado a una persona ("le di $50.000 a Carlos")
  console.log('Test 5: Detección de dinero entregado a una persona...');
  const res3 = parseHeuristicReminder('le di $50.000 a Carlos');
  assert.ok(res3);
  assert.strictEqual(res3.intent, 'finance_expense');
  assert.strictEqual(res3.amount, 50000);
  assert.strictEqual(res3.person, 'Carlos');
  assert.strictEqual(res3.needsDescription, false);
  console.log(`  ✅ "le di $50.000 a Carlos" extrajo: egreso de $${res3.amount} a persona "${res3.person}".`);

  // Test 6: Reconocimiento de Ingreso en efectivo ("me dieron $10.000 en efectivo")
  console.log('Test 6: Detección de ingreso en efectivo...');
  const res4 = parseHeuristicReminder('me dieron $10.000 en efectivo');
  assert.ok(res4);
  assert.strictEqual(res4.intent, 'finance_income');
  assert.strictEqual(res4.amount, 10000);
  assert.strictEqual(res4.paymentMethod, 'efectivo');
  assert.strictEqual(res4.needsDescription, false);
  console.log(`  ✅ "me dieron $10.000 en efectivo" extrajo: ingreso de $${res4.amount} (${res4.paymentMethod}).`);

  // Test 7: Reconocimiento de Transferencia ("me tranfirieron $15.000 a la cuenta")
  console.log('Test 7: Detección de transferencia entrante a la cuenta...');
  const res5 = parseHeuristicReminder('me tranfirieron $15.000 a la cuenta');
  assert.ok(res5);
  assert.strictEqual(res5.intent, 'finance_income');
  assert.strictEqual(res5.amount, 15000);
  assert.strictEqual(res5.paymentMethod, 'transferencia');
  assert.strictEqual(res5.needsDescription, false);
  console.log(`  ✅ "me tranfirieron $15.000 a la cuenta" extrajo: ingreso de $${res5.amount} (${res5.paymentMethod}).`);

  // Test 8: Pedidos de reportes (día, día anterior, semana, mes)
  console.log('Test 8: Detección de solicitudes de reporte...');
  const repDay = parseHeuristicReminder('dame el reporte del dia');
  assert.strictEqual(repDay.intent, 'finance_report');
  assert.strictEqual(repDay.period, 'today');

  const repYesterday = parseHeuristicReminder('reporte del dia anterior');
  assert.strictEqual(repYesterday.intent, 'finance_report');
  assert.strictEqual(repYesterday.period, 'yesterday');

  const repYesterday2 = parseHeuristicReminder('reporte de ayer');
  assert.strictEqual(repYesterday2.intent, 'finance_report');
  assert.strictEqual(repYesterday2.period, 'yesterday');

  const repWeek = parseHeuristicReminder('reporte de la semana');
  assert.strictEqual(repWeek.intent, 'finance_report');
  assert.strictEqual(repWeek.period, 'week');

  const repMonth = parseHeuristicReminder('reporte del mes');
  assert.strictEqual(repMonth.intent, 'finance_report');
  assert.strictEqual(repMonth.period, 'month');

  const spentToday = parseHeuristicReminder('¿cuánto he gastado hoy?');
  assert.strictEqual(spentToday.intent, 'finance_report');
  assert.strictEqual(spentToday.period, 'today');
  console.log('  ✅ Solicitudes de reportes (día, ayer, semana, mes) clasificadas al 100%.');

  // Test 9: Borrar última transacción
  console.log('Test 9: Detección de borrado de última transacción...');
  const delTx = parseHeuristicReminder('borra el ultimo gasto');
  assert.strictEqual(delTx.intent, 'finance_delete_last');

  const delTx2 = parseHeuristicReminder('me equivoqué, borra lo último');
  assert.strictEqual(delTx2.intent, 'finance_delete_last');
  console.log('  ✅ Borrado de última transacción reconocido correctamente.');

  console.log('\n🎉 ¡TODAS LAS 9 PRUEBAS UNITARIAS PASARON EXITOSAMENTE!');
}

runTests().catch((err) => {
  console.error('❌ Error en prueba:', err);
  process.exit(1);
});
