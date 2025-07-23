import express from 'express';
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { SYSTEM_MESSAGE } from './prompts';

config();

const systemMessage = SYSTEM_MESSAGE;
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

const twilioWss = new WebSocketServer({ server });

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
              },
            },
          },
          {
            type: 'function',
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
            },
          },
          {
            type: 'function',
            name: 'bookAppointment',
            description: 'Book an appointment slot',
            parameters: {
              type: 'object',
              properties: {
                bookingInfo: {
                  type: 'string',
                  description: 'Appointment date and time and user',
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
            lookupCustomer(JSON.parse(item.arguments)).then((customer) => {
              console.log('Item>>>>>>>>:', item.arguments);
              console.log('Customer>>>>>>>>:', customer);
              const data = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: JSON.stringify(customer),
                },
              };
              console.log('Sending customer:', data);
              openaiWs.send(JSON.stringify(data));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            });
          } else if (item.name === 'checkAvailableSlots') {
            checkAvailableSlots(JSON.parse(item.arguments)).then((slots) => {
              const data = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: JSON.stringify(slots),
                },
              };
              console.log('Sending slots:', data);
              openaiWs.send(JSON.stringify(data));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            });
          } else if (item.name === 'bookAppointment') {
            bookAppointment(JSON.parse(item.arguments)).then((booking) => {
              const data = {
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: item.call_id,
                  output: JSON.stringify(booking),
                },
              };
              console.log('Sending booking:', data);
              openaiWs.send(JSON.stringify(data));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            });
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

const customerDB = [
  {
    firstName: 'John',
    lastName: 'Doe',
    name: 'John Doe',
    vehicle: 'Tesla Model 3',
    history: 'Last service: 2024-01-15',
  },
  {
    firstName: 'Mary',
    lastName: 'Smith',
    name: 'Mary Smith',
    vehicle: 'BMW X5',
    history: 'Last service: 2024-02-20',
  },
  {
    firstName: 'John',
    lastName: 'Thompson',
    name: 'John Thompson',
    vehicle: 'Toyota Camry',
    history: 'Last service: 2024-03-10',
  },
  {
    firstName: 'Mary',
    lastName: 'Baker',
    name: 'Mary Baker',
    vehicle: 'Honda Accord',
    history: 'Last service: 2024-04-15',
  },
];

const lookupCustomer = async (params: any): Promise<string> => {
  // Extract the name from the params object
  const input = params.name.trim();
  const hasComma = input.includes(',');

  if (hasComma) {
    // If there's a comma, treat as firstName, lastName format
    const [firstName, lastName] = input
      .split(',')
      .map((name: string) => name.trim());
    const customer = customerDB.find(
      (c) =>
        c.firstName.toLowerCase() === firstName.toLowerCase() &&
        c.lastName.toLowerCase() === lastName.toLowerCase()
    );
    return customer ? JSON.stringify(customer) : 'Customer not found';
  } else {
    // Single name search - could be either first or last name
    const searchName = input;
    const customer = customerDB.find(
      (c) =>
        c.firstName.toLowerCase().includes(searchName.toLowerCase()) ||
        c.lastName.toLowerCase().includes(searchName.toLowerCase())
    );
    return customer ? JSON.stringify(customer) : 'Customer not found';
  }
};

const appointmentSlots = new Map([
  ['2025-02-08', ['09:00', '11:00', '14:00']],
  ['2025-02-09', ['10:00', '13:00', '15:00']],
  ['2025-01-10', ['09:00', '12:00', '16:00']],
]);

const checkAvailableSlots = async (params: any): Promise<string> => {
  const slots = appointmentSlots.get(params.date as string);
  return slots ? JSON.stringify(slots) : appointmentSlots.get('2025-02-08');
};

const bookAppointment = async (arugments: any): Promise<string> => {
  const { bookingInfo } = arugments;
  console.log('Booking appointment for:', bookingInfo);
  return 'Appointment booked successfully for ' + bookingInfo;
};

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
