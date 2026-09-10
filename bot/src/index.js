require('dotenv').config();
const { createServer } = require('./server');
const { initWhatsAppClient } = require('./whatsapp');
const prisma = require('./db');

const PORT = process.env.PORT || 3001;

async function start() {
  console.log('--- Starting WhatsApp Bot & Reminder Engine ---');

  // Verify database connection
  try {
    await prisma.$connect();
    console.log('[Prisma] Database connected successfully.');
  } catch (dbErr) {
    console.error('[Prisma] Database connection error:', dbErr.message);
  }

  // Start Express API server
  const app = createServer();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Express] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[Express] QR endpoint: http://localhost:${PORT}/api/qr`);
    console.log(`[Express] Status endpoint: http://localhost:${PORT}/api/status`);
  });

  // Initialize WhatsApp Web client
  initWhatsAppClient();
}

start().catch((err) => {
  console.error('[App] Fatal startup error:', err);
  process.exit(1);
});
