import {
  Swarm,
  Flow,
  ToolResult,
  SwarmError,
  SwarmConfig,
  ToolDefinition,
  AgentConfig,
} from '../types/basic';
import * as crypto from 'crypto';

/**
 * AbstractSwarm provides common functionality for different swarm implementations.
 * It handles the basic session management and provides abstract methods for
 * implementation-specific behavior.
 */
export abstract class AbstractSwarm implements Swarm {
  protected config!: SwarmConfig;
  protected sessions: Map<string, Flow> = new Map();

  /**
   * Initialize the swarm with configuration
   */
  async init(config: SwarmConfig): Promise<void> {
    this.config = config;

    // Validate configuration
    // if (!config.agents || config.agents.length === 0) {
    //   throw new SwarmError('No agents configured', 'INITIALIZATION_ERROR');
    // }

    // if (!config.tools || config.tools.length === 0) {
    //   throw new SwarmError('No tools configured', 'INITIALIZATION_ERROR');
    // }

    // Perform implementation-specific initialization
    await this.initImpl(config);
  }

  /**
   * Implementation-specific initialization
   */
  protected abstract initImpl(config: SwarmConfig): Promise<void>;

  /**
   * Create a new session
   */
  async createSession(agentName: string): Promise<Flow> {
    // Verify agent exists
    const agent = this.getAgentConfig(agentName);
    if (!agent) {
      throw new SwarmError(`Agent ${agentName} not found`, 'AGENT_ERROR');
    }

    // Create a basic session
    const session: Flow = {
      id: crypto.randomUUID(),
      agentName,
      nodeResults: {},
      createdAt: new Date(),
    };

    // Perform implementation-specific session creation
    const createdSession = await this.createSessionImpl(session, agent);

    // Store the session
    this.sessions.set(createdSession.id, createdSession);
    return createdSession;
  }

  /**
   * Implementation-specific session creation
   */
  protected abstract createSessionImpl(
    session: Flow,
    agent: AgentConfig
  ): Promise<Flow>;

  /**
   * Run a session with user input
   */
  async runSession(
    flowId: string,
    userInput: string,
    options?: { script?: string; continueFromPrevious?: boolean }
  ): Promise<ToolResult> {
    const session = this.sessions.get(flowId);
    if (!session) {
      throw new SwarmError(`Session ${flowId} not found`, 'INVALID_FLOW');
    }

    // Perform implementation-specific session run
    return this.runSessionImpl(session, userInput, options);
  }

  /**
   * Implementation-specific session run
   */
  protected abstract runSessionImpl(
    session: Flow,
    userInput: string,
    options?: { script?: string; continueFromPrevious?: boolean }
  ): Promise<ToolResult>;

  /**
   * End a session
   */
  async endSession(flowId: string): Promise<void> {
    const session = this.sessions.get(flowId);
    if (!session) {
      throw new SwarmError(`Session ${flowId} not found`, 'INVALID_FLOW');
    }

    // Perform implementation-specific session cleanup
    await this.endSessionImpl(session);

    // Remove session from tracking
    this.sessions.delete(flowId);
  }

  /**
   * Implementation-specific session cleanup
   */
  protected abstract endSessionImpl(session: Flow): Promise<void>;

  /**
   * Get session status
   */
  async getStatus(flowId: string): Promise<Flow> {
    const session = this.sessions.get(flowId);
    if (!session) {
      throw new SwarmError(`Session ${flowId} not found`, 'INVALID_FLOW');
    }
    return session;
  }

  /**
   * Run a one-shot agent interaction
   */
  async runOnce(
    agentName: string,
    goal: string,
    options?: { script?: string; continueFromPrevious?: boolean }
  ): Promise<ToolResult> {
    // Create a temporary session
    const session = await this.createSession(agentName);

    try {
      // Run the session
      const result = await this.runSession(session.id, goal, options);

      // Clean up the session
      await this.endSession(session.id);

      return result;
    } catch (error) {
      // Ensure session is cleaned up even on error
      await this.endSession(session.id).catch(() => {});
      throw error;
    }
  }

  /**
   * Run multiple agent interactions in batch
   */
  async runBatch(
    runs: Array<{ agentName: string; goal: string; script?: string }>,
    options?: {
      batchSize?: number;
      concurrency?: number;
      onProgress?: (completed: number, total: number) => void;
    }
  ): Promise<Array<{ id: string; result: ToolResult; error?: Error }>> {
    const batchSize = options?.batchSize || 10;
    const concurrency = options?.concurrency || 5;
    const results: Array<{ id: string; result: ToolResult; error?: Error }> =
      [];

    // Process in batches
    for (let i = 0; i < runs.length; i += batchSize) {
      const batch = runs.slice(i, i + batchSize);
      const batchPromises = batch.map(async (run) => {
        try {
          const result = await this.runOnce(run.agentName, run.goal, {
            script: run.script,
          });
          return { id: crypto.randomUUID(), result };
        } catch (error) {
          return {
            id: crypto.randomUUID(),
            result: {},
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      });

      // Process batch with concurrency limit
      const batchResults = await this.processBatchWithConcurrency(
        batchPromises,
        concurrency
      );
      results.push(...batchResults);

      if (options?.onProgress) {
        options.onProgress(Math.min(i + batchSize, runs.length), runs.length);
      }
    }

    return results;
  }

  /**
   * Process a batch of promises with concurrency limit
   */
  private async processBatchWithConcurrency<T>(
    promises: Promise<T>[],
    concurrency: number
  ): Promise<T[]> {
    const batches = promises.reduce(
      (acc, promise) => {
        const lastBatch = acc[acc.length - 1];
        if (lastBatch.length < concurrency) {
          lastBatch.push(promise);
        } else {
          acc.push([promise]);
        }
        return acc;
      },
      [[]] as Promise<T>[][]
    );

    const results = await Promise.all(
      batches.map((batch) => Promise.all(batch))
    );
    return results.flat();
  }

  /**
   * Get an agent configuration by name
   */
  protected getAgentConfig(agentName: string): AgentConfig | undefined {
    return this.config.agents.find((agent) => agent.name === agentName);
  }

  /**
   * Get a tool definition by name
   */
  protected getToolDefinition(toolName: string): ToolDefinition | undefined {
    return this.config.tools.find((tool) => tool.function.name === toolName);
  }

  /**
   * Check if a tool is allowed for an agent
   */
  protected isToolAllowedForAgent(
    toolName: string,
    agentName: string
  ): boolean {
    const agent = this.getAgentConfig(agentName);
    return agent ? agent.allowedTools.includes(toolName) : false;
  }
}
