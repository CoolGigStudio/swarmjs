import { GptSwarm } from '../src/core/GptSwarm';
import { SwarmConfig, AgentConfig, ToolDefinition } from '../src/types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

async function main(): Promise<void> {
  // Define simple tools that use local information
  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'appendLocalInfo',
        description: 'Appends current directory name and timestamp to text',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to process',
            },
          },
        },
      },
      handler: async (params): Promise<string> => {
        const text = params.text as string;
        const currentDir = path.basename(process.cwd());
        const timestamp = Date.now();
        return `${text}_${currentDir}_${timestamp}`;
      },
    },
    {
      type: 'function',
      function: {
        name: 'combineWithMarker',
        description: 'Combines two texts with a marker and timestamp',
        parameters: {
          type: 'object',
          properties: {
            texts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Two texts to combine',
            },
          },
        },
      },
      handler: async (params): Promise<string> => {
        const texts = params.texts as string[];
        const timestamp = Date.now();
        return `[COMBINED_${timestamp}]${texts[0]}@@@${texts[1]}`;
      },
      examples: ['$1 = combineWithMarker(texts: ["text1", "text2"])'],
    },
  ];

  // Define simple processing agent
  const processingAgent: AgentConfig = {
    name: 'TextProcessor',
    description: 'An agent that processes text using local system information',
    systemMessage: `You are a text processing agent that adds local system information to texts.
    Each processed text will contain the current directory name and timestamp, which you cannot know without using the tools.
    Always point out the local information in the results to prove the tools were actually executed.`,
    allowedTools: ['appendLocalInfo', 'combineWithMarker'],
  };

  // Create swarm configuration
  const config: SwarmConfig = {
    agents: [processingAgent],
    tools: tools,
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,
  };

  try {
    // Initialize swarm
    const swarm = new GptSwarm();
    await swarm.init(config);

    // Test processing with local information
    console.log('Processing texts with local system information:');
    const flow = await swarm.createSession('TextProcessor');

    const response = await swarm.runSession(
      flow.id,
      'Append local information to these two variables: variable1 = "Job1" and variable2 = "Job2" and then combine them with a marker',
      {
        script: `
          $1 = appendLocalInfo(text: variable1)
          $2 = appendLocalInfo(text: variable2)
          $3 = combineWithMarker(texts: [$1, $2])
          $4 = finish()
        `,
      }
    );
    console.log('Result:', response);

    // Clean up
    await swarm.endSession(flow.id);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Unknown error occurred');
    }
  }
}

// Run the example
main().catch((error) => {
  if (error instanceof Error) {
    console.error('Fatal error:', error.message);
  } else {
    console.error('Unknown fatal error occurred');
  }
});
