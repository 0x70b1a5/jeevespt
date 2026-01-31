/**
 * Nitter scraper - Fetches tweets from Nitter instances
 */

import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

export interface Tweet {
    text: string;
    date: Date;
    dateString: string;
    url: string;
}

export interface NitterResult {
    tweets: Tweet[];
    error?: string;
}

// List of Nitter instances to try (in order of preference)
const NITTER_INSTANCES = [
    'nitter.privacydev.net',
    'nitter.poast.org',
    'nitter.tiekoetter.com',
    'nitter.woodland.cafe',
    'nitter.1d4.us',
];

/**
 * Create a configured Chrome WebDriver
 */
async function createDriver(): Promise<WebDriver> {
    const options = new chrome.Options();
    options.addArguments(
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--remote-debugging-port=9223',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

/**
 * Parse a Nitter date string into a Date object
 * Formats: "Jan 22, 2026 · 5:57 PM UTC" or "Jan 22"
 */
function parseNitterDate(dateStr: string): Date {
    // Try full format first: "Jan 22, 2026 · 5:57 PM UTC"
    const fullMatch = dateStr.match(/(\w+)\s+(\d+),?\s*(\d{4})?\s*·?\s*(\d+):(\d+)\s*(AM|PM)?\s*UTC?/i);
    if (fullMatch) {
        const [, month, day, year, hour, minute, ampm] = fullMatch;
        const months: Record<string, number> = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };

        let h = parseInt(hour);
        if (ampm?.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (ampm?.toUpperCase() === 'AM' && h === 12) h = 0;

        return new Date(Date.UTC(
            parseInt(year || new Date().getFullYear().toString()),
            months[month] ?? 0,
            parseInt(day),
            h,
            parseInt(minute)
        ));
    }

    // Try short format: "Jan 22" (assumes current year)
    const shortMatch = dateStr.match(/(\w+)\s+(\d+)/);
    if (shortMatch) {
        const [, month, day] = shortMatch;
        const months: Record<string, number> = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
        };
        return new Date(new Date().getFullYear(), months[month] ?? 0, parseInt(day));
    }

    return new Date();
}

/**
 * Scrape tweets from a Nitter instance
 */
async function scrapeNitterInstance(
    driver: WebDriver,
    instance: string,
    username: string,
    daysBack: number
): Promise<Tweet[]> {
    const url = `https://${instance}/${username}`;
    console.log(`📡 Trying Nitter instance: ${url}`);

    await driver.get(url);

    // Wait for timeline to load (look for timeline-item elements)
    try {
        await driver.wait(
            until.elementLocated(By.css('.timeline-item, .tweet-body, .timeline')),
            15000
        );
    } catch (e) {
        console.log(`⚠️ Timeline not found on ${instance}`);
        throw new Error('Timeline not found');
    }

    // Additional wait for content to render
    await driver.sleep(2000);

    const tweets: Tweet[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    cutoffDate.setHours(0, 0, 0, 0); // Include full day

    // Try to find tweet elements using various selectors
    const tweetSelectors = [
        '.timeline-item',
        '.tweet-body',
        '[class*="tweet"]',
        '.timeline > div'
    ];

    let tweetElements: any[] = [];
    for (const selector of tweetSelectors) {
        tweetElements = await driver.findElements(By.css(selector));
        if (tweetElements.length > 0) {
            console.log(`✅ Found ${tweetElements.length} elements with selector: ${selector}`);
            break;
        }
    }

    if (tweetElements.length === 0) {
        // Fallback: get page source and parse manually
        const pageSource = await driver.getPageSource();
        console.log(`📄 Got page source (${pageSource.length} chars), parsing manually...`);
        return parsePageSource(pageSource, username, cutoffDate, instance);
    }

    for (const element of tweetElements) {
        try {
            // Skip retweets (look for .retweet-header which indicates "Retweeted by X")
            try {
                const retweetHeader = await element.findElements(By.css('.retweet-header'));
                if (retweetHeader.length > 0) {
                    console.log('⏭️ Skipping retweet');
                    continue;
                }
            } catch {}

            // Skip replies (check for replying-to indicator)
            try {
                const replyIndicator = await element.findElements(By.css('.replying-to'));
                if (replyIndicator.length > 0) {
                    console.log('⏭️ Skipping reply');
                    continue;
                }
            } catch {}

            // Get tweet text
            let text = '';
            try {
                const contentEl = await element.findElement(By.css('.tweet-content, .content, [class*="content"]'));
                text = await contentEl.getText();
            } catch {
                text = await element.getText();
            }

            if (!text || text.length < 5) continue;

            // Skip if text starts with "RT @" (retweet indicator in text)
            if (text.startsWith('RT @')) {
                console.log('⏭️ Skipping retweet (RT @ prefix)');
                continue;
            }

            // Skip if text starts with "@" (likely a reply)
            if (text.startsWith('@')) {
                console.log('⏭️ Skipping reply (@ prefix)');
                continue;
            }

            // Get date from title attribute or link
            let dateStr = '';
            try {
                const dateLinks = await element.findElements(By.css('a[title*="UTC"], a[href*="/status/"]'));
                for (const link of dateLinks) {
                    const title = await link.getAttribute('title');
                    if (title && title.includes('UTC')) {
                        dateStr = title;
                        break;
                    }
                }
            } catch {}

            if (!dateStr) {
                // Try getting any visible date text
                try {
                    const dateEl = await element.findElement(By.css('.tweet-date, time, [class*="date"]'));
                    dateStr = await dateEl.getText();
                } catch {}
            }

            const date = parseNitterDate(dateStr);

            // Skip if older than cutoff
            if (date < cutoffDate) {
                console.log(`⏭️ Skipping tweet from ${date.toISOString()} (before cutoff)`);
                continue;
            }

            // Get tweet URL
            let tweetUrl = '';
            try {
                const statusLink = await element.findElement(By.css('a[href*="/status/"]'));
                const href = await statusLink.getAttribute('href');
                tweetUrl = href.startsWith('http') ? href : `https://${instance}${href}`;
            } catch {}

            tweets.push({
                text: text.trim(),
                date,
                dateString: dateStr || date.toLocaleDateString(),
                url: tweetUrl
            });

        } catch (e) {
            console.log(`⚠️ Error parsing tweet element:`, e);
            continue;
        }
    }

    return tweets;
}

/**
 * Parse tweets from raw page source (fallback method)
 */
function parsePageSource(html: string, username: string, cutoffDate: Date, instance: string): Tweet[] {
    const tweets: Tweet[] = [];

    // Look for status links and extract surrounding content
    const statusRegex = new RegExp(`/${username}/status/(\\d+)`, 'gi');
    const matches = [...html.matchAll(statusRegex)];

    // Extract unique status IDs
    const statusIds = [...new Set(matches.map(m => m[1]))];
    console.log(`📝 Found ${statusIds.length} unique status IDs`);

    // For each status, try to find associated content
    for (const statusId of statusIds.slice(0, 50)) { // Limit to avoid processing pinned/old tweets
        // Find the section containing this status
        const statusIndex = html.indexOf(`/status/${statusId}`);
        if (statusIndex === -1) continue;

        // Extract a window around the status link
        const windowStart = Math.max(0, statusIndex - 2000);
        const windowEnd = Math.min(html.length, statusIndex + 2000);
        const window = html.substring(windowStart, windowEnd);

        // Skip retweets (look for retweet-header which indicates "Retweeted by X")
        if (window.includes('retweet-header')) {
            continue;
        }

        // Skip replies (look for replying-to indicator)
        if (window.includes('replying-to')) {
            continue;
        }

        // Try to find tweet content in this window
        const contentMatch = window.match(/class="[^"]*tweet-content[^"]*"[^>]*>([^<]+)/);
        const text = contentMatch ? contentMatch[1].trim() : '';

        if (!text || text.length < 5) continue;

        // Skip if text starts with "RT @" (retweet) or "@" (reply)
        if (text.startsWith('RT @') || text.startsWith('@')) {
            continue;
        }

        // Try to find date
        const dateMatch = window.match(/title="([^"]*UTC[^"]*)"/);
        const dateStr = dateMatch ? dateMatch[1] : '';
        const date = parseNitterDate(dateStr);

        if (date < cutoffDate) continue;

        tweets.push({
            text,
            date,
            dateString: dateStr || date.toLocaleDateString(),
            url: `https://${instance}/${username}/status/${statusId}`
        });
    }

    return tweets;
}

/**
 * Fetch tweets from the last N days for a given username
 */
export async function fetchTweets(username: string, daysBack: number = 7): Promise<NitterResult> {
    let driver: WebDriver | null = null;

    try {
        driver = await createDriver();
        console.log(`🚀 WebDriver initialized for Nitter scraping`);

        // Try each Nitter instance until one works
        for (const instance of NITTER_INSTANCES) {
            try {
                const tweets = await scrapeNitterInstance(driver, instance, username, daysBack);

                if (tweets.length > 0) {
                    // Sort by date descending
                    tweets.sort((a, b) => b.date.getTime() - a.date.getTime());
                    console.log(`✅ Successfully fetched ${tweets.length} tweets from ${instance}`);
                    return { tweets };
                }

                console.log(`⚠️ No tweets found on ${instance}, trying next...`);
            } catch (e) {
                console.log(`❌ Failed on ${instance}:`, e);
                continue;
            }
        }

        return {
            tweets: [],
            error: 'Could not fetch tweets from any Nitter instance'
        };

    } catch (error) {
        console.error('❌ Error in fetchTweets:', error);
        return {
            tweets: [],
            error: `Failed to fetch tweets: ${error}`
        };
    } finally {
        if (driver) {
            await driver.quit();
            console.log('🧹 WebDriver closed');
        }
    }
}

/**
 * Format tweets into a digest
 */
export function formatDigest(tweets: Tweet[], username: string): string {
    if (tweets.length === 0) {
        return `No tweets found for @${username} in the last 7 days.`;
    }

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const startDate = weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endDate = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    let digest = `# Weekly Twitter Digest - ${startDate} to ${endDate}\n\n`;
    digest += `**@${username}**\n\n---\n\n`;

    // Group tweets by date
    const byDate = new Map<string, Tweet[]>();
    for (const tweet of tweets) {
        const dateKey = tweet.date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
        if (!byDate.has(dateKey)) {
            byDate.set(dateKey, []);
        }
        byDate.get(dateKey)!.push(tweet);
    }

    // Output grouped by date
    for (const [dateKey, dateTweets] of byDate) {
        digest += `## ${dateKey}\n\n`;
        for (const tweet of dateTweets) {
            digest += `> ${tweet.text}\n\n`;
        }
    }

    digest += `---\n\n*${tweets.length} tweets total*`;

    return digest;
}
