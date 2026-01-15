import fs from 'fs';
import { ScheduledReminder } from './types';

/**
 * Store for managing scheduled reminders
 */
export class ReminderStore {
    private reminders: Map<string, ScheduledReminder> = new Map();

    constructor() {
        this.load();
    }

    add(reminder: ScheduledReminder): void {
        this.reminders.set(reminder.id, reminder);
        this.persist();
    }

    remove(id: string): boolean {
        const deleted = this.reminders.delete(id);
        if (deleted) {
            this.persist();
        }
        return deleted;
    }

    get(id: string): ScheduledReminder | undefined {
        return this.reminders.get(id);
    }

    getAll(): ScheduledReminder[] {
        return Array.from(this.reminders.values());
    }

    getForUser(userId: string): ScheduledReminder[] {
        return Array.from(this.reminders.values())
            .filter(reminder => reminder.userId === userId);
    }

    private async persist(): Promise<void> {
        try {
            const remindersData = Array.from(this.reminders.entries()).map(([id, reminder]) => ({
                ...reminder,
                triggerTime: reminder.triggerTime.toISOString()
            }));

            await fs.promises.mkdir('data', { recursive: true });
            await fs.promises.writeFile(
                'data/reminders.json',
                JSON.stringify(remindersData, null, 2)
            );
        } catch (error) {
            console.error('Error persisting reminders:', error);
        }
    }

    private async load(): Promise<void> {
        try {
            const data = await fs.promises.readFile('data/reminders.json', 'utf8');
            const remindersData = JSON.parse(data);

            for (const reminderData of remindersData) {
                const reminder: ScheduledReminder = {
                    ...reminderData,
                    triggerTime: new Date(reminderData.triggerTime)
                };
                this.reminders.set(reminder.id, reminder);
            }

            console.log(`📅 Loaded ${this.reminders.size} reminders`);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('Error loading reminders:', error);
            }
        }
    }
}
