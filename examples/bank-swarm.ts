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
  ['2025-02-12', ['09:00', '11:00', '14:00']],
  ['2025-02-13', ['10:00', '13:00', '15:00']],
  ['2025-02-14', ['09:00', '12:00', '16:00']],
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
  systemMessage: `You are a customer service agent for Fremont Bank. You should follow the following workflow to assist the customer:
  1. Start by greeting and asking for the customer's name and account number or card number
  2. Look up the customer's info and confirm the details
  3. Ask what help does the customer need for help? The services that you can provide are: checking balance, paying bills, and provide branch location and hours.
  4. If the customer needs to check balance, ask for the account number or card number and provide the balance.
  5. If the customer needs to pay bills, ask for the bill amount and provide the payment options.
  6. If the customer needs to know the branch location and hours, provide the information.
  7. For other inquiries, transfer the call to a live operator.
  
  Always use customerChatCLI for customer interaction.
  Maintain a natural conversation flow while following the steps.`,
  allowedTools: [
    'customerChatCLI',
    'lookupCustomer',
    'checkBalance',
    'payBills',
    'provideBranchInfo',
    'terminateSession',
  ],
};

const swarmConfig: SwarmConfig = {
  agents: [customerServiceAgent],
  tools,
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY,
  planningModel: 'gpt-4.5-preview',
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
        # Step 1: Greet the customer and request identification details
        $1 = customerChatCLI(message: "Hello! Welcome to Fremont Bank. Please provide your name and your account number or card number.")

        # Step 2: Look up customer information using the provided information: name and account number or card number
        $2 = lookupCustomer(customerName: $1, accountNumber: $1)

        # Step 3: Confirm customer details and present available service options
        $3 = customerChatCLI(message: "Thank you, [Customer Name]. Your details have been confirmed. How can we assist you today? Options: check balance, pay bills, or branch information.")

        # Step 4: Process customer's service selection based on the customer's response
        # Each branch represents a possible customer request
            # Branch: Customer requests to check their balance
            $4 = checkBalance(account: $1) 

            # Branch: Customer requests to pay bills
            $5 = payBills(billAmount: $1) 

            # Branch: Customer requests branch location and hours information
            $6 = provideBranchInfo() 

            # Branch: Customer requests other services beyond the automated ones; transfer to live operator
            $7 = terminateSession(message: "Transferring you to a live operator for further assistance."

        # Step 5: End the interaction by thanking the customer
        $8 = customerChatCLI(message: "Thank you for contacting Fremont Bank. Have a great day!")

        # Error Handling: In case an error occurs at any stage, terminate the session gracefully
        $9 = terminateSession(message: "An error occurred during the interaction. Please try again later.")
    `;

    await swarm.runSession(flow.id, 'Start customer interaction');
    await swarm.endSession(flow.id);
    rl.close();
  } catch (error) {
    console.error('Error:', error);
    rl.close();
  }
}

main().catch(console.error);
