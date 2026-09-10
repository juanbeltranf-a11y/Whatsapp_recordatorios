const { Groq } = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getGroqApiKey } = require('./config');

/**
 * Transcribes audio (voice notes / PTT / audio files) using Groq Whisper.
 * @param {string} base64Data Base64 encoded audio string
 * @param {string} mimeType MimeType of the audio
 * @returns {Promise<string>} Transcribed text in Spanish
 */
async function transcribeAudio(base64Data, mimeType = 'audio/ogg; codecs=opus') {
  let tempFilePath = null;
  try {
    const apiKey = await getGroqApiKey();
    const groq = new Groq({ apiKey });

    let ext = '.ogg';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = '.m4a';
    else if (mimeType.includes('mp3')) ext = '.mp3';
    else if (mimeType.includes('wav')) ext = '.wav';

    const tempFileName = `wa_audio_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`;
    tempFilePath = path.join(os.tmpdir(), tempFileName);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(tempFilePath, buffer);

    console.log(`[AudioTranscriber] Transcribing ${buffer.length} bytes with whisper-large-v3...`);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
      language: 'es',
      response_format: 'json',
      temperature: 0.0,
    });

    const result = transcription.text ? transcription.text.trim() : '';
    console.log(`[AudioTranscriber] ✅ Transcription result: "${result}"`);
    return result;
  } catch (error) {
    console.error('[AudioTranscriber] Error transcribing audio:', error.message);
    throw error;
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {}
    }
  }
}

module.exports = {
  transcribeAudio,
};
