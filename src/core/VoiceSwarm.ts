import {
  Flow,
  ToolResult,
  SwarmError,
  SwarmConfig,
  AgentConfig,
  ToolDefinition,
} from '../types/basic';
import {
  VoiceAgentConfig,
  VoiceSwarmConfig,
  VoiceSession,
} from '../types/voice';
import { AbstractSwarm } from './AbstractSwarm';
import { VoiceIOManager, VoiceIOEvent } from './VoiceIOManager';

/**
 * VoiceSwarm implements the Swarm interface for voice-based interactions
 * using a layered architecture where VoiceIOManager handles the actual voice I/O.
 */
export class VoiceSwarm extends AbstractSwarm {
  private voiceIO: VoiceIOManager;

  // Session data that can be accessed by clients
  private sessionData: Map<
    string,
    {
      metadata: Record<string, any>;
    }
  > = new Map();

  constructor() {
    super();
    this.voiceIO = new VoiceIOManager();
  }

  /**
   * Implementation-specific initialization
   */
  protected async initImpl(config: SwarmConfig): Promise<void> {
    // Cast to VoiceSwarmConfig since we're adding voice-specific properties
    const voiceConfig = config as VoiceSwarmConfig;

    // Initialize the voice I/O manager
    await this.voiceIO.init(voiceConfig);

    // Register event handlers
    this.voiceIO.onEvent(this.handleVoiceIOEvent.bind(this));
  }

