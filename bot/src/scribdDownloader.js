const puppeteer = require('puppeteer');
const { MessageMedia } = require('whatsapp-web.js');

/**
 * Extracts the document ID from various Scribd URL formats.
 * Examples:
 *  - https://www.scribd.com/document/358621690/Manual-Testing-Test-Case-Examples
 *  - https://es.scribd.com/document/724190988/Manual-Testing-Documentation-Guide
 *  - https://www.scribd.com/doc/123456/Some-Doc
 *  - https://www.scribd.com/presentation/987654/Slides
 *  - https://www.scribd.com/embeds/358621690/content
 *  - https://scribd.com/d/358621690-Title
 */
function extractScribdId(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/(?:scribd\.com\/(?:document|doc|embeds|presentation|d)\/|scribd\.com\/d\/)(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Extracts a readable title from the URL slug if available.
 */
function extractTitleFromSlug(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/scribd\.com\/(?:document|doc|embeds|presentation)\/\d+\/([^/?#]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1]).replace(/[-_]+/g, ' ').trim();
    } catch (e) {
      return match[1].replace(/[-_]+/g, ' ').trim();
    }
  }
  return null;
}

/**
 * Downloads a Scribd document and converts it to a clean PDF MessageMedia.
 * Reuses existing Puppeteer browser instance if provided, or launches an ephemeral one.
 *
 * @param {string} url - The Scribd document URL.
 * @param {object} [browserInstance] - Active Puppeteer browser instance from WhatsApp client.
 * @returns {Promise<{ media: MessageMedia, title: string, pageCount: number, filename: string, sizeBytes: number }>}
 */
async function downloadScribdPdf(url, browserInstance = null) {
  const docId = extractScribdId(url);
  if (!docId) {
    throw new Error('No se pudo identificar el ID del documento en el enlace de Scribd.');
  }

  let title = extractTitleFromSlug(url) || 'Documento Scribd';
  const embedUrl = `https://www.scribd.com/embeds/${docId}/content?start_page=1&view_mode=scroll`;

  let browser = browserInstance;
  let isEphemeralBrowser = false;

  if (!browser || (typeof browser.isConnected === 'function' && !browser.isConnected())) {
    console.log('[ScribdDownloader] Launching ephemeral Chromium browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--mute-audio',
      ],
    });
    isEphemeralBrowser = true;
  }

  let page = null;
  try {
    console.log(`[ScribdDownloader] Opening tab for Scribd docId ${docId}...`);
    page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1200, height: 1600 });

    // Navigate to embed viewer with 35s timeout
    await page.goto(embedUrl, {
      waitUntil: ['domcontentloaded', 'networkidle2'],
      timeout: 35000,
    });

    // Scroll through pages to trigger lazy-loaded text and images
    await page.evaluate(async () => {
      const pages = document.querySelectorAll('.outer_page');
      for (let i = 0; i < pages.length; i++) {
        pages[i].scrollIntoView();
        if (window.docManager && typeof window.docManager.gotoPage === 'function') {
          window.docManager.gotoPage(i + 1);
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    });

    // Wait a brief moment for pending font/image network requests
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Clean DOM and apply CSS print styling
    const extractionMeta = await page.evaluate(() => {
      // Remove extraneous UI elements (toolbars, headers, footers, popups, promotions, banners)
      const selectors = [
        '.toolbar',
        '.header',
        '.footer',
        '.mobile_banner',
        '.promotions',
        '.between_page_ads',
        '.promo_banner',
        '.upsell_banner',
        '.document_toolbar',
        '.between_page_portal_root',
        '.between_page_module',
        '.page_missing_explanation',
      ];
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      });

      // Reset scrollers so Chromium print engine prints all pages
      const scrollers = document.querySelectorAll('.document_scroller, .body_container, html, body');
      scrollers.forEach((el) => {
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('height', 'auto', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('position', 'static', 'important');
      });

      // Process outer_page elements
      let validPages = 0;
      const allPages = Array.from(document.querySelectorAll('.outer_page'));
      allPages.forEach((p) => {
        const hasImg = p.querySelector('img') && p.querySelector('img').naturalWidth > 0;
        const hasText = (p.innerText || '').trim().length > 10;
        if (!hasImg && !hasText) {
          p.remove();
        } else {
          validPages++;
          p.style.setProperty('page-break-after', 'always', 'important');
          p.style.setProperty('break-after', 'page', 'important');
          p.style.setProperty('page-break-inside', 'avoid', 'important');
          p.style.setProperty('break-inside', 'avoid', 'important');
          p.style.setProperty('margin', '0 auto 20px auto', 'important');
          p.style.setProperty('display', 'block', 'important');
        }
      });

      const docTitle = document.title && document.title !== 'Scribd' ? document.title : null;
      return { validPages, docTitle };
    });

    if (extractionMeta.docTitle && title === 'Documento Scribd') {
      title = extractionMeta.docTitle;
    }

    if (extractionMeta.validPages === 0) {
      throw new Error('No se pudo encontrar contenido visible o accesible en este documento de Scribd.');
    }

    console.log(`[ScribdDownloader] Printing ${extractionMeta.validPages} pages to PDF...`);

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '5mm', bottom: '5mm', left: '5mm', right: '5mm' },
    });

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Error al generar el archivo PDF desde el documento.');
    }

    // WhatsApp safe limit: 50MB
    if (pdfBuffer.length > 50 * 1024 * 1024) {
      throw new Error('El documento PDF generado excede el límite de 50 MB permitido por WhatsApp.');
    }

    const sanitizedTitle = title.replace(/[/\\?%*:|"<>\.]/g, '_').trim().slice(0, 80) || 'documento_scribd';
    const filename = `${sanitizedTitle}.pdf`;
    const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);

    console.log(`[ScribdDownloader] ✅ Generated PDF "${filename}" (${pdfBuffer.length} bytes, ${extractionMeta.validPages} pages)`);

    return {
      media,
      title,
      pageCount: extractionMeta.validPages,
      filename,
      sizeBytes: pdfBuffer.length,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (isEphemeralBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }
}

module.exports = {
  extractScribdId,
  extractTitleFromSlug,
  downloadScribdPdf,
};
