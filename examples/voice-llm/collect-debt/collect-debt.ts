import express from 'express';
import { createServer, get } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { twilioClient } from '../../ivr-ai/voiceService';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  COLLECT_DEBT_SYSTEM_MESSAGE,
  COLLECT_DEBT_SYSTEM_MESSAGE_DAG_CH,
  COLLECT_DEBT_SYSTEM_MESSAGE_DAG,
} from './prompts';

config();

const systemMessage = COLLECT_DEBT_SYSTEM_MESSAGE_DAG;
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

let customerName: string;

const app = express();
const port = process.env.PORT || 3010;
app.use(express.json());

export async function initiateCall(
  phoneNumber: string
): Promise<{ callSid: string }> {
  try {
    console.log('Making outbound call to:', phoneNumber);

    const call = await twilioClient.calls.create({
      url: `${process.env.BASE_URL}/voice-webhook`, // Twilio will hit this when call connects
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER as string,
      statusCallback: `${process.env.BASE_URL}/status-callback`,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'answered', 'completed'],
    });

    console.log('Call initiated with SID:', call.sid);
    return { callSid: call.sid };
  } catch (error) {
    throw new Error(
      `Failed to initiate call: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function endCall(callSid: string): Promise<void> {
  try {
    await twilioClient.calls(callSid).update({ status: 'completed' });
  } catch (error) {
    console.error('Error ending call:', error);
  }
}

const publicPath = path.join(__dirname, 'index_ch.html');

console.log('publicPath:', publicPath);
app.get('/index', (req, res) => {
  res.sendFile(publicPath);
});

// Handle outbound call webhook
app.post('/voice-webhook', (req, res) => {
  console.log('Voice webhook triggered for outbound call');
  try {
    const response = new VoiceResponse();
    const connect = response.connect();

    // This instructs Twilio to open a WebSocket connection to your /media-stream endpoint
    connect.stream({ url: `${process.env.HOSTNAME}/media-stream` });

    res.type('text/xml');
    res.send(response.toString());
  } catch (error) {
    console.error('Error in voice webhook:', error);
    res.status(500).send('Error handling call');
  }
});

app.post('/start-call', async (req, res) => {
  console.log('Start call received');
  const {
    customerName: currentCustomer,
    phoneNumber,
    customerProfile,
  } = req.body;
  customerName = currentCustomer;
  console.log('Customer name:', customerName);
  console.log('Phone number:', phoneNumber);
  console.log('Customer profile:', customerProfile);

  // Call the customer using twilio
  try {
    const result = await initiateCall(phoneNumber);
    res.json({ success: true, callSid: result.callSid });
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Handle call status updates.
app.post('/status-callback', async (req, res) => {
  const { CallSid, CallStatus } = req.body;
  console.log('Call Status Update:', req.body);

  if (['failed', 'busy', 'no-answer'].includes(CallStatus)) {
    try {
      console.log('Ending call:', CallSid);
      await endCall(CallSid);
    } catch (error) {
      console.error('Error ending call:', error);
    }
  }

  res.sendStatus(200);
});

const server = createServer(app);

const twilioWss = new WebSocketServer({ noServer: true });

// Handle the WebSocket upgrade for Twilio connections
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`)
    .pathname;

  if (pathname === '/media-stream') {
    twilioWss.handleUpgrade(request, socket, head, (ws) => {
      twilioWss.emit('connection', ws, request);
    });
  } else {
    // For any other WebSocket routes (if you add them in the future)
    socket.destroy();
  }
});

