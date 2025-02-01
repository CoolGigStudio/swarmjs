import {
  SwarmConfig,
  AgentConfig,
  ToolDefinition,
  ToolParameter,
  ToolResult,
} from '../../src/types/basic';
import OpenAI from 'openai';
import { Twilio } from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

// Initialize OpenAI and Twilio
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Database configurations
export const customerDB = new Map([
  [
    'auth_123',
    {
      name: 'John Doe',
      vehicle: 'Tesla Model 3',
      history: 'Last service: 2024-01-15',
    },
  ],
  [
    'auth_456',
    {
      name: 'Jane Smith',
      vehicle: 'BMW X5',
      history: 'Last service: 2024-02-20',
    },
  ],
]);

export const appointmentSlots = new Map([
  ['2025-01-26', ['09:00', '11:00', '14:00']],
  ['2025-01-27', ['10:00', '13:00', '15:00']],
  ['2025-01-28', ['09:00', '12:00', '16:00']],
]);

// Store active calls
export const activeCalls = new Map<
  string,
  {
    response: any;
    resolve: (value: string) => void;
  }
>();

// Voice interaction tools
export const voiceTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'customerChatVoice',
      description: 'Interact with customer through voice',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to send to customer',
          },
        },
        required: ['message'],
      },
    },
    handler: async (
      params: Record<string, ToolParameter>
    ): Promise<ToolResult> => {
      const message = String(params.message);

      // Convert message to speech
      const mp3Response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'alloy',
        input: message,
      });

      const buffer = Buffer.from(await mp3Response.arrayBuffer());
      const audioContent = buffer.toString('base64');

      // Return a Promise that will be resolved when the customer responds
      return new Promise((resolve) => {
        const currentCall = activeCalls.keys().next().value;
        if (currentCall) {
          activeCalls.set(currentCall, {
            response: audioContent,
            resolve,
          });
        }
      });
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookupCustomer',
      description: 'Look up customer information by auth ID',
      parameters: {
        type: 'object',
        properties: {
          authId: {
            type: 'string',
            description: 'Customer auth ID',
          },
        },
        required: ['authId'],
      },
    },
    handler: async (
      params: Record<string, ToolParameter>
    ): Promise<ToolResult> => {
      const customer = customerDB.get(String(params.authId));
      return customer ? JSON.stringify(customer) : 'Customer not found';
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkAvailableSlots',
      description: 'Check available appointment slots for a date',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date to check (YYYY-MM-DD)',
          },
        },
        required: ['date'],
      },
    },
    handler: async (
      params: Record<string, ToolParameter>
    ): Promise<ToolResult> => {
      const slots = appointmentSlots.get(String(params.date));
      return slots ? JSON.stringify(slots) : 'No available slots';
    },
  },
  {
    type: 'function',
    function: {
      name: 'bookAppointment',
      description: 'Book an appointment slot',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Appointment date' },
          time: { type: 'string', description: 'Appointment time' },
          authId: { type: 'string', description: 'Customer auth ID' },
        },
        required: ['date', 'time', 'authId'],
      },
    },
    handler: async (
      params: Record<string, ToolParameter>
    ): Promise<ToolResult> => {
      const slots = appointmentSlots.get(String(params.date));
      if (!slots?.includes(String(params.time))) return 'Slot not available';
      const newSlots = slots.filter((slot) => slot !== String(params.time));
      appointmentSlots.set(String(params.date), newSlots);
      return 'Appointment booked successfully';
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminateCall',
      description: 'Terminate the call with a goodbye message',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Final message to send to customer',
          },
        },
        required: ['message'],
      },
    },
    handler: async (
      params: Record<string, ToolParameter>
    ): Promise<ToolResult> => {
      return 'Call terminated';
    },
  },
];

// Agent configuration
export const voiceServiceAgent: AgentConfig = {
  name: 'VoiceService',
  description: 'Handles complete customer interaction flow via voice',
  systemMessage: `You are a voice-enabled customer service agent for a car dealership following a specific workflow:
  1. Start by greeting and asking for auth ID
  2. Look up customer info and confirm details
  3. If customer hasn't mentioned booking, ask about appointment needs
  4. Check availability for requested dates
  5. Present 3 options and help book appointment
  6. Confirm booking details
  
  Always use customerChatVoice for customer interaction.
  Keep responses concise and clear for voice communication.`,
  allowedTools: [
    'customerChatVoice',
    'lookupCustomer',
    'checkAvailableSlots',
    'bookAppointment',
    'terminateCall',
  ],
};

// Swarm configuration
export const swarmConfig: SwarmConfig = {
  agents: [voiceServiceAgent],
  tools: voiceTools,
  model: 'gpt-4',
  apiKey: process.env.OPENAI_API_KEY,
  planningModel: 'gpt-4',
};
