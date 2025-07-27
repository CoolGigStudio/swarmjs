import { GptSwarm } from '../src/core/GptSwarm';
import { SwarmConfig, AgentConfig, ToolDefinition } from '../src/types';
import * as dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
  // Get command line argument
  const args = process.argv.slice(2);
  const mode = args[0]?.toLowerCase() || 'session';

  if (mode !== 'session' && mode !== 'runonce') {
    console.error('Usage: ts-node twoAgentsSwarm.ts [session|runonce]');
    process.exit(1);
  }

  // Simple tools that are easy to verify
  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'encode',
        description: 'Adds a timestamp and directory marker to text',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to encode',
            },
          },
        },
      },
      handler: async (params): Promise<string> => {
        const text = params.text as string;
        console.log(`🔧 Tool called: encode("${text}")`);
        const timestamp = Date.now();
        // Return a simple format that's easy to verify with reversed text
        const reversedText = text.split('').reverse().join('');
        const result = `<encoded>${reversedText}_${timestamp}</encoded>`;
        console.log(`📤 encode result: ${result}`);
        return result;
      },
    },
    {
      type: 'function',
      function: {
        name: 'cleanup',
        description: 'Removes non-alphabetic characters from text',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to cleanup',
            },
          },
        },
      },
      handler: async (params): Promise<string> => {
        const text = params.text as string;
        console.log(`🔧 Tool called: cleanup("${text}")`);
        // First extract content from encoded tags
        const match = text.match(/<encoded>(.*?)_\d+<\/encoded>/);
        if (!match) return text;
        // Then remove non-alphabetic characters
        const content = match[1];
        const result = `<cleaned>${content.replace(/[^a-zA-Z]/g, '')}</cleaned>`;
        console.log(`📤 cleanup result: ${result}`);
        return result;
      },
    },
    {
      type: 'function',
      function: {
        name: 'decode',
        description: 'This tool is used to decode the text',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to decode',
            },
          },
        },
      },
      handler: async (params): Promise<string> => {
        const text = params.text as string;
        console.log(`🔧 Tool called: decode("${text}")`);
        const match = text.match(/<cleaned>(.*?)<\/cleaned>/);
        const extractedText = match ? match[1] : text;
        const result = extractedText.split('').reverse().join('');
        console.log(`📤 decode result: ${result}`);
        return result;
      },
    },
    {
      type: 'function',
      function: {
        name: 'reduceByTwoLetters',
        description: 'Reduces the text by two letters',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to reduce',
            },
          },
        },
      },
      handler: async (params): Promise<string> => {
        const text = params.text as string;
        console.log(`🔧 Tool called: reduceByTwoLetters("${text}")`);
        if (text.length < 3) {
          console.log(`📤 reduceByTwoLetters result: ${text} (no reduction - length < 3)`);
          return text;
        }
        // Reduce two letters at a time
        let reducedText = text;
        reducedText = reducedText.slice(0, -2);
        console.log(`📤 reduceByTwoLetters result: ${reducedText}`);
        return reducedText;
      },
    },
    //         },
    //       },
    //     },
    //   },
    //   handler: async (params): Promise<string> => {
    //     const chatHistory = params.chatHistory as string;
    //     console.log('chatHistory:', chatHistory);
    //     return `Final result: ${chatHistory}`;
    //   },
    // },
  ];

  // Define encoder agent
  const encoderAgent: AgentConfig = {
    name: 'Encoder',
    description: 'Encodes and cleans text',
    systemMessage: `You are a text processing agent that:
    1. First encodes text with a timestamp and reverse the text
    2. Then removes non-alphabetic characters
    3. Finally switches to the Decoder agent
    
    Always show the output of each step in your response.`,
    allowedTools: ['encode', 'cleanup'],
  };

  // Define decoder agent
  const decoderAgent: AgentConfig = {
    name: 'Decoder',
    description: 'Decodes final results',
    systemMessage: `You are a decoder agent that:
    1. Takes cleaned and encoded text
    2. Extracts the final alphabetic-only content
    
    Always show the decoded result in your response.`,
    allowedTools: ['decode', 'reduceByTwoLetters'],
  };

  // Create swarm configuration
  const config: SwarmConfig = {
    agents: [encoderAgent, decoderAgent],
    tools: tools,
    model: 'gpt-4o', //'gpt-4o', //'o1-mini',
    apiKey: process.env.OPENAI_API_KEY,
    planningModel: 'gpt-4o', //'o1-mini',
    options: {
      saveDags: process.env.SAVE_DAGS === 'true',
    },
  };

  try {
    console.log('Initializing swarm...');
    const swarm = new GptSwarm();
    await swarm.init(config);

    if (mode === 'session') {
      console.log('\nRunning with session mode...');
      console.log('Creating session...');
      const flow = await swarm.createSession('Encoder');

      console.log('Executing script...');
      const response = await swarm.runSession(
        flow.id,
        'Encode the inputText only one time and then process the encoded text until you get less than 3 letters message and keep the resulting letters in the order of the original text. Here is the inputText:"Hello123, World!!!"'
        // {
        //   script: `
        //         # Encoding Phase
        //         $1 = encode(text: "Hello123, World!!!")

        //         # Cleanup Phase
        //         $2 = cleanup(text: $1)

        //         # Agent Switching
        //         $3 = switchAgent(agentName: "Decoder", currentStepNu
        // mber: "$2", lastOutput: $2)

        //         # Decoding Phase
        //         $4 = decode(text: $2)

        //         # Iterative Processing: Decode and Reduce until message length is less than 3
        //         # Repeat the following steps until the condition is met
        //         $5 = reduceByTwoLetters(text: $4)

        //         # Summarize the result
        //         $7 = SummarizeByLLM(text: $6)

        //         # Error Handling
        //         $8 = handleErrors(process: $5)ByLLM
        //     `,
        //}
      );

      console.log('Process completed successfully');
      console.log('Final Result:', response);

      console.log('Cleaning up...');
      await swarm.endSession(flow.id);
    } else {
      console.log('\nRunning with runOnce mode...');
      const response = await swarm.runOnce(
        'Encoder',
        'Process the following inputText: "Testing456, RunOnce!!!"',
        {
          script: `
              # Text Encoding and Cleanup (Encoder Agent)
              $1 = encode(text: "Testing456, RunOnce!!!")
              $2 = cleanup(text: $1)

              # Agent Switching
              $3 = switchAgent(agentName: "Decoder")

              # Text Decoding and Reduction (Decoder Agent)
              $4 = decode(text: $2)
              $5 = reduceByTwoLetters(text: $4)
          `,
        }
      );

      console.log('RunOnce completed successfully');
      console.log('RunOnce Result:', response);
    }
  } catch (error) {
    console.error('Detailed error information:');
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    } else {
      console.error('Unknown error:', error);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error in main:', error);
});
