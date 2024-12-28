export interface Memory {
    content: any;
    timestamp: number;
    source: string;
    memory_type: string;
    metadata?: Record<string, any>;
}

export interface MemoryQuery {
    memory_type?: string;
    source?: string;
    start_time?: number;
    end_time?: number;
    metadata?: Record<string, any>;
}

export interface MemoryBackend {
    store(key: string, value: any, ttl?: number): Promise<void>;
    retrieve(key: string): Promise<any>;
    delete(key: string): Promise<void>;
    query(pattern: string): Promise<string[]>;
}