const prisma = require('./db');

const DEFAULT_GROQ_KEY = process.env.GROQ_API_KEY || '';

/**
 * Gets the current GROQ_API_KEY dynamically from Prisma Config table.
 * Falls back to process.env if not set in DB yet.
 */
async function getGroqApiKey() {
  try {
    const config = await prisma.config.findUnique({
      where: { key: 'GROQ_API_KEY' },
    });

    if (config && config.value && config.value.trim().length > 0) {
      return config.value.trim();
    }
  } catch (error) {
    console.error('[Config] Error fetching GROQ_API_KEY from database:', error.message);
  }

  return DEFAULT_GROQ_KEY;
}

/**
 * Updates or creates the GROQ_API_KEY in the Config table.
 */
async function setGroqApiKey(newKey) {
  if (!newKey || typeof newKey !== 'string') {
    throw new Error('API Key must be a valid non-empty string');
  }

  const cleanKey = newKey.trim();
  const updated = await prisma.config.upsert({
    where: { key: 'GROQ_API_KEY' },
    update: { value: cleanKey },
    create: {
      key: 'GROQ_API_KEY',
      value: cleanKey,
    },
  });

  return updated;
}

module.exports = {
  getGroqApiKey,
  setGroqApiKey,
};
