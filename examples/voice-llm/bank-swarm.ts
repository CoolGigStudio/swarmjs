import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { BANK_SWARM_SYSTEM_MESSAGE } from './prompts';
import path from 'path';

config();

const systemMessage = BANK_SWARM_SYSTEM_MESSAGE;
const VOICE = 'alloy';
const LOG_EVENT_TYPES = [
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
];

const app = express();
const port = process.env.PORT || 3010;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Variable to store active session details
let activeSessionData: {
  customerName: string;
  accountNumber: string;
  sessionId: string;
  pendingAction: string | null; // Allow pendingAction to be a string or null
} = {
  customerName: '',
  accountNumber: '',
  sessionId: '',
  pendingAction: null, // Will store actions like "show-payment-form" when needed
};

// Home page route
app.get('/index', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to get current user session data
app.get('/api/session-data', (req, res) => {
  res.json(activeSessionData);
});

// Handle bill payment form submission
app.post('/api/pay-bill', (req, res) => {
  const { amount, recipient } = req.body;
  const { customerName, accountNumber } = activeSessionData;

  console.log(
    `Processing bill payment: ${amount} to ${recipient} for ${customerName}`
  );

  // Here you would actually process the payment
  // For now, we'll just acknowledge receipt
  res.json({
    success: true,
    message: `Payment of $${amount} to ${recipient} processed successfully`,
    transaction: {
      id: `TXN-${Date.now()}`,
      date: new Date().toISOString(),
      customerName,
      accountNumber,
      amount,
      recipient,
    },
  });
});

app.post('/incoming-call', (req, res) => {
  console.log('Incoming call received');
  try {
    const response = new VoiceResponse();
    const connect = response.connect();
    console.log('Call received');
    connect.stream({ url: `${process.env.HOSTNAME}/media-stream` });
    console.log('Stream connected at:', `${process.env.HOSTNAME}/media-stream`);
    res.type('text/xml');
    console.log('Response sent:', response.toString());
    res.send(response.toString());
  } catch (error) {
    console.error('Error processing call:', error);
    res.status(500).send('Error handling call');
  }
});

const server = createServer(app);

// WebSocket server for client communication
const clientWss = new WebSocketServer({
  noServer: true,
  path: '/client-updates',
});

// Store client connections
const clientConnections = new Map();

// Handle client WebSocket connections
clientWss.on('connection', (ws, req) => {
  // Get client identifier from URL query parameters
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId') || `client-${Date.now()}`;

  console.log(`Client connected with ID: ${clientId}`);

  // Store the connection
  clientConnections.set(clientId, ws);

  // Send initial session data to the client
  ws.send(
    JSON.stringify({
      type: 'session-update',
      data: activeSessionData,
    })
  );

  // Check if there's a pending action for this client
  if (activeSessionData.pendingAction) {
    ws.send(
      JSON.stringify({
        type: 'action',
        action: activeSessionData.pendingAction,
      })
    );
  }

  // Handle client disconnection
  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clientConnections.delete(clientId);
  });
});

// Handle the WebSocket upgrade for client connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`)
    .pathname;

  if (pathname === '/client-updates') {
    clientWss.handleUpgrade(request, socket, head, (ws) => {
      clientWss.emit('connection', ws, request);
    });
  }
});

// Define a type for the message object
interface ClientMessage {
  type: string;
  [key: string]: any; // Allow additional properties
}

function broadcastToClients(message: ClientMessage) {
  clientConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

const twilioWss = new WebSocketServer({
  noServer: true,
  path: '/media-stream',
});

// Handle the WebSocket upgrade for Twilio connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`)
    .pathname;

  if (pathname === '/media-stream') {
    twilioWss.handleUpgrade(request, socket, head, (ws) => {
      twilioWss.emit('connection', ws, request);
    });
  }
});

