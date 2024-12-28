import { z } from 'zod';
import { ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';

export type AgentFunction = (...args: any[]) => Promise<string | Agent | Record<string, any>>;

export const AgentSchema = z.object({
  name: z.string().default('Agent'),
  model: z.string().default('gpt-4'),
  instructions: z.union([z.string(), z.function()]).default('You are a helpful agent.'),
  functions: z.array(z.custom<AgentFunction>()).default([]),
  toolChoice: z.custom<ChatCompletionToolChoiceOption>().nullable().default(null),
  parallelToolCalls: z.boolean().default(true)
});

export type Agent = z.infer<typeof AgentSchema>;

export const ResponseSchema = z.object({
  messages: z.array(z.any()).default([]),
  agent: AgentSchema.nullable().default(null),
  contextVariables: z.record(z.any()).default({})
});

export type Response = z.infer<typeof ResponseSchema>;

export const ResultSchema = z.object({
  value: z.string().default(''),
  agent: AgentSchema.nullable().default(null),
  contextVariables: z.record(z.any()).default({})
});

export type Result = z.infer<typeof ResultSchema>;