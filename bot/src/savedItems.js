const prisma = require('./db');

/**
 * Normalizes text for better matching (lowercase, strips accents)
 */
function normalizeString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Saves an item (text/data, image, or link) for a given user.
 */
async function saveUserItem({ userId, type, content, description, mediaData = null, mimeType = null }) {
  try {
    const finalContent = content || '';
    let finalDesc = description;

    if (!finalDesc || finalDesc.trim() === '' || finalDesc.toLowerCase() === 'sin descripcion' || finalDesc.toLowerCase() === 'nota') {
      // Extract first meaningful line or phrase
      const lines = finalContent.split('\n').map(l => l.trim()).filter(Boolean);
      finalDesc = lines[0] ? lines[0].substring(0, 60) : 'Dato guardado';
    }

    const item = await prisma.savedItem.create({
      data: {
        userId,
        type: type || 'text',
        content: finalContent,
        description: finalDesc.trim(),
        mediaData,
        mimeType,
      },
    });
    console.log(`[SavedItems] Saved item (${item.type}) id=${item.id} for user=${userId}: "${item.description}"`);
    return item;
  } catch (error) {
    console.error('[SavedItems] Error saving item:', error.message);
    throw error;
  }
}

/**
 * Finds the best matching saved item for a user given a search query.
 */
async function findUserItem({ userId, query, type = null }) {
  try {
    const where = { userId };
    if (type && type !== 'all') {
      where.type = type;
    }

    const items = await prisma.savedItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (!items.length) return null;

    if (!query || query.trim() === '') {
      return items[0]; // Most recent item if no query provided
    }

    const normQuery = normalizeString(query);
    const queryWords = normQuery.split(/[\s,.-]+/).filter((w) => w.length >= 2);
    const queryNumbers = query.match(/\d+/g) || [];

    let bestMatch = null;
    let highestScore = -1;

    for (const item of items) {
      const normDesc = normalizeString(item.description);
      const normContent = normalizeString(item.content);

      let score = 0;

      // Exact phrase match
      if (normDesc.includes(normQuery)) score += 25;
      if (normContent.includes(normQuery)) score += 20;

      // Exact number matches (e.g. cédula, teléfono, código)
      for (const num of queryNumbers) {
        if (normContent.includes(num)) score += 30;
        if (normDesc.includes(num)) score += 30;
      }

      // Keyword matches
      for (const word of queryWords) {
        if (normDesc.includes(word)) score += 8;
        if (normContent.includes(word)) score += 5;
      }

      if (score > highestScore && score > 0) {
        highestScore = score;
        bestMatch = item;
      }
    }

    return bestMatch;
  } catch (error) {
    console.error('[SavedItems] Error finding item:', error.message);
    return null;
  }
}

/**
 * Deletes a saved item for a user by query match or id.
 */
async function deleteUserItem({ userId, query, id = null }) {
  try {
    let targetItem = null;
    if (id) {
      targetItem = await prisma.savedItem.findFirst({ where: { id, userId } });
    } else if (query) {
      targetItem = await findUserItem({ userId, query });
    }

    if (!targetItem) return null;

    await prisma.savedItem.delete({
      where: { id: targetItem.id },
    });

    console.log(`[SavedItems] Deleted item id=${targetItem.id} ("${targetItem.description}") for user=${userId}`);
    return targetItem;
  } catch (error) {
    console.error('[SavedItems] Error deleting item:', error.message);
    throw error;
  }
}

/**
 * Lists all saved items for a user.
 */
async function listUserItems({ userId, type = null }) {
  try {
    const where = { userId };
    if (type && type !== 'all') {
      where.type = type;
    }

    return await prisma.savedItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  } catch (error) {
    console.error('[SavedItems] Error listing items:', error.message);
    return [];
  }
}

/**
 * Formats user saved items into a clear readable WhatsApp message.
 */
function formatSavedItemsList(items) {
  if (!items || items.length === 0) {
    return `📂 Aún no tienes ningún dato guardado.\n\nPuedes enviarme cualquier información para que la recuerde, por ejemplo:\n• _"Guárdame estos datos: 36155047 Elvira Reyes, cédula de la vecina"_\n• _"Guárdame esta foto de donde vivo"_\n• _"Guarda este enlace"_.`;
  }

  const textNotes = items.filter((i) => i.type !== 'image' && i.type !== 'link');
  const images = items.filter((i) => i.type === 'image');
  const links = items.filter((i) => i.type === 'link');

  let message = `📂 *TUS DATOS Y ELEMENTOS GUARDADOS:*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (textNotes.length > 0) {
    message += `📋 *Datos y Notas:* (${textNotes.length})\n`;
    textNotes.forEach((item, index) => {
      message += `${index + 1}. 📌 *${item.description}*\n   ${item.content.split('\n').join('\n   ')}\n\n`;
    });
  }

  if (images.length > 0) {
    message += `📸 *Imágenes:* (${images.length})\n`;
    images.forEach((img, index) => {
      message += `${index + 1}. *${img.description}*\n`;
    });
    message += `\n`;
  }

  if (links.length > 0) {
    message += `🔗 *Enlaces:* (${links.length})\n`;
    links.forEach((l, index) => {
      message += `${index + 1}. *${l.description}*:\n   ${l.content}\n`;
    });
    message += `\n`;
  }

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💡 *¿Cómo consultarlos?*\n• Pregúntame directamente: _"¿Cuál es la cédula de la vecina?"_ o _"Pásame los datos de Elvira"_\n• _"Borra el dato de [nombre]"_`;

  return message.trim();
}

module.exports = {
  saveUserItem,
  findUserItem,
  deleteUserItem,
  listUserItems,
  formatSavedItemsList,
  normalizeString,
};
