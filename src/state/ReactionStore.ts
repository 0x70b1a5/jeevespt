import { ReactionTracker, ReactionHistory } from './types';

const MAX_REACTIONS = 5;
const MAX_CONTENT_LENGTH = 100;

/**
 * Store for managing reaction tracking per guild/user
 */
export class ReactionStore {
    private guildTrackers: Map<string, ReactionTracker> = new Map();
    private userTrackers: Map<string, ReactionTracker> = new Map();

    getTracker(id: string, isDM: boolean): ReactionTracker {
        const map = isDM ? this.userTrackers : this.guildTrackers;
        let tracker = map.get(id);

        if (!tracker) {
            console.log(`🎭 No reaction tracker found for ${isDM ? 'DM' : 'guild'} (${id}). Creating new tracker.`);
            tracker = {
                recentReactions: []
            };
            map.set(id, tracker);
        }

        return tracker;
    }

    recordReaction(id: string, isDM: boolean, emoji: string, messageContent: string, channelId: string): void {
        const tracker = this.getTracker(id, isDM);

        // Truncate message content for storage
        const truncatedContent = messageContent.length > MAX_CONTENT_LENGTH
            ? messageContent.substring(0, MAX_CONTENT_LENGTH) + '...'
            : messageContent;

        const reactionHistory: ReactionHistory = {
            emoji,
            timestamp: Date.now(),
            messageContent: truncatedContent,
            channelId
        };

        // Add to beginning and keep only last MAX_REACTIONS
        tracker.recentReactions.unshift(reactionHistory);
        if (tracker.recentReactions.length > MAX_REACTIONS) {
            tracker.recentReactions = tracker.recentReactions.slice(0, MAX_REACTIONS);
        }
    }

    getRecentReactions(id: string, isDM: boolean): ReactionHistory[] {
        const tracker = this.getTracker(id, isDM);
        return tracker.recentReactions;
    }

    /**
     * Serialize tracker data for persistence
     */
    serialize(id: string, isDM: boolean): object {
        const tracker = this.getTracker(id, isDM);
        return {
            recentReactions: tracker.recentReactions
        };
    }

    /**
     * Load tracker data from persisted format
     */
    load(id: string, isDM: boolean, data: any): void {
        const map = isDM ? this.userTrackers : this.guildTrackers;
        const tracker: ReactionTracker = {
            recentReactions: data.recentReactions || []
        };
        map.set(id, tracker);
    }
}
