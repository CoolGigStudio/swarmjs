import { AgentConfig, SwarmConfig, Flow } from "./basic";
import * as WebSocket from "ws";

export interface VoiceAgentConfig extends AgentConfig {
  voice?: string; // Voice identifier for the agent
  phoneNumber?: string; // Twilio phone number for the agent
  inputAudioFormat?: string; // Audio format for input
  outputAudioFormat?: string; // Audio format for output
  turnDetection?: {
    type: string;
    silence_duration_ms?: number;
    threshold?: number;
    parameters?: Record<string, unknown>;
  };
}

export interface VoiceSwarmConfig extends SwarmConfig {
  agents: VoiceAgentConfig[];
  twilioConfig: {
    accountSid: string;
    authToken: string;
    phoneNumbers: string[];
  };
  openAIConfig: {
    apiKey: string;
    organizationId: string;
    realtimeEndpoint: string;
  };
  server: {
    port: number;
    hostname: string;
    publicDir?: string;
  };
}

export interface VoiceSession extends Flow {
  streamSid?: string;
  twilioWs?: WebSocket.WebSocket;
  openAIWs?: WebSocket.WebSocket;
  currentVoice?: string;
  metadata?: Record<string, any>;
}