import { createClient, RedisClientType } from 'redis';
import { MemoryBackend } from '../types';

export class RedisMemoryBackend implements MemoryBackend {
    private client: RedisClientType;
    private connected: boolean = false;

    constructor(private url: string) {
        this.client = createClient({ url });
        this.client.on('error', err => console.error('Redis Error:', err));
    }

    private async ensureConnection(): Promise<void> {
        if (!this.connected) {
            await this.client.connect();
            this.connected = true;
        }
    }

    async store(key: string, value: any, ttl?: number): Promise<void> {
        await this.ensureConnection();
        const serialized = JSON.stringify(value);
        if (ttl) {
            await this.client.setEx(key, ttl, serialized);
        } else {
            await this.client.set(key, serialized);
        }
    }

    async retrieve(key: string): Promise<any> {
        await this.ensureConnection();
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : null;
    }

    async delete(key: string): Promise<void> {
        await this.ensureConnection();
        await this.client.del(key);
    }

    async query(pattern: string): Promise<string[]> {
        await this.ensureConnection();
        return this.client.keys(pattern);
    }
}