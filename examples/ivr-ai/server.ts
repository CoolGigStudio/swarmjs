import express, { Request, Response } from 'express';
import { twiml } from 'twilio';
import { initiateCall, handleCustomerResponse, endCall } from './voiceService';
import ngrok from 'ngrok';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

interface InitiateCallRequest {
  phoneNumber: string;
}

interface VoiceWebhookRequest {
  CallSid: string;
  RecordingUrl?: string;
}

interface StatusCallbackRequest {
  CallSid: string;
  CallStatus: string;
}

// Initialize outbound call
app.post(
  '/initiate-call',
  async (req: Request<{}, {}, InitiateCallRequest>, res: Response) => {
    const { phoneNumber } = req.body;

    try {
      const result = await initiateCall(phoneNumber);
      res.json({ success: true, callSid: result.callSid });
    } catch (error) {
      console.error('Error initiating call:', error);
      res
        .status(500)
        .json({
          error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
  }
);

// Handle voice webhook
app.post(
  '/voice-webhook',
  async (req: Request<{}, {}, VoiceWebhookRequest>, res: Response) => {
    const callSid = req.body.CallSid;
    const recordingUrl = req.body.RecordingUrl;
    const response = new twiml.VoiceResponse();

    try {
      if (recordingUrl) {
        // Process the customer's response and get the next message
        const audioContent = await handleCustomerResponse(
          callSid,
          recordingUrl
        );

        // Play the response and record the next input
        response.play({}, Buffer.from(audioContent, 'base64').toString());
        response.record({
          action: '/voice-webhook',
          maxLength: 10,
          timeout: 2,
        });
      } else {
        // Record the customer's response
        response.record({
          action: '/voice-webhook',
          maxLength: 10,
          timeout: 2,
        });
      }
    } catch (error) {
      console.error('Error in voice webhook:', error);
      response.say('Sorry, there was an error. Please try again later.');
      response.hangup();
      await endCall(callSid);
    }

    res.type('text/xml');
    res.send(response.toString());
  }
);

// Handle call status updates
app.post(
  '/status-callback',
  async (req: Request<{}, {}, StatusCallbackRequest>, res: Response) => {
    const callSid = req.body.CallSid;
    const status = req.body.CallStatus;

    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'busy' ||
      status === 'no-answer'
    ) {
      await endCall(callSid);
    }

    res.sendStatus(200);
  }
);

// Start the server and set up ngrok
async function startServer() {
  try {
    // Ensure PORT is a number
    const PORT = parseInt(process.env.PORT || '3000', 10);

    // Start express server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Start ngrok and get public URL
    const url = await ngrok.connect(PORT);
    console.log(`Ngrok tunnel established at: ${url}`);

    // Update webhook URL in environment
    process.env.BASE_URL = url;

    console.log('Server is ready to handle calls.');
    console.log('To make a call, send a POST request to:');
    console.log(`${url}/initiate-call`);
    console.log('with body: { "phoneNumber": "+1234567890" }');
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(console.error);
