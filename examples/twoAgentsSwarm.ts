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
        const timestamp = Date.now();
        // Return a simple format that's easy to verify with reversed text
        const reversedText = text.split('').reverse().join('');
        return `<encoded>${reversedText}_${timestamp}</encoded>`;
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
        // First extract content from encoded tags
        const match = text.match(/<encoded>(.*?)_\d+<\/encoded>/);
        if (!match) return text;
        // Then remove non-alphabetic characters
        const content = match[1];
        return `<cleaned>${content.replace(/[^a-zA-Z]/g, '')}</cleaned>`;
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
        const match = text.match(/<cleaned>(.*?)<\/cleaned>/);
        const extractedText = match ? match[1] : text;
        return extractedText.split('').reverse().join('');
      },
    },
    // {
    //   type: 'function',
    //   function: {
    //     name: 'summarize',
    //     description: 'Summarizes and returns the final result',
    //     parameters: {
    //       type: 'object',
    //       properties: {
    //         chatHistory: {
    //           type: 'string',
    //           description:
    //             'The entire history of the chat history since the start of the first tool call',
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
    allowedTools: ['decode', 'summarize'],
  };

  // Create swarm configuration
  const config: SwarmConfig = {
    agents: [encoderAgent, decoderAgent],
    tools: tools,
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,
    planningModel: 'o1-mini', //'gpt-4o', //'o1-mini',
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
        'Process the following inputText: "Hello123, World!!!"',
        {
          script: `                                                                                                                                       
          # Encoding Phase                                                                                                                            
          $1 = encode(text: "Hello123, World!!!")                                                                                                     
                                                                                                                                                      
          # Cleanup Phase                                                                                                                             
          $2 = cleanup(text: $1)                                                                                                                      
                                                                                                                                                      
          # Agent Switching                                                                                                                           
          $3 = switchAgent(agentName: "Decoder", currentStepNu                                                                                        
  mber: "$2", lastOutput: $2)                                                                                                                         
                                                                                                                                                      
          # Decoding Phase                                                                                                                            
          $4 = decode(text: $2)                                                                                                                       
                                                                                                                                                      
          # Summarization Phase                                                                                                                       
          $5 = summarize(text: $4)                                                                                                                    
                                                                                                                                                      
          # Error Handling                                                                                                                            
          $6 = handleErrors(process: $5)ByLLM                                                                                                         
      `,
        }
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
              # Text Encoding and Cleanup
              $1 = encode(text: "Testing456, RunOnce!!!")
              $2 = cleanup(text: $1)

              # Agent Switching
              $3 = switchAgent(agentName: "Decoder")

              # Text Decoding
              $4 = decode(text: $2)

              # Summarization by LLM
              $5 = summarize_ByLLM(text: $4)

              # Error Handling
              $6 = handleErrors_ByLLM(step: $5)
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
