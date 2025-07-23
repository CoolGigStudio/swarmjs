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
  systemMessage: `You are a customer service agent for South Bay Pediatrics Medical Group. You should follow the following workflow:
  1. Start by greeting and asking for the patient's name and birthdate
  2. Look up the patient's info and confirm the details
  3. Ask what help does the patient need for help?
  4. For the office visit, ask the patient the reason for the visit and triage the conditions so you can provide the available slots according to the following rules:
    - If the patient's condition is not urgent, provide the available slots for the next 3 days.
    - If the patient's condition is urgent, provide the available slots available today.
    - If the patient's condition is annual physical, provide the available slots for the next 3 months.
    - If the patient's condition is life threatening, transfer the call to a live operator.
    - If the patient's condition is a new patient, ask for the patient's name, birthdate, and insurance information. And then provide the available slots for the next 3 weeks.
  5. For prescription refill, look up the patient's existing prescriptions and if the patient has a valid prescription, ask the patient which prescription they would like to refill. 
  6. For other inquiries, transfer the call to a live operator.
  
  Always use customerChatCLI for customer interaction.
  Maintain a natural conversation flow while following the steps.`,
  allowedTools: [
    'customerChatCLI',
    'lookupPatient',
    'checkAvailableSlots',
    'bookAppointment',
    'lookupPrescription',
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
    # System Initialization: Greet the customer and start the interaction
    $1 = customerChatCLI(message: "Hello, welcome to South Bay Pediatrics Medical Group. May I have your name and birthdate, please?")
    
    # Lookup Customer Info
    # Since the allowed tool "lookupPatient" is not available in our tools list, we denote this step as handled by the LLM.
    $2 = lookupPatient(name: $1, birthdate: $1)
    
    # Ask the Customer for the Type of Assistance Needed
    $3 = customerChatCLI(message: "How can I assist you today? (Office Visit, Prescription Refill, or Other Inquiries)")
    
    # ====================================================================
    # Branching: The following flows represent mutually exclusive branches
    # based on the customer's response. Only ONE branch will execute.
    # ====================================================================
    
    # Branch: Office Visit Flow
    # Parent Task: Handling Office Visit Appointment
        $4 = customerChatCLI(message: "For an office visit, please provide the reason for your visit along with any details about your condition.")
        # Triage the customer's condition.
        # (Note: Determination of the appropriate date range is handled manually since no dedicated triage tool is available.)
        # For example:
        # - If not urgent: check slots for the next 3 days.
        # - If urgent: check slots available today.
        # - If annual physical: check slots for the next 3 months.
        # - If life threatening: transfer to a live operator.
        # - If new patient: ask additional details then check slots for the next 3 weeks.
        $5 = checkAvailableSlots(date: "calculated_date_based_on_triage")  # The exact date is determined by the condition details.
        $6 = bookAppointment(date: "selected_date", time: "selected_time", authId: "customer-auth-id")
    
    # Branch: Prescription Refill Flow
    # Parent Task: Handling Prescription Refill Request
        # Since the allowed tool "lookupPrescription" is not available in our tools list,
        # we denote the prescription lookup step as handled by the LLM.
        $7 = lookupPrescriptionByLLM(authId: "customer-auth-id")
        $8 = customerChatCLI(message: "Please indicate which prescription you would like to refill.")
    
    # Branch: Other Inquiries Flow
    # Parent Task: Transferring the Call for Other Inquiries
        $9 = terminateSession(message: "Transferring you to a live operator for additional assistance.")
    
    # ====================================================================
    # Finalization: Conclude the Interaction
    $10 = customerChatCLI(message: "Thank you for contacting South Bay Pediatrics Medical Group. Have a great day!")
    
    # ====================================================================
    # Error Handling Consideration
    # This step is available as a fallback if any critical error occurs during the interaction.
    $11 = terminateSession(message: "We encountered an error during our interaction. Please try again later or contact support directly.")
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