  /**
   * Handle events from the VoiceIOManager
   */
  private async handleVoiceIOEvent(event: VoiceIOEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'session_start':
          // A new voice session has started - handled via createSession
          console.log(`Voice session started: ${event.sessionId}`);
          break;

        case 'session_end':
          // A voice session has ended
          if (this.sessions.has(event.sessionId)) {
            await this.endSession(event.sessionId);
          }
          console.log(`Voice session ended: ${event.sessionId}`);
          break;

        case 'tool_call':
          // A tool call was requested
          await this.handleToolCall(
            event.sessionId,
            event.toolName,
            event.callId,
            event.args
          );
          break;

        case 'client_response':
          // A response from a client (e.g., web UI)
          await this.voiceIO.sendToolResult(
            event.sessionId,
            event.callId,
            event.result
          );
          break;

        case 'error':
          // An error occurred
          console.error(
            `Error in voice session ${event.sessionId}:`,
            event.error
          );
          break;
      }
    } catch (error) {
      console.error('Error handling VoiceIO event:', error);
    }
  }

  /**
   * Handle a tool call directly (similar to your handlers.ts approach)
   */
  private async handleToolCall(
    sessionId: string,
    toolName: string,
    callId: string,
    args: any
  ): Promise<void> {
    // Get the session
    const session = this.sessions.get(sessionId) as VoiceSession;
    if (!session) {
      console.error(`Session ${sessionId} not found for tool call ${toolName}`);
      await this.voiceIO.sendToolError(
        sessionId,
        callId,
        `Session ${sessionId} not found`
      );
      return;
    }

    // Find the tool definition
    const tool = this.getToolDefinition(toolName);
    if (!tool) {
      console.error(`Tool ${toolName} not found`);
      await this.voiceIO.sendToolError(
        sessionId,
        callId,
        `Tool ${toolName} not found`
      );
      return;
    }

    // Verify tool access
    if (!this.isToolAllowedForAgent(toolName, session.agentName)) {
      console.error(
        `Tool ${toolName} not allowed for agent ${session.agentName}`
      );
      await this.voiceIO.sendToolError(
        sessionId,
        callId,
        `Tool ${toolName} not allowed for this agent`
      );
      return;
    }

    console.log(`Executing tool ${toolName} with args:`, args);

    try {
      // Execute the tool
      const result = await tool.handler(args);

      // Store result in session
      session.nodeResults[callId] = result;

      // Update session metadata if needed
      this.updateSessionMetadata(sessionId, toolName, args, result);

      // Send the result back to OpenAI
      await this.voiceIO.sendToolResult(sessionId, callId, result);
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);

      // Send error back to OpenAI
      await this.voiceIO.sendToolError(
        sessionId,
        callId,
        error instanceof Error ? error.message : 'Tool execution failed'
      );
    }
  }

  /**
   * Update session metadata based on tool execution
   * This is similar to how your current handlers update activeSessionData
   */
  protected updateSessionMetadata(
    sessionId: string,
    toolName: string,
    args: any,
    result: any
  ): void {
    // Get or create session data
    let data = this.sessionData.get(sessionId);
    if (!data) {
      data = { metadata: {} };
      this.sessionData.set(sessionId, data);
    }

    // Update metadata based on the tool
    if (toolName === 'lookupCustomer') {
      if (typeof result === 'string') {
        try {
          const customer = JSON.parse(result);
          if (customer.name) data.metadata.customerName = customer.name;
          if (customer.accountNumber)
            data.metadata.accountNumber = customer.accountNumber;
        } catch (error) {
          console.error('Error parsing customer data:', error);
        }
      }
    } else if (
      toolName === 'payBills' ||
      toolName === 'redirectToPayBillsForm'
    ) {
      // Update customer info
      if (args.customerName) data.metadata.customerName = args.customerName;
      if (args.accountNumber) data.metadata.accountNumber = args.accountNumber;

      // Set pending action
      data.metadata.pendingAction = 'show-payment-form';

      // Broadcast to clients
      this.voiceIO.broadcastToClients({
        type: 'action',
        action: 'show-payment-form',
        data: {
          customerName: data.metadata.customerName,
          accountNumber: data.metadata.accountNumber,
        },
      });
    }

    // Broadcast session data update
    this.voiceIO.broadcastToClients({
      type: 'session-update',
      data: data.metadata,
    });
  }

  /**
   * Implementation-specific session creation
   */
  protected async createSessionImpl(
    session: Flow,
    agent: AgentConfig
  ): Promise<Flow> {
    // Cast to VoiceAgentConfig
    const voiceAgent = agent as VoiceAgentConfig;

    // Create a voice-specific session
    const voiceSession: VoiceSession = {
      ...session,
      currentVoice: voiceAgent.voice || 'alloy',
      metadata: {},
    };

    // Initialize session data
    this.sessionData.set(session.id, {
      metadata: {
        sessionId: session.id,
        pendingAction: null,
      },
    });

    // Register session but DON'T connect to OpenAI yet
    await this.voiceIO.registerSession(session.id, voiceAgent);

    return voiceSession;
  }

  /**
   * Implementation-specific session run
   */
  protected async runSessionImpl(
    session: Flow,
    userInput: string,
    options?: { script?: string; continueFromPrevious?: boolean }
  ): Promise<ToolResult> {
    // For voice sessions, we don't really "run" them with text input
    // They are event-driven through the voice channels
    // But we can maintain compatibility by returning a status
    return {
      status: 'active',
      message: 'Voice session is active via WebSockets',
      sessionId: session.id,
    };
  }

  /**
   * Implementation-specific session cleanup
   */
  protected async endSessionImpl(session: Flow): Promise<void> {
    // Clean up voice IO connections for this session
    await this.voiceIO.cleanupSession(session.id);

    // Clean up session data
    this.sessionData.delete(session.id);
  }

  /**
   * Get the VoiceIOManager instance
   */
  getVoiceIO(): VoiceIOManager {
    return this.voiceIO;
  }

  /**
   * Get the session data
   */
  getInternalSessionData(): Map<string, { metadata: Record<string, any> }> {
    return this.sessionData;
  }

  /**
   * Override of runOnce to handle voice-specific behavior
   */
  async runOnce(
    agentName: string,
    goal: string,
    options?: { script?: string; continueFromPrevious?: boolean }
  ): Promise<ToolResult> {
    // Voice swarm doesn't support one-shot execution in the same way as text
    throw new SwarmError(
      'Voice swarm requires active WebSocket sessions and cannot be used in one-shot mode',
      'EXECUTION_ERROR'
    );
  }

  /**
   * Override of runBatch to handle voice-specific behavior
   */
  async runBatch(
    runs: Array<{ agentName: string; goal: string; script?: string }>,
    options?: {
      batchSize?: number;
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<Array<{ id: string; result: ToolResult; error?: Error }>> {
    // Batch processing not supported for voice swarm
    throw new SwarmError(
      'Batch processing not implemented for voice swarm due to its real-time nature',
      'EXECUTION_ERROR'
    );
  }
}
