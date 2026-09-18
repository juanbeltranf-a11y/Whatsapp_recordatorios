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

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Downloads a Scribd document and converts it to a clean PDF MessageMedia.
 * Uses high-speed direct page extraction and token resolution.
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
  let browser = browserInstance;
  let isEphemeralBrowser = false;

  if (!browser || (typeof browser.isConnected === 'function' && !browser.isConnected())) {
    console.log('[ScribdDownloader] Launching Chromium browser...');
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

  let docPage = null;
  let cleanTab = null;
  const tempRawPdf = path.join('/tmp', `scribd_${docId}_${Date.now()}_raw.pdf`);
  const tempFinalPdf = path.join('/tmp', `scribd_${docId}_${Date.now()}_final.pdf`);

  try {
    console.log(`[ScribdDownloader] Iniciando extracción rápida para docId ${docId}...`);
    docPage = await browser.newPage();
    await docPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await docPage.setViewport({ width: 1200, height: 1600 });

    const targetUrl = url.includes('/embeds/') ? url : `https://es.scribd.com/document/${docId}`;
    await docPage.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 35000,
    });

    const extraction = await docPage.evaluate(async () => {
      const dm = window.docManager;
      if (!dm || !dm.pages) {
        return { error: 'No se encontró docManager en esta página.' };
      }

      const pageNums = Object.keys(dm.pages).map(Number).sort((a, b) => a - b);
      const total = pageNums.length;
      const pages = [];
      const allFontIds = new Set();

      const batchSize = 35;
      for (let i = 0; i < total; i += batchSize) {
        const batch = pageNums.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (n) => {
            const p = dm.pages[n];
            if (!p || !p.contentUrl) return null;

            try {
              const res = await fetch(p.contentUrl);
              if (!res.ok) return null;
              const text = await res.text();

              let html = '';
              window['cb_' + n] = (arr) => { html = arr[0]; };
              try { eval(text.replace(/page\d+_callback/, 'cb_' + n)); } catch (e) {}
              delete window['cb_' + n];

              if (!html) return null;

              const div = document.createElement('div');
              div.innerHTML = html;
              div.querySelectorAll('img').forEach((img) => {
                const orig = img.getAttribute('orig');
                if (orig && dm.subImageSrc) {
                  img.src = dm.subImageSrc(orig);
                } else if (orig) {
                  img.src = orig.replace('http://html.scribd.com', 'https://html.scribdassets.com');
                }
              });

              const matches = html.match(/ff\d+/g) || [];
              matches.forEach((m) => allFontIds.add(m.replace('ff', '')));

              const np = div.querySelector('.newpage');
              const w = np ? parseInt(np.style.width) || 893 : 893;
              const h = np ? parseInt(np.style.height) || 1263 : 1263;

              return { n, html: div.innerHTML, w, h };
            } catch (err) {
              return null;
            }
          })
        );

        for (const item of batchResults) {
          if (item) pages.push(item);
        }
      }

      pages.sort((a, b) => a.n - b.n);
      return {
        docTitle: document.title,
        assetPrefix: dm.assetPrefix,
        fontIds: Array.from(allFontIds),
        totalPages: total,
        pages,
      };
    });

    await docPage.close();
    docPage = null;

    if (!extraction || !extraction.pages || extraction.pages.length === 0) {
      throw new Error('No se pudo extraer el contenido del documento.');
    }

    if (extraction.docTitle && title === 'Documento Scribd') {
      title = extraction.docTitle.replace(/\|.*$/i, '').trim();
    }

    console.log(`[ScribdDownloader] Extracción completada: ${extraction.pages.length} páginas. Renderizando PDF...`);

    cleanTab = await browser.newPage();
    const firstW = extraction.pages[0]?.w || 893;
    const firstH = extraction.pages[0]?.h || 1263;
    await cleanTab.setViewport({ width: firstW, height: firstH });

    const fontFaces = (extraction.fontIds || []).map((id) => `
      @font-face {
        font-family: 'ff${id}';
        src: url('https://html.scribdassets.com/${extraction.assetPrefix}/fonts/${id.padStart(4, '0')}.woff2') format('woff2');
        font-display: block;
      }
      .ff${id} {
        font-family: 'ff${id}', sans-serif;
      }
    `).join('\n');

    const cleanHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${fontFaces}
          @page {
            size: ${firstW}px ${firstH}px;
            margin: 0;
          }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
          }
          .page_container {
            width: ${firstW}px;
            height: ${firstH}px;
            position: relative;
            overflow: hidden;
            background: #ffffff;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .newpage {
            position: relative !important;
            margin: 0 !important;
            overflow: hidden !important;
            background: #ffffff !important;
          }
          .image_layer {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
          }
          .image_layer img.absimg {
            position: absolute;
          }
          .text_layer {
            width: 0px;
            height: 0px;
            position: absolute;
            top: 0px;
            left: 0px;
            transform: scale(0.2);
            transform-origin: left top;
          }
          .text_layer div, .text_layer span {
            white-space: nowrap;
            padding: 0px;
            margin: 0px;
            border: none;
            line-height: 1;
          }
          .text_layer span { height: 1px; }
          .text_layer span.a, .text_layer span.g {
            position: absolute;
            border: none;
            left: 0px;
          }
          .text_layer span.w {
            white-space: nowrap;
            padding: 0px;
            margin: 0px;
            border: none;
            height: 1px;
            line-height: 1;
            display: inline-block;
          }
          .text_layer span.l { margin: 0px; }
          .text_layer span.l, .text_layer span.l1 {
            white-space: nowrap;
            padding: 0px;
            border: none;
            height: 1px;
            line-height: 1;
            display: inline;
          }
          .text_layer span.l1 { margin: 0px 0px 0px -1px; }
          .text_layer span.l2 { margin: 0px 0px 0px -2px; }
          .text_layer span.l2, .text_layer span.l3 {
            white-space: nowrap;
            padding: 0px;
            border: none;
            height: 1px;
            line-height: 1;
            display: inline;
          }
          .text_layer span.l3 { margin: 0px 0px 0px -3px; }
        </style>
      </head>
      <body>
        ${extraction.pages.map((p) => `
          <div class="page_container">
            ${p.html}
          </div>
        `).join('')}
      </body>
      </html>
    `;

    await cleanTab.setContent(cleanHtml, { waitUntil: 'load', timeout: 60000 });
    await cleanTab.evaluate(async () => {
      await document.fonts.ready;
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(
        imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => {
          i.onload = r;
          i.onerror = r;
          setTimeout(r, 4000);
        })))
      );
    });

    const pdfBuffer = await cleanTab.pdf({
      width: `${firstW}px`,
      height: `${firstH}px`,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      timeout: 0,
    });

    fs.writeFileSync(tempRawPdf, pdfBuffer);
    console.log(`[ScribdDownloader] Raw PDF: ${(pdfBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    let finalPdfPath = tempRawPdf;
    try {
      execSync(`gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${tempFinalPdf} ${tempRawPdf}`);
      if (fs.existsSync(tempFinalPdf) && fs.statSync(tempFinalPdf).size > 0) {
        finalPdfPath = tempFinalPdf;
      }
    } catch (gsErr) {
      console.warn('[ScribdDownloader] Ghostscript compression warning:', gsErr.message);
    }

    const sanitizedTitle = title.replace(/[/\\?%*:|"<>\.]/g, '_').trim().slice(0, 80) || 'documento_scribd';
    const filename = `${sanitizedTitle}.pdf`;
    const media = MessageMedia.fromFilePath(finalPdfPath);
    media.filename = filename;

    const finalStats = fs.statSync(finalPdfPath);
    console.log(`[ScribdDownloader] ✅ Final PDF "${filename}" (${(finalStats.size / 1024 / 1024).toFixed(2)} MB, ${extraction.pages.length} páginas)`);

    return {
      media,
      title,
      pageCount: extraction.pages.length,
      filename,
      sizeBytes: finalStats.size,
    };
  } finally {
    if (docPage) await docPage.close().catch(() => {});
    if (cleanTab) await cleanTab.close().catch(() => {});
    if (isEphemeralBrowser && browser) await browser.close().catch(() => {});
    try { if (fs.existsSync(tempRawPdf)) fs.unlinkSync(tempRawPdf); } catch (e) {}
    try { if (fs.existsSync(tempFinalPdf)) fs.unlinkSync(tempFinalPdf); } catch (e) {}
  }
}

module.exports = {
  extractScribdId,
  extractTitleFromSlug,
  downloadScribdPdf,
};
