import { AIService, AIConfig, AIServiceType } from '../../types/aiService';
import { ClaudeService } from './claude';
import { GPTService } from './gpt';

export class AIServiceFactory {
  static createService(type: AIServiceType, config: AIConfig): AIService {
    switch (type) {
      case AIServiceType.CLAUDE:
        return new ClaudeService(config);
      case AIServiceType.GPT:
        return new GPTService(config);
      default:
        throw new Error('Unsupported AI service type');
    }
  }
}
