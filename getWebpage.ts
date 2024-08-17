import * as cheerio from 'cheerio'
import trim from './trim';

export default async function getWebpage(url: string) {
    if (!url.startsWith('http')) {
        url = `https://${url}`
    }
    const response = await fetch(url, {
    });
    const data = await response.text();
    // parse the data into a more useful format
    const $ = cheerio.load(data);
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
  
    return truncatedContent;
}