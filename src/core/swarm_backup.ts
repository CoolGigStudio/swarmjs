import OpenAI from 'openai';
import { 
    ChatCompletionTool,
    ChatCompletionCreateParams,
    ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { Agent, Response, Result, AgentFunction } from './openai-types';
import { BaseAgent } from './BaseAgent';
import { debugPrint } from '../utils/debug';
import { mergeChunk } from '../utils/merge';
import { ExecutionFactory, ExecutionBackend } from './ExecutionBackend';

export class Swarm {
    private client: OpenAI;
    private executionBackend: ExecutionBackend;
    private idCounter: number = 0;
    private agentRegistry: Map<string, new (goal: string, functions: AgentFunction[], agent: Agent) => BaseAgent>;

    constructor(
        client?: OpenAI,
        backendType: 'chat' | 'assistant' = 'chat'
    ) {
        this.client = client || new OpenAI();
        this.executionBackend = ExecutionFactory.createBackend(backendType, this.client);
        this.agentRegistry = new Map();
    }

    public registerAgent(name: string, agentClass: new (goal: string, functions: AgentFunction[], agent: Agent) => BaseAgent) {
        this.agentRegistry.set(name, agentClass);
    }

    private createAgentInstance(agentConfig: Agent, currentAgent: BaseAgent): BaseAgent | null {
        const AgentClass = this.agentRegistry.get(agentConfig.name);
        if (!AgentClass) {
            debugPrint(true, `No agent class registered for name: ${agentConfig.name}`);
            return null;
        }
        return new AgentClass(currentAgent.goal, currentAgent.functions, agentConfig);
    }

    public async run(
        agent: BaseAgent,
        messages: ChatCompletionMessageParam[],
        contextVariables: Record<string, any> = {},
        modelOverride: string | null = null,
        stream: boolean = false,
        debug: boolean = false,
        maxTurns: number = Infinity,
        executeTools: boolean = true
    ): Promise<Response | AsyncGenerator<any, void, unknown>> {
        // Check streaming support
        if (stream && !this.executionBackend.supportsStreaming()) {
            throw new Error(
                'Streaming is not supported with the current backend. ' +
                'Use ChatAPI backend for streaming support.'
            );
        }

        if (stream) {
            return this.runAndStream(
                agent,
                messages,
                contextVariables,
                modelOverride,
                debug,
                maxTurns,
                executeTools
            );
        }

        return this.runNonStreaming(
            agent,
            messages,
            contextVariables,
            modelOverride,
            debug,
            maxTurns,
            executeTools
        );
    }

    private async runNonStreaming(
        agent: BaseAgent,
        messages: ChatCompletionMessageParam[],
        contextVariables: Record<string, any>,
        modelOverride: string | null,
        debug: boolean,
        maxTurns: number,
        executeTools: boolean
    ): Promise<Response> {
        let activeAgent = agent;
        const ctxVars = { ...contextVariables };
        const history = [...messages];
        const initLen = messages.length;

        while (history.length - initLen < maxTurns) {
            try {
                // Get completion from backend
                const completion = await this.executionBackend.executeCompletion(
                    activeAgent.getAgent(),
                    history,
                    ctxVars,
                    modelOverride,
                    false,
                    debug
                );

                const message = completion.choices[0].message;
                (message as any).sender = activeAgent.getAgent().name;
                history.push(JSON.parse(JSON.stringify(message)));

                if (!message.tool_calls || !executeTools) {
                    debugPrint(debug, 'No tool calls or tool execution disabled');
                    if (activeAgent.shouldTransferManually()) {
                        debugPrint(debug, 'Agent requested manual transfer');
                        activeAgent.updateLastResponse(message.content );
                        const nextAgent = await activeAgent.nextAgent();
                        if (nextAgent) {
                            activeAgent = nextAgent;
                            continue;
                        }
                    }
                    break;
                }

                // Handle tool execution
                const toolResponse = await this.executionBackend.handleToolExecution(
                    message.tool_calls,
                    new Map(activeAgent.getAgent().functions.map(f => [f.name, f])),
                    ctxVars,
                    debug
                );

                history.push(...toolResponse.messages);
                Object.assign(ctxVars, toolResponse.contextVariables);

                if (toolResponse.agent) {
                    const newAgent = this.createAgentInstance(toolResponse.agent, activeAgent);
                    if (newAgent) {
                        activeAgent = newAgent;
                    }
                }

            } catch (error) {
                debugPrint(debug, 'Error during execution:', error);
                throw error;
            }
        }

        return {
            messages: history.slice(initLen),
            agent: activeAgent.getAgent(),
            contextVariables: ctxVars
        };
    }

    private async *runAndStream(
        agent: BaseAgent,
        messages: ChatCompletionMessageParam[],
        contextVariables: Record<string, any>,
        modelOverride: string | null,
        debug: boolean,
        maxTurns: number,
        executeTools: boolean
    ): AsyncGenerator<any, void, unknown> {
        let activeAgent = agent;
        const ctxVars = { ...contextVariables };
        const history = [...messages];
        const initLen = messages.length;

        while (history.length - initLen < maxTurns) {
            const message: Record<string, any> = {
                content: '',
                sender: activeAgent.getAgent().name,
                role: 'assistant',
                function_call: null,
                tool_calls: {}
            };

            try {
                const completion = await this.executionBackend.executeCompletion(
                    activeAgent.getAgent(),
                    history,
                    ctxVars,
                    modelOverride,
                    true,
                    debug
                );

                yield { delim: 'start' };

                for await (const chunk of completion as AsyncIterable<any>) {
                    const delta = chunk.choices[0].delta;
                    if (delta.role === 'assistant') {
                        (delta as any).sender = activeAgent.getAgent().name;
                    }
                    yield delta;
                    mergeChunk(message, delta);
                }

                yield { delim: 'end' };

                message.tool_calls = Object.values(message.tool_calls);
                if (!message.tool_calls.length) {
                    message.tool_calls = null;
                }

                debugPrint(debug, 'Received completion:', message);
                history.push(message);

                if (!message.tool_calls || !executeTools) {
                    if (activeAgent.shouldTransferManually()) {
                        activeAgent.updateLastResponse(message.content );
                        const nextAgent = await activeAgent.nextAgent();
                        if (nextAgent) {
                            activeAgent = nextAgent;
                            continue;
                        }
                    }
                    break;
                }

                const toolResponse = await this.executionBackend.handleToolExecution(
                    message.tool_calls,
                    new Map(activeAgent.getAgent().functions.map(f => [f.name, f])),
                    ctxVars,
                    debug
                );

                history.push(...toolResponse.messages);
                Object.assign(ctxVars, toolResponse.contextVariables);

                if (toolResponse.agent) {
                    const newAgent = this.createAgentInstance(toolResponse.agent, activeAgent);
                    if (newAgent) {
                        activeAgent = newAgent;
                    }
                }

            } catch (error) {
                debugPrint(debug, 'Error during streaming:', error);
                throw error;
            }
        }

        yield {
            response: {
                messages: history.slice(initLen),
                agent: activeAgent.getAgent(),
                contextVariables: ctxVars
            }
        };
    }
}