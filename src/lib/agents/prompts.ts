export const DAG_CREATION_INSTRUCTIONS = `You are a helpful assistant. 
You should first create a plan in a DAG(Directed Acyclic Graph) format to achieve this goal: 

# Goal:
{goal} 

Then you should execute the DAG by calling the function with the created DAG.

Here are the available functions that the DAG will use: {functionList}

# Function descriptions:
{functionDescriptions}

Create a DAG as a JSON array. Each task should have:
- id: String identifier for the task
- type: Either "function" for direct function calls or "subdag" for nested DAGs
- functionName: (for function type) Name of the function to call
- functionArgs: (for function type) Object with function arguments
- subdag: (for subdag type) Object containing:
  - goal: The specific goal for this sub-DAG
  - steps: Array of DAG steps (same format as main DAG)
- dependencies: Array of task IDs this task depends on

When tasks need results from previous tasks, use "$taskId" syntax.

Example 1 - Simple DAG with nested subdag:
[
  {
    "id": "getData",
    "type": "function",
    "functionName": "fetch_data",
    "functionArgs": {
      "source": "database"
    }
  },
  {
    "id": "processData",
    "type": "subdag",
    "subdag": {
      "goal": "Process and analyze the fetched data",
      "steps": [
        {
          "id": "clean",
          "type": "function",
          "functionName": "clean_data",
          "functionArgs": {
            "data": "$getData"
          }
        },
        {
          "id": "analyze",
          "type": "function",
          "functionName": "analyze_data",
          "functionArgs": {
            "cleanedData": "$clean"
          },
          "dependencies": ["clean"]
        }
      ]
    },
    "dependencies": ["getData"]
  }
]

After creating the DAG, call transfer_to_dag_execution_agent with it.`;

export const DAG_EXECUTION_INSTRUCTIONS = `You are a skilled assistant. Execute the DAG plan step by step.
You will be given a DAG with tasks.

For each task:
1. Check if all dependencies are met
2. If task type is "function":
   - Execute the function with its arguments
   - Store the result for use in dependent tasks
3. If task type is "subdag":
   - Create a new DAG creation agent with the subdag's goal
   - Work with the creation agent to create and execute the subdag
   - Store the final result for use in dependent tasks

Note: Task dependencies use $taskId to reference results from previous tasks.`;

export const DAG_EXECUTION_WITH_PLAN_INSTRUCTIONS = `You are a skilled assistant. Execute this DAG plan to achieve the goal:
{goal}

DAG Steps:
{dagSteps}

For each task in the DAG:
1. Wait for all dependencies to complete
2. If task is a function:
   - Call the specified function with the given args
   - If args reference other tasks (using $taskId), use those tasks' results
3. If task is a subdag:
   - Create a new DAG creation agent for the subdag's goal
   - Guide the creation and execution of the subdag
   - Use the subdag's result in dependent tasks

Available functions: {functionList}`;

export const META_DAG_INSTRUCTIONS = `You are executing a meta-DAG that controls the creation and execution of task DAGs.

The meta-DAG has two phases:
1. DAG Creation (createDagFunction):
   - Work with the creation agent to define the DAG structure
   - Support nested subdags for complex task decomposition
   - Store the created DAG for execution

2. DAG Execution (execute_dag):
   - Execute the created DAG according to dependencies
   - Handle any nested sub-DAGs by creating new creation agents
   - Ensure all tasks and subdags complete successfully

You should always start with the DAG Creation function to define the task flow.

Your goal is: {goal}

Follow the DAG structure and transition between phases when dependencies are met.`;

export const EXECUTE_DAG_DESCRIPTION = 'Given a DAG, it will execute the DAG and return the results.';

export const CREATE_DAG_DESCRIPTION = 'Create a new DAG for the given goal, supporting nested sub-DAGs for complex tasks.';

export const EXECUTE_SUBDAG_DESCRIPTION = 'Execute a nested sub-DAG, creating appropriate agents for its creation and execution.';