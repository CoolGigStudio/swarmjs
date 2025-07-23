import * as ws from 'ws';
import { IncomingMessage, Server, createServer } from 'http';
import express, { Request, Response } from 'express';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import * as path from 'path';
import { config } from 'dotenv';

import { SwarmError } from '../types/basic';
import { VoiceAgentConfig, VoiceSwarmConfig } from '../types/voice';

// Create constant for WebSocket states
const OPEN = ws.WebSocket.OPEN;

/**
 * Events emitted by the VoiceIOManager
 */
export type VoiceIOEvent =
  | { type: 'session_start'; sessionId: string; streamSid: string }
  | { type: 'session_end'; sessionId: string }
  | {
      type: 'tool_call';
      sessionId: string;
      toolName: string;
      callId: string;
      args: any;
    }
  | { type: 'client_response'; sessionId: string; callId: string; result: any }
  | { type: 'error'; sessionId: string; error: Error };

/**
 * VoiceIOManager handles the voice input/output channels and WebSocket communication
 * between Twilio (telephony provider) and OpenAI (voice processing).
 */
export class VoiceIOManager {
  private config!: VoiceSwarmConfig;
  private server: Server;
  private twilioWss: ws.WebSocketServer;
  private clientWss: ws.WebSocketServer;
  private app: express.Application;
  private clientConnections: Map<string, ws.WebSocket> = new Map();
  private sessionStreams: Map<
    string,
    {
      twilioWs?: ws.WebSocket;
      openAIWs?: ws.WebSocket;
      streamSid?: string;
      agentConfig?: VoiceAgentConfig;
    }
  > = new Map();

  // Event handlers for callbacks
  private eventHandlers: ((event: VoiceIOEvent) => void)[] = [];

  // Constants for event logging
  private LOG_EVENT_TYPES = [
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
  ];

  constructor() {
    // Initialize environment variables
    config();

    this.app = express();
    this.server = createServer(this.app);

    // Initialize WebSocket servers
    this.twilioWss = new ws.WebSocketServer({
      noServer: true,
      path: '/media-stream',
    });

    this.clientWss = new ws.WebSocketServer({
      noServer: true,
      path: '/client-updates',
    });

    this.setupExpressMiddleware();
    this.setupExpressRoutes();
    this.setupWebSocketUpgrade();
  }

  /**
   * Initialize the VoiceIOManager with configuration
   */
  async init(config: VoiceSwarmConfig): Promise<void> {
    try {
      this.config = config;

      if (!this.config.twilioConfig || !this.config.openAIConfig) {
        throw new SwarmError(
          'Missing Twilio or OpenAI configuration',
          'INITIALIZATION_ERROR'
        );
      }

      // Set up static file serving if a public directory is provided
      if (this.config.server?.publicDir) {
        this.app.use(express.static(this.config.server.publicDir));
      }

      // Setup WebSocket handlers for client and Twilio
      this.setupClientWebSocketHandlers();
      this.setupTwilioWebSocketHandlers();

      // Start the server
      const port = this.config.server?.port || 3010;
      this.server.listen(port, () => {
        console.log(`Voice IO server running on port ${port}`);
      });
    } catch (error) {
      console.error('Error initializing VoiceIOManager:', error);
      throw new SwarmError(
        'Failed to initialize VoiceIOManager',
        'INITIALIZATION_ERROR',
        { error }
      );
    }
  }

  /**
   * Register an event handler callback
   */
  onEvent(handler: (event: VoiceIOEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an event to all registered handlers
   */
  private emitEvent(event: VoiceIOEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in event handler:', error);
      }
    }
  }

  private setupExpressMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupExpressRoutes(): void {
    // Serve static files if configured
    this.app.use(express.static(path.join(__dirname, '../../public')));

    // Client web interface route
    this.app.get('/index', (_req, res) => {
      res.sendFile(path.join(__dirname, '../../public', 'index.html'));
    });

    // API routes for session data and other client needs
    this.app.get('/api/session-data', (_req, res) => {
      res.json({}); // Will be implemented by VoiceSwarm
    });

    // Handle incoming Twilio calls
    this.app.post('/incoming-call', this.handleIncomingCall.bind(this));
  }

