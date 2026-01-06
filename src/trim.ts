export default function trim(text: string) {
    text = text.replace(/\n(\s+)?\n(\s+)?/g, '\n');
    return text.replace(/[ \t\r]+/g, ' ') || ''
}