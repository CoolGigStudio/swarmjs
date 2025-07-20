import * as path from 'path';
import { BankVoiceSwarm } from './BankVoiceSwarm';
import { customerDB, branchesDB } from './data';
import { VoiceSwarmConfig } from '../../src/types/voice';
// Create and initialize the bank voice swarm
async function startBankVoiceSwarm() {
  const bankSwarm = new BankVoiceSwarm();

  // Configure the swarm
  const config: VoiceSwarmConfig = {
    agents: [
      {
        name: 'bankAgent',
        description: 'A virtual banking assistant',
        systemMessage: '', // Will be set in BankVoiceSwarm.initImpl
        allowedTools: [
          'lookupCustomer',
          'checkBalance',
          'payBills',
          'provideBranchInfo',
          'redirectToPayBillsForm',
        ],
      },
    ],
    tools: [], // Will be populated in BankVoiceSwarm.initImpl
    model: 'gpt-4',
    twilioConfig: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      phoneNumbers: [process.env.TWILIO_PHONE_NUMBER || ''],
    },
    openAIConfig: {
      apiKey: process.env.OPENAI_API_KEY || '',
      organizationId: process.env.OPENAI_ORG || '',
      realtimeEndpoint: process.env.OPENAI_REALTIME_WS || '',
    },
    server: {
      port: Number(process.env.PORT || '3000'),
      hostname: process.env.HOSTNAME || 'http://localhost:3000',
      publicDir: path.join(__dirname, 'public'),
    },
  };
  await bankSwarm.init(config);

  // Create a session for incoming calls
  const session = await bankSwarm.createSession('bankAgent');
  console.log(`Bank agent session created: ${session.id}`);

  return bankSwarm;
}

// Start the service
startBankVoiceSwarm()
  .then(() => console.log('Bank Voice Swarm started successfully'))
  .catch((error) => console.error('Failed to start Bank Voice Swarm:', error));

// For debugging/testing
export { customerDB, branchesDB };
