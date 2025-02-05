import { GptSwarm } from '../../src/core/GptSwarm';
import { openai, swarmConfig } from './config';
import { activeCalls } from './config';
import { Twilio } from 'twilio';
import fetch from 'node-fetch';

// Export Twilio client
export const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Initialize GptSwarm
export const swarm = new GptSwarm();
swarm.init(swarmConfig);

// Store for flow IDs
export const flowIds = new Map<string, string>();

export async function handleCustomerResponse(
  callSid: string,
  recordingUrl: string
): Promise<string> {
  try {
    // Download the audio file from Twilio.
    const response = await fetch(recordingUrl);
    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const file = new File([blob], 'audio.wav', { type: 'audio/wav' });

    // Transcribe the audio using OpenAI’s Whisper (or any transcription service).
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });
    console.log('Transcribed text:', transcription.text);

    // Retrieve the active call data and resolve the waiting promise.
    const callData = activeCalls.get(callSid);
    if (!callData) {
      throw new Error('No active call found');
    }
    callData.resolve(transcription.text);

    // Return the last TTS audio message so that the webhook can play it back.
    return callData.ttsAudio || '';
  } catch (error) {
    throw new Error(
      `Error handling customer response: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function startConversation(callSid: string): Promise<string> {
  let flowId = flowIds.get(callSid);
  if (!flowId) {
    const flow = await swarm.createSession('VoiceService');
    flowId = flow.id;
    flowIds.set(callSid, flow.id);
  }

  console.log('Starting conversation for call:', callSid, 'with flow:', flowId);

  const initialScript = `
    # Customer Interaction Initialization
    $1 = customerChatVoice(message: "Hello! Welcome to our car dealership. Could you please provide your authentication ID?", callSid: ${callSid})

    # Customer Information Lookup
    $2 = lookupCustomer(authId: $1)

    # Confirm Customer Details
    $3 = customerChatVoice(message: "Thank you! Let me confirm your details: $2. Is everything correct?", callSid: ${callSid})

    # Check for Appointment Needs
    $4 = customerChatVoice(message: "Would you like to book an appointment with us?")

    # Determine Next Steps Based on Customer Response
    # If customer wants to book an appointment, proceed with availability check
    # Hierarchical Task: Appointment Booking Process
        # Get Current and Earliest Available Dates
        $5 = getEarliestAvailableDate()

        # Check Available Slots for the Earliest Date
        $6 = checkAvailableSlots(date: $5.earliestDate)

        # Present Options to Customer
        $7 = customerChatVoice(message: "Here are the available slots for $5.earliestDate: $6. Please choose one.", callSid: ${callSid})

        # Book the Appointment
        $8 = bookAppointment(date: $5.earliestDate, time: $7, authId: $1)

        # Confirm Booking Details
        $9 = customerChatVoice(message: "Your appointment is confirmed for $5.earliestDate at $7. Thank you!", callSid: ${callSid})

    # End of Customer Interaction
    $10 = terminateCall(message: "Thank you for choosing our dealership. Have a great day!", callSid: ${callSid})
  `;

  // Start the conversation asynchronously.
  swarm
    .runSession(flowId, 'Start customer interaction', { script: initialScript })
    .catch((error) => {
      console.error('Error in swarm session:', error);
    });

  // Wait until the first TTS audio is generated (from customerChatVoice).
  const ttsAudio = await new Promise<string>((resolve) => {
    const interval = setInterval(() => {
      const callData = activeCalls.get(callSid);
      if (callData && callData.ttsAudio) {
        clearInterval(interval);
        resolve(callData.ttsAudio);
      }
    }, 500);
  });

  return ttsAudio;
}

export async function initiateCall(
  phoneNumber: string
): Promise<{ callSid: string }> {
  try {
    console.log('Making outbound call to:', phoneNumber);
    console.log('Using webhook URL:', process.env.BASE_URL);

    const call = await twilioClient.calls.create({
      url: `${process.env.BASE_URL}/voice-webhook`,
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
