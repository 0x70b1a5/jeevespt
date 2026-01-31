#!/usr/bin/env ts-node
/**
 * Test script for Nitter scraping
 * Usage: npx ts-node scripts/test-nitter.ts <username> [days]
 *
 * Example:
 *   npx ts-node scripts/test-nitter.ts elonmusk
 *   npx ts-node scripts/test-nitter.ts elonmusk 3
 */

import { fetchTweets, formatDigest } from '../src/nitter';

async function main() {
    const username = process.argv[2];
    const days = parseInt(process.argv[3] || '7', 10);

    if (!username) {
        console.error('Usage: npx ts-node scripts/test-nitter.ts <username> [days]');
        console.error('Example: npx ts-node scripts/test-nitter.ts elonmusk 7');
        process.exit(1);
    }

    console.log(`\n🔍 Fetching tweets for @${username} from the last ${days} days...\n`);

    const result = await fetchTweets(username, days);

    if (result.error) {
        console.error(`❌ Error: ${result.error}`);
        process.exit(1);
    }

    console.log(`\n✅ Found ${result.tweets.length} tweets\n`);

    if (result.tweets.length > 0) {
        console.log('--- RAW TWEETS ---\n');
        for (const tweet of result.tweets) {
            console.log(`[${tweet.dateString}]`);
            console.log(tweet.text.substring(0, 200) + (tweet.text.length > 200 ? '...' : ''));
            console.log(`URL: ${tweet.url}`);
            console.log('---\n');
        }

        console.log('\n--- FORMATTED DIGEST ---\n');
        console.log(formatDigest(result.tweets, username));
    }
}

main().catch(console.error);
