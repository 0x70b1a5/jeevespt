import fs from 'fs';
import { ScheduledTask } from './types';

/**
 * Store for managing scheduled tasks (agent runs on a schedule).
 *
 * Persisted separately from reminders because the trigger behavior diverges:
 * tasks run a one-shot agent with tools (e.g. web_search) and emit the
 * agent's response, while reminders just nudge the user with their own text.
 */
export class TaskStore {
    private tasks: Map<string, ScheduledTask> = new Map();

    constructor() {
        this.load();
    }

    add(task: ScheduledTask): void {
        this.tasks.set(task.id, task);
        this.persist();
    }

    update(task: ScheduledTask): void {
        this.tasks.set(task.id, task);
        this.persist();
    }

    remove(id: string): boolean {
        const deleted = this.tasks.delete(id);
        if (deleted) {
            this.persist();
        }
        return deleted;
    }

    get(id: string): ScheduledTask | undefined {
        return this.tasks.get(id);
    }

    getAll(): ScheduledTask[] {
        return Array.from(this.tasks.values());
    }

    getForUser(userId: string): ScheduledTask[] {
        return Array.from(this.tasks.values()).filter(t => t.userId === userId);
    }

    private async persist(): Promise<void> {
        try {
            const data = Array.from(this.tasks.values()).map(t => ({
                ...t,
                nextRun: t.nextRun.toISOString(),
                createdAt: t.createdAt.toISOString(),
                lastRun: t.lastRun?.toISOString()
            }));

            await fs.promises.mkdir('data', { recursive: true });
            await fs.promises.writeFile(
                'data/tasks.json',
                JSON.stringify(data, null, 2)
            );
        } catch (error) {
            console.error('Error persisting tasks:', error);
        }
    }

    private async load(): Promise<void> {
        try {
            const raw = await fs.promises.readFile('data/tasks.json', 'utf8');
            const data = JSON.parse(raw);

            for (const item of data) {
                const task: ScheduledTask = {
                    ...item,
                    nextRun: new Date(item.nextRun),
                    createdAt: new Date(item.createdAt),
                    lastRun: item.lastRun ? new Date(item.lastRun) : undefined
                };
                this.tasks.set(task.id, task);
            }

            console.log(`📋 Loaded ${this.tasks.size} tasks`);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading tasks:', error);
            }
        }
    }
}
