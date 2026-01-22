import fs from 'fs';
import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

const IPA_READER_URL = 'http://ipa-reader.com';
const IPA_VOICE = 'Cristiano'; // Portuguese voice for eldritch sound

// Valid IPA characters (basic Latin, IPA extensions, and common diacritics)
const IPA_CHAR_REGEX = /^[\sa-zæçðøħŋœǀǁǂǃɐɑɒɓɔɕɖɗɘəɚɛɜɝɞɟɠɡɢɣɤɥɦɧɨɪɫɬɭɮɯɰɱɲɳɴɵɶɷɸɹɺɻɼɽɾɿʀʁʂʃʄʅʆʇʈʉʊʋʌʍʎʏʐʑʒʓʔʕʖʗʘʙʚʛʜʝʞʟʠʡʢʣʤʥʦʧʨʩʪʫʬʭʮʯˈˌːˑ̀́̂̃̄̆̇̈̊̋̌̏̽͡βθχ]+$/i;

/**
 * Lugso orthography to IPA mapping
 * Lugso uses ASCII-friendly orthography that maps 1:1 to IPA
 */
const LUGSO_IPA_MAP: Record<string, string> = {
    'a': 'ʌ',
    'e': 'ʌ',
    'o': 'ʌ',
    'b': 'β',
    'p': 'ɸ',
    't': 'θ',
    'd': 'ð',
    '5': 'ʃ',
    '3': 'ʒ',
    'l': 'ɮ',
    'x': 'x',
    'g': 'ɣ',
    'h': 'χ',
    'y': 'j',
    'r': 'ɻ',
    "'": 'ʔ',
    '\u0323': ''
};

/**
 * Convert Lugso orthography to IPA
 */
export function lugsoToIPA(text: string): string {
    return text
        .toLowerCase()
        .split(' ')
        .map(word => {
            const chars = word.split('');
            let result = '';
            let firstVowel = false;

            for (const char of chars) {
                let ipaChar = LUGSO_IPA_MAP[char] ?? char;

                // Lugso stress rule: only first syllable is stressed
                // Convert all ʌ after the first vowel into ə
                if (firstVowel && ipaChar === 'ʌ') {
                    ipaChar = 'ə';
                }
                if (/[uiʌ]/.test(ipaChar)) {
                    firstVowel = true;
                }

                result += ipaChar;
            }
            return result;
        })
        .join(' ');
}

/**
 * Sanitize text to only include valid IPA characters and spaces
 */
function sanitizeForIPA(text: string): string {
    return text
        .split('')
        .filter(char => char === ' ' || IPA_CHAR_REGEX.test(char))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Split text into sentences by punctuation
 */
function splitIntoSentences(text: string): string[] {
    return text
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

/**
 * Create a headless Chrome browser instance
 */
async function createBrowser(): Promise<WebDriver> {
    const options = new chrome.Options();
    options.addArguments('--headless');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--disable-gpu');

    return new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
}

/**
 * Synthesize a single sentence and return the audio as a Buffer
 */
async function synthesizeSentence(driver: WebDriver, sentence: string): Promise<Buffer> {
    // Clear and enter the IPA text
    const textInput = await driver.findElement(By.css('#ipa-text'));
    await textInput.clear();
    await textInput.sendKeys(sentence);

    // Click the speak button
    const speakButton = await driver.findElement(By.css('button#submit'));
    await speakButton.click();

    // Wait for the audio element to appear in div.audio
    const audioElement = await driver.wait(
        until.elementLocated(By.css('div.audio audio, div.audio source')),
        30000
    );

    // Wait a bit for the audio to be fully loaded
    await driver.sleep(1000);

    // Get the audio source URL
    let audioUrl = await audioElement.getAttribute('src');

    if (!audioUrl) {
        const sourceElement = await driver.findElement(By.css('div.audio audio source'));
        audioUrl = await sourceElement.getAttribute('src');
    }

    if (!audioUrl) {
        const audio = await driver.findElement(By.css('div.audio audio'));
        audioUrl = await audio.getAttribute('src');
    }

    if (!audioUrl) {
        throw new Error('Could not find audio URL from ipa-reader.com');
    }

    // Download the audio through the browser to preserve session/cookies
    const base64Audio = await driver.executeAsyncScript(`
        const callback = arguments[arguments.length - 1];
        fetch('${audioUrl}')
            .then(response => response.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => callback(reader.result);
                reader.readAsDataURL(blob);
            })
            .catch(err => callback('ERROR:' + err.message));
    `) as string;

    if (base64Audio.startsWith('ERROR:')) {
        throw new Error(`Failed to download audio in browser: ${base64Audio}`);
    }

    // Strip the data URL prefix (e.g., "data:audio/mpeg;base64,")
    const base64Data = base64Audio.split(',')[1];
    return Buffer.from(base64Data, 'base64');
}

/**
 * Synthesize speech from IPA text using ipa-reader.com via browser automation
 * Returns the path to the generated audio file
 */
export async function synthesizeIPA(
    text: string,
    userId: string,
    mode: 'tokipona' | 'lugso'
): Promise<string> {
    const timestamp = Date.now();
    const filename = `ipa_speech_${userId}_${timestamp}.mp3`;

    // Convert to IPA if Lugso (toki pona is already IPA-like)
    const ipaText = mode === 'lugso' ? lugsoToIPA(text) : text;

    // Split into sentences and sanitize each
    const sentences = splitIntoSentences(ipaText)
        .map(sanitizeForIPA)
        .filter(s => s.length > 0);

    if (sentences.length === 0) {
        throw new Error('No valid IPA text to synthesize');
    }

    console.log(`🎤 Synthesizing IPA speech via ipa-reader.com for ${mode} (${sentences.length} sentences)`);
    console.log(`   IPA: ${ipaText.substring(0, 100)}${ipaText.length > 100 ? '...' : ''}`);

    let driver: WebDriver | null = null;

    try {
        driver = await createBrowser();

        // Navigate to IPA Reader
        await driver.get(IPA_READER_URL);

        // Wait for the page to load
        await driver.wait(until.elementLocated(By.css('#ipa-text')), 10000);

        // Select the voice by manually toggling the dropdown visibility
        await driver.executeScript(`
            document.querySelector('ul.select-options').style.display = 'inline';
        `);
        const voiceOption = await driver.findElement(By.css(`li[rel="${IPA_VOICE}"]`));
        await voiceOption.click();
        await driver.executeScript(`
            document.querySelector('ul.select-options').style.display = 'none';
        `);

        // Synthesize each sentence and collect audio buffers
        const audioBuffers: Buffer[] = [];
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            console.log(`   Synthesizing sentence ${i + 1}/${sentences.length}: "${sentence.substring(0, 50)}${sentence.length > 50 ? '...' : ''}"`);
            const buffer = await synthesizeSentence(driver, sentence);
            audioBuffers.push(buffer);
        }

        // Concatenate all audio buffers
        const combinedAudio = Buffer.concat(audioBuffers);
        await fs.promises.writeFile(filename, combinedAudio);

        console.log(`✅ IPA speech synthesized successfully via ipa-reader.com: ${filename}`);
        return filename;

    } catch (error) {
        console.error('❌ Error synthesizing IPA speech via ipa-reader.com:', error);
        throw error;
    } finally {
        if (driver) {
            await driver.quit();
        }
    }
}
