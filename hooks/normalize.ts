/** The normalized form of text that every match and key compares. */

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[*_`[\]()]/g, '').replace(/\s+/g, ' ').trim()
}
