import fs from 'fs';

export class ElevenLabs {
    private apiKey: string;
    private baseUrl = 'https://api.elevenlabs.io/v1';
    private voiceId = '43yLyUvWli9VbfxCn6CL';
    private modelId = 'eleven_multilingual_v2'; // Their recommended model

    constructor(apiKey?: string) {
        this.apiKey = apiKey || '';
        if (!this.apiKey) {
            throw new Error('ELEVENLABS_API_KEY is required for voice synthesis');
        }
    }

    async synthesizeSpeech(text: string, userId: string): Promise<string> {
        const timestamp = Date.now();
        const filename = `speech_${userId}_${timestamp}.mp3`;

        console.log(`🎤 Synthesizing speech for text (${text.length} chars)`);

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': this.apiKey
            },
            body: JSON.stringify({
                text,
                model_id: this.modelId,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            })
        };

        try {
            const response = await fetch(
                `${this.baseUrl}/text-to-speech/${this.voiceId}/stream`,
                options
            );

            if (!response.ok) {
                throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            await fs.promises.writeFile(filename, Buffer.from(buffer));

            console.log(`✅ Speech synthesized successfully: ${filename}`);
            return filename;
        } catch (error) {
            console.error('❌ Error synthesizing speech:', error);
            throw error;
        }
    }
} 