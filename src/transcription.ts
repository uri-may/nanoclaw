import OpenAI from 'openai';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;

  const apiKey =
    process.env.OPENAI_API_KEY ||
    readEnvFile(['OPENAI_API_KEY']).OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — voice transcription disabled');
    return null;
  }

  client = new OpenAI({ apiKey });
  return client;
}

/**
 * Transcribe an audio buffer to text using OpenAI STT.
 * Returns the transcribed text, or null on failure.
 * Language is auto-detected (supports Hebrew, English, etc.).
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
): Promise<string | null> {
  const openai = getClient();
  if (!openai) return null;

  try {
    const file = new File([buffer], filename, {
      type: 'application/octet-stream',
    });
    const response = await openai.audio.transcriptions.create({
      model: 'gpt-4o-transcribe',
      file,
    });

    const text = response.text?.trim();
    if (!text) return null;

    logger.info(
      { filename, chars: text.length },
      'Audio transcribed',
    );
    return text;
  } catch (err) {
    logger.error({ err, filename }, 'Transcription failed');
    return null;
  }
}
