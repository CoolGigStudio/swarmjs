export function mergeFields(
    target: Record<string, any>,
    source: Record<string, any>
  ): void {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') {
        target[key] = (target[key] ) + value;
      } else if (value !== null && typeof value === 'object') {
        target[key] = target[key] || {};
        mergeFields(target[key], value);
      }
    }
  }
  
  export function mergeChunk(
    finalResponse: Record<string, any>,
    delta: Record<string, any>
  ): void {
    delete delta.role;
    mergeFields(finalResponse, delta);
  
    const toolCalls = delta.toolCalls;
    if (toolCalls?.[0]) {
      const index = toolCalls[0].index;
      delete toolCalls[0].index;
      finalResponse.toolCalls = finalResponse.toolCalls || {};
      finalResponse.toolCalls[index] = finalResponse.toolCalls[index] || {
        function: { arguments: '', name: '' },
        id: '',
        type: '',
      };
      mergeFields(finalResponse.toolCalls[index], toolCalls[0]);
    }
  }