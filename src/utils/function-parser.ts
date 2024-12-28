import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { FunctionDefinition, FunctionParameters } from 'openai/resources/shared';

export function functionToJson(func: Function): ChatCompletionTool {
  const funcStr = func.toString();
  const params = funcStr
    .slice(funcStr.indexOf('(') + 1, funcStr.indexOf(')'))
    .split(',');

  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];

  params.forEach((param) => {
    const trimmedParam = param.trim();
    if (trimmedParam) {
      const [name, defaultValue] = trimmedParam.split('=');
      const paramName = name.trim();
      properties[paramName] = { 
        type: 'string',
        description: `Parameter ${paramName}`
      };
      if (!defaultValue) {
        required.push(paramName);
      }
    }
  });

  const parameters: FunctionParameters = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {})
  };

  const functionDefinition: FunctionDefinition = {
    name: func.name,
    description: (func as any).description ,
    parameters
  };

  return {
    type: 'function' as const,
    function: functionDefinition
  };
}