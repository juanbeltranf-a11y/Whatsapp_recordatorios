const prisma = require('./db');

/**
 * Formatea un monto numérico a formato moneda en Pesos Colombianos (COP)
 * Ej: 100000 -> "$100.000", 15500 -> "$15.500"
 */
function formatCurrencyCOP(amount) {
  const num = Math.round(Number(amount) || 0);
  const formatted = Math.abs(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return num < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Obtiene los límites de fecha (Date objects en UTC) correspondientes
 * al inicio y fin de un período en la zona horaria de Colombia (UTC-5).
 */
function getColombiaDateBounds(period = 'today', customDate = null) {
  // Hora actual en UTC
  const now = customDate ? new Date(customDate) : new Date();

  // Convertir tiempo actual a hora Colombia (UTC - 5 horas)
  const colombiaOffsetMs = -5 * 60 * 60 * 1000;
  const colDate = new Date(now.getTime() + colombiaOffsetMs);

  const year = colDate.getUTCFullYear();
  const month = colDate.getUTCMonth();
  const day = colDate.getUTCDate();
  const dayOfWeek = colDate.getUTCDay(); // 0 = Domingo, 1 = Lunes, etc.

  let startCol, endCol;
  let label = 'Hoy';

  if (period === 'yesterday' || period === 'ayer') {
    startCol = new Date(Date.UTC(year, month, day - 1, 0, 0, 0, 0));
    endCol = new Date(Date.UTC(year, month, day - 1, 23, 59, 59, 999));
    label = 'Ayer';
  } else if (period === 'week' || period === 'semana') {
    // Lunes como inicio de semana (ISO)
    const diffToMonday = (dayOfWeek + 6) % 7;
    startCol = new Date(Date.UTC(year, month, day - diffToMonday, 0, 0, 0, 0));
    endCol = new Date(Date.UTC(year, month, day - diffToMonday + 6, 23, 59, 59, 999));
    label = 'Esta Semana';
  } else if (period === 'month' || period === 'mes') {
    startCol = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    // Último día del mes: día 0 del siguiente mes
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    endCol = new Date(Date.UTC(year, month, lastDay, 23, 59, 59, 999));
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    label = `Mes de ${monthNames[month]}`;
  } else {
    // Hoy por defecto
    startCol = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    endCol = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
    label = 'Hoy';
  }

  // Devolver las fechas convertidas de vuelta al UTC real de la BD
  // Si en Colombia es 00:00, en UTC es +5 horas (05:00)
  const startUtc = new Date(startCol.getTime() - colombiaOffsetMs);
  const endUtc = new Date(endCol.getTime() - colombiaOffsetMs);

  return { startUtc, endUtc, label };
}

/**
 * Formatea una fecha a hora legible en Colombia (ej: "03:45 PM")
 */
function formatTimeColombia(date) {
  const colombiaOffsetMs = -5 * 60 * 60 * 1000;
  const colDate = new Date(new Date(date).getTime() + colombiaOffsetMs);
  let hours = colDate.getUTCHours();
  const minutes = colDate.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 -> 12
  return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
}

/**
 * Registra un movimiento financiero (Ingreso o Egreso)
 */
async function recordTransaction({
  userId,
  type, // "income" | "expense"
  amount,
  description,
  category = null,
  paymentMethod = null,
  person = null,
  date = new Date(),
}) {
  const numericAmount = Math.abs(Number(amount) || 0);
  if (numericAmount <= 0) {
    throw new Error('El monto de la transacción debe ser mayor a cero.');
  }

  const transaction = await prisma.transaction.create({
    data: {
      userId,
      type: type === 'income' ? 'income' : 'expense',
      amount: numericAmount,
      description: description ? description.trim() : (type === 'income' ? 'Ingreso registrado' : 'Gasto registrado'),
      category: category ? category.trim() : null,
      paymentMethod: paymentMethod ? paymentMethod.trim() : null,
      person: person ? person.trim() : null,
      date: new Date(date),
    },
  });

  return transaction;
}

/**
 * Obtiene el estado conversacional pendiente del usuario (si hay una pregunta activa)
 */
async function getUserState({ userId }) {
  try {
    const stateRecord = await prisma.userState.findUnique({
      where: { userId },
    });

    if (!stateRecord) return null;

    // Verificar si el estado no ha caducado (expira en 30 minutos de inactividad)
    const now = new Date();
    const updated = new Date(stateRecord.updatedAt);
    const diffMinutes = (now.getTime() - updated.getTime()) / (1000 * 60);

    if (diffMinutes > 30) {
      await clearUserState({ userId });
      return null;
    }

    return stateRecord;
  } catch (err) {
    console.error('[Finance] Error reading user state:', err.message);
    return null;
  }
}

/**
 * Guarda o actualiza el estado conversacional del usuario
 */
async function setUserState({ userId, state, data = {} }) {
  try {
    return await prisma.userState.upsert({
      where: { userId },
      update: { state, data },
      create: { userId, state, data },
    });
  } catch (err) {
    console.error('[Finance] Error setting user state:', err.message);
  }
}

/**
 * Limpia el estado conversacional del usuario
 */
async function clearUserState({ userId }) {
  try {
    await prisma.userState.deleteMany({
      where: { userId },
    });
  } catch (err) {
    console.error('[Finance] Error clearing user state:', err.message);
  }
}

/**
 * Elimina la última transacción registrada por el usuario
 */
async function deleteLastTransaction({ userId }) {
  const lastTx = await prisma.transaction.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });

  if (!lastTx) {
    return null;
  }

  await prisma.transaction.delete({
    where: { id: lastTx.id },
  });

  return lastTx;
}

