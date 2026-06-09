import { modelSupportsTemperature } from './constants';

describe('modelSupportsTemperature', () => {
    describe('models that dropped sampling params (no temperature)', () => {
        const dropped = [
            'claude-fable-5',
            'claude-fable-6',            // assume future Fable tiers keep dropping it
            'claude-opus-4-7',
            'claude-opus-4-8',
            'claude-opus-4-8-20260101',  // date-suffixed snapshot
            'claude-opus-4-10',          // hypothetical future minor
            'claude-opus-5',             // future major, no minor
            'claude-opus-5-0',
        ];
        it.each(dropped)('%s → false', model => {
            expect(modelSupportsTemperature(model)).toBe(false);
        });
    });

    describe('models that still accept temperature', () => {
        const supported = [
            'claude-opus-4-6',
            'claude-opus-4-5',
            'claude-opus-4-1',
            'claude-opus-4-1-20250805',
            'claude-opus-4-0',
            'claude-opus-4-20250514',    // Opus 4.0 with a date suffix — NOT minor v20250514
            'claude-sonnet-4-6',
            'claude-sonnet-4-5',
            'claude-sonnet-4-20250514',  // Sonnet 4.0 with a date suffix
            'claude-haiku-4-5',
            'claude-haiku-4-5-20251001',
            'claude-3-7-sonnet-20250219',
        ];
        it.each(supported)('%s → true', model => {
            expect(modelSupportsTemperature(model)).toBe(true);
        });
    });
});
