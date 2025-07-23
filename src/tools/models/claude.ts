import {
  AIService,
  AIConfig,
  AIMessage,
  AIResponse,
} from '../../types/aiService';

interface ClaudeResponse {
  content: string;
  role: string;
  error?: {
    message: string;
    type: string;
  };
}

export class ClaudeService implements AIService {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async complete(
    messages: AIMessage[]
  ): Promise<AIResponse> {
    try {
      // Prepare messages for Claude - converting the format
      const claudeMessages = messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      }));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: this.config.maxTokens || 4096,
          messages: claudeMessages,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as {
          error?: { message: string };
        };
        throw new Error(
          errorData.error?.message || `HTTP error! status: ${response.status}`
        );
      }

      const data = (await response.json()) as ClaudeResponse;

      if (data.error) {
        throw new Error(data.error.message);
      }

      return {
        content: data.content,
        raw: data,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Claude API error: ${error.message}`);
      }
      throw new Error('Unknown error occurred');
    }
  }
}