  /**
   * Handle incoming Twilio calls
   */
  private handleIncomingCall(req: Request, res: Response): void {
    try {
      console.log('Incoming call received');
      const response = new VoiceResponse();
      const connect = response.connect();

      // Configure stream URL based on config or fallback to request hostname
      const streamUrl = this.config?.server?.hostname
        ? `${this.config.server.hostname}/media-stream`
        : `${req.protocol}://${req.headers.host}/media-stream`;

      connect.stream({ url: streamUrl });
      console.log('Stream connected at:', streamUrl);

      res.type('text/xml');
      res.send(response.toString());
      console.log('Response sent:', response.toString());
    } catch (error) {
      console.error('Error handling incoming call:', error);
      res.status(500).send('Error processing call');
    }
  }

  private setupWebSocketUpgrade(): void {
    // Handle WebSocket upgrade for different endpoints
    this.server.on(
      'upgrade',
      (request: IncomingMessage, socket: any, head: Buffer) => {
        if (!request.url) {
          socket.destroy();
          return;
        }

        const pathname = new URL(request.url, `http://${request.headers.host}`)
          .pathname;

        if (pathname === '/client-updates') {
          this.clientWss.handleUpgrade(request, socket, head, (ws) => {
            this.clientWss.emit('connection', ws, request);
          });
        } else if (pathname === '/media-stream') {
          this.twilioWss.handleUpgrade(request, socket, head, (ws) => {
            this.twilioWss.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      }
    );
  }

  private setupClientWebSocketHandlers(): void {
    // Handle client web browser connections
    this.clientWss.on(
      'connection',
      (ws: ws.WebSocket, req: IncomingMessage) => {
        if (!req.url) {
          console.error('Client connection missing URL');
          return;
        }

        // Get client identifier from URL query parameters
        const url = new URL(req.url, `http://${req.headers.host}`);
        const clientId =
          url.searchParams.get('clientId') || `client-${Date.now()}`;

        console.log(`Client connected with ID: ${clientId}`);

        // Store the connection
        this.clientConnections.set(clientId, ws);

        // Handle client disconnection
        ws.on('close', () => {
          console.log(`Client disconnected: ${clientId}`);
          this.clientConnections.delete(clientId);
        });

        // Handle messages from client
        ws.on('message', (data: ws.Data) => {
          try {
            const dataStr =
              typeof data === 'string'
                ? data
                : data instanceof Buffer
                  ? data.toString('utf-8')
                  : Buffer.from(data as ArrayBuffer).toString('utf-8');

            const message = JSON.parse(dataStr);
            console.log('Received message from client:', message);

            // Handle tool responses from client
            if (
              message.type === 'tool-response' &&
              message.sessionId &&
              message.callId
            ) {
              this.emitEvent({
                type: 'client_response',
                sessionId: message.sessionId,
                callId: message.callId,
                result: message.result,
              });
            }
          } catch (error) {
            console.error('Error processing client message:', error);
          }
        });
      }
    );
  }

  private setupTwilioWebSocketHandlers(): void {
    this.twilioWss.on('connection', (twilioWs: ws.WebSocket) => {
      console.log('Twilio web socket connection established');
      let streamSid = '';

      // Generate a unique session ID for this connection
      const sessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Update the session registry with just this info initially
      this.sessionStreams.set(sessionId, { twilioWs });

      // Notify about new session
      this.emitEvent({
        type: 'session_start',
        sessionId,
        streamSid: '',
      });

      // Establish a WebSocket connection to OpenAI's Realtime API directly
      const openAIWs = new ws.WebSocket(
        this.config.openAIConfig.realtimeEndpoint,
        {
          headers: {
            Authorization: `Bearer ${this.config.openAIConfig.apiKey}`,
            'openai-beta': 'realtime=v1',
            'OpenAI-Organization': this.config.openAIConfig.organizationId,
          },
        }
      );

      // Update our session with OpenAI connection
      this.sessionStreams.set(sessionId, {
        twilioWs,
        openAIWs,
      });

      // Open event for OpenAI WebSocket
      openAIWs.on('open', () => {
        console.log(
          'Connected to the OpenAI Realtime API for session:',
          sessionId
        );

        // Get the default agent
        const defaultAgent = this.config.agents[0] as VoiceAgentConfig;
        console.log('Default agent:', defaultAgent);

        // Send session update after a short delay to ensure connection stability
        setTimeout(() => {
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
              voice: defaultAgent.voice || 'alloy',
              instructions: defaultAgent.systemMessage,
              modalities: ['text', 'audio'],
              tools: this.buildToolDefinitions(defaultAgent.allowedTools),
              tool_choice: 'auto',
              temperature: 0.8,
            },
          };

          console.log(
            'Sending session update to OpenAI for session:',
            sessionId
          );
          openAIWs.send(JSON.stringify(sessionUpdate));
        }, 250);
      });

      // Handle messages from OpenAI
      openAIWs.on('message', (data: ws.Data) => {
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

          // Log specific event types
          if (this.LOG_EVENT_TYPES.includes(response.type)) {
            console.log(
              `Received event: ${response.type} for session: ${sessionId}`
            );
          }

          // Handle session updates
          if (response.type === 'session.updated') {
            console.log('Session updated successfully for session:', sessionId);
          }

          // Handle audio responses
          if (
            response.type === 'response.audio.delta' &&
            response.delta &&
            streamSid
          ) {
            const audioDelta = {
              event: 'media',
              streamSid: streamSid,
              media: {
                payload: Buffer.from(response.delta, 'base64').toString(
                  'base64'
                ),
              },
            };
            twilioWs.send(JSON.stringify(audioDelta));
          }

          // Handle function calls
          if (response.type === 'response.output_item.done') {
            const { item } = response;

            if (item && item.type === 'function_call') {
              console.log(
                'Function call detected:',
                item.name,
                'for session:',
                sessionId
              );

              try {
                const args = JSON.parse(item.arguments);

                // Emit tool call event
                this.emitEvent({
                  type: 'tool_call',
                  sessionId,
                  toolName: item.name,
                  callId: item.call_id,
                  args,
                });
              } catch (error) {
                console.error('Error parsing function arguments:', error);
                this.emitEvent({
                  type: 'error',
                  sessionId,
                  error:
                    error instanceof Error ? error : new Error(String(error)),
                });
              }
            }
          }

          // Handle response completion
          if (response.type === 'response.done') {
            console.log('Response done event received for session:', sessionId);
            if (
              response.response &&
              response.response.status === 'failed' &&
              response.response.status_details
            ) {
              console.error(
                'Error details:',
                response.response.status_details.error
              );
            }
          }
        } catch (error) {
          console.error('Error processing OpenAI message:', error);
          this.emitEvent({
            type: 'error',
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

      // Handle errors
      openAIWs.on('error', (error: Error) => {
        console.error('OpenAI WebSocket error for session:', sessionId, error);
        this.emitEvent({
          type: 'error',
          sessionId,
          error,
        });
      });

      // Handle connection close
      openAIWs.on('close', (code: number, reason: Buffer) => {
        console.log(
          'OpenAI WebSocket connection closed for session:',
          sessionId
        );
        console.log(`Close code: ${code}, reason: ${reason.toString()}`);
      });

      // Handle Twilio messages
      twilioWs.on('message', async (data: ws.Data) => {
        try {
          const dataStr =
            typeof data === 'string'
              ? data
              : data instanceof Buffer
                ? data.toString('utf-8')
                : Buffer.from(data as ArrayBuffer).toString('utf-8');

          const message = JSON.parse(dataStr);

          switch (message.event) {
            case 'start': {
              streamSid = message.start.streamSid;

              // Update session data with streamSid
              const sessionData = this.sessionStreams.get(sessionId);
              if (sessionData) {
                sessionData.streamSid = streamSid;
                this.sessionStreams.set(sessionId, sessionData);
              }

              console.log(
                'Twilio stream started:',
                streamSid,
                'Session:',
                sessionId
              );
              break;
            }

            case 'media':
              // Forward media directly to OpenAI - this keeps the connection alive
              if (openAIWs.readyState === OPEN) {
                const audioAppend = {
                  type: 'input_audio_buffer.append',
                  audio: message.media.payload,
                };
                openAIWs.send(JSON.stringify(audioAppend));
              }
              break;

            case 'stop':
              console.log('Twilio stream stopped for session:', sessionId);

              // Close OpenAI connection
              if (openAIWs.readyState === OPEN) {
                openAIWs.close();
              }

              // Cleanup session
              this.sessionStreams.delete(sessionId);

              // Notify about session end
              this.emitEvent({
                type: 'session_end',
                sessionId,
              });
              break;
          }
        } catch (error) {
          console.error('Error processing Twilio message:', error);
          this.emitEvent({
            type: 'error',
            sessionId,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });

      // Handle Twilio disconnection
      twilioWs.on('close', () => {
        console.log(
          'Twilio WebSocket connection closed for session:',
          sessionId
        );

        // Close OpenAI connection
        if (openAIWs.readyState === OPEN) {
          openAIWs.close();
        }

        // Cleanup session
        this.sessionStreams.delete(sessionId);

        // Notify about session end
        this.emitEvent({
          type: 'session_end',
          sessionId,
        });
      });
    });
  }

  /**
   * Register a new session
   */
  async registerSession(
    sessionId: string,
    agentConfig: VoiceAgentConfig
  ): Promise<void> {
    // Create an entry in sessionStreams with the agent config
    this.sessionStreams.set(sessionId, { agentConfig });
    console.log(`Registered session in VoiceIOManager: ${sessionId}`);
    console.log(`Current sessions: ${this.sessionStreams.size}`);
  }

  async handleTwilioConnection(twilioWs: ws.WebSocket): Promise<string> {
    console.log('Twilio web socket connection established');
    let streamSid = '';

    // Generate a unique session ID for this connection
    const sessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Store the connection info
    this.sessionStreams.set(sessionId, {
      twilioWs,
      streamSid: '', // Will be set when Twilio sends 'start' event
    });

    // Setup message handling for this connection
    twilioWs.on('message', async (data: ws.Data) => {
      try {
        const dataStr =
          typeof data === 'string'
            ? data
            : data instanceof Buffer
              ? data.toString('utf-8')
              : Buffer.from(data as ArrayBuffer).toString('utf-8');

        const message = JSON.parse(dataStr);

        switch (message.event) {
          case 'start': {
            streamSid = message.start.streamSid;

            const sessionData = this.sessionStreams.get(sessionId);
            if (sessionData && sessionData.agentConfig) {
              await this.connectToOpenAI(sessionId, sessionData.agentConfig);
            } else {
              console.error(
                `No sessionData ${sessionData} or agent config ${sessionData?.agentConfig} found for session: ${sessionId}`
              );
            }

            console.log(
              'Twilio stream started:',
              streamSid,
              'Session:',
              sessionId
            );
            break;
          }

          case 'media':
            // Forward media to OpenAI
            this.forwardAudioToOpenAI(sessionId, message.media.payload);
            break;

          case 'stop':
            console.log('Twilio stream stopped for session:', sessionId);
            await this.cleanupSession(sessionId);
            break;
        }
      } catch (error) {
        console.error('Error processing Twilio message:', error);
      }
    });

    // Handle disconnection
    twilioWs.on('close', () => {
      console.log('Twilio WebSocket connection closed');
      this.cleanupSession(sessionId).catch((error) => {
        console.error('Error cleaning up session:', error);
      });
    });

    // Emit event about new session
    this.emitEvent({
      type: 'session_start',
      sessionId,
      streamSid: '',
    });

    return sessionId;
  }

  // Helper method to forward audio to OpenAI
  private forwardAudioToOpenAI(sessionId: string, audioPayload: string): void {
    const sessionData = this.sessionStreams.get(sessionId);
    if (sessionData?.openAIWs && sessionData.openAIWs.readyState === OPEN) {
      const audioAppend = {
        type: 'input_audio_buffer.append',
        audio: audioPayload,
      };
      sessionData.openAIWs.send(JSON.stringify(audioAppend));
    }
  }

  /**
   * Connect to OpenAI for a voice session
   */
  async connectToOpenAI(
    sessionId: string,
    agent: VoiceAgentConfig
  ): Promise<void> {
    const sessionData = this.sessionStreams.get(sessionId);
    if (!sessionData) {
      throw new SwarmError(`Session ${sessionId} not found`, 'INVALID_FLOW');
    }

    // Create OpenAI WebSocket connection
    const openAIWs = new ws.WebSocket(
      this.config.openAIConfig.realtimeEndpoint,
      {
        headers: {
          Authorization: `Bearer ${this.config.openAIConfig.apiKey}`,
          'openai-beta': 'realtime=v1',
          'OpenAI-Organization': this.config.openAIConfig.organizationId,
        },
      }
    );

    // Store WebSocket in session
    sessionData.openAIWs = openAIWs;
    this.sessionStreams.set(sessionId, sessionData);

    // Handle connection open
    openAIWs.on('open', () => {
      console.log(
        'Connected to the OpenAI Realtime API for session:',
        sessionId
      );

      // Send session update after a short delay
      setTimeout(() => {
        this.sendSessionUpdate(sessionId, agent);
      }, 250);
    });

    // Handle messages from OpenAI
    openAIWs.on('message', (data: ws.Data) => {
      this.handleOpenAIMessage(data, sessionId);
    });

    // Handle connection errors
    openAIWs.on('error', (error: Error) => {
      console.error('OpenAI WebSocket error:', error);
    });

    // Handle connection close
    openAIWs.on('close', () => {
      console.log('OpenAI WebSocket connection closed for session:', sessionId);
    });
  }

  /**
   * Send session update to OpenAI
   */
  private sendSessionUpdate(sessionId: string, agent: VoiceAgentConfig): void {
    const sessionData = this.sessionStreams.get(sessionId);
    if (
      !sessionData ||
      !sessionData.openAIWs ||
      sessionData.openAIWs.readyState !== OPEN
    ) {
      console.error('Cannot send session update - no active OpenAI connection');
      return;
    }

    // Build tools array from allowed tools
    const tools = this.buildToolDefinitions(agent.allowedTools);

    const sessionUpdate = {
      type: 'session.update',
      session: {
        voice: agent.voice || 'alloy',
        instructions: agent.systemMessage,
        input_audio_format: agent.inputAudioFormat || 'g711_ulaw',
        output_audio_format: agent.outputAudioFormat || 'g711_ulaw',
        turn_detection: agent.turnDetection || {
          type: 'server_vad',
          silence_duration_ms: 600,
          threshold: 0.6,
        },
        tools,
        modalities: ['text', 'audio'],
        temperature: 0.8,
        tool_choice: 'auto',
      },
    };

    console.log('Sending session update to OpenAI for session:', sessionId);
    sessionData.openAIWs.send(JSON.stringify(sessionUpdate));
  }

  /**
   * Handle messages from OpenAI
   */
  private handleOpenAIMessage(data: ws.Data, sessionId: string): void {
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

      // Log specific event types
      if (this.LOG_EVENT_TYPES.includes(response.type)) {
        console.log(
          `Received event: ${response.type} for session: ${sessionId}`
        );
      }

      // Handle session updates
      if (response.type === 'session.updated') {
        console.log('Session updated successfully for session:', sessionId);
      }

      // Handle audio responses
      if (response.type === 'response.audio.delta' && response.delta) {
        this.sendAudioToTwilio(sessionId, response.delta);
      }

      // Handle function calls
      if (response.type === 'response.output_item.done') {
        const { item } = response;

        if (item && item.type === 'function_call') {
          console.log(
            'Function call detected:',
            item.name,
            'for session:',
            sessionId
          );

          try {
            const args = JSON.parse(item.arguments);

            // Emit tool call event
            this.emitEvent({
              type: 'tool_call',
              sessionId,
              toolName: item.name,
              callId: item.call_id,
              args,
            });
          } catch (error) {
            console.error('Error parsing function arguments:', error);
            this.emitEvent({
              type: 'error',
              sessionId,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        }
      }

      // Handle response completion
      if (response.type === 'response.done') {
        console.log('Response done event received for session:', sessionId);
        if (
          response.response &&
          response.response.status === 'failed' &&
          response.response.status_details
        ) {
          console.error(
            'Error details:',
            response.response.status_details.error
          );
        }
      }
    } catch (error) {
      console.error('Error processing OpenAI message:', error);
      this.emitEvent({
        type: 'error',
        sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Send audio response to Twilio
   */
  private sendAudioToTwilio(sessionId: string, audioData: string): void {
    const sessionData = this.sessionStreams.get(sessionId);
    if (!sessionData || !sessionData.twilioWs || !sessionData.streamSid) {
      console.error(
        'Cannot send audio to Twilio - no active Twilio connection'
      );
      return;
    }

    const audioDelta = {
      event: 'media',
      streamSid: sessionData.streamSid,
      media: {
        payload: Buffer.from(audioData, 'base64').toString('base64'),
      },
    };

    sessionData.twilioWs.send(JSON.stringify(audioDelta));
  }

  /**
   * Send tool result back to OpenAI
   */
  async sendToolResult(
    sessionId: string,
    callId: string,
    result: any
  ): Promise<void> {
    const sessionData = this.sessionStreams.get(sessionId);
    if (
      !sessionData ||
      !sessionData.openAIWs ||
      sessionData.openAIWs.readyState !== OPEN
    ) {
      console.error('Cannot send tool result - no active OpenAI connection');
      return;
    }

    // Format the result
    const resultStr =
      typeof result === 'string' ? result : JSON.stringify(result);

    // Create the response
    const response = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: resultStr,
      },
    };

    console.log(`Sending tool result for ${callId}:`, response);

    // Send the response
    sessionData.openAIWs.send(JSON.stringify(response));

    // Create a new response
    sessionData.openAIWs.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Send tool error back to OpenAI
   */
  async sendToolError(
    sessionId: string,
    callId: string,
    errorMessage: string
  ): Promise<void> {
    const sessionData = this.sessionStreams.get(sessionId);
    if (
      !sessionData ||
      !sessionData.openAIWs ||
      sessionData.openAIWs.readyState !== OPEN
    ) {
      console.error('Cannot send tool error - no active OpenAI connection');
      return;
    }

    // Create the error response
    const errorResponse = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({
          error: true,
          message: errorMessage,
        }),
      },
    };

    // Send the error response
    sessionData.openAIWs.send(JSON.stringify(errorResponse));

    // Create a new response
    sessionData.openAIWs.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Broadcast a message to all connected clients
   */
  async broadcastToClients(message: any): Promise<void> {
    this.clientConnections.forEach((ws) => {
      if (ws.readyState === OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
  }

  /**
   * Get the OpenAI WebSocket for a session
   * This allows direct message sending in tool handlers
   */
  getOpenAIWebSocket(sessionId: string): ws.WebSocket | undefined {
    const sessionData = this.sessionStreams.get(sessionId);
    return sessionData?.openAIWs;
  }

  /**
   * Clean up resources for a session
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const sessionData = this.sessionStreams.get(sessionId);
    if (sessionData) {
      // Close WebSocket connections
      if (sessionData.openAIWs && sessionData.openAIWs.readyState === OPEN) {
        sessionData.openAIWs.close();
      }

      if (sessionData.twilioWs && sessionData.twilioWs.readyState === OPEN) {
        sessionData.twilioWs.close();
      }

      // Remove session data
      this.sessionStreams.delete(sessionId);
    }
  }

  /**
   * Build tool definitions from allowed tools
   */
  private buildToolDefinitions(allowedTools: string[]): any[] {
    return this.config.tools
      .filter((tool) => allowedTools.includes(tool.function.name))
      .map((tool) => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
  }
}
