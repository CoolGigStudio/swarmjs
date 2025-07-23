export const CODE_GENERATIONSWARM_GOAL_PROMPT = `
Generate a swarm implementation based on the requirements using swarmjs framework.

Here are the list of core files containing swarmjs framework implementation code:
{coreFiles}

Here are the requirements: {requirements}

Here is the destination path for the generated code: {destinationPath}
`;

export const CODE_GENERATION_PROMPT = `
You are a world class software engineer.
Your task is to generate the swarm implementation based on the requirements using swarmjs framework.

Here are the requirements: {requirements}

Here are the code of the swarmjs framework and the example files: {frameworkCode}

Generate code based on the requirements and framework code.
`;
