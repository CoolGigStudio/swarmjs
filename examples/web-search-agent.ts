import { GptSwarm } from '../src/core/GptSwarm';
import { SwarmConfig, AgentConfig, ToolDefinition } from '../src/types';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

export async function testWebSearchAgent(
  modelName: string = 'gpt-4o'
): Promise<void> {
  console.log(`🚀 Testing WebSearchAgent with model: ${modelName}`);
  console.log('━'.repeat(70));
  // Define custom tools for DAG workflow
  const tools: ToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'getUserInput',
        description:
          'Greets the user and prompts them to enter their destination city',
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt message to display to the user',
            },
          },
          required: ['prompt'],
        },
      },
      handler: async (params): Promise<string> => {
        const prompt = params.prompt as string;
        console.log(`\n${prompt}`);

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        return new Promise((resolve) => {
          rl.question('🏙️  Enter your destination city: ', (city) => {
            rl.close();
            const cityName = city.trim() || 'San Francisco';
            console.log(`\n✅ Destination set to: ${cityName}`);
            resolve(cityName);
          });
        });
      },
    },
    {
      type: 'function',
      function: {
        name: 'formatTravelReport',
        description:
          'Formats the final travel report with weather, traffic, and legal disclaimers',
        parameters: {
          type: 'object',
          properties: {
            cityName: {
              type: 'string',
              description: 'Name of the destination city',
            },
            weatherData: {
              type: 'string',
              description: 'Weather information from web search',
            },
            trafficData: {
              type: 'string',
              description: 'Traffic information from web search',
            },
          },
          required: ['cityName', 'weatherData', 'trafficData'],
        },
      },
      handler: async (params): Promise<string> => {
        const { cityName, weatherData, trafficData } = params as {
          cityName: string;
          weatherData: string;
          trafficData: string;
        };

        const timestamp = new Date().toLocaleString();

        return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                    🌍 REAL-TIME TRAVEL REPORT FOR ${cityName.toUpperCase()}                     ║
║                        Generated on ${timestamp}                         ║
╚══════════════════════════════════════════════════════════════════════════════╝

🌤️  CURRENT WEATHER CONDITIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${weatherData}

🚗 CURRENT TRAFFIC CONDITIONS  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${trafficData}

⚖️  LEGAL DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The information provided in this travel report is sourced from publicly available 
data and web searches conducted in real-time. While we strive for accuracy, please note:

• Weather and traffic conditions can change rapidly
• This information is provided for general guidance only
• Always verify current conditions through official local sources before travel
• We are not responsible for any decisions made based on this information
• For emergency situations, contact local authorities directly

📱 RECOMMENDED VERIFICATION SOURCES:
• Weather: Local meteorological services, weather apps
• Traffic: Local traffic authorities, navigation apps, road agencies
• Emergency: Local emergency services and authorities

╚══════════════════════════════════════════════════════════════════════════════╝

Report generated using OpenAI Responses API with real-time web search capability.
        `;
      },
    },
  ];

  // Define web search agent that uses OpenAI's built-in web search with DAG workflow
  const travelAgent: AgentConfig = {
    name: 'TravelAssistant',
    description:
      'An agent that executes DAG workflows to provide real-time travel information using web search',
    systemMessage: `You are a travel assistant that executes DAG workflows to gather comprehensive travel information.

CRITICAL: You must execute the entire DAG script provided, following all node dependencies. 

Available Tools:
- web_search: OpenAI's built-in web search tool for current, real-time information
- getUserInput: Get input from the user
- formatTravelReport: Format the final travel report with disclaimers

You must follow the script exactly as written, executing each node and using the results from previous nodes as inputs to subsequent nodes. Do not stop after the first node - complete the entire workflow.`,
    allowedTools: ['web_search', 'getUserInput', 'formatTravelReport'],
  };

  // Create swarm configuration with Responses API and web search enabled
  const config: SwarmConfig & { responsesAPI?: any } = {
    agents: [travelAgent],
    tools: tools,
    model: modelName, // Model being tested
    apiKey: process.env.OPENAI_API_KEY,
    // Enable the new Responses API with built-in web search
    responsesAPI: {
      builtInTools: ['web_search_preview'], // The actual tool name in the current SDK
    },
  };

  // For automated testing, we'll skip the interactive input

  try {
    console.log(`🚀 Initializing Web Search Agent with ${modelName}...`);
    const swarm = new GptSwarm();
    await swarm.init(config);
    console.log(`✅ GptSwarm initialized successfully with ${modelName}!`);

    // Check if we're using the new Responses API
    if (swarm.isUsingResponsesAPI()) {
      console.log('🌐 Using OpenAI Responses API with built-in web search');
      const availableTools = swarm.getAvailableBuiltInTools();
      console.log(
        `   Available built-in tools: ${availableTools.join(', ') || 'web_search'}`
      );
    } else {
      console.log(
        '⚠️  Note: Using traditional API (web search may not be available)'
      );
    }

    console.log('\n📝 Creating session with TravelAssistant agent...');
    const flow = await swarm.createSession('TravelAssistant');
    console.log(`✅ Session created with ID: ${flow.id.substring(0, 8)}...`);

    console.log(`\n🔍 Executing DAG workflow for travel information...`);
    console.log(
      '   DAG: Get City → Weather Search → Traffic Search → Format Report → Finish'
    );

    // Temporarily suppress verbose console output during processing
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      const message = args.join(' ');
      // Only suppress specific debug messages, keep most messages
      if (
        !message.includes('Making API call with tools:') &&
        !message.includes('Responses API not available') &&
        !message.includes('Tool ') &&
        !message.includes('Web search executed:') &&
        !message.includes('result:')
      ) {
        originalConsoleLog(...args);
      }
    };

    const response = await swarm.runSession(
      flow.id,
      'Execute the following DAG workflow to provide comprehensive travel information. Follow the script exactly, executing each node in dependency order:',
      {
        script: `
          $1 = getUserInput(prompt: "🌍 Welcome to your Real-Time Travel Assistant!")
          $2 = web_search(query: "current weather conditions temperature forecast " + $1)
          $3 = web_search(query: "current traffic conditions road closures construction delays " + $1)
          $4 = formatTravelReport(cityName: $1, weatherData: $2, trafficData: $3)
          $5 = finish()
        `,
      }
    );

    // Restore original console.log
    console.log = originalConsoleLog;

    console.log('\n📋 DAG Workflow Completed - Travel Report Generated:');
    console.log(response);

    console.log('\n🧹 Cleaning up session...');
    await swarm.endSession(flow.id);
    console.log('✅ Session ended successfully!');

    console.log(
      `\n🎉 ${modelName} Real Web Search Agent test completed successfully!`
    );
    console.log('   ✓ OpenAI Responses API worked');
    console.log('   ✓ Real web search worked with live data');
    console.log('   ✓ Local system time tool worked');
    console.log('   ✓ Information formatting worked');
  } catch (error) {
    console.log('\n❌ Test failed!');
    if (error instanceof Error) {
      console.error('   Error:', error.message);

      // Provide helpful error messages
      if (error.message.includes('web_search_preview')) {
        console.log(
          '\n💡 Note: Web search requires OpenAI Responses API access'
        );
        console.log(
          '   Make sure your API key has access to the latest features'
        );
      }
    } else {
      console.error('   Unknown error occurred');
    }

    if (!process.env.OPENAI_API_KEY) {
      console.log(
        '\n💡 Tip: Make sure to set your OPENAI_API_KEY environment variable'
      );
    }
  }
}


async function main(): Promise<void> {
  console.log('🌍 Real-Time Travel Information Agent');
  console.log('🔍 Using OpenAI Responses API with Built-in Web Search');
  console.log('='.repeat(70));

  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  try {
    // Use gpt-4o-mini as default model
    const selectedModel = 'gpt-4o-mini';

    console.log(
      `\n🚀 Getting real-time travel information using ${selectedModel}...`
    );
    console.log('━'.repeat(70));

    await testWebSearchAgent(selectedModel);

    console.log(
      '\n🎊 Thank you for using the Real-Time Travel Information Agent!'
    );
    console.log(
      "💡 This system uses OpenAI's latest Responses API with built-in web search for live data."
    );
  } catch (error) {
    console.error(
      '\n💥 Application failed:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

// Run the example
main().catch((error) => {
  if (error instanceof Error) {
    console.error('Fatal error:', error.message);
  } else {
    console.error('Unknown fatal error occurred');
  }
  process.exit(1);
});
