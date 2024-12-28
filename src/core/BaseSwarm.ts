import BaseAgent from './BaseAgent';
import { Goal } from './types-old';

export default abstract class BaseSwarm {
    protected name: string;
    protected agents: Map<string, BaseAgent>;
  
    constructor(name: string) {
      this.name = name;
      this.agents = new Map();
    }
  
    abstract pursueGoal(goal: Goal): Promise<any>;
  
    addAgents(agents: BaseAgent[]): void {
      agents.forEach(agent => this.agents.set(agent.getName(), agent));
    }
  }
