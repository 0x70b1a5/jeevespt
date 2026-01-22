import fs from 'fs';

// IPA Reader API (adapted from http://ipareader.xyz)
const IPA_API_ENDPOINT = 'https://iawll6of90.execute-api.us-east-1.amazonaws.com/production';

// Available voices - using Portuguese for a more "eldritch" sound
const IPA_VOICE = 'Cristiano';

/**
 * Lugso orthography to IPA mapping
 * Lugso uses ASCII-friendly orthography that maps 1:1 to IPA
 */
const LUGSO_IPA_MAP: Record<string, string> = {
    'a':'ʌ',
    'e':'ʌ',
    'o':'ʌ',
    'b':'β',
    'p':'ɸ',
    't':'θ',
    'd':'ð',
    '5':'ʃ',
    '3':'ʒ',
    'l':'ɮ',
    'x':'x',
    'g':'ɣ',
    'h':'χ',
    'y':'j',
    'r':'ɻ',
    "'":'ʔ',
    '\u0323':''
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
 * Synthesize speech from IPA text using the IPA Reader API
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

    console.log(`🎤 Synthesizing IPA speech for ${mode} (${text.length} chars)`);
    console.log(`   IPA: ${ipaText.substring(0, 100)}${ipaText.length > 100 ? '...' : ''}`);

    try {
        const response = await fetch(IPA_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: ipaText,
                voice: IPA_VOICE,
            }),
        });

        if (!response.ok) {
            throw new Error(`IPA API error: ${response.status} ${response.statusText}`);
        }

        // API returns base64-encoded MP3
        const base64Audio = await response.text();
        const audioBuffer = Buffer.from(base64Audio, 'base64');

        await fs.promises.writeFile(filename, audioBuffer);

        console.log(`✅ IPA speech synthesized successfully: ${filename}`);
        return filename;
    } catch (error) {
        console.error('❌ Error synthesizing IPA speech:', error);
        throw error;
    }
}
