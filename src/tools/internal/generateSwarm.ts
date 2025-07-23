import { GptSwarm } from '../../../src/core/GptSwarm';
import { AgentConfig, ToolDefinition } from '../../../src/types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import dotenv from 'dotenv';
import { CODE_GENERATIONSWARM_GOAL_PROMPT } from './prompts';

dotenv.config();

const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'readFile',
      description: 'Read content of a file',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file',
          },
        },
        required: ['filePath'],
      },
    },
    handler: async (params): Promise<string> => {
      try {
        const content = await fs.readFile(params.filePath as string, 'utf8');
        return `// ${params.filePath}\n${content}`;
      } catch (error) {
        return `Error reading file: ${error}`;
      }
    },
  },
  {
    type: 'function',
    function: {
      name: 'writeFile',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Destination file path',
          },
          content: {
            type: 'string',
            description: 'Content to write',
          },
        },
        required: ['filePath', 'content'],
      },
    },
    handler: async (params): Promise<string> => {
      try {
        await fs.mkdir(path.dirname(params.filePath as string), {
          recursive: true,
        });
        await fs.writeFile(params.filePath as string, params.content as string);
        return `Successfully wrote to ${params.filePath}`;
      } catch (error) {
        return `Error writing file: ${error}`;
      }
    },
  },
  // {
  //   type: 'function',
  //   function: {
  //     name: 'generateCode',
  //     description: 'Generate code using Claude',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         frameworkCode: {
  //           type: 'string',
  //           description: 'Prompt for code generation',
  //         },
  //         requirements: {
  //           type: 'string',
  //           description: 'Requirements for code generation',
  //         },
  //       },
  //       required: ['frameworkCode', 'requirements'],
  //     },
  //   },
  //   handler: async (params): Promise<string> => {
  //     const config: AIConfig = {
  //       apiKey: process.env.CLAUDE_API_KEY || '',
  //       model: 'claude-3-5-sonnet-latest',
  //       maxTokens: 8192,
  //       temperature: 0,
  //     };

  //     const aiService = AIServiceFactory.createService(
  //       AIServiceType.CLAUDE,
  //       config
  //     );
  //     const frameworkCode = params.frameworkCode as string;
  //     const requirements = params.requirements as string;
  //     const prompt = CODE_GENERATION_PROMPT.replace(
  //       '{requirements}',
  //       requirements
  //     ).replace('{frameworkCode}', frameworkCode);
  //     console.log('Prompt for code generation:', prompt);
  //     const response = await aiService.complete([
  //       { role: 'user', content: prompt },
  //     ]);
  //     console.log('Response from Claude:', response.content);
  //     if (Array.isArray(response.content) && response.content.length === 1) {
  //       const firstContent = response.content[0];
  //       return 'type' in firstContent &&
  //         firstContent.type === 'text' &&
  //         'text' in firstContent
  //         ? firstContent.text
  //         : 'No code from Claude';
  //     }
  //     return 'No code from Claude';
  //   },
  // },
];

const codeGeneratorAgent: AgentConfig = {
  name: 'CodeGenerator',
  description: 'Generates swarm implementation code',
  systemMessage: `Generate swarm implementation based on requirements and swarmjs framework shown in code and example files.`,
  allowedTools: ['readFile', 'writeFile'],
};

async function main(): Promise<void> {
  const swarm = new GptSwarm();
  await swarm.init({
    agents: [codeGeneratorAgent],
    tools,
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY,
  });

  const flow = await swarm.createSession(codeGeneratorAgent.name);

  try {
    const destinationPath = await new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(
        'Enter destination path (default: ./examples/): ',
        (path: any) => {
          rl.close();
          resolve(path || './examples/');
        }
      );
    });

    const requirements = await new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(
        'Enter swarm requirements (default: Default swarm implementation): ',
        (reqs: any) => {
          rl.close();
          resolve(reqs || 'Default swarm implementation');
        }
      );
    });

    const coreFiles = [
      'src/core/GptSwarm.ts',
      'src/types/basic.ts',
      'src/core/prompts.ts',
      'examples/customerAgentCarDealer.ts',
    ].join(', ');
    const goal = CODE_GENERATIONSWARM_GOAL_PROMPT.replace(
      '{requirements}',
      requirements
    )
      .replace('{coreFiles}', coreFiles)
      .replace('{destinationPath}', destinationPath);

    const script = `
  # System Initialization
  # Initialize the process by reading core files for SwarmJS framework

  $1 = readFile(filePath: "src/core/GptSwarm.ts")
  $2 = readFile(filePath: "src/types/basic.ts")
  $3 = readFile(filePath: "src/core/prompts.ts")
  $4 = readFile(filePath: "examples/customerAgentCarDealer.ts")

  # Code Generation
  # Generate the swarm implementation code for the hairstylist chatbot
  $5 = generateCode(
    frameworkCode: $1, $2, $3, $4
    requirements: ${goal}
  )ByLLM

  # Error Handling
  # Check if code generation was successful
  $6 = handleErrorsByLLM(lastOutput: $5)

  # Writing Generated Code
  # Write the generated code to the destination path
  $7 = writeFile(filePath: "test.ts", content: $5)

  # Finalization
  $8 = endSession()ByLLM
`;
    await swarm.runSession(flow.id, goal, { script });
    //const script = await swarm.generateScript(goal);
    //console.log(script);
    await swarm.endSession(flow.id);
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
