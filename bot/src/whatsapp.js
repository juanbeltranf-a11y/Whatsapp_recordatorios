const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const prisma = require('./db');
const { parseUserMessage } = require('./groq');
const { scheduleReminder, initScheduler } = require('./scheduler');
const { saveUserItem, findUserItem, listUserItems } = require('./savedItems');
const { transcribeAudio } = require('./audioTranscriber');
const { downloadSong } = require('./music');
const { downloadSocialMedia, identifyPlatform } = require('./socialDownloader');

const botState = {
  status: 'DISCONNECTED',
  qr: null,
  phone: null,
  pushname: null,
  lastUpdated: new Date().toISOString(),
};

let clientInstance = null;
const processedMessageIds = new Set();
const botSentTexts = new Set();

const messageQueue = [];
let isProcessingQueue = false;
let keepAliveTimer = null;

function getBotState() {
  return botState;
}

function getClient() {
  return clientInstance;
}

function cleanupSingletonLocks(sessionDir) {
  try {
    if (!fs.existsSync(sessionDir)) return;
    const items = fs.readdirSync(sessionDir);
    for (const item of items) {
      if (item.startsWith('Singleton')) {
        const fullPath = path.join(sessionDir, item);
        try {
          fs.unlinkSync(fullPath);
          console.log(`[WhatsApp] Cleaned lock file: ${item}`);
        } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('[WhatsApp] Error during lock cleanup:', err.message);
  }
}

async function safeDownloadMedia(client, msg) {
  if (!msg || !msg.hasMedia) return null;

  const shortId = msg.id?.id || (typeof msg.id === 'string' ? msg.id : '');
  const fullId = msg.id?._serialized || (typeof msg.id === 'object' ? `${msg.id.fromMe || false}_${msg.id.remote}_${msg.id.id}` : shortId);
  const chatId = msg.from || (msg.id?.remote) || '';

  const mediaParams = {
    directPath: msg.rawData?.directPath || msg.directPath,
    encFilehash: msg.rawData?.encFilehash || msg.encFilehash,
    filehash: msg.rawData?.filehash || msg.filehash,
    mediaKey: msg.rawData?.mediaKey || msg.mediaKey,
    mediaKeyTimestamp: msg.rawData?.mediaKeyTimestamp || msg.mediaKeyTimestamp,
    type: msg.rawData?.type || msg.type,
    mimetype: msg.rawData?.mimetype || msg.mimetype,
    filename: msg.rawData?.filename || msg.filename || null,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[WhatsApp] 📥 safeDownloadMedia for ${shortId} (attempt ${attempt}/2)...`);
      
      const evalPromise = client.pupPage.evaluate(async (sId, fId, cId, params) => {
        try {
          const collections = window.require('WAWebCollections');
          let msgModel = null;
          
          if (collections?.Msg) {
            msgModel = collections.Msg.get(fId) || collections.Msg.get(sId);
            if (!msgModel && collections.Msg.models) {
              msgModel = collections.Msg.models.find(m => m.id?.id === sId || m.id?._serialized === fId);
            }
          }

          if (!msgModel && collections?.Chat) {
            const chat = collections.Chat.get(cId);
            if (chat && chat.msgs?.models) {
              msgModel = chat.msgs.models.find(m => m.id?.id === sId || m.id?._serialized === fId);
            }
            if (!msgModel && collections.Chat.models) {
              for (const ch of collections.Chat.models) {
                if (ch.msgs?.models) {
                  msgModel = ch.msgs.models.find(m => m.id?.id === sId || m.id?._serialized === fId);
                  if (msgModel) break;
                }
              }
            }
          }

          const directPath = msgModel?.directPath || params.directPath;
          const encFilehash = msgModel?.encFilehash || params.encFilehash;
          const filehash = msgModel?.filehash || params.filehash;
          const mediaKey = msgModel?.mediaKey || params.mediaKey;
          const mediaKeyTimestamp = msgModel?.mediaKeyTimestamp || params.mediaKeyTimestamp;
          const type = msgModel?.type || params.type;
          const mimetype = msgModel?.mimetype || params.mimetype;
          const filename = msgModel?.filename || params.filename;

          if (!directPath || !mediaKey) {
            return { error: `Missing directPath (${!!directPath}) or mediaKey (${!!mediaKey})` };
          }

          const downloadManager = window.require('WAWebDownloadManager')?.downloadManager;
          if (!downloadManager || typeof downloadManager.downloadAndMaybeDecrypt !== 'function') {
            return { error: 'WAWebDownloadManager not found' };
          }

          const mockQpl = {
            addAnnotations: function () { return this; },
            addPoint: function () { return this; },
          };

          const abortController = new AbortController();
          const abortTimeout = setTimeout(() => abortController.abort(), 7000);

          let decryptedMedia;
          try {
            decryptedMedia = await Promise.race([
              downloadManager.downloadAndMaybeDecrypt({
                directPath,
                encFilehash,
                filehash,
                mediaKey,
                mediaKeyTimestamp,
                type,
                signal: abortController.signal,
                downloadQpl: mockQpl,
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Decrypt timed out')), 6500)),
            ]);
          } finally {
            clearTimeout(abortTimeout);
          }

          if (!decryptedMedia) {
            return { error: 'Decrypted media is empty' };
          }

          const data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
          return {
            data,
            mimetype,
            filename,
          };
        } catch (innerErr) {
          return { error: String(innerErr?.message || innerErr) };
        }
      }, shortId, fullId, chatId, mediaParams);

      const res = await Promise.race([
        evalPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timeout')), 9000)),
      ]);

      if (res && res.data) {
        console.log(`[WhatsApp] ✅ safeDownloadMedia succeeded (${res.mimetype}) for ${shortId}`);
        return new MessageMedia(res.mimetype, res.data, res.filename);
      } else {
        console.warn(`[WhatsApp] safeDownloadMedia attempt ${attempt} for ${shortId} failed:`, res?.error);
      }
    } catch (err) {
      console.warn(`[WhatsApp] safeDownloadMedia attempt ${attempt} evaluate error:`, err.message);
    }

    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  // Fast fallback to native msg.downloadMedia() with 4-second timeout
  try {
    const fallbackMedia = await Promise.race([
      msg.downloadMedia(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('msg.downloadMedia timeout')), 4000)),
    ]);
    if (fallbackMedia && fallbackMedia.data) {
      console.log(`[WhatsApp] ✅ Native fallback msg.downloadMedia succeeded for ${shortId}`);
      return fallbackMedia;
    }
  } catch (err) {
    console.warn('[WhatsApp] Fallback msg.downloadMedia failed:', err.message);
  }

  return null;
}

async function handleIncomingMessage(msg) {
  if (!msg) return;

  // Reject groups and status broadcasts
  if (msg.from && (msg.from.endsWith('@g.us') || msg.from.includes('broadcast'))) return;
  if (msg.to && (msg.to.endsWith('@g.us') || msg.to.includes('broadcast'))) return;
  if (msg.isStatus || msg.broadcast) return;

  const msgId = msg.id?._serialized || msg.id?.id;
  if (msgId && processedMessageIds.has(msgId)) {
    return;
  }
  if (msgId) {
    processedMessageIds.add(msgId);
    if (processedMessageIds.size > 2000) {
      const oldest = processedMessageIds.values().next().value;
      processedMessageIds.delete(oldest);
    }
  }

  const myNumber = clientInstance?.info?.wid?.user;
  const fromId = msg.from || '';
  const toId = msg.to || '';

  const isSelfChat = msg.fromMe && myNumber && (fromId.includes(myNumber) && toId.includes(myNumber));

  if (msg.fromMe && !isSelfChat) {
    return;
  }

  const senderIdentifier = isSelfChat ? myNumber : msg.from;
  let chatId = senderIdentifier;
  if (!chatId.includes('@')) {
    chatId = `${senderIdentifier.replace(/\D/g, '')}@c.us`;
  }

  let userText = (msg.body || '').trim();
  let downloadedMedia = null;
  let isAudioInput = false;

  // 1. Audio handling (Voice notes / PTT)
  if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
    console.log(`[WhatsApp] 🎙️ Received voice note/audio from ${senderIdentifier}`);
    try {
      downloadedMedia = await safeDownloadMedia(clientInstance, msg);
      if (downloadedMedia && downloadedMedia.data) {
        const transcription = await transcribeAudio(downloadedMedia.data, downloadedMedia.mimetype);
        if (transcription) {
          userText = transcription;
          isAudioInput = true;
          console.log(`[WhatsApp] 🎙️ Audio transcribed: "${userText}"`);
        } else {
          await msg.reply('🎙️ No pude escuchar con claridad el audio, ¿podrías repetírmelo o escribírmelo?');
          return;
        }
      } else {
        await msg.reply('⚠️ No pude procesar el archivo de audio. Por favor intenta de nuevo.');
        return;
      }
    } catch (audioErr) {
      console.error('[WhatsApp] Error processing incoming audio:', audioErr.message);
      await msg.reply('⚠️ Hubo un problema al procesar la nota de voz. Por favor intenta de nuevo.');
      return;
    }
  }

  // 2. Image handling
  let isImageInput = false;
  if (msg.hasMedia && msg.type === 'image') {
    console.log(`[WhatsApp] 📸 Received image from ${senderIdentifier}`);
    isImageInput = true;
    try {
      downloadedMedia = await safeDownloadMedia(clientInstance, msg);
    } catch (mediaErr) {
      console.warn('[WhatsApp] Error downloading image media:', mediaErr.message);
    }
  }

  if (!userText && !isImageInput) {
    return;
  }

  if (botSentTexts.has(userText)) {
    return;
  }

  console.log(`[WhatsApp] 📩 Processing incoming: "${userText}" (hasImage: ${isImageInput}, isAudio: ${isAudioInput}) from ${senderIdentifier}`);

  // Find or create User in Prisma
  let user = await prisma.user.findUnique({
    where: { phone: senderIdentifier },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { phone: senderIdentifier },
    });
  }

  // Analyze intent with Groq
  const analysis = await parseUserMessage(userText, {
    hasMedia: isImageInput,
    mediaType: isImageInput ? 'image' : (isAudioInput ? 'audio' : null),
  });

  console.log(`[WhatsApp] 🤖 Intent: ${analysis.intent} | Reply: "${analysis.responseMessage.slice(0, 50)}..."`);

  const audioPrefix = isAudioInput ? `🎙️ _"${userText}"_\n\n` : '';

  try {
    // A. MUSIC INTENT
    if (analysis.intent === 'music') {
      const songQuery = analysis.query || userText.replace(/^(enviame|mandame|pon|descarga)\s+(la\s+)?(cancion\s+)?/i, '').trim();
      
      const ackMsg = `${audioPrefix}🎵 Buscando y descargando *" ${songQuery} "* en audio, dame unos segundos...`;
      botSentTexts.add(ackMsg.trim());
      await msg.reply(ackMsg);

      // Download and send in background
      downloadSong(songQuery)
        .then(async (result) => {
          try {
            await clientInstance.sendMessage(chatId, result.media, { sendAudioAsVoice: false });
            console.log(`[WhatsApp] 🎶 Song "${result.title}" sent to ${chatId}`);
          } catch (sendMusicErr) {
            console.error('[WhatsApp] Error sending music media:', sendMusicErr.message);
            await clientInstance.sendMessage(chatId, `⚠️ No se pudo enviar el archivo de audio de "${result.title}".`);
          }
        })
        .catch(async (musicErr) => {
          console.error('[WhatsApp] Music download failed:', musicErr.message);
          await clientInstance.sendMessage(chatId, `⚠️ ${musicErr.message || 'No se pudo descargar la canción solicitada.'}`);
        });

      return;
    }

    // A2. SOCIAL MEDIA DOWNLOAD INTENT (TikTok, Instagram, Facebook, etc.)
    if (analysis.intent === 'social_media_download') {
      const targetUrl = analysis.linkUrl || (userText.match(/https?:\/\/[^\s]+/i) || [])[0];
      if (!targetUrl) {
        await msg.reply(`${audioPrefix}⚠️ Por favor envía o incluye el enlace de TikTok, Instagram o Facebook que deseas descargar.`);
        return;
      }

      const platform = identifyPlatform(targetUrl);
      const ackMsg = `${audioPrefix}📥 Descargando contenido de *${platform}*, dame unos segundos...`;
      botSentTexts.add(ackMsg.trim());
      await msg.reply(ackMsg);

      // Download and send in background
      downloadSocialMedia(targetUrl)
        .then(async (result) => {
          try {
            const caption = result.title ? `🎬 *${result.platform}*\n_${result.title}_` : `🎬 *${result.platform}*`;
            await clientInstance.sendMessage(chatId, result.media, {
              sendMediaAsDocument: false,
              caption,
            });
            console.log(`[WhatsApp] 🎬 ${result.platform} media sent to ${chatId}`);
          } catch (sendSocialErr) {
            console.error('[WhatsApp] Error sending social media:', sendSocialErr.message);
            await clientInstance.sendMessage(chatId, `⚠️ No se pudo enviar el archivo descargado de ${result.platform}.`);
          }
        })
        .catch(async (socialErr) => {
          console.error('[WhatsApp] Social media download failed:', socialErr.message);
          await clientInstance.sendMessage(chatId, `⚠️ ${socialErr.message || 'No se pudo descargar el contenido de la red social.'}`);
        });

      return;
    }

    // B. SAVE ITEM INTENT (Image, Link, or Note)
    if (analysis.intent === 'save_item' || (isImageInput && userText.toLowerCase().includes('guarda'))) {
      const isImg = isImageInput || analysis.itemType === 'image';
      const urlMatch = userText.match(/https?:\/\/[^\s]+/i);
      const isLink = !isImg && (analysis.itemType === 'link' || !!urlMatch);

      const description = analysis.description || userText.replace(/guarda(me)?(\s+este|\s+esta|\s+el)?\s*(enlace|link|imagen|foto)?/gi, '').trim() || (isImg ? 'Foto' : 'Enlace');

      if (isImg) {
        if (!downloadedMedia) {
          downloadedMedia = await safeDownloadMedia(clientInstance, msg);
        }

        if (downloadedMedia && downloadedMedia.data) {
          await saveUserItem({
            userId: user.id,
            type: 'image',
            content: 'image',
            description,
            mediaData: downloadedMedia.data,
            mimeType: downloadedMedia.mimetype,
          });

          const reply = `${audioPrefix}📸 ¡Listo! Guardé tu imagen como *"${description}"*.\n\nCuando la quieras de vuelta, solo dime: _"Pásame la imagen de ${description}"_.`;
          botSentTexts.add(reply.trim());
          await msg.reply(reply);
          return;
        } else {
          const reply = `${audioPrefix}⚠️ No pude descargar la imagen adjunta para guardarla. Por favor intenta enviarla de nuevo.`;
          botSentTexts.add(reply.trim());
          await msg.reply(reply);
          return;
        }
      } else if (isLink) {
        const linkUrl = analysis.linkUrl || (urlMatch ? urlMatch[0] : userText);
        await saveUserItem({
          userId: user.id,
          type: 'link',
          content: linkUrl,
          description,
        });

        const reply = `${audioPrefix}🔗 ¡Listo! Guardé tu enlace como *"${description}"*:\n${linkUrl}\n\nCuando lo necesites, pídemelo con: _"Pásame el enlace de ${description}"_.`;
        botSentTexts.add(reply.trim());
        await msg.reply(reply);
        return;
      }
    }

    // C. GET ITEM INTENT (Retrieve saved item)
    if (analysis.intent === 'get_item') {
      const searchQuery = analysis.query || userText.replace(/^(pasame|dame|muestrame|cual\s+es|busca)\s+(la\s+imagen|la\s+foto|el\s+enlace|el\s+link)?\s*(de\s+|del\s+)?/i, '').trim();
      const itemType = analysis.itemType === 'all' ? null : analysis.itemType;

      const item = await findUserItem({
        userId: user.id,
        query: searchQuery,
        type: itemType,
      });

      if (!item) {
        const reply = `${audioPrefix}🔍 No encontré nada guardado relacionado con *"${searchQuery}"*.\n\nPuedes escribir *"¿Qué tengo guardado?"* para ver tu lista.`;
        botSentTexts.add(reply.trim());
        await msg.reply(reply);
        return;
      }

      if (item.type === 'image' && item.mediaData) {
        const media = new MessageMedia(item.mimeType || 'image/jpeg', item.mediaData, 'imagen.jpg');
        await clientInstance.sendMessage(chatId, media, {
          caption: `${audioPrefix}📸 Aquí tienes la imagen de *"${item.description}"*:`,
        });
        return;
      } else if (item.type === 'link') {
        const reply = `${audioPrefix}🔗 Aquí tienes tu enlace de *"${item.description}"*:\n${item.content}`;
        botSentTexts.add(reply.trim());
        await msg.reply(reply);
        return;
      } else {
        const reply = `${audioPrefix}📝 *${item.description}:*\n${item.content}`;
        botSentTexts.add(reply.trim());
        await msg.reply(reply);
        return;
      }
    }

    // D. LIST ITEMS INTENT
    if (analysis.intent === 'list_items') {
      const items = await listUserItems({ userId: user.id });
      if (!items.length) {
        const reply = `${audioPrefix}📂 Aún no tienes nada guardado.\n\nPuedes enviarme fotos o enlaces diciendo por ejemplo: _"Guárdame esta foto de donde vivo"_ o _"Guarda este enlace"_.`;
        botSentTexts.add(reply.trim());
        await msg.reply(reply);
        return;
      }

      let textList = `${audioPrefix}📂 *Tus elementos guardados:*\n\n`;
      const images = items.filter((i) => i.type === 'image');
      const links = items.filter((i) => i.type === 'link');
      const others = items.filter((i) => i.type !== 'image' && i.type !== 'link');

      if (images.length) {
        textList += `📸 *Imágenes:*\n`;
        images.forEach((img) => {
          textList += `• "${img.description}"\n`;
        });
        textList += `\n`;
      }

      if (links.length) {
        textList += `🔗 *Enlaces:*\n`;
        links.forEach((l) => {
          textList += `• "${l.description}": ${l.content}\n`;
        });
        textList += `\n`;
      }

      if (others.length) {
        textList += `📝 *Notas:*\n`;
        others.forEach((o) => {
          textList += `• "${o.description}": ${o.content}\n`;
        });
        textList += `\n`;
      }

      textList += `_Para pedir cualquiera, dime por ejemplo: "Pásame la imagen de [nombre]" o "Pásame el enlace de [nombre]"_`;
      botSentTexts.add(textList.trim());
      await msg.reply(textList);
      return;
    }

    // E. REMINDER INTENT (Single or Multiple)
    if (analysis.intent === 'reminder') {
      const remindersToSchedule = (analysis.reminders && analysis.reminders.length > 0)
        ? analysis.reminders
        : (analysis.extractedDate ? [{
            text: userText,
            extractedDate: analysis.extractedDate,
            recurringDays: analysis.recurringDays,
            isRecurring: !!analysis.recurringDays,
          }] : []);

      for (const rem of remindersToSchedule) {
        if (!rem.extractedDate) continue;
        const targetDate = new Date(rem.extractedDate);

        if (!isNaN(targetDate.getTime())) {
          const reminder = await prisma.reminder.create({
            data: {
              texto: rem.text || userText,
              targetDate,
              status: 'pending',
              isRecurring: rem.recurringDays !== null && rem.recurringDays > 0,
              recurrenceDays: rem.recurringDays,
              userId: user.id,
              scheduledAlerts: [],
            },
            include: { user: true },
          });

          scheduleReminder(reminder, clientInstance);
          console.log(`[WhatsApp] ⏰ Scheduled reminder "${rem.text}" for ${targetDate.toISOString()}`);
        }
      }
    }

    // F. VENTING, OTHER, OR REMINDER CONFIRMATION REPLY
    const replyText = `${audioPrefix}${analysis.responseMessage}`;
    botSentTexts.add(replyText.trim());
    if (botSentTexts.size > 500) {
      const oldest = botSentTexts.values().next().value;
      botSentTexts.delete(oldest);
    }

    await msg.reply(replyText);
    console.log(`[WhatsApp] ✅ Replied to ${senderIdentifier}: "${replyText.slice(0, 40)}..."`);
  } catch (err) {
    console.error(`[WhatsApp] Error handling intent ${analysis.intent}:`, err.message);
    await msg.reply(`${audioPrefix}Ocurrió un pequeño inconveniente al procesar tu solicitud. Por favor intenta de nuevo.`);
  }
}

function enqueueMessage(msg) {
  if (msg.from && (msg.from.endsWith('@g.us') || msg.from.includes('broadcast'))) return;
  if (msg.to && (msg.to.endsWith('@g.us') || msg.to.includes('broadcast'))) return;

  messageQueue.push(msg);
  processQueue();
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    while (messageQueue.length > 0) {
      const nextMsg = messageQueue.shift();
      try {
        // Enforce 25-second timeout per message
        await Promise.race([
          handleIncomingMessage(nextMsg),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Processing timeout')), 25000)),
        ]);
        // 1-second pacing between replies to respect WhatsApp rate limits
        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        console.error('[WhatsApp Queue] Message failed or timed out:', e.message);
      }
    }
  } finally {
    // ALWAYS reset lock so the queue NEVER stays stuck
    isProcessingQueue = false;
  }
}


function initWhatsAppClient() {
  console.log('[WhatsApp] Initializing client...');

  const authDir = process.env.WWEBJS_DIR || 
    (fs.existsSync('/app/data') ? '/app/data/.wwebjs_auth' : './.wwebjs_auth');

  cleanupSingletonLocks(path.join(authDir, 'session'));

  clientInstance = new Client({
    authStrategy: new LocalAuth({
      dataPath: authDir,
    }),
    webVersion: '2.3000.1046918752-alpha',
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      strict: false,
    },
    takeoverOnConflict: true,
    takeoverTimeoutMs: 1000,
    evalOnNewDoc: `
      window.RTCPeerConnection = undefined;
      window.webkitRTCPeerConnection = undefined;
      window.RTCSessionDescription = undefined;
      window.RTCIceCandidate = undefined;
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('Media disabled'));
        navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
      }
    `,
    puppeteer: {
      headless: true,
      protocolTimeout: 60000,
      dumpio: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-video-decode',
        '--disable-accelerated-video-encode',
        '--disable-3d-apis',
        '--disable-webrtc',
        '--disable-webrtc-hw-decoding',
        '--disable-webrtc-hw-encoding',
        '--enable-unsafe-swiftshader',
        '--disable-search-engine-choice-screen',
        '--no-default-browser-check',
        '--disable-features=WebRtcHideLocalIpsWithMdns,WebRTC,WebRTC-H264WithOpenH264FFmpeg,WebUIOmniboxPopup,WebUIOmniboxAimPopup,SidePanel,ChromeRefresh2023,OmniboxUIBareMin',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
        '--mute-audio',
        '--disk-cache-size=33554432',
        '--media-cache-size=16777216',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    },
  });

  clientInstance.on('qr', async (qr) => {
    console.log('[WhatsApp] QR Code received.');
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      botState.qr = dataUrl;
      botState.status = 'QR_READY';
      botState.lastUpdated = new Date().toISOString();
    } catch (err) {
      console.error('[WhatsApp] Error converting QR to dataUrl:', err);
    }
  });

  clientInstance.on('authenticated', () => {
    console.log('[WhatsApp] Authenticated successfully.');
    botState.status = 'AUTHENTICATED';
    botState.qr = null;
    botState.lastUpdated = new Date().toISOString();
  });

  clientInstance.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Auth failure:', msg);
    botState.status = 'DISCONNECTED';
    botState.qr = null;
    botState.lastUpdated = new Date().toISOString();
  });

  clientInstance.on('ready', async () => {
    console.log('[WhatsApp] Bot is ready and connected!');
    botState.status = 'CONNECTED';
    botState.qr = null;
    botState.phone = clientInstance.info?.wid?.user || null;
    botState.pushname = clientInstance.info?.pushname || null;
    botState.lastUpdated = new Date().toISOString();

    try {
      if (clientInstance.pupPage) {
        await clientInstance.pupPage.bringToFront();
        clientInstance.pupPage.on('dialog', async (dialog) => {
          console.log('[WhatsApp Dialog Auto-Dismissed]:', dialog.type(), dialog.message());
          await dialog.dismiss().catch(() => {});
        });
        clientInstance.pupPage.on('error', (err) => {
          console.error('[WhatsApp Page Crash/Error]:', err.message);
          botState.status = 'DISCONNECTED';
          setTimeout(() => {
            initWhatsAppClient();
          }, 3000);
        });
        clientInstance.pupPage.on('pageerror', (err) => {
          console.error('[WhatsApp Page JS Error]:', err.message);
        });
      }
    } catch (e) {}

    await initScheduler(clientInstance);

    // Keep-alive heartbeat: keeps WebSocket active, prevents idle timeout
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(async () => {
      try {
        if (clientInstance && botState.status === 'CONNECTED') {
          await clientInstance.sendPresenceAvailable().catch(() => {});
          if (clientInstance.pupPage && !clientInstance.pupPage.isClosed()) {
            await clientInstance.pupPage.mouse.move(Math.floor(Math.random() * 20), Math.floor(Math.random() * 20)).catch(() => {});
            await clientInstance.pupPage.bringToFront().catch(() => {});
          }
        }
      } catch (e) {}
    }, 25000);
  });

  clientInstance.on('disconnected', (reason) => {
    console.warn('[WhatsApp] Disconnected event:', reason);
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    botState.status = 'DISCONNECTED';
    botState.qr = null;
    botState.lastUpdated = new Date().toISOString();
    setTimeout(() => {
      initWhatsAppClient();
    }, 5000);
  });

  clientInstance.on('message', (msg) => {
    console.log(`[WhatsApp Event] 📩 message from ${msg.from}: "${msg.body}"`);
    enqueueMessage(msg);
  });

  clientInstance.on('message_create', (msg) => {
    if (msg.fromMe) {
      console.log(`[WhatsApp Event] 📝 message_create (fromMe: true) from ${msg.from}: "${msg.body}"`);
      enqueueMessage(msg);
    }
  });

  clientInstance.on('message_ciphertext', (msg) => {
    console.warn(`[WhatsApp Event] 🔐 message_ciphertext from ${msg.from}`);
  });

  clientInstance.on('message_ciphertext_failed', (msg) => {
    console.error(`[WhatsApp Event] ❌ message_ciphertext_failed from ${msg.from}`);
  });

  clientInstance.initialize().catch((err) => {
    console.error('[WhatsApp] Failed to initialize client:', err.message);
    setTimeout(() => {
      initWhatsAppClient();
    }, 5000);
  });

  return clientInstance;
}

module.exports = {
  initWhatsAppClient,
  getBotState,
  getClient,
};
