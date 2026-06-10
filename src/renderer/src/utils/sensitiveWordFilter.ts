export function filterSensitiveText(content: string, words: string[]): string {
  if (!content || !words.length) return content

  const chars = Array.from(content)
  const masked = new Array<boolean>(chars.length).fill(false)
  const codeUnitToCharIndex: number[] = []
  let codeUnitIndex = 0

  for (let charIndex = 0; charIndex < chars.length; charIndex++) {
    const char = chars[charIndex]
    for (let offset = 0; offset < char.length; offset++) {
      codeUnitToCharIndex[codeUnitIndex + offset] = charIndex
    }
    codeUnitIndex += char.length
  }

  for (const word of words) {
    if (!word) continue
    let searchFrom = 0
    while (searchFrom < content.length) {
      const foundAt = content.indexOf(word, searchFrom)
      if (foundAt < 0) break

      const startChar = codeUnitToCharIndex[foundAt]
      const endChar = codeUnitToCharIndex[foundAt + word.length - 1]
      if (startChar !== undefined && endChar !== undefined) {
        for (let i = startChar; i <= endChar; i++) {
          masked[i] = true
        }
      }

      searchFrom = foundAt + 1
    }
  }

  return chars.map((char, index) => (masked[index] ? '*' : char)).join('')
}
