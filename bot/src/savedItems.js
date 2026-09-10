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
 * Saves an item (image, link, or note) for a given user.
 */
async function saveUserItem({ userId, type, content, description, mediaData = null, mimeType = null }) {
  try {
    const item = await prisma.savedItem.create({
      data: {
        userId,
        type,
        content: content || '',
        description: description || 'Sin descripción',
        mediaData,
        mimeType,
      },
    });
    console.log(`[SavedItems] Saved item (${type}) id=${item.id} for user=${userId}: "${description}"`);
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
    if (type) {
      where.type = type;
    }

    const items = await prisma.savedItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    if (!items.length) return null;

    if (!query) {
      return items[0]; // If no query, return the most recent one
    }

    const normQuery = normalizeString(query);
    const queryWords = normQuery.split(/\s+/).filter((w) => w.length > 2);

    let bestMatch = null;
    let highestScore = -1;

    for (const item of items) {
      const normDesc = normalizeString(item.description);
      const normContent = normalizeString(item.content);

      let score = 0;
      // Exact or mutual substring match
      if (normDesc.includes(normQuery) || normQuery.includes(normDesc)) {
        score += 10;
      }
      if (normContent.includes(normQuery) || (item.type === 'link' && normQuery.includes(normContent))) {
        score += 5;
      }

      // Individual word matches
      for (const word of queryWords) {
        if (normDesc.includes(word)) score += 3;
        if (normContent.includes(word)) score += 1;
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
 * Lists all saved items for a user.
 */
async function listUserItems({ userId, type = null }) {
  try {
    const where = { userId };
    if (type) {
      where.type = type;
    }

    return await prisma.savedItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  } catch (error) {
    console.error('[SavedItems] Error listing items:', error.message);
    return [];
  }
}

module.exports = {
  saveUserItem,
  findUserItem,
  listUserItems,
  normalizeString,
};
