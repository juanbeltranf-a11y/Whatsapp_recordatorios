const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');

function executeDownload(bin, searchArg, isYoutube, outputTemplate, titleFile) {
  return new Promise((resolve) => {
    const args = [
      searchArg,
      '-f', 'bestaudio/best',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '128K',
      '--no-playlist',
      '--no-simulate',
      '-o', outputTemplate,
      '--print-to-file', '%(title)s', titleFile,
      '--no-warnings',
    ];

    if (isYoutube) {
      args.push('--extractor-args', 'youtube:player_client=android,web');
    }

    execFile(bin, args, { timeout: 45000 }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

/**
 * Searches and downloads a song using yt-dlp (YouTube with SoundCloud fallback).
 * Returns { media: MessageMedia, title: string }
 */
async function downloadSong(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('Término de búsqueda vacío');
  }

  const cleanQuery = query.replace(/[^\w\s\u00C0-\u017F\-\–]/gi, ' ').trim();
  const tempPrefix = `song_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const outputTemplate = path.join(os.tmpdir(), `${tempPrefix}.%(ext)s`);
  const titleFile = path.join(os.tmpdir(), `${tempPrefix}.title`);
  const ytDlpBin = fs.existsSync('/usr/local/bin/yt-dlp')
    ? '/usr/local/bin/yt-dlp'
    : (fs.existsSync('/tmp/yt-dlp-latest') ? '/tmp/yt-dlp-latest' : 'yt-dlp');

  const isUrl = /^https?:\/\//i.test(cleanQuery);
  const primarySearch = isUrl ? cleanQuery : `scsearch1:${cleanQuery}`;
  const secondarySearch = isUrl ? null : `ytsearch1:${cleanQuery}`;

  console.log(`[Music] 🔍 Searching and downloading song: "${cleanQuery}" with ${ytDlpBin}...`);

  // Attempt 1: SoundCloud (or direct URL)
  let result = await executeDownload(ytDlpBin, primarySearch, false, outputTemplate, titleFile);

  // Check if file was produced
  let matchingFiles = [];
  try {
    matchingFiles = fs.readdirSync(os.tmpdir()).filter(
      (f) => f.startsWith(tempPrefix) && !f.endsWith('.title') && !f.endsWith('.part')
    );
  } catch (e) {}

  // Attempt 2: YouTube fallback if primary search produced no file
  if (matchingFiles.length === 0 && secondarySearch) {
    console.log(`[Music] 🔄 Primary search did not produce file, trying YouTube fallback for: "${cleanQuery}"...`);
    result = await executeDownload(ytDlpBin, secondarySearch, true, outputTemplate, titleFile);
    try {
      matchingFiles = fs.readdirSync(os.tmpdir()).filter(
        (f) => f.startsWith(tempPrefix) && !f.endsWith('.title') && !f.endsWith('.part')
      );
    } catch (e) {}
  }

  if (matchingFiles.length === 0) {
    console.error('[Music] Download failed for:', cleanQuery, 'stderr:', result?.stderr);
    throw new Error('No se pudo encontrar o procesar el audio de la canción.');
  }

  const foundFile = path.join(os.tmpdir(), matchingFiles[0]);

  // Read title
  let title = cleanQuery;
  try {
    if (fs.existsSync(titleFile)) {
      title = fs.readFileSync(titleFile, 'utf8').trim() || cleanQuery;
      fs.unlinkSync(titleFile);
    }
  } catch (e) {}

  try {
    const stats = fs.statSync(foundFile);
    console.log(`[Music] ✅ Downloaded "${title}" (${(stats.size / 1024 / 1024).toFixed(2)} MB) at ${foundFile}`);

    const ext = path.extname(foundFile).toLowerCase();
    let mime = 'audio/mp3';
    if (ext === '.m4a' || ext === '.mp4') mime = 'audio/mp4';
    else if (ext === '.opus' || ext === '.ogg') mime = 'audio/ogg; codecs=opus';
    else if (ext === '.wav') mime = 'audio/wav';

    const dataBase64 = fs.readFileSync(foundFile).toString('base64');
    const cleanTitle = title.replace(/[/\\?%*:|"<>]/g, '').slice(0, 60);
    const media = new MessageMedia(mime, dataBase64, `${cleanTitle}${ext}`);

    try {
      fs.unlinkSync(foundFile);
    } catch (e) {}

    return {
      media,
      title,
    };
  } catch (readErr) {
    console.error('[Music] Error reading downloaded file:', readErr.message);
    throw new Error('Error al procesar el archivo de audio.');
  }
}

module.exports = {
  downloadSong,
};
