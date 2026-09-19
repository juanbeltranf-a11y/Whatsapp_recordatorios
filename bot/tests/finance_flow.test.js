const assert = require('assert');
const { formatCurrencyCOP, formatTimeColombia } = require('../src/finance');
const { parseHeuristicReminder } = require('../src/groq');

async function runFlowTest() {
  console.log('🧪 === SIMULACIÓN DE FLUJO CONVERSACIONAL FINANCIERO ===\n');

  // Base de datos simulada en memoria para validar la lógica del flujo de conversación
  const mockDb = {
    users: [{ id: 'user-1', phone: '573001234567@c.us' }],
    userStates: new Map(),
    transactions: [],
  };

  let lastReply = '';
  function mockReply(text) {
    lastReply = text;
  }

  // Simulación del handler que procesa mensajes entrantes (como en whatsapp.js)
  async function simulateIncomingMessage(userText) {
    const userId = 'user-1';
    const cleanLower = userText.toLowerCase().trim();

    // 1. Verificar estado pendiente
    const activeState = mockDb.userStates.get(userId);
    if (activeState) {
      if (cleanLower === 'cancela' || cleanLower === 'cancelar' || cleanLower === 'olvidalo') {
        mockDb.userStates.delete(userId);
        mockReply('❌ Entendido, cancelé el registro pendiente.');
        return;
      }

      if (activeState.state === 'AWAITING_EXPENSE_CONCEPT') {
        const concept = userText.replace(/^(en|de|por|para)\s+/i, '').trim() || userText.trim();
        const tx = {
          id: `tx-${Date.now()}`,
          userId,
          type: 'expense',
          amount: activeState.data.amount,
          description: concept,
          date: new Date(),
        };
        mockDb.transactions.push(tx);
        mockDb.userStates.delete(userId);

        mockReply(`💸 Gasto anotado exitosamente: ${formatCurrencyCOP(tx.amount)} en ${concept}`);
        return;
      }

      if (activeState.state === 'AWAITING_INCOME_CONCEPT') {
        const concept = userText.replace(/^(de|por|en|desde)\s+/i, '').trim() || userText.trim();
        const tx = {
          id: `tx-${Date.now()}`,
          userId,
          type: 'income',
          amount: activeState.data.amount,
          description: concept,
          paymentMethod: activeState.data.paymentMethod,
          date: new Date(),
        };
        mockDb.transactions.push(tx);
        mockDb.userStates.delete(userId);

        mockReply(`💰 Ingreso anotado exitosamente: +${formatCurrencyCOP(tx.amount)} en ${concept}`);
        return;
      }
    }

    // 2. Clasificación
    const analysis = parseHeuristicReminder(userText);
    if (!analysis) {
      mockReply('No entendí el mensaje');
      return;
    }

    if (analysis.intent === 'finance_expense') {
      if (analysis.needsDescription || !analysis.description) {
        mockDb.userStates.set(userId, {
          state: 'AWAITING_EXPENSE_CONCEPT',
          data: { amount: analysis.amount },
        });
        mockReply(`¿En qué te gastaste esos ${formatCurrencyCOP(analysis.amount)}? Cuéntame para anotarlo bien. 📝`);
        return;
      }

      const tx = {
        id: `tx-${Date.now()}`,
        userId,
        type: 'expense',
        amount: analysis.amount,
        description: analysis.description,
        person: analysis.person || null,
        date: new Date(),
      };
      mockDb.transactions.push(tx);
      mockReply(`💸 Gasto anotado: ${formatCurrencyCOP(tx.amount)} en ${tx.description}`);
      return;
    }

    if (analysis.intent === 'finance_income') {
      const tx = {
        id: `tx-${Date.now()}`,
        userId,
        type: 'income',
        amount: analysis.amount,
        description: analysis.description,
        paymentMethod: analysis.paymentMethod,
        date: new Date(),
      };
      mockDb.transactions.push(tx);
      mockReply(`💰 Ingreso anotado: +${formatCurrencyCOP(tx.amount)} (${tx.description})`);
      return;
    }

    if (analysis.intent === 'finance_report') {
      let totalInc = 0;
      let totalExp = 0;
      mockDb.transactions.forEach((t) => {
        if (t.type === 'income') totalInc += t.amount;
        else totalExp += t.amount;
      });
      const net = totalInc - totalExp;
      mockReply(`Reporte: Ingresos ${formatCurrencyCOP(totalInc)} | Egresos ${formatCurrencyCOP(totalExp)} | Balance ${formatCurrencyCOP(net)}`);
      return;
    }

    if (analysis.intent === 'finance_delete_last') {
      const popped = mockDb.transactions.pop();
      if (popped) {
        mockReply(`🗑️ Se eliminó la última transacción: ${formatCurrencyCOP(popped.amount)}`);
      } else {
        mockReply('No hay transacciones para eliminar');
      }
      return;
    }
  }

  // Paso 1: Usuario dice: "Hoy me gaste $100.000" (sin especificar concepto)
  console.log('Paso 1: Usuario dice: "Hoy me gaste $100.000"');
  await simulateIncomingMessage('Hoy me gaste $100.000');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('¿En qué te gastaste esos $100.000?'));
  assert.ok(mockDb.userStates.has('user-1'));

  // Paso 2: Usuario responde con el concepto: "En un pollo"
  console.log('Paso 2: Usuario responde: "En un pollo"');
  await simulateIncomingMessage('En un pollo');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('$100.000 en un pollo'));
  assert.strictEqual(mockDb.userStates.has('user-1'), false);
  assert.strictEqual(mockDb.transactions.length, 1);

  // Paso 3: Usuario dice: "me dieron $10.000 en efectivo"
  console.log('Paso 3: Usuario dice: "me dieron $10.000 en efectivo"');
  await simulateIncomingMessage('me dieron $10.000 en efectivo');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('+$10.000'));
  assert.strictEqual(mockDb.transactions.length, 2);

  // Paso 4: Usuario dice: "me tranfirieron $15.000 a la cuenta"
  console.log('Paso 4: Usuario dice: "me tranfirieron $15.000 a la cuenta"');
  await simulateIncomingMessage('me tranfirieron $15.000 a la cuenta');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('+$15.000'));
  assert.strictEqual(mockDb.transactions.length, 3);

  // Paso 5: Usuario dice: "le di $20.000 a Carlos"
  console.log('Paso 5: Usuario dice: "le di $20.000 a Carlos"');
  await simulateIncomingMessage('le di $20.000 a Carlos');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('$20.000 en le di a Carlos'));
  assert.strictEqual(mockDb.transactions.length, 4);

  // Paso 6: Usuario pide reporte del día
  console.log('Paso 6: Usuario pide: "reporte del dia"');
  await simulateIncomingMessage('reporte del dia');
  console.log('  Bot responde:', lastReply);
  // Ingresos: 10.000 + 15.000 = 25.000
  // Egresos: 100.000 + 20.000 = 120.000
  // Balance: 25.000 - 120.000 = -95.000
  assert.ok(lastReply.includes('Ingresos $25.000'));
  assert.ok(lastReply.includes('Egresos $120.000'));
  assert.ok(lastReply.includes('Balance -$95.000'));

  // Paso 7: Usuario dice: "borra el ultimo gasto"
  console.log('Paso 7: Usuario dice: "borra el ultimo gasto"');
  await simulateIncomingMessage('borra el ultimo gasto');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('Se eliminó la última transacción: $20.000'));
  assert.strictEqual(mockDb.transactions.length, 3);

  // Paso 8: Reporte actualizado
  console.log('Paso 8: Usuario vuelve a pedir: "reporte de hoy"');
  await simulateIncomingMessage('reporte de hoy');
  console.log('  Bot responde:', lastReply);
  assert.ok(lastReply.includes('Egresos $100.000'));
  assert.ok(lastReply.includes('Balance -$75.000'));

  console.log('\n🎉 ¡FLUJO CONVERSACIONAL DE FINANZAS VALIDADO AL 100%!');
}

runFlowTest().catch((err) => {
  console.error('❌ Error en test de flujo:', err);
  process.exit(1);
});
