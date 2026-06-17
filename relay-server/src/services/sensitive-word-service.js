import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_VOCABULARY_DIR = path.resolve(__dirname, "..", "vocabulary");

export function createSensitiveWordService({ vocabularyDir = DEFAULT_VOCABULARY_DIR } = {}) {
  let words = null;

  function loadWords() {
    if (words) return words;
    try {
      const loadedWords = fs
        .readdirSync(vocabularyDir)
        .filter((fileName) => fileName.endsWith(".txt"))
        .flatMap((fileName) => fs
          .readFileSync(path.join(vocabularyDir, fileName), "utf8")
          .split(/\r?\n/)
          .map((word) => word.trim())
          .filter(Boolean));
      words = Array.from(new Set(loadedWords)).sort((a, b) => b.length - a.length);
    } catch (error) {
      console.error("[SensitiveWordService] Failed to load sensitive vocabulary:", error);
      words = [];
    }
    return words;
  }

  function filterText(content) {
    if (typeof content !== "string" || !content) return content;
    const loadedWords = loadWords();
    if (loadedWords.length === 0) return content;

    const chars = Array.from(content);
    const masked = new Array(chars.length).fill(false);
    const codeUnitToCharIndex = [];
    let codeUnitIndex = 0;

    for (let charIndex = 0; charIndex < chars.length; charIndex++) {
      const char = chars[charIndex];
      for (let offset = 0; offset < char.length; offset++) {
        codeUnitToCharIndex[codeUnitIndex + offset] = charIndex;
      }
      codeUnitIndex += char.length;
    }

    for (const word of loadedWords) {
      let searchFrom = 0;
      while (searchFrom < content.length) {
        const foundAt = content.indexOf(word, searchFrom);
        if (foundAt < 0) break;

        const startChar = codeUnitToCharIndex[foundAt];
        const endChar = codeUnitToCharIndex[foundAt + word.length - 1];
        if (startChar !== undefined && endChar !== undefined) {
          for (let index = startChar; index <= endChar; index++) {
            masked[index] = true;
          }
        }

        searchFrom = foundAt + 1;
      }
    }

    return chars.map((char, index) => (masked[index] ? "*" : char)).join("");
  }

  return {
    filterText,
    hasWords: () => loadWords().length > 0,
    loadWords,
  };
}
