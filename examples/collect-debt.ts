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
      name: 'lookupCollectionActions',
      description: 'Look up collection actions by auth ID',
      parameters: {
        type: 'object',
        properties: {
          customerExcuse: {
            type: 'string',
            description: 'Customer excuse',
          },
        },
        required: ['customerExcuse'],
      },
    },
    handler: async (params): Promise<string> => {
      return 'We will take the following actions: 1. Sue the customer. 2. Report the customer to the credit bureau. 3. Take legal action.';
    },
  },
  {
    type: 'function',
    function: {
      name: 'makePayment',
      description: 'Make a payment using credit card',
      parameters: {
        type: 'object',
        properties: {
          customerName: {
            type: 'string',
            description: 'Customer name',
          },
          creditCardNumber: {
            type: 'string',
            description: 'Credit card number',
          },
          amount: {
            type: 'number',
            description: 'Amount to pay',
          },
        },
        required: ['customerName', 'creditCardNumber', 'amount'],
      },
    },
    handler: async (params): Promise<string> => {
      return 'Payment made successfully';
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
  systemMessage: `
    You are a debt collector. You should follow the following workflow:
    1. Greet the customer and ask for the customer's name.
    2. Tell the customer that you are calling to collect a debt for the amount that the customer owes. You should have the amount in customer's profile.
    3. Ask the customer if they are able to make a payment today.
    4. If the customer is able to make a payment, ask for the payment amount.
    5. If the customer is not able to make a payment today, ask when they will be able to make a payment.
    6. If the customer is refusing to make a payment or giving you all kinds of excuses, tell them that they have to make a payment and if they don't pay, the collection agency will take legal action.
    7. You need to make sure that the customer understands the gravity of the situation and that you are not bluffing. You can look up the examples of actions that the collection agency can take based on the customer's response.
    8. Thank the customer for their time and end the call.
    
`,
  allowedTools: [
    'customerChatCLI',
    'lookupCustomer',
    'lookupCollectionActions',
    'makePayment',
    'collectDebt',
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
    # Start Customer Interaction
    # Step 1: Greet the customer and ask for their name.
    $1 = customerChatCLI(message: "Hello, thank you for calling. May I have your name?")
    
    # Retrieve Customer Profile
    # Step 2: Look up customer details using an authentication ID.
    $2 = lookupCustomer(authId: "customer_auth_id")
    
    # Inform the Customer About the Debt
    # Step 3: Greet the customer by name and inform them of the outstanding debt.
    $3 = customerChatCLI(message: "Hello, customer_name. Our records show that you owe an outstanding amount that needs to be collected.")
    
    # Ask About Payment Ability
    # Step 4: Ask the customer if they are able to make a payment today.
    $4 = customerChatCLI(message: "Are you able to make a payment today? (yes/no)")
    
    # Payment Flow Branches (Using Hierarchical Structure to denote conditional paths)
    # Parent Task: Conditional Payment Flow
    
        # Payment Successful Branch: Customer is able to pay
        $5 = customerChatCLI(message: "Great! Please enter the payment amount you wish to pay today.")
        $6 = makePayment(customerName: "customer_name", creditCardNumber: "customer_credit_card", amount: 0)
        # Note: The 'amount' value would be dynamically replaced by the customer's input.
        
        # Payment Scheduling Branch: Customer is not able to pay today
        $7 = customerChatCLI(message: "No problem. When will you be able to make a payment?")
        $8 = customerChatCLI(message: "Thank you. We have noted your scheduled payment date.")
        
        # Refusal/Excuse Branch: Customer is refusing to pay or providing excuses
        $9 = lookupCollectionActions(customerExcuse: "customer_excuse")
        $10 = customerChatCLI(message: "I must remind you that payment is required. Failure to make payment may result in legal action taken by our collection agency.")
    
    # Error Handling Considerations
    # In case any of the above steps fail (e.g., payment processing error), the session will be terminated with an appropriate message.
    $11 = terminateSession(message: "An error occurred or the call has ended. Thank you for your time. Goodbye.")
`;

    await swarm.runSession(flow.id, 'Collect debt from customer', {
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
