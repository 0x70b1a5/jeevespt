import trim from './trim';
import { Builder, By } from 'selenium-webdriver';
import * as cheerio from 'cheerio';

export async function getWebpage(url: string): Promise<string> {
    if (!url) {
        throw new Error('URL is required');
    }
    if (!url.startsWith('http')) {
        url = `https://${url}`;
    }
    // Initialize the WebDriver
    console.log('Initializing the WebDriver...');
    let driver = await new Builder().forBrowser('chrome').build();
    console.log('WebDriver initialized');
    try {
        // Navigate to the URL
        console.log('Navigating to the URL...');
        await driver.get(url);
        console.log('Navigated to the URL');
        
        // Wait for the page to load completely
        console.log('Waiting for the page to load...');
        await driver.sleep(10000);
        console.log('Page loaded');
        
        // Get the page source
        console.log('Getting page source...');
        const data = await driver.getPageSource();
        console.log('Page source obtained');
        
        console.log('Loading Cheerio...');
        const $ = cheerio.load(data);
        console.log('Cheerio loaded');

        console.log('Extracting relevant parts of the webpage...');
        // Extract relevant parts of the webpage
        const title = trim($('title').text());
        const pageText = trim($('body').text());
        
        // Combine extracted information
        const relevantContent = [
            `Title: ${title}`,
            `Text: ${pageText}`
        ].join('\n\n');
    
        // Truncate to a reasonable length
        const maxLength = 4000;
        const truncatedContent = relevantContent.length > maxLength
            ? relevantContent.slice(0, maxLength) + '...'
            : relevantContent;
    
        console.log('Content retrieved. Huzzah!', truncatedContent);

        return truncatedContent;
    } catch (error) {
        console.error('Error getting webpage:', error);
        throw error;
    } finally {
        await driver.quit();
    }
}