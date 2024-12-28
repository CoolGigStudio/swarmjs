import { Memory, MemoryQuery, MemoryBackend } from './types';
import * as crypto from 'crypto';

export class MemoryManager {
    private conversationCache: Map<string, Memory[]>;
    private readonly maxCacheSize: number;

    constructor(
        private backend: MemoryBackend,
        options: { maxCacheSize?: number } = {}
    ) {
        this.conversationCache = new Map();
        this.maxCacheSize = options.maxCacheSize || 1000;
    }

    async addMemory(
        agent_id: string,
        memory: Memory,
        ttl?: number
    ): Promise<void> {
        const key = this.generateMemoryKey(agent_id, memory);
        await this.backend.store(key, memory, ttl);

        // Update conversation cache if it's a conversation memory
        if (memory.memory_type === 'conversation') {
            let cache = this.conversationCache.get(agent_id) || [];
            cache.push(memory);
            
            // Maintain cache size limit
            if (cache.length > this.maxCacheSize) {
                cache = cache.slice(-this.maxCacheSize);
            }
            
            this.conversationCache.set(agent_id, cache);
        }
    }

    async getMemories(
        agent_id: string,
        memory_type?: string,
        limit: number = 100,
        query?: MemoryQuery
    ): Promise<Memory[]> {
        // Fast path for recent conversations using cache
        if (memory_type === 'conversation' && !query) {
            const cache = this.conversationCache.get(agent_id);
            if (cache) {
                return cache.slice(-limit);
            }
        }

        // Build key pattern based on query
        let pattern = `memory:${agent_id}:`;
        if (memory_type) {
            pattern += `${memory_type}:*`;
        } else {
            pattern += '*';
        }

        // Get matching keys
        const keys = await this.backend.query(pattern);
        const memories: Memory[] = [];

        // Retrieve and filter memories
        for (const key of keys) {
            const memory = await this.backend.retrieve(key);
            if (memory && this.matchesQuery(memory, query)) {
                memories.push(memory);
            }
        }

        // Sort by timestamp and apply limit
        return memories
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    async clearMemories(
        agent_id: string,
        memory_type?: string
    ): Promise<void> {
        const pattern = memory_type
            ? `memory:${agent_id}:${memory_type}:*`
            : `memory:${agent_id}:*`;

        const keys = await this.backend.query(pattern);
        await Promise.all(keys.map(key => this.backend.delete(key)));

        // Clear cache if applicable
        if (!memory_type || memory_type === 'conversation') {
            this.conversationCache.delete(agent_id);
        }
    }

    async transferMemories(
        from_agent: string,
        to_agent: string,
        memory_type?: string
    ): Promise<void> {
        const memories = await this.getMemories(from_agent, memory_type);
        for (const memory of memories) {
            await this.addMemory(to_agent, {
                ...memory,
                timestamp: Date.now(),
                metadata: {
                    ...memory.metadata,
                    transferred_from: from_agent
                }
            });
        }
    }

    private generateMemoryKey(agent_id: string, memory: Memory): string {
        const uuid = crypto.randomUUID();
        return `memory:${agent_id}:${memory.memory_type}:${uuid}`;
    }

    private matchesQuery(memory: Memory, query?: MemoryQuery): boolean {
        if (!query) return true;

        if (query.memory_type && memory.memory_type !== query.memory_type) {
            return false;
        }

        if (query.source && memory.source !== query.source) {
            return false;
        }

        if (query.start_time && memory.timestamp < query.start_time) {
            return false;
        }

        if (query.end_time && memory.timestamp > query.end_time) {
            return false;
        }

        if (query.metadata) {
            for (const [key, value] of Object.entries(query.metadata)) {
                if (memory.metadata?.[key] !== value) {
                    return false;
                }
            }
        }

        return true;
    }
}