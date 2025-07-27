import { GptSwarm } from '../src/core/GptSwarm';
import { SwarmConfig, AgentConfig, ToolDefinition } from '../src/types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

async function testSingleAgent(modelName: string = 'gpt-4o'): Promise<void> {
  console.log(`🚀 Testing SingleAgentSwarm with model: ${modelName}`);
  console.log('━'.repeat(60));
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
    model: modelName,
    apiKey: process.env.OPENAI_API_KEY,
  };

  try {
    console.log(`🔧 Initializing GptSwarm with ${modelName}...`);
    const swarm = new GptSwarm();
    await swarm.init(config);
    console.log(`✅ GptSwarm initialized successfully with ${modelName}!`);
    console.log(`🌐 Using Responses API: ${swarm.isUsingResponsesAPI()}`);

    console.log('\n📝 Creating session with TextProcessor agent...');
    const flow = await swarm.createSession('TextProcessor');
    console.log(`✅ Session created with ID: ${flow.id.substring(0, 8)}...`);

    console.log('\n🔧 Processing two text variables with local system information:');
    console.log('   Input: variable1 = "Job1", variable2 = "Job2"');
    console.log('   Processing... (this may take a few seconds)');
    
    // Temporarily suppress verbose console output during processing
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      const message = args.join(' ');
      // Only suppress debug messages, keep error messages
      if (!message.includes('message:') && 
          !message.includes('Run requires action:') && 
          !message.includes('Tool output:') &&
          !message.includes('Switching agent') &&
          !message.includes('currentAgent:') &&
          !message.includes('parsedOutput:')) {
        originalConsoleLog(...args);
      }
    };
    
    const response = await swarm.runSession(
      flow.id,
      'Append local information to these two variables: variable1 = "Job1" and variable2 = "Job2" and then combine them with a marker',
      {
        script: `
          $1 = appendLocalInfo(text: "Job1")
          $2 = appendLocalInfo(text: "Job2")
          $3 = combineWithMarker(texts: [$1, $2])
          $4 = finish()
        `,
      }
    );
    
    // Restore original console.log
    console.log = originalConsoleLog;

    console.log('\n📊 Processing Results:');
    console.log('   ✨ Final Output:', response);
    
    // Extract and display the components from the result
    const combinedMatch = response.match(/\[COMBINED_\d+\]([^@]+)@@@(.+)/);
    if (combinedMatch) {
      console.log('\n🔍 Breakdown:');
      console.log(`   📁 Text 1 with local info: ${combinedMatch[1]}`);
      console.log(`   📁 Text 2 with local info: ${combinedMatch[2]}`);
      console.log(`   📍 Directory: ${combinedMatch[1].split('_')[1]}`);
      console.log(`   ⏰ Timestamps show real-time execution`);
    }

    console.log('\n🧹 Cleaning up session...');
    await swarm.endSession(flow.id);
    console.log('✅ Session ended successfully!');
    
    console.log(`\n🎉 ${modelName} test completed successfully!`);
    console.log('   ✓ Agent initialization worked');
    console.log('   ✓ Tool execution worked');  
    console.log('   ✓ Script processing worked');
    console.log('   ✓ Session management worked');

  } catch (error) {
    console.log('\n❌ Test failed!');
    if (error instanceof Error) {
      console.error('   Error:', error.message);
    } else {
      console.error('   Unknown error occurred');
    }
    
    if (!process.env.OPENAI_API_KEY) {
      console.log('\n💡 Tip: Make sure to set your OPENAI_API_KEY environment variable');
    }
  }
}

async function main(): Promise<void> {
  const modelsToTest = ['gpt-4o-mini']; // Test only one model for now
  
  console.log('🧪 Testing SingleAgentSwarm with improved agent loop');
  console.log('=' .repeat(60));
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }
  
  for (let i = 0; i < modelsToTest.length; i++) {
    const model = modelsToTest[i];
    console.log(`\n📋 Test ${i + 1}/${modelsToTest.length}: ${model}`);
    
    try {
      await testSingleAgent(model);
    } catch (error) {
      console.log(`❌ ${model} test failed:`, error instanceof Error ? error.message : error);
    }
    
    // Add delay between tests except for the last one
    if (i < modelsToTest.length - 1) {
      console.log('\n⏳ Waiting 3 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n🏁 All SingleAgentSwarm tests completed!');
}

// Run the example
main().catch((error) => {
  if (error instanceof Error) {
    console.error('Fatal error:', error.message);
  } else {
    console.error('Unknown fatal error occurred');
  }
});