twilioWss.on('connection', (twilioWs) => {
  console.log('Twilio web socket connection established');
  let streamSid: string;

  // Generate a unique session ID for this connection
  const sessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // Update active session with the new session ID
  activeSessionData.sessionId = sessionId;
  activeSessionData.pendingAction = null;

  // Establish a WebSocket connection to OpenAI's Realtime API.
  const openaiWs = new WebSocket(process.env.OPENAI_REALTIME_WS || '', {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'openai-beta': 'realtime=v1',
      'OpenAI-Organization': process.env.OPENAI_ORG || '',
    },
  });

  const sendSessionUpdate = (): void => {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 600,
          threshold: 0.6,
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: VOICE,
        instructions: systemMessage,
        modalities: ['text', 'audio'],
        tools: [
          {
            type: 'function',
            name: 'lookupCustomer',
            description: 'Look up customer information by name',
            parameters: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Customer name',
                },
                accountNumber: {
                  type: 'string',
                  description: 'Account number',
                },
              },
            },
          },
          {
            type: 'function',
            name: 'checkBalance',
            description: 'Check customer balance',
            parameters: {
              type: 'object',
              properties: {
                account: {
                  type: 'string',
                  description: 'Account number',
                },
              },
            },
          },
          {
            type: 'function',
            name: 'payBills',
            description: 'Prepare bill payment form',
            parameters: {
              type: 'object',
              properties: {
                customerName: {
                  type: 'string',
                  description: 'Customer name',
                },
                accountNumber: {
                  type: 'string',
                  description: 'Account number',
                },
              },
            },
          },
          {
            type: 'function',
            name: 'provideBranchInfo',
            description: 'Provide branch information',
            parameters: {
              type: 'object',
              properties: {
                zipCode: {
                  type: 'string',
                  description: 'Zip code',
                },
              },
            },
          },
          {
            type: 'function',
            name: 'redirectToPayBillsForm',
            description: 'Redirect user to bill payment form',
            parameters: {
              type: 'object',
              properties: {
                customerName: {
                  type: 'string',
                  description: 'Customer name',
                },
                accountNumber: {
                  type: 'string',
                  description: 'Account number',
                },
              },
            },
          },
        ],
        tool_choice: 'auto',
        temperature: 0.8,
      },
    };
    console.log('Sending session update:', JSON.stringify(sessionUpdate));
    openaiWs.send(JSON.stringify(sessionUpdate));
  };

  // Open event for OpenAI WebSocket
  openaiWs.on('open', () => {
    console.log('Connected to the OpenAI Realtime API');
    setTimeout(sendSessionUpdate, 250); // Ensure connection stability, send after .25 seconds
  });

  openaiWs.on('message', (data: WebSocket.RawData) => {
    try {
      let jsonString: string;
      if (typeof data === 'string') {
        jsonString = data;
      } else if (data instanceof Buffer) {
        jsonString = data.toString('utf-8');
      } else if (data instanceof ArrayBuffer) {
        jsonString = Buffer.from(data).toString('utf-8');
      } else {
        throw new Error('Unsupported data type');
      }

      const response = JSON.parse(jsonString);
      console.log(response.type);
      if (LOG_EVENT_TYPES.includes(response.type)) {
        console.log(`Received event: ${response.type}`, response);
      }
      if (response.type === 'session.updated') {
        console.log('Session updated successfully:', response);
      }
      if (response.type === 'response.audio.delta' && response.delta) {
        console.log('Received audio delta.');
        const audioDelta = {
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: Buffer.from(response.delta, 'base64').toString('base64'),
          },
        };
        twilioWs.send(JSON.stringify(audioDelta));
      }
      if (response.type === 'response.output_item.done') {
        const { item } = response;
        if (item.type === 'function_call') {
          if (item.name === 'lookupCustomer') {
            const args = JSON.parse(item.arguments);
            lookupCustomer(args).then((customer) => {
              console.log('Item>>>>>>>>:', item.arguments);
              console.log('Customer>>>>>>>>:', customer);

              // Store customer info in active session
              try {
                const customerObj = JSON.parse(customer);
                if (customerObj && typeof customerObj === 'object') {
                  // Check if this is an error object or a valid customer
                  if (customerObj.error) {
                    console.log(
                      'Customer lookup returned an error:',
                      customerObj.message
                    );
                    // Still store the placeholder values to prevent errors later
                    activeSessionData.customerName =
                      customerObj.name || 'Unknown Customer';
                    activeSessionData.accountNumber =
                      customerObj.accountNumber || 'Unknown';
                  } else {
                    // Store actual customer data
                    activeSessionData.customerName = customerObj.name || '';
                    activeSessionData.accountNumber =
                      customerObj.accountNumber || '';
                  }

                  // Broadcast session data update to all clients
                  broadcastToClients({
                    type: 'session-update',
                    data: activeSessionData,
                  });
                }
              } catch (e) {
                console.error('Error parsing customer data:', e);
                // Set default values in case of parsing error
                activeSessionData.customerName = 'Unknown Customer';
                activeSessionData.accountNumber = 'Unknown';
              }

              const data = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: customer,
                },
              };
              console.log('Sending customer:', data);
              openaiWs.send(JSON.stringify(data));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            });
          } else if (item.name === 'checkBalance') {
            checkBalance(JSON.parse(item.arguments)).then((balance) => {
              const data = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: JSON.stringify(balance),
                },
              };
              console.log('Sending balance:', data);
              openaiWs.send(JSON.stringify(data));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            });
          } else if (item.name === 'payBills') {
            const args = JSON.parse(item.arguments);

            // Update session data with the latest customer info
            if (args.customerName)
              activeSessionData.customerName = args.customerName;
            if (args.accountNumber)
              activeSessionData.accountNumber = args.accountNumber;

            // Set a pending action to show the payment form
            activeSessionData.pendingAction = 'show-payment-form';

            // Broadcast to all clients to show the payment form
            broadcastToClients({
              type: 'action',
              action: 'show-payment-form',
              data: {
                customerName: activeSessionData.customerName,
                accountNumber: activeSessionData.accountNumber,
              },
            });

            const payBillsResponse = {
              status: 'ready',
              message:
                'Bill payment form is ready. Please go to the home page at /index. The payment form will automatically appear.',
              formUrl: `/index?action=pay-bills&sessionId=${activeSessionData.sessionId}`,
            };

            const data = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: item.call_id,
                output: JSON.stringify(payBillsResponse),
              },
            };
            console.log('Sending payBills info:', data);
            openaiWs.send(JSON.stringify(data));
            openaiWs.send(JSON.stringify({ type: 'response.create' }));
          } else if (item.name === 'provideBranchInfo') {
            provideBranchInfo(JSON.parse(item.arguments)).then((branchInfo) => {
              const data = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: JSON.stringify(branchInfo),
                },
              };
              console.log('Sending branch info:', data);
              openaiWs.send(JSON.stringify(data));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            });
          } else if (item.name === 'redirectToPayBillsForm') {
            const args = JSON.parse(item.arguments);

            // Update session data with the latest customer info
            if (args.customerName)
              activeSessionData.customerName = args.customerName;
            if (args.accountNumber)
              activeSessionData.accountNumber = args.accountNumber;

            // Set a pending action to show the payment form
            activeSessionData.pendingAction = 'show-payment-form';

            // Broadcast to all clients to show the payment form
            broadcastToClients({
              type: 'action',
              action: 'show-payment-form',
              data: {
                customerName: activeSessionData.customerName,
                accountNumber: activeSessionData.accountNumber,
              },
            });

            const redirectResponse = {
              status: 'redirect',
              url: `/index?action=pay-bills&sessionId=${activeSessionData.sessionId}`,
              message:
                'Please go to the home page. The payment form will automatically appear.',
            };

            const data = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: item.call_id,
                output: JSON.stringify(redirectResponse),
              },
            };
            console.log('Sending redirect info:', data);
            openaiWs.send(JSON.stringify(data));
            openaiWs.send(JSON.stringify({ type: 'response.create' }));
          }
        }
      }
      if (response.type === 'response.done') {
        console.log('Response done event received:', response);
        if (
          response.response.status === 'failed' &&
          response.response.status_details
        ) {
          const errorDetails = JSON.stringify(
            response.response.status_details.error
          );
          console.log('Error details:', errorDetails);
        }
      }
    } catch (error) {
      console.error(
        'Error processing OpenAI message:',
        error,
        'Raw message:',
        data
      );
    }
  });

  openaiWs.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  twilioWs.on('message', async (msg) => {
    const message = JSON.parse(msg.toString());

    switch (message.event) {
      case 'start':
        streamSid = message.start.streamSid;
        console.log('Twilio stream started:', streamSid);
        break;

      case 'media':
        if (openaiWs.readyState === WebSocket.OPEN) {
          const audioAppend = {
            type: 'input_audio_buffer.append',
            audio: message.media.payload,
          };
          openaiWs.send(JSON.stringify(audioAppend));
        }
        break;

      case 'stop':
        console.log('Twilio stream stopped');
        openaiWs.close();
        break;
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio webSocket connection closed');
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});

// Mock customer database with account numbers
const customerDB = [
  {
    firstName: 'John',
    lastName: 'Doe',
    name: 'John Doe',
    accountNumber: '12345',
    balance: 5243.87,
  },
  {
    firstName: 'Mary',
    lastName: 'Smith',
    name: 'Mary Smith',
    accountNumber: '09876',
    balance: 12456.34,
  },
  {
    firstName: 'John',
    lastName: 'Thompson',
    name: 'John Thompson',
    accountNumber: '56789',
    balance: 7891.23,
  },
  {
    firstName: 'Mary',
    lastName: 'Baker',
    name: 'Mary Baker',
    accountNumber: '43210',
    balance: 3245.67,
  },
];

const lookupCustomer = async (params: any) => {
  // Check if we received params.name or params.customerName
  const nameInput = params.name || params.customerName || '';

  // Look for account number in various possible fields
  const accountInput = params.account || params.accountNumber || '';

  console.log(
    `Looking up customer with name: "${nameInput}", account: "${accountInput}"`
  );

  let customer: (typeof customerDB)[0] | null = null; // Initialize customer as null

  // First try to find by account number if provided
  if (accountInput && accountInput.trim() !== '') {
    // Clean up account number (remove dashes or spaces)
    const cleanAccountNum = accountInput.replace(/[-\s]/g, '');
    customer =
      customerDB.find(
        (c) => c.accountNumber.replace(/[-\s]/g, '') === cleanAccountNum
      ) || null;

    if (customer) {
      console.log(`Found customer by account number: ${customer.name}`);
      return JSON.stringify(customer);
    }
  }

  // If no account match or no account provided, try by name
  if (nameInput && nameInput.trim() !== '') {
    const input = nameInput.trim();
    const hasComma = input.includes(',');

    if (hasComma) {
      // If there's a comma, treat as firstName, lastName format
      const [firstName, lastName] = input
        .split(',')
        .map((name: string) => name.trim());
      customer =
        customerDB.find(
          (c) =>
            c.firstName.toLowerCase() === firstName.toLowerCase() &&
            c.lastName.toLowerCase() === lastName.toLowerCase()
        ) || null;
    } else {
      // Single name search - could be either first or last name
      const searchName = input;
      customer =
        customerDB.find(
          (c) =>
            c.firstName.toLowerCase().includes(searchName.toLowerCase()) ||
            c.lastName.toLowerCase().includes(searchName.toLowerCase())
        ) || null;
    }
  }

  // Return customer if found, otherwise return a JSON object with an error message
  if (customer) {
    return JSON.stringify(customer);
  } else {
    return JSON.stringify({
      error: true,
      message: 'Customer not found',
      name: nameInput || 'Unknown Customer',
      accountNumber: accountInput || 'Unknown',
    });
  }
};

const checkBalance = async (params: any) => {
  const account = params.account;
  const customer = customerDB.find((c) => c.accountNumber === account);

  if (customer) {
    return {
      accountNumber: customer.accountNumber,
      name: customer.name,
      balance: customer.balance,
      formattedBalance: `$${customer.balance.toFixed(2)}`,
    };
  } else {
    return { error: 'Account not found' };
  }
};

// Define the type for branch information
interface BranchInfo {
  name: string;
  address: string;
  hours: string;
  phone: string;
}

// Define the type for branchesDB with an index signature
const branchesDB: { [key: string]: BranchInfo } = {
  '94538': {
    name: 'Fremont Main Branch',
    address: '39150 Fremont Blvd, Fremont, CA 94538',
    hours: 'Mon-Fri: 9:00 AM - 5:00 PM, Sat: 9:00 AM - 1:00 PM',
    phone: '(510) 555-1234',
  },
  '94555': {
    name: 'Fremont Ardenwood Branch',
    address: '5000 Mowry Ave, Fremont, CA 94555',
    hours: 'Mon-Fri: 9:00 AM - 5:00 PM, Sat: Closed',
    phone: '(510) 555-5678',
  },
  '94536': {
    name: 'Fremont Centerville Branch',
    address: '37111 Fremont Blvd, Fremont, CA 94536',
    hours: 'Mon-Fri: 9:00 AM - 6:00 PM, Sat: 9:00 AM - 2:00 PM',
    phone: '(510) 555-9012',
  },
};

const provideBranchInfo = async (params: any) => {
  const zipCode: string = params.zipCode;

  if (branchesDB[zipCode]) {
    return branchesDB[zipCode];
  } else {
    // Return nearest branch if exact zipcode not found
    return branchesDB['94538']; // Default to main branch
  }
};

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
