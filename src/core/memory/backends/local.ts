import { MemoryBackend } from '../types';

export class LocalMemoryBackend implements MemoryBackend {
    private memoryStore: Map<string, any> = new Map();
    private ttls: Map<string, number> = new Map();

    async store(key: string, value: any, ttl?: number): Promise<void> {
        this.memoryStore.set(key, value);
        if (ttl) {
            this.ttls.set(key, Date.now() + ttl * 1000);
        }
    }

    async retrieve(key: string): Promise<any> {
        // Check TTL
        const ttl = this.ttls.get(key);
        if (ttl && Date.now() > ttl) {
            this.memoryStore.delete(key);
            this.ttls.delete(key);
            return null;
        }
        return this.memoryStore.get(key);
    }

    async delete(key: string): Promise<void> {
        this.memoryStore.delete(key);
        this.ttls.delete(key);
    }

    async query(pattern: string): Promise<string[]> {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return Array.from(this.memoryStore.keys()).filter(key => regex.test(key));
    }
}