/**
 * Genera el reporte financiero para un período dado
 */
async function getFinancialReport({ userId, period = 'today', customDate = null }) {
  const { startUtc, endUtc, label } = getColombiaDateBounds(period, customDate);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: {
        gte: startUtc,
        lte: endUtc,
      },
    },
    orderBy: { date: 'asc' },
  });

  let totalIncome = 0;
  let totalExpense = 0;
  const incomeList = [];
  const expenseList = [];

  for (const tx of transactions) {
    const formattedAmount = formatCurrencyCOP(tx.amount);
    const timeStr = formatTimeColombia(tx.date);
    const extraInfo = [];
    if (tx.paymentMethod) extraInfo.push(tx.paymentMethod);
    if (tx.person) extraInfo.push(`persona: ${tx.person}`);
    const metaSuffix = extraInfo.length > 0 ? ` _(${extraInfo.join(', ')})_` : '';

    if (tx.type === 'income') {
      totalIncome += tx.amount;
      incomeList.push(`• *${formattedAmount}* — ${tx.description}${metaSuffix} _(${timeStr})_`);
    } else {
      totalExpense += tx.amount;
      expenseList.push(`• *${formattedAmount}* — ${tx.description}${metaSuffix} _(${timeStr})_`);
    }
  }

  const netBalance = totalIncome - totalExpense;

  let reportText = `📊 *REPORTE FINANCIERO — ${label.toUpperCase()}*\n`;
  reportText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (transactions.length === 0) {
    reportText += `_No tienes movimientos registrados para este período._\n\n`;
    reportText += `💡 *Ejemplos para registrar:*\n`;
    reportText += `• _"Gasté $10.000 en un pollo"_\n`;
    reportText += `• _"Me transfirieron $15.000 a la cuenta"_\n`;
    reportText += `• _"Le di $20.000 a Carlos"_`;
    return {
      totalIncome: 0,
      totalExpense: 0,
      netBalance: 0,
      transactionsCount: 0,
      reportText,
    };
  }

  if (incomeList.length > 0) {
    reportText += `🟢 *INGRESOS (+${formatCurrencyCOP(totalIncome)}):*\n`;
    reportText += incomeList.join('\n') + '\n\n';
  } else {
    reportText += `🟢 *INGRESOS:* _$0_\n\n`;
  }

  if (expenseList.length > 0) {
    reportText += `🔴 *EGRESOS (-${formatCurrencyCOP(totalExpense)}):*\n`;
    reportText += expenseList.join('\n') + '\n\n';
  } else {
    reportText += `🔴 *EGRESOS:* _$0_\n\n`;
  }

  reportText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  reportText += `📈 *Total Ingresos:* +${formatCurrencyCOP(totalIncome)}\n`;
  reportText += `📉 *Total Egresos:*  -${formatCurrencyCOP(totalExpense)}\n`;
  
  const balanceEmoji = netBalance >= 0 ? '💰' : '⚠️';
  const balanceSign = netBalance >= 0 ? '+' : '';
  reportText += `${balanceEmoji} *Balance Neto:*    ${balanceSign}${formatCurrencyCOP(netBalance)}\n`;
  reportText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  reportText += `_Movimientos registrados: ${transactions.length}_`;

  return {
    totalIncome,
    totalExpense,
    netBalance,
    transactionsCount: transactions.length,
    reportText,
  };
}

module.exports = {
  formatCurrencyCOP,
  getColombiaDateBounds,
  formatTimeColombia,
  recordTransaction,
  getUserState,
  setUserState,
  clearUserState,
  deleteLastTransaction,
  getFinancialReport,
};
