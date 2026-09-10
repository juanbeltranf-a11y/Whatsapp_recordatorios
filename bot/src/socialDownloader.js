const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MessageMedia } = require('whatsapp-web.js');

/**
 * Identifies the platform name from a URL.
 */
function identifyPlatform(url) {
  if (!url || typeof url !== 'string') return 'Red Social';
  const lower = url.toLowerCase();
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'Facebook';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'X (Twitter)';
  if (lower.includes('pinterest.com') || lower.includes('pin.it')) return 'Pinterest';
  return 'Red Social';
}

/**
 * Downloads a video, photo, story or reel from social media using yt-dlp.
 * Returns { media: MessageMedia, platform: string, title: string, isVideo: boolean, filename: string }
 */
async function downloadSocialMedia(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('No se proporcionó un enlace válido.');
  }

  const cleanUrl = targetUrl.trim();
  const platform = identifyPlatform(cleanUrl);
  const tempPrefix = `social_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const outputTemplate = path.join(os.tmpdir(), `${tempPrefix}.%(ext)s`);
  const titleFile = path.join(os.tmpdir(), `${tempPrefix}.title`);

  const ytDlpBin = fs.existsSync('/usr/local/bin/yt-dlp')
    ? '/usr/local/bin/yt-dlp'
    : (fs.existsSync('/tmp/yt-dlp-latest') ? '/tmp/yt-dlp-latest' : 'yt-dlp');

  console.log(`[SocialDownloader] 📥 Downloading from ${platform}: "${cleanUrl}" using ${ytDlpBin}...`);

  const args = [
    cleanUrl,
    '-f', 'best[filesize<50M]/bestvideo[filesize<40M]+bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '--no-simulate',
    '-o', outputTemplate,
    '--print-to-file', '%(title)s', titleFile,
  ];

  // User-agent to avoid simple blocks on Instagram/TikTok
  args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  const result = await new Promise((resolve) => {
    execFile(ytDlpBin, args, { timeout: 40000 }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });

  // Locate downloaded media file
  let matchingFiles = [];
  try {
    matchingFiles = fs.readdirSync(os.tmpdir()).filter(
      (f) => f.startsWith(tempPrefix) && !f.endsWith('.title') && !f.endsWith('.part')
    );
  } catch (e) {}

  if (matchingFiles.length === 0) {
    const errorMsg = result.stderr || result.error?.message || '';
    console.error(`[SocialDownloader] Failed to download from ${platform}:`, errorMsg);

    if (errorMsg.includes('login') || errorMsg.includes('private') || errorMsg.includes('Sign in')) {
      throw new Error(`Este contenido de ${platform} es de una cuenta privada o requiere inicio de sesión.`);
    }
    if (errorMsg.includes('expired') || errorMsg.includes('404') || errorMsg.includes('not found')) {
      throw new Error(`El contenido de ${platform} ya no está disponible o el enlace ha caducado.`);
    }
    throw new Error(`No se pudo descargar el contenido de ${platform}. Asegúrate de que la publicación sea pública.`);
  }

  const downloadedPath = path.join(os.tmpdir(), matchingFiles[0]);

  // Read title if available
  let title = `${platform} Media`;
  try {
    if (fs.existsSync(titleFile)) {
      title = fs.readFileSync(titleFile, 'utf8').trim() || title;
      fs.unlinkSync(titleFile);
    }
  } catch (e) {}

  try {
    const stats = fs.statSync(downloadedPath);
    console.log(`[SocialDownloader] ✅ Downloaded ${platform} file: "${title}" (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    const ext = path.extname(downloadedPath).toLowerCase();
    let mime = 'video/mp4';
    let isVideo = true;

    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
      isVideo = false;
    } else if (['.mp4', '.m4v', '.mov', '.webm', '.mkv'].includes(ext)) {
      mime = 'video/mp4';
      isVideo = true;
    } else if (['.mp3', '.m4a', '.ogg', '.opus'].includes(ext)) {
      mime = 'audio/mp4';
      isVideo = false;
    }

    const dataBase64 = fs.readFileSync(downloadedPath).toString('base64');
    const cleanFilename = `${platform.toLowerCase()}_${Date.now()}${ext}`;
    const media = new MessageMedia(mime, dataBase64, cleanFilename);

    // Clean up temporary downloaded file
    try {
      fs.unlinkSync(downloadedPath);
    } catch (e) {}

    return {
      media,
      platform,
      title: title.slice(0, 100),
      isVideo,
      filename: cleanFilename,
    };
  } catch (readErr) {
    console.error('[SocialDownloader] Error processing downloaded file:', readErr.message);
    throw new Error('Error al procesar el archivo descargado.');
  }
}

module.exports = {
  identifyPlatform,
  downloadSocialMedia,
};
