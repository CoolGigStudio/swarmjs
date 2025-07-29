import { LocalVoiceSwarm } from '../../src/core/LocalVoiceSwarm';
import { LocalVoiceSwarmConfig } from '../../src/types/voice';
import { ToolDefinition } from '../../src/types/basic';
import { config } from 'dotenv';

// Load environment variables
config();

// Define tools for the voice Q&A agent
const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getCurrentTime',
      description: 'Get the current time and date',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async () => {
      const now = new Date();
      return {
        currentTime: now.toLocaleTimeString(),
        currentDate: now.toLocaleDateString(),
        timestamp: now.toISOString(),
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWeather',
      description: 'Get weather information for a city',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'The city to get weather for',
          },
        },
        required: ['city'],
      },
    },
    handler: async (params: Record<string, any>) => {
      const args = params as { city: string };
      // Mock weather data for demo
      const weatherData = {
        'San Francisco': { temp: '68°F', condition: 'Foggy', humidity: '78%' },
        'New York': { temp: '45°F', condition: 'Cloudy', humidity: '65%' },
        'London': { temp: '52°F', condition: 'Rainy', humidity: '85%' },
        'Tokyo': { temp: '72°F', condition: 'Sunny', humidity: '60%' },
      };
      
      const weather = weatherData[args.city as keyof typeof weatherData] || {
        temp: '70°F',
        condition: 'Unknown',
        humidity: '50%'
      };
      
      return {
        city: args.city,
        temperature: weather.temp,
        condition: weather.condition,
        humidity: weather.humidity,
        message: `Current weather in ${args.city}: ${weather.temp}, ${weather.condition}, Humidity: ${weather.humidity}`,
      };
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculateMath',
      description: 'Perform basic mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Mathematical expression to evaluate (e.g., "2 + 3", "10 * 5")',
          },
        },
        required: ['expression'],
      },
    },
    handler: async (params: Record<string, any>) => {
      const args = params as { expression: string };
      try {
        // Simple safe evaluation for basic math
        const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
        const result = Function(`"use strict"; return (${sanitized})`)();
        
        return {
          expression: args.expression,
          result: result,
          message: `${args.expression} = ${result}`,
        };
      } catch (error) {
        return {
          expression: args.expression,
          result: 'Error',
          message: `Cannot calculate: ${args.expression}`,
        };
      }
    },
  },
];

// Configuration for the voice Q&A swarm
const voiceSwarmConfig: LocalVoiceSwarmConfig = {
  agents: [
    {
      name: 'VoiceAssistant',
      description: 'A helpful voice assistant that can answer questions, provide weather info, and perform calculations',
      systemMessage: `You are a helpful voice assistant. You can:
- Answer questions about the current time and date
- Provide weather information for cities
- Perform basic mathematical calculations
- Have friendly conversations

Keep your responses conversational and concise since this is a voice interaction. 
Use the available tools when appropriate to provide accurate information.
Always be polite and helpful.`,
      allowedTools: ['getCurrentTime', 'getWeather', 'calculateMath'],
      voice: 'alloy', // Use the friendly alloy voice
      temperature: 0.8,
      enableTranscription: true,
      turnDetection: {
        type: 'server_vad',
        silence_duration_ms: 800,
        threshold: 0.6,
      },
    },
  ],
  tools,
  openAIConfig: {
    apiKey: process.env.OPENAI_API_KEY!,
    organizationId: process.env.OPENAI_ORG_ID,
    model: 'gpt-4o-realtime-preview-2024-12-17',
    apiVersion: '2025-04-01-preview',
  },
  audio: {
    sampleRate: 24000,
    channels: 1,
    enableEchoCancellation: true,
    enableNoiseSuppression: true,
    enableAutoGainControl: true,
  },
  enableCaching: true,
};

/**
 * Example usage of LocalVoiceSwarm for voice Q&A
 */
async function runVoiceQA() {
  console.log('🎤 Starting Local Voice Q&A Example');
  console.log('=====================================');

  // Validate environment
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  try {
    // Initialize the voice swarm
    const voiceSwarm = new LocalVoiceSwarm();
    await voiceSwarm.init(voiceSwarmConfig);

    console.log('✅ LocalVoiceSwarm initialized successfully');
    console.log('📱 Ready for voice interactions...');
    console.log('\nYou can now:');
    console.log('• Ask for the current time: "What time is it?"');
    console.log('• Get weather info: "What\'s the weather in San Francisco?"');
    console.log('• Do math: "Calculate 15 times 7"');
    console.log('• Have a conversation: "Hello, how are you?"');
    console.log('\n🎯 Creating voice session...');

    // Create a voice session
    const session = await voiceSwarm.createSession('VoiceAssistant');
    console.log(`✅ Voice session created: ${session.id}`);

    // Start the session (this will begin voice processing)
    const result = await voiceSwarm.runSession(session.id, 'Start voice interaction');
    console.log('🎯 Session result:', result);

    console.log('\n🎤 Voice session is now active!');
    console.log('   • Speak into your microphone');
    console.log('   • The assistant will respond with voice');
    console.log('   • Press Ctrl+C to exit');

    // Keep the process alive to maintain the voice session
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down voice session...');
      await voiceSwarm.endSession(session.id);
      console.log('✅ Voice session ended. Goodbye!');
      process.exit(0);
    });

    // Log session events for debugging
    const voiceIO = voiceSwarm.getVoiceIO();
    voiceIO.onEvent((event) => {
      switch (event.type) {
        case 'audio_start':
          console.log('🎤 Audio recording started');
          break;
        case 'audio_end':
          console.log('🔇 Audio recording ended');
          break;
        case 'tool_call':
          console.log(`🔧 Tool called: ${event.data?.toolName}`);
          break;
        case 'error':
          console.error('❌ Error:', event.error?.message);
          break;
      }
    });

    // Keep process alive
    await new Promise(() => {}); // Infinite wait

  } catch (error) {
    console.error('❌ Error running voice Q&A:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }
    process.exit(1);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  runVoiceQA().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runVoiceQA, voiceSwarmConfig };