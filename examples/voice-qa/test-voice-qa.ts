import { LocalVoiceSwarm } from '../../src/core/LocalVoiceSwarm';
import { LocalVoiceSwarmConfig } from '../../src/types/voice';
import { config } from 'dotenv';

// Load environment variables
config();

// Simple test configuration
const testConfig: LocalVoiceSwarmConfig = {
  agents: [
    {
      name: 'TestVoiceAgent',
      description: 'A test voice assistant for verification',
      systemMessage: 'You are a test voice assistant. Keep responses very short.',
      allowedTools: ['getCurrentTime'],
      voice: 'alloy',
      temperature: 0.8,
    },
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'getCurrentTime',
        description: 'Get the current time',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      handler: async () => {
        return {
          currentTime: new Date().toLocaleTimeString(),
          message: `Current time is ${new Date().toLocaleTimeString()}`,
        };
      },
    },
  ],
  openAIConfig: {
    apiKey: process.env.OPENAI_API_KEY!,
    organizationId: process.env.OPENAI_ORG,
    model: 'gpt-4o-realtime-preview-2024-12-17',
    apiVersion: '2025-04-01-preview',
  },
  audio: {
    sampleRate: 24000,
    channels: 1,
  },
};

async function testVoiceQA() {
  console.log('🧪 Testing LocalVoiceSwarm Core Functionality');
  console.log('============================================');

  try {
    // Test 1: Initialize LocalVoiceSwarm
    console.log('1. Initializing LocalVoiceSwarm...');
    const voiceSwarm = new LocalVoiceSwarm();
    await voiceSwarm.init(testConfig);
    console.log('✅ LocalVoiceSwarm initialized successfully');

    // Test 2: Create Session
    console.log('\n2. Creating voice session...');
    const session = await voiceSwarm.createSession('TestVoiceAgent');
    console.log(`✅ Session created: ${session.id}`);

    // Test 3: Check Session Metadata
    console.log('\n3. Checking session metadata...');
    const metadata = voiceSwarm.getSessionMetadata(session.id);
    console.log('✅ Session metadata:', metadata);

    // Test 4: Get Voice IO Manager
    console.log('\n4. Getting VoiceIO Manager...');
    const voiceIO = voiceSwarm.getVoiceIO();
    console.log('✅ VoiceIO Manager obtained');

    // Test 5: Check Active Sessions
    console.log('\n5. Checking active sessions...');
    const activeSessions = voiceSwarm.getActiveVoiceSessions();
    console.log(`✅ Active sessions: ${activeSessions.length}`);

    // Test 6: Run Session (this will just mark it as active)
    console.log('\n6. Running session...');
    const result = await voiceSwarm.runSession(session.id, 'Test voice interaction');
    console.log('✅ Session result:', result);

    // Test 7: Test Tool Manually
    console.log('\n7. Testing tool manually...');
    const tool = testConfig.tools![0];
    const toolResult = await tool.handler({});
    console.log('✅ Tool result:', toolResult);

    // Test 8: End Session
    console.log('\n8. Ending session...');
    await voiceSwarm.endSession(session.id);
    console.log('✅ Session ended successfully');

    console.log('\n🎉 All tests passed! LocalVoiceSwarm is working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
  }
}

// Run the test
testVoiceQA().catch(console.error);