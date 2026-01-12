export interface TTSConfig {
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
  speed: number;
  outputFormat: string;
  latency: number;
}

export interface ProcessingLog {
  id: number;
  textSnippet: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  audioUrl?: string;
  audioBlob?: Blob;
  message?: string;
  apiKeyUsed?: string; // Masked
}

export interface FileContent {
  name: string;
  content: string;
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
}

export interface ApiKeyDetails {
  key: string; // The masked key or identifier
  valid: boolean;
  remainingCredits: number;
  characterLimit: number;
  resetDate?: string;
  tier?: string;
  voices: VoiceInfo[];
}