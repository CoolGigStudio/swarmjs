export enum AIServiceType {
  CLAUDE = 'claude',
  GPT = 'gpt',
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  content: string;
  raw: any; // Raw API response
}

// core/ai-service.ts
export interface AIService {
  complete(
    messages: AIMessage[],
    systemMessage?: AIMessage
  ): Promise<AIResponse>;
}
