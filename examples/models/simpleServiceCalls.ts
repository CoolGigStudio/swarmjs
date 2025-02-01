// example.ts
import { AIServiceFactory } from '../../src/tools/models/aiServices';
import { AIServiceType, AIConfig, AIMessage } from '../../src/types/aiService';
import * as dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
  try {
    // Get model type from command line args, default to GPT
    const modelType =
      process.argv[2]?.toLowerCase() === 'claude'
        ? AIServiceType.CLAUDE
        : AIServiceType.GPT;

    // Configure the AI service
    const config: AIConfig = {
      apiKey:
        modelType === AIServiceType.CLAUDE
          ? process.env.CLAUDE_API_KEY || ''
          : process.env.OPENAI_API_KEY || '',
      model:
        modelType === AIServiceType.CLAUDE
          ? 'claude-3-opus-20240229'
          : 'gpt-4o',
      maxTokens: 1000,
      temperature: 0.1,
    };

    // Check if API key is available
    if (!config.apiKey) {
      throw new Error(
        `API key not found for ${modelType} service. Please check your .env file.`
      );
    }

    // Create the AI service
    const aiService = AIServiceFactory.createService(modelType, config);

    // Example messages - without system message for Claude
    const messages: AIMessage[] = [
      {
        role: 'user',
        content: 'What is the capital of Kenya?',
      },
    ];

    console.log(`Using ${modelType} service...`);

    const response = await aiService.complete(messages);
    console.log('\nResponse:', response.content);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('An unknown error occurred');
    }
    process.exit(1);
  }
}

main();
