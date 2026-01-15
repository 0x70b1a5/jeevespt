import { LearningTracker } from './types';

/**
 * Store for managing learning trackers per guild/user
 */
export class LearningStore {
    private guildTrackers: Map<string, LearningTracker> = new Map();
    private userTrackers: Map<string, LearningTracker> = new Map();

    getTracker(id: string, isDM: boolean): LearningTracker {
        const map = isDM ? this.userTrackers : this.guildTrackers;
        let tracker = map.get(id);

        if (!tracker) {
            console.log(`📚 No learning tracker found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new tracker.`);
            tracker = {
                lastQuestionTimes: new Map(),
                dailyQuestionCount: new Map(),
                lastResetDate: new Date().toDateString()
            };
            map.set(id, tracker);
        }

        // Reset daily counts if it's a new day
        const today = new Date().toDateString();
        if (tracker.lastResetDate !== today) {
            tracker.dailyQuestionCount.clear();
            tracker.lastResetDate = today;
        }

        return tracker;
    }

    recordQuestionAsked(id: string, isDM: boolean, subject: string): void {
        const tracker = this.getTracker(id, isDM);
        const now = Date.now();

        tracker.lastQuestionTimes.set(subject, now);
        tracker.dailyQuestionCount.set(subject, (tracker.dailyQuestionCount.get(subject) || 0) + 1);
    }

    getTimeUntilNextQuestion(id: string, isDM: boolean, subjects: string[]): number {
        if (subjects.length === 0) return Infinity;

        const tracker = this.getTracker(id, isDM);
        const hoursPerQuestion = 24 / subjects.length;
        const intervalMs = hoursPerQuestion * 60 * 60 * 1000;

        let earliestTime = Infinity;
        for (const subject of subjects) {
            const lastTime = tracker.lastQuestionTimes.get(subject) || 0;
            const nextTime = lastTime + intervalMs;
            if (nextTime < earliestTime) {
                earliestTime = nextTime;
            }
        }

        return Math.max(0, earliestTime - Date.now());
    }

    getNextQuestionSubject(id: string, isDM: boolean, subjects: string[]): string | null {
        if (subjects.length === 0) return null;

        const tracker = this.getTracker(id, isDM);
        const hoursPerQuestion = 24 / subjects.length;
        const intervalMs = hoursPerQuestion * 60 * 60 * 1000;
        const now = Date.now();

        let nextSubject = null;
        let earliestDueTime = Infinity;

        for (const subject of subjects) {
            const lastTime = tracker.lastQuestionTimes.get(subject) || 0;
            const nextTime = lastTime + intervalMs;

            if (nextTime <= now && nextTime < earliestDueTime) {
                earliestDueTime = nextTime;
                nextSubject = subject;
            }
        }

        return nextSubject;
    }

    /**
     * Serialize tracker data for persistence
     */
    serialize(id: string, isDM: boolean): object {
        const tracker = this.getTracker(id, isDM);
        return {
            lastQuestionTimes: Object.fromEntries(tracker.lastQuestionTimes),
            dailyQuestionCount: Object.fromEntries(tracker.dailyQuestionCount),
            lastResetDate: tracker.lastResetDate
        };
    }

    /**
     * Load tracker data from persisted format
     */
    load(id: string, isDM: boolean, data: any): void {
        const map = isDM ? this.userTrackers : this.guildTrackers;
        const tracker: LearningTracker = {
            lastQuestionTimes: new Map(Object.entries(data.lastQuestionTimes || {})),
            dailyQuestionCount: new Map(Object.entries(data.dailyQuestionCount || {})),
            lastResetDate: data.lastResetDate || new Date().toDateString()
        };
        map.set(id, tracker);
    }
}