twilioWss.on('connection', (twilioWs) => {
  console.log('Twilio web socket connection established');
  let streamSid: string;

  // Conversation history can be maintained if needed.
  // let conversationHistory: string[] = [];

  // // Timestamp of the last significant (non-silent) audio.
  // let lastSignificantTimestamp: number | null = null;

  // // Buffer for accumulating audio/text if needed.
  // let questionBuffer = '';

  // Establish a WebSocket connection to OpenAI's Realtime API.
  const openaiWs = new WebSocket(process.env.OPENAI_REALTIME_WS || '', {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'openai-beta': 'realtime=v1',
      'OpenAI-Organization': process.env.OPENAI_ORG || '',
    },
  });

  const sendSessionUpdate = (customerName: string): void => {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 500,
          threshold: 0.6,
        },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: VOICE,
        instructions: systemMessage.replace('{customer_name}', customerName),
        modalities: ['text', 'audio'],
        tools: [
          {
            type: 'function',
            name: 'lookupDebt',
            description: 'Look up customer debt information',
            parameters: {
              type: 'object',
              properties: {
                customerName: {
                  type: 'string',
                  description: 'Customer name',
                },
              },
              required: ['customerName'],
            },
          },
          {
            type: 'function',
            name: 'processPayment',
            description: 'Process a payment for the debt',
            parameters: {
              type: 'object',
              properties: {
                amount: {
                  type: 'number',
                  description: 'Payment amount',
                },
                paymentMethod: {
                  type: 'string',
                  description:
                    'Payment method (credit card, bank transfer, etc.)',
                },
              },
              required: ['amount', 'paymentMethod'],
            },
          },
          {
            type: 'function',
            name: 'arrangePaymentPlan',
            description: 'Set up a payment plan',
            parameters: {
              type: 'object',
              properties: {
                installments: {
                  type: 'number',
                  description: 'Number of installments',
                },
                startDate: {
                  type: 'string',
                  description: 'Start date for the payment plan (YYYY-MM-DD)',
                },
              },
              required: ['installments', 'startDate'],
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
    setTimeout(() => sendSessionUpdate(customerName), 250); // Ensure connection stability, send after .25 seconds
  });

  openaiWs.on('message', async (data: WebSocket.RawData) => {
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
          console.log('Function call:', item);

          try {
            const args = JSON.parse(item.arguments);
            let result;

            switch (item.name) {
              case 'lookupDebt':
                result = await lookupDebt(args);
                console.log('Lookup debt result:', result);
                break;
              case 'verifyCustomerIdentity':
                result = await verifyCustomerIdentity(args);
                break;
              case 'processPayment':
                result = await processPayment(args);
                console.log('Process payment result:', result);
                break;
              case 'arrangePaymentPlan':
                result = await arrangePaymentPlan(args);
                console.log('Arrange payment plan result:', result);
                break;
              default:
                result = JSON.stringify({ error: 'Unknown function' });
            }

            const data = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: item.call_id,
                output: result,
              },
            };
            console.log('Sending function result:', data);
            openaiWs.send(JSON.stringify(data));
            openaiWs.send(JSON.stringify({ type: 'response.create' }));
          } catch (error) {
            console.error('Error processing function call:', error);
            const errorData = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: item.call_id,
                output: JSON.stringify({
                  error: 'Error processing function call',
                }),
              },
            };
            openaiWs.send(JSON.stringify(errorData));
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

        /* // Commit the real-time event to OpenAI after 10 seconds.
        setTimeout(() => {
          console.log('Committing real-time event to OpenAI');
          if (openaiWs.readyState === WebSocket.OPEN) {
            openaiWs.send(
              JSON.stringify({
                type: 'input_audio_buffer.commit',
              })
            );
            openaiWs.send(JSON.stringify({ type: 'response.create' }));
          }
        }, 10000); */
        break;

      // In the message handler for 'media' event:
      // In the server.ts file, update the media event handler:
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

// Replace the customer database with a debt database
const debtDB = [
  {
    customerId: '123456',
    name: '李强',
    amount: 1250.75,
    currency: 'CNY',
    dueDate: '2025-01-15',
    status: 'overdue',
    lastContact: '2025-01-30',
    address: '123 Main St, Anytown, US',
    phoneNumber: '+1555123456',
  },
  {
    customerId: '789012',
    name: 'Mary Smith',
    amount: 850.25,
    currency: 'CNY',
    dueDate: '2025-02-10',
    status: 'overdue',
    lastContact: '2025-02-20',
    address: '456 Oak Ave, Somewhere, US',
    phoneNumber: '+1555789012',
  },
  {
    customerId: '345678',
    name: 'John Thompson',
    amount: 2300.0,
    currency: 'CNY',
    dueDate: '2024-12-05',
    status: 'overdue',
    lastContact: '2025-01-15',
    address: '789 Pine Blvd, Elsewhere, US',
    phoneNumber: '+1555345678',
  },
  {
    customerId: '901234',
    name: 'Mary Baker',
    amount: 475.5,
    currency: 'CNY',
    dueDate: '2025-01-20',
    status: 'overdue',
    lastContact: '2025-02-05',
    address: '321 Maple Dr, Nowhere, US',
    phoneNumber: '+1555901234',
  },
];

// Implement the debt collection function handlers
const lookupDebt = async (params: any) => {
  console.log('Looking up debt for:', params);
  const { customerName } = params;

  const debtInfo = debtDB.find((debt) =>
    debt.name.toLowerCase().includes(customerName.toLowerCase())
  );

  return debtInfo
    ? JSON.stringify(debtInfo)
    : JSON.stringify({ error: 'Customer debt information not found' });
};

const verifyCustomerIdentity = async (params: any) => {
  console.log('Verifying customer identity:', params);
  const { customerId } = params;

  // In a real implementation, you would verify identity with security questions
  // This is a mock implementation
  const customer = debtDB.find(
    (debt) =>
      debt.customerId === customerId ||
      debt.name.toLowerCase().includes(customerId.toLowerCase())
  );

  if (customer) {
    return JSON.stringify({
      verified: true,
      customerId: customer.customerId,
      name: customer.name,
    });
  } else {
    return JSON.stringify({
      verified: false,
      error: 'Customer not found',
    });
  }
};

const processPayment = async (params: any) => {
  console.log('Processing payment:', params);
  const { amount, paymentMethod } = params;

  // In a real implementation, you would process the payment through a payment gateway
  // This is a mock implementation
  return JSON.stringify({
    success: true,
    amount,
    paymentMethod,
    transactionId: 'PMT' + Math.floor(Math.random() * 1000000),
    timestamp: new Date().toISOString(),
    receipt: 'A receipt will be emailed to the customer',
  });
};

const arrangePaymentPlan = async (params: any) => {
  console.log('Arranging payment plan:', params);
  // const { installments, startDate } = params;

  // Calculate payment dates based on the start date and number of installments
  // const paymentDates = [];
  // const startDateObj = new Date(startDate);

  // for (let i = 0; i < installments; i++) {
  //   const paymentDate = new Date(startDateObj);
  //   paymentDate.setMonth(paymentDate.getMonth() + i);
  //   //paymentDates.push(paymentDate.toISOString().split('T')[0]);
  // }

  // return JSON.stringify({
  //   success: true,
  //   installments,
  //   startDate,
  //   planId: 'PLAN' + Math.floor(Math.random() * 1000000),
  //   paymentDates,
  //   confirmation: 'Payment plan has been arranged',
  // });
  console.log('Arranging payment plan:', params);
  return 'Payment plan has been arranged';
};


server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
