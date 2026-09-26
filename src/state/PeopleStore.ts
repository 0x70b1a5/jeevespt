import fs from 'fs';

const FILE = 'data/people.json';
/** Oldest notes about a person are dropped beyond this. */
export const MAX_NOTES_PER_PERSON = 12;
export const MAX_NOTE_CHARS = 300;

export interface PersonNote {
    text: string;
    at: number;
}

interface Person {
    /** Last name we saw them under, for display. */
    name: string;
    notes: PersonNote[];
}

/**
 * What the bot remembers about people, per guild (or DM): small facts it
 * chose to note with the remember_about_person tool, or that people told it
 * about themselves with /notes. Each person can see and remove their own.
 */
export class PeopleStore {
    /** scope key ("guild:<id>" / "user:<id>") → user id → person */
    private scopes = new Map<string, Map<string, Person>>();

    constructor() {
        this.load();
    }

    add(scopeKey: string, userId: string, name: string, text: string): void {
        let scope = this.scopes.get(scopeKey);
        if (!scope) {
            scope = new Map();
            this.scopes.set(scopeKey, scope);
        }
        const person = scope.get(userId) ?? { name, notes: [] };
        person.name = name;
        person.notes.push({ text: text.trim().slice(0, MAX_NOTE_CHARS), at: Date.now() });
        person.notes = person.notes.slice(-MAX_NOTES_PER_PERSON);
        scope.set(userId, person);
        this.persist();
    }

    get(scopeKey: string, userId: string): PersonNote[] {
        return this.scopes.get(scopeKey)?.get(userId)?.notes ?? [];
    }

    remove(scopeKey: string, userId: string, at: number): boolean {
        const person = this.scopes.get(scopeKey)?.get(userId);
        if (!person) return false;
        const before = person.notes.length;
        person.notes = person.notes.filter(n => n.at !== at);
        if (person.notes.length === before) return false;
        this.persist();
        return true;
    }

    private async persist(): Promise<void> {
        try {
            const data: Record<string, Record<string, Person>> = {};
            for (const [key, scope] of this.scopes) data[key] = Object.fromEntries(scope);
            await fs.promises.mkdir('data', { recursive: true });
            await fs.promises.writeFile(FILE, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error persisting people notes:', error);
        }
    }

    private async load(): Promise<void> {
        try {
            const data = JSON.parse(await fs.promises.readFile(FILE, 'utf8')) as Record<string, Record<string, Person>>;
            for (const [key, people] of Object.entries(data)) {
                this.scopes.set(key, new Map(Object.entries(people)));
            }
        } catch (error: any) {
            if (error?.code !== 'ENOENT') console.error('Error loading people notes:', error);
        }
    }
}
