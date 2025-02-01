import { GptSwarm } from '../src/core/GptSwarm';
import { SwarmConfig, AgentConfig, ToolDefinition } from '../src/types';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

dotenv.config();

const customerDB = new Map([
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

const appointmentSlots = new Map([
  ['2025-01-26', ['09:00', '11:00', '14:00']],
  ['2025-01-27', ['10:00', '13:00', '15:00']],
  ['2025-01-28', ['09:00', '12:00', '16:00']],
]);

// Simulated CLI interaction
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const tools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'customerChatCLI',
      description: 'Interact with customer through CLI',
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
    handler: async (params): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(`Agent: ${params.message}\nCustomer: `, (answer) => {
          resolve(answer);
        });
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
    handler: async (params): Promise<string> => {
      const customer = customerDB.get(params.authId as string);
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
    handler: async (params): Promise<string> => {
      const slots = appointmentSlots.get(params.date as string);
      return slots ? JSON.stringify(slots) : 'No available slots';
    },
  },
  {
    type: 'function',
    function: {
      name: 'getEarliestAvailableDate',
      description: 'Get both the current date and the earliest available date',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    handler: async (): Promise<string> => {
      const currentDate = new Date().toISOString().split('T')[0];
      const earliestAvailableDate = appointmentSlots.keys().next().value;
      return JSON.stringify({ currentDate, earliestAvailableDate });
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
    handler: async (params): Promise<string> => {
      const slots = appointmentSlots.get(params.date as string);
      if (!slots?.includes(params.time as string)) return 'Slot not available';
      const newSlots = slots.filter((slot) => slot !== params.time);
      appointmentSlots.set(params.date as string, newSlots);
      return 'Appointment booked successfully';
    },
  },
  {
    type: 'function',
    function: {
      name: 'terminateSession',
      description: 'Terminate the session',
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
    handler: async (params): Promise<string> => {
      console.log(params.message);
      return 'CustomerService: Session terminated';
    },
  },
];

const customerServiceAgent: AgentConfig = {
  name: 'CustomerService',
  description: 'Handles complete customer interaction flow',
  systemMessage: `You are a customer service agent for a car dealership following a specific workflow:
  1. Start by greeting and asking for auth ID
  2. Look up customer info and confirm details
  3. If customer hasn't mentioned booking, ask about appointment needs
  4. Check availability for requested dates
  5. Present 3 options and help book appointment
  6. Confirm booking details
  
  Always use customerChatCLI for customer interaction.
  Maintain a natural conversation flow while following the steps.`,
  allowedTools: [
    'customerChatCLI',
    'lookupCustomer',
    'checkAvailableSlots',
    'bookAppointment',
    'getEarliestAvailableDate',
    'terminateSession',
  ],
};

const swarmConfig: SwarmConfig = {
  agents: [customerServiceAgent],
  tools,
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  planningModel: 'o3-mini',
  options: {
    saveDags: process.env.SAVE_DAGS === 'true',
  },
};

async function main() {
  const swarm = new GptSwarm();
  await swarm.init(swarmConfig);

  const flow = await swarm.createSession(customerServiceAgent.name);

  try {
    const initialScript = `
          # Customer Interaction Initialization
          $1 = customerChatCLI(message: "Hello! Welcome to our car dealership. Could you please provide your authentication ID?")
  
          # Customer Information Lookup
          $2 = lookupCustomer(authId: $1)
  
          # Confirm Customer Details
          $3 = customerChatCLI(message: "Thank you! Let me confirm your details: $2. Is everything correct?")
  
          # Check for Appointment Needs
          $4 = customerChatCLI(message: "Would you like to book an appointment with us?")
  
          # Determine Next Steps Based on Customer Response
          # If customer wants to book an appointment, proceed with availability check
          # Hierarchical Task: Appointment Booking Process
              # Get Current and Earliest Available Dates
              $5 = getEarliestAvailableDate()
  
              # Check Available Slots for the Earliest Date
              $6 = checkAvailableSlots(date: $5.earliestDate)
  
              # Present Options to Customer
              $7 = customerChatCLI(message: "Here are the available slots for $5.earliestDate: $6. Please choose one.")
  
              # Book the Appointment
              $8 = bookAppointment(date: $5.earliestDate, time: $7, authId: $1)
  
              # Confirm Booking Details
              $9 = customerChatCLI(message: "Your appointment is confirmed for $5.earliestDate at $7. Thank you!")
  
          # Error Handling
          # If any step fails, inform the customer and attempt to resolve
          $10 = customerChatCLI(message: "If you encounter any issues, please let us know and we'll assist you further.")
  
          # End of Customer Interaction
          $11 = terminateSession(message: "Thank you for choosing our dealership. Have a great day!")
      `;

    await swarm.runSession(flow.id, 'Start customer interaction', {
      script: initialScript,
    });
    await swarm.endSession(flow.id);
    rl.close();
  } catch (error) {
    console.error('Error:', error);
    rl.close();
  }
}

main().catch(console.error);
