import {
  AIService,
  AIConfig,
  AIMessage,
  AIResponse,
} from '../../types/aiService';

interface GPTResponse {
  choices: {
    message: {
      content: string;
      role: string;
    };
  }[];
  error?: {
    message: string;
    type: string;
  };
}

export class GPTService implements AIService {
  private config: AIConfig;

  constructor(config: AIConfig) {
    this.config = config;
  }

  async complete(
    messages: AIMessage[],
    systemMessage?: AIMessage
  ): Promise<AIResponse> {
    try {
      if (!systemMessage) {
        systemMessage = {
          role: 'system',
          content: 'You are a helpful assistant.',
        };
        messages.unshift(systemMessage);
      }
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [systemMessage, ...messages],
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
          }),
        }
      );

      if (!response.ok) {
        const errorData = (await response.json()) as {
          error?: { message: string };
        };
        throw new Error(
          errorData.error?.message || `HTTP error! status: ${response.status}`
        );
      }

      const data = (await response.json()) as GPTResponse;

      if (data.error) {
        throw new Error(data.error.message);
      }

      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Invalid response format from GPT API');
      }

      return {
        content: data.choices[0].message.content,
        raw: data,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`GPT API error: ${error.message}`);
      }
      throw new Error('Unknown error occurred');
    }
  }
}
