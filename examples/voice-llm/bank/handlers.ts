import WebSocket from 'ws';
import {
  activeSessionData,
  clientConnections,
  lookupCustomer,
  checkBalance,
  provideBranchInfo,
} from './data';

// List of event types to log
const LOG_EVENT_TYPES = [
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
];

/**
 * Broadcast a message to all connected clients
 */
export function broadcastToClients(message: any): void {
  clientConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
}

/**
 * Handle client WebSocket connections
 */
export function handleClientConnection(ws: WebSocket, req: any): void {
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
}

/**
 * Handle messages from OpenAI's WebSocket
 */
export function handleOpenAIMessage(
  data: WebSocket.RawData,
  openaiWs: WebSocket,
  twilioWs: WebSocket,
  streamSid: string
): void {
  try {
    let jsonString: string;

    // Convert the message to a string based on its type
    if (typeof data === 'string') {
      jsonString = data;
    } else if (data instanceof Buffer) {
      jsonString = data.toString('utf-8');
    } else if (data instanceof ArrayBuffer) {
      jsonString = Buffer.from(data).toString('utf-8');
    } else {
      throw new Error('Unsupported data type');
    }

    // Parse the JSON message
    const response = JSON.parse(jsonString);
    console.log(response.type);

    // Log specific event types
    if (LOG_EVENT_TYPES.includes(response.type)) {
      console.log(`Received event: ${response.type}`, response);
    }

    // Handle session updates
    if (response.type === 'session.updated') {
      console.log('Session updated successfully:', response);
    }

    // Handle audio responses
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

    // Handle function calls
    if (response.type === 'response.output_item.done') {
      const { item } = response;
      console.log('Response output item received:', item.type);

      if (item.type === 'function_call') {
        console.log('Function call detected:', item.name);
        handleFunctionCall(item, openaiWs);
      }
    }

    // Handle response completion
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
}

/**
 * Handle function calls from OpenAI
 */
async function handleFunctionCall(
  item: any,
  openaiWs: WebSocket
): Promise<void> {
  console.log(`Function call received: ${item.name}`, item);
  const args = JSON.parse(item.arguments);

  try {
    switch (item.name) {
      case 'lookupCustomer':
        console.log('Processing lookupCustomer function call');
        await handleLookupCustomer(item, args, openaiWs);
        break;

      case 'checkBalance':
        console.log('Processing checkBalance function call');
        await handleCheckBalance(item, args, openaiWs);
        break;

      case 'payBills':
        console.log('Processing payBills function call');
        await handlePayBills(item, args, openaiWs);
        break;

      case 'provideBranchInfo':
        console.log('Processing provideBranchInfo function call');
        await handleProvideBranchInfo(item, args, openaiWs);
        break;

      case 'redirectToPayBillsForm':
        console.log('Processing redirectToPayBillsForm function call');
        await handleRedirectToPayBillsForm(item, args, openaiWs);
        break;

      default:
        console.warn(`Unknown function call: ${item.name}`);
    }
  } catch (error) {
    console.error(`Error handling function call ${item.name}:`, error);
  }
}

/**
 * Handle lookupCustomer function call
 */
async function handleLookupCustomer(
  item: any,
  args: any,
  openaiWs: WebSocket
): Promise<void> {
  const customer = await lookupCustomer(args);
  console.log('Item>>>>>>>>:', item.arguments);
  console.log('Customer>>>>>>>>:', customer);

  // Store customer info in active session
  try {
    const customerObj = JSON.parse(customer);
    if (customerObj && typeof customerObj === 'object') {
      // Check if this is an error object or a valid customer
      if (customerObj.error) {
        console.log('Customer lookup returned an error:', customerObj.message);
        // Still store the placeholder values to prevent errors later
        activeSessionData.customerName = customerObj.name || 'Unknown Customer';
        activeSessionData.accountNumber =
          customerObj.accountNumber || 'Unknown';
      } else {
        // Store actual customer data
        activeSessionData.customerName = customerObj.name || '';
        activeSessionData.accountNumber = customerObj.accountNumber || '';
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

  // Send response back to OpenAI
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
}

/**
 * Handle checkBalance function call
 */
async function handleCheckBalance(
  item: any,
  args: any,
  openaiWs: WebSocket
): Promise<void> {
  const balance = await checkBalance(args);
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
}

/**
 * Handle payBills function call
 */
async function handlePayBills(
  item: any,
  args: any,
  openaiWs: WebSocket
): Promise<void> {
  console.log('PayBills tool called with args:', args);

  // Update session data with the latest customer info
  if (args.customerName) {
    activeSessionData.customerName = args.customerName;
    console.log(`Updated customerName to: ${activeSessionData.customerName}`);
  }

  if (args.accountNumber) {
    activeSessionData.accountNumber = args.accountNumber;
    console.log(`Updated accountNumber to: ${activeSessionData.accountNumber}`);
  }

  // Set a pending action to show the payment form
  activeSessionData.pendingAction = 'show-payment-form';
  console.log('Setting pendingAction to show-payment-form');
  console.log('Current session data:', JSON.stringify(activeSessionData));

  // Broadcast session update with the pending action
  const sessionUpdateMsg = {
    type: 'session-update',
    data: activeSessionData,
  };
  console.log('Broadcasting session update:', JSON.stringify(sessionUpdateMsg));
  broadcastToClients(sessionUpdateMsg);

  // Also broadcast direct action message as a failsafe
  const actionMsg = {
    type: 'action',
    action: 'show-payment-form',
    data: {
      customerName: activeSessionData.customerName,
      accountNumber: activeSessionData.accountNumber,
    },
  };
  console.log('Broadcasting action message:', JSON.stringify(actionMsg));
  broadcastToClients(actionMsg);

  // Log connected clients count
  console.log(`Currently connected clients: ${clientConnections.size}`);
  clientConnections.forEach((ws, id) => {
    console.log(`Client ID: ${id}, ReadyState: ${ws.readyState}`);
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
  console.log('Sending payBills response to LLM:', data);
  openaiWs.send(JSON.stringify(data));
  openaiWs.send(JSON.stringify({ type: 'response.create' }));
}

/**
 * Handle provideBranchInfo function call
 */
async function handleProvideBranchInfo(
  item: any,
  args: any,
  openaiWs: WebSocket
): Promise<void> {
  const branchInfo = await provideBranchInfo(args);
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
}

/**
 * Handle redirectToPayBillsForm function call
 */
async function handleRedirectToPayBillsForm(
  item: any,
  args: any,
  openaiWs: WebSocket
): Promise<void> {
  // Update session data with the latest customer info
  if (args.customerName) activeSessionData.customerName = args.customerName;
  if (args.accountNumber) activeSessionData.accountNumber = args.accountNumber;

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

/**
 * Handle messages from Twilio's WebSocket
 */
export function handleTwilioMessage(
  message: any,
  openaiWs: WebSocket,
  streamSid: string
): void {
  switch (message.event) {
    case 'start':
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
}
