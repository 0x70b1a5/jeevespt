#!/usr/bin/env ts-node
/**
 * Test script for Patreon posting
 * Usage: npx ts-node scripts/test-patreon.ts
 *
 * Make sure PATREON_EMAIL and PATREON_PASSWORD are set in .env
 */

import dotenv from 'dotenv';
dotenv.config();

import { postToPatreon } from '../src/patreon';

async function main() {
    console.log('\n🧪 Testing Patreon posting...\n');

    // Check credentials
    if (!process.env.PATREON_EMAIL || !process.env.PATREON_PASSWORD) {
        console.error('❌ PATREON_EMAIL and PATREON_PASSWORD must be set in .env');
        process.exit(1);
    }

    console.log(`📧 Using email: ${process.env.PATREON_EMAIL}`);

    // Create a test post
    const title = 'Test Post - ' + new Date().toISOString();
    const content = `# Test Digest

This is a test post created by the automated system.

## Sample Content

- Item 1
- Item 2
- Item 3

---

*Generated at ${new Date().toISOString()}*`;

    console.log(`\n📝 Creating test post: "${title}"`);
    console.log('Content preview:');
    console.log(content.substring(0, 200) + '...\n');

    const result = await postToPatreon(title, content, 5);

    if (result.success) {
        console.log(`\n✅ Successfully posted to Patreon!`);
        if (result.postUrl) {
            console.log(`📍 Post URL: ${result.postUrl}`);
        }
    } else {
        console.error(`\n❌ Failed to post: ${result.error}`);
        process.exit(1);
    }
}

main().catch(console.error);
