import express, { Request, Response } from 'express';
import { twiml } from 'twilio';
import {
  initiateCall,
  endCall,
  startConversation,
  handleCustomerResponse,
  flowIds,
} from './voiceService';
import ngrok from 'ngrok';
import { uploadAudioToStorage } from './utils';
import { activeCalls, ActiveCallData } from './config';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

interface InitiateCallRequest {
  phoneNumber: string;
}

interface VoiceWebhookRequest {
  SpeechResult: any;
  CallSid: string;
  RecordingUrl?: string;
  Digits?: string;
}

interface StatusCallbackRequest {
  CallSid: string;
  CallStatus: string;
}

// Initialize outbound call.
app.post(
  '/initiate-call',
  async (req: Request<{}, {}, InitiateCallRequest>, res: Response) => {
    const { phoneNumber } = req.body;
    try {
      const result = await initiateCall(phoneNumber);
      res.json({ success: true, callSid: result.callSid });
    } catch (error) {
      console.error('Error initiating call:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
);

// Handle voice webhook.
app.post(
  '/voice-webhook',
  async (
    req: Request<{}, {}, VoiceWebhookRequest>,
    res: Response
  ): Promise<void> => {
    const { CallSid, Digits, RecordingUrl } = req.body;
    console.log('Webhook request body:', req.body);

    const twimlResponse = new twiml.VoiceResponse();

    try {
      let ttsAudio: string | undefined;

      if (req.body.SpeechResult) {
        let callData: ActiveCallData | undefined = activeCalls.get(CallSid);
        if (callData) {
          callData.msg = req.body.SpeechResult;
          callData.resolve(req.body.SpeechResult);

          //wait for callData to be resolved
          await new Promise((resolve) => {
            // Update the activeCalls entry with the real resolve function.
            callData.resolve = resolve;
          });
        } else {
          throw new Error('Call data is undefined');
        }
      } else if (RecordingUrl) {
        // Process the customer's recording: convert voice to text and resolve the waiting tool promise.
        ttsAudio = await handleCustomerResponse(CallSid, RecordingUrl);
      } else if (Digits) {
        let flowId = flowIds.get(CallSid);
        if (!flowId) {
          ttsAudio = await startConversation(CallSid);
        } else {
          ttsAudio = await handleCustomerResponse(CallSid, flowId);
        }
      } else {
        // Initial interaction: ask the user to press a key to start.
        twimlResponse
          .gather({
            action: '/voice-webhook',
            numDigits: 1,
            timeout: 10,
          })
          .say('Press any key to start.');
        res.type('text/xml');
        res.send(twimlResponse.toString());
        return;
      }

      console.log('Got the TTS audio for webhook.');

      // Build the public URL for the audio file using the ngrok BASE_URL.
      if (!ttsAudio) {
        throw new Error('TTS audio is undefined');
      }
      const filename = `call-${CallSid}.mp3`;
      const audioBuffer = Buffer.from(ttsAudio, 'base64');
      const audioUrl = await uploadAudioToStorage(audioBuffer, filename);
      console.log('Audio file available at:', audioUrl);

      // In the TwiML response, play the audio from the public URL.
      twimlResponse.play(audioUrl);

      // Set up a gather for the next input.
      twimlResponse.gather({
        action: '/voice-webhook',
        input: ['speech', 'dtmf'],
        numDigits: 1,
        timeout: 5,
      });

      console.log('TwiML Response:', twimlResponse.toString());
      res.type('text/xml').send(twimlResponse.toString());
    } catch (error) {
      console.error('Error in voice webhook:', error);
      twimlResponse.say('Sorry, there was an error. Please try again later.');
      twimlResponse.hangup();
      await endCall(CallSid);
      res.type('text/xml').send(twimlResponse.toString());
    }
  }
);

// Handle call status updates.
app.post(
  '/status-callback',
  async (req: Request<{}, {}, StatusCallbackRequest>, res: Response) => {
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
  }
);

// Start the server and set up ngrok.
async function startServer() {
  try {
    const PORT = parseInt(process.env.PORT || '3000', 10);
    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    const useNgrok = process.env.USE_NGROK === 'true';
    if (useNgrok) {
      try {
        await ngrok.kill();
        const url = await ngrok.connect({
          addr: PORT,
          authtoken: process.env.NGROK_AUTH_TOKEN,
        });
        console.log(`\nNgrok tunnel established at: ${url}`);
        process.env.BASE_URL = url;
      } catch (ngrokError) {
        console.error('\nError setting up ngrok:', ngrokError);
        process.env.BASE_URL = `http://localhost:${PORT}`;
      }
    } else {
      process.env.BASE_URL = `http://localhost:${PORT}`;
    }

    console.log('\nServer is ready to handle calls.');
    console.log('To make a call, send a POST request to:');
    console.log(`${process.env.BASE_URL}/initiate-call`);
    console.log('with body: { "phoneNumber": "+1234567890" }');

    process.on('SIGTERM', async () => {
      console.log('Shutting down...');
      if (useNgrok) {
        await ngrok.kill();
      }
      server.close();
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Start the server.
startServer().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
