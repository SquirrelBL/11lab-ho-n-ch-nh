import JSZip from 'jszip';
import { TTSConfig } from '../types';

interface GenerateResponse {
  success: boolean;
  data?: Blob;
  error?: string;
}

export const generateVoice = async (
  text: string,
  apiKey: string,
  voiceId: string,
  config: TTSConfig
): Promise<GenerateResponse> => {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${config.outputFormat}&optimize_streaming_latency=${config.latency}`;

  let payload: any;

  if (config.modelId === 'eleven_v3') {
     // V3 (Alpha) only supports stability with values 0.0, 0.5, 1.0
     // We assume the UI provides one of these, but we clamp for safety.
     let stability = 0.5;
     if (config.stability <= 0.25) stability = 0.0;
     else if (config.stability >= 0.75) stability = 1.0;
     else stability = 0.5;

     payload = {
        text: text,
        model_id: config.modelId,
        voice_settings: {
           stability: stability
        }
     };
  } else {
     // V2 and others
     payload = {
        text: text,
        model_id: config.modelId,
        voice_settings: {
          stability: config.stability,
          similarity_boost: config.similarityBoost,
          style: config.style,
          use_speaker_boost: config.useSpeakerBoost,
          speed: config.speed,
        },
      };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const blob = await response.blob();
      return { success: true, data: blob };
    } else {
      let errorMsg = `HTTP Error: ${response.status}`;
      try {
        const errorJson = await response.json();
        errorMsg = JSON.stringify(errorJson);
      } catch (e) {
        // ignore json parse error
      }
      return { success: false, error: errorMsg };
    }
  } catch (error: any) {
    return { success: false, error: error.message || 'Network error' };
  }
};

export const createZip = async (files: { name: string; blob: Blob }[]): Promise<Blob> => {
  const zip = new JSZip();
  files.forEach((file) => {
    zip.file(file.name, file.blob);
  });
  return await zip.generateAsync({ type: 'blob' });
};

export const fetchUserSubscription = async (apiKey: string) => {
    try {
        const response = await fetch("https://api.elevenlabs.io/v1/user", {
            headers: { "xi-api-key": apiKey }
        });
        if (response.ok) {
            const data = await response.json();
            const charLimit = data.subscription.character_limit;
            const charCount = data.subscription.character_count;
            return {
                remaining: charLimit - charCount,
                valid: true
            };
        }
        return { remaining: 0, valid: false };
    } catch {
        return { remaining: 0, valid: false };
    }
}