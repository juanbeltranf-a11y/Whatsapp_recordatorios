const express = require('express');
const cors = require('cors');
const prisma = require('./db');
const { getBotState, getClient } = require('./whatsapp');
const { getGroqApiKey, setGroqApiKey } = require('./config');

function createServer() {
  const app = express();

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json());

  // Inspect all browser pages and targets
  app.get('/api/debug-browser', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupBrowser) return res.json({ error: 'no browser' });
      const pages = await client.pupBrowser.pages();
      const targets = client.pupBrowser.targets().map(t => ({
        type: t.type(),
        url: t.url(),
      }));
      const pageDetails = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        let title = 'timeout';
        try {
          title = await Promise.race([
            p.title(),
            new Promise((_, r) => setTimeout(() => r('title timeout'), 2000))
          ]);
        } catch (e) { title = e.message; }
        pageDetails.push({
          index: i,
          url: p.url(),
          title,
          isPupPage: p === client.pupPage,
        });
      }
      res.json({
        browserConnected: client.pupBrowser.isConnected(),
        targets,
        pageDetails,
      });
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  // Deep diagnostic endpoint to inspect WhatsApp Web internal state
  app.get('/api/test-eval', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupPage) {
        return res.status(503).json({ error: 'client or pupPage not available' });
      }

      const result = await Promise.race([
        client.pupPage.evaluate(() => {
          try {
            const hasWWebJS = typeof window.WWebJS !== 'undefined';
            const hasRequire = typeof window.require !== 'undefined';
            let chatCount = 0;
            let unreadList = [];

            if (window.Store && window.Store.Chat) {
              chatCount = window.Store.Chat.models?.length || 0;
              unreadList = window.Store.Chat.models
                ?.filter(c => (c.unreadCount || 0) > 0)
                ?.slice(0, 10)
                ?.map(c => ({
                  id: c.id?._serialized,
                  name: c.formattedTitle || c.name,
                  unread: c.unreadCount,
                  lastMsg: c.lastReceivedKey?._serialized || null,
                })) || [];
            }

            return {
              title: document.title,
              url: location.href,
              hasWWebJS,
              hasRequire,
              chatCount,
              unreadList,
              botWID: window.Store?.User?.getMaybeMeUser?.()?._serialized || null,
            };
          } catch (e) {
            return { evalError: e.message, stack: e.stack };
          }
        }),
        new Promise((_, r) => setTimeout(() => r(new Error('evaluate timed out after 6s')), 6000))
      ]);

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Diagnostic endpoint
  app.get('/api/diag', async (req, res) => {
    try {
      const client = getClient();
      let clientState = 'none';
      let pageResponsive = false;
      if (client) {
        try {
          clientState = await Promise.race([
            client.getState(),
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
          ]);
        } catch (e) {
          clientState = 'error: ' + e.message;
        }

        try {
          pageResponsive = await Promise.race([
            client.pupPage ? client.pupPage.evaluate(() => document.readyState) : false,
            new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
          ]);
        } catch (e) {
          pageResponsive = 'error: ' + e.message;
        }
      }

        let sysInfo = {};
        try {
          const { execSync } = require('child_process');
          sysInfo.df = execSync('df -h').toString();
          sysInfo.ps = execSync('ps aux').toString();
        } catch (e) {
          sysInfo.error = e.message;
        }

        res.json({
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          clientState,
          pageResponsive,
          botState: getBotState(),
          sysInfo,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

  // Visual Inspection Endpoint: Returns live screenshot of Puppeteer page
  app.get('/api/screenshot', async (req, res) => {
    try {
      const client = getClient();
      if (!client || !client.pupPage || client.pupPage.isClosed()) {
        return res.status(503).send('Puppeteer page not available');
      }

      const imgBuffer = await Promise.race([
        client.pupPage.screenshot({ type: 'png' }),
        new Promise((_, r) => setTimeout(() => r(new Error('Screenshot timed out after 5s')), 5000))
      ]);

      res.set('Content-Type', 'image/png');
      res.send(imgBuffer);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Test send endpoint to verify outbound messaging directly
  app.get('/api/send-test', async (req, res) => {
    try {
      const client = getClient();
      const { to, text } = req.query;
      if (!client) return res.status(503).json({ error: 'No client' });
      if (!to || !text) return res.status(400).json({ error: 'Missing to or text query param' });

      const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
      const result = await Promise.race([
        client.sendMessage(chatId, text),
        new Promise((_, r) => setTimeout(() => r(new Error('sendMessage timed out after 10s')), 10000))
      ]);
      res.json({ success: true, id: result?.id?._serialized || 'delivered' });
    } catch (err) {
      res.status(500).json({ error: err.message, stack: err.stack });
    }
  });

  // Status
  app.get('/api/status', (req, res) => {
    const state = getBotState();
    res.json({
      status: state.status,
      phone: state.phone,
      pushname: state.pushname,
      lastUpdated: state.lastUpdated,
    });
  });

  // QR
  app.get('/api/qr', (req, res) => {
    const state = getBotState();
    res.json({
      status: state.status,
      qr: state.qr,
    });
  });

  // Config
  app.get('/api/config', async (req, res) => {
    try {
      const fullKey = await getGroqApiKey();
      const maskedKey = fullKey && fullKey.length > 8
        ? `${fullKey.slice(0, 6)}...${fullKey.slice(-4)}`
        : '***';

      res.json({
        groqApiKeyMasked: maskedKey,
        isConfigured: Boolean(fullKey && fullKey.startsWith('gsk_')),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return res.status(400).json({ error: 'La API Key de Groq no puede estar vacía' });
      }

      await setGroqApiKey(apiKey.trim());
      res.json({ success: true, message: 'GROQ_API_KEY actualizada exitosamente en la base de datos' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Users endpoint
  app.get('/api/users', async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        take: 50,
      });
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reminders
  app.get('/api/reminders', async (req, res) => {
    try {
      const reminders = await prisma.reminder.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { phone: true },
          },
        },
        take: 100,
      });

      res.json(reminders);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/reminders/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { cancelReminderJobs } = require('./scheduler');
      cancelReminderJobs(id);
      await prisma.reminder.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reminder types endpoint
  app.get('/api/reminders/types', (req, res) => {
    const { getReminderTypesInfo } = require('./reminderManager');
    res.json({
      types: [
        {
          id: 'exact',
          name: 'Puntual (De una sola vez)',
          icon: '⏰',
          description: 'Para fechas y horas fijas. Incluye pre-alertas automáticas 24h antes y 1h antes.',
          example: 'Recuérdame pagar el recibo mañana a las 3pm'
        },
        {
          id: 'daily',
          name: 'Recurrente Diario',
          icon: '🔄',
          description: 'Se repite todos los días a la misma hora.',
          example: 'Recuérdame todos los días a las 8am tomar vitaminas'
        },
        {
          id: 'weekly',
          name: 'Recurrente Semanal',
          icon: '📅',
          description: 'Se repite días específicos de la semana.',
          example: 'Recuérdame los lunes a las 9am reunión de equipo'
        },
        {
          id: 'relative',
          name: 'Relativo / Cuenta Regresiva',
          icon: '⏳',
          description: 'Avisos en minutos u horas.',
          example: 'Recuérdame en 25 minutos sacar el pollo del horno'
        }
      ],
      infoText: getReminderTypesInfo()
    });
  });

  // Transactions endpoint
  app.get('/api/transactions', async (req, res) => {
    try {
      const { userId, type, limit = 50 } = req.query;
      const where = {};
      if (userId) where.userId = userId;
      if (type) where.type = type;

      const transactions = await prisma.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        take: parseInt(limit, 10) || 50,
        include: {
          user: {
            select: { phone: true },
          },
        },
      });

      res.json(transactions);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Financial report endpoint
  app.get('/api/transactions/report', async (req, res) => {
    try {
      const { userId, period = 'today' } = req.query;
      if (!userId) {
        return res.status(400).json({ error: 'Falta el parámetro userId' });
      }

      const { getFinancialReport } = require('./finance');
      const report = await getFinancialReport({ userId, period });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/transactions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await prisma.transaction.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = { createServer };
