export const DAG_CREATION_INSTRUCTIONS = `You are a skilled planner. Create a DAG plan to achieve this goal: {goal}

Available functions: {functionList}
Function descriptions:
{functionDescriptions}

Create a DAG as a JSON array. Each task should have:
- id: String identifier for the task
- type: Name of the function to call
- args: Object with function arguments
- dependencies: Array of task IDs this task depends on

When tasks need results from previous tasks, use "$taskId" syntax.

Example 1 - Simple greeting with dependency:
[
  {
    "id": "step1",
    "type": "get_time_of_day",
    "args": {
      "timezone": "EST"
    }
  },
  {
    "id": "step2",
    "type": "create_greeting",
    "args": {
      "name": "John",
      "timeOfDay": "$step1"
    },
    "dependencies": ["step1"]
  }
]

Example 2 - Multiple parallel searches with comparison:
[
  {
    "id": "search1",
    "type": "search",
    "args": {
      "query": "Stanford University Nobel laureates count"
    }
  },
  {
    "id": "search2",
    "type": "search",
    "args": {
      "query": "UCLA Nobel laureates count"
    }
  },
  {
    "id": "search3",
    "type": "search",
    "args": {
      "query": "UC Berkeley Nobel laureates count"
    }
  },
  {
    "id": "math1",
    "type": "math",
    "args": {
      "operation": "add",
      "values": ["$search1", "$search2"]
    },
    "dependencies": ["search1", "search2"]
  },
  {
    "id": "math2",
    "type": "math",
    "args": {
      "operation": "compare",
      "values": ["$math1", "$search3"]
    },
    "dependencies": ["math1", "search3"]
  }
]

Example 3 - Multi-branch parallel execution with joins:
[
  {
    "id": "search1",
    "type": "search",
    "args": {
      "query": "Florida public healthcare expenses"
    }
  },
  {
    "id": "search2",
    "type": "search",
    "args": {
      "query": "Florida private healthcare expenses"
    }
  },
  {
    "id": "search3",
    "type": "search",
    "args": {
      "query": "New York public healthcare expenses"
    }
  },
  {
    "id": "search4",
    "type": "search",
    "args": {
      "query": "New York private healthcare expenses"
    }
  },
  {
    "id": "math1",
    "type": "math",
    "args": {
      "operation": "add",
      "values": ["$search1", "$search2"]
    },
    "dependencies": ["search1", "search2"]
  },
  {
    "id": "math2",
    "type": "math",
    "args": {
      "operation": "add",
      "values": ["$search3", "$search4"]
    },
    "dependencies": ["search3", "search4"]
  },
  {
    "id": "math3",
    "type": "math",
    "args": {
      "operation": "compare",
      "values": ["$math1", "$math2"]
    },
    "dependencies": ["math1", "math2"]
  }
]

After creating the DAG, call transfer_to_dag_execution_agent with it.`;

export const DAG_EXECUTION_INSTRUCTIONS = `You are a skilled assistant. Execute the DAG plan step by step.
You will be given a DAG with tasks.
For each task:
1. Check if all dependencies are met
2. Execute the task's function with its arguments
3. Store the result for use in dependent tasks

Note: Task dependencies use $taskId to reference results from previous tasks.`;

export const DAG_EXECUTION_WITH_PLAN_INSTRUCTIONS = `You are a skilled assistant. Execute this DAG plan to achieve the goal:

DAG Steps:
{dagSteps}

For each task in the DAG:
1. Wait for all dependencies to complete
2. Get the function specified in the task's "type"
3. Call the function with args from the task
4. If args reference other tasks (using $taskId), use those tasks' results

Available functions: {functionList}`;

export const TRANSFER_AGENT_DESCRIPTION = 'Transfer the planned DAG to the execution agent';