export interface FuzzySearchField<FieldId extends string> {
  id: FieldId;
  priority: "primary" | "secondary";
  text: string;
}

export interface FuzzySearchMatch<FieldId extends string> {
  matchedFieldIds: readonly FieldId[];
  score: number;
}

const ENGLISH_KEYBOARD = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./";
const RUSSIAN_KEYBOARD = "ёйцукенгшщзхъфывапролджэячсмитьбю.";
const EXACT_SCORE = 0;
const PREFIX_SCORE = 100;
const INITIALISM_SCORE = 200;
const SUBSTRING_SCORE = 300;
const SUBSEQUENCE_SCORE = 400;
const EDIT_DISTANCE_SCORE = 500;
const SECONDARY_FIELD_PENALTY = 1;

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ё/g, "е").trim().toLocaleLowerCase("ru");
}

function swapKeyboardLayout(value: string, source: string, target: string): string {
  return [...value.toLocaleLowerCase("ru")].map((character) => {
    const index = source.indexOf(character);
    return index === -1 ? character : target[index];
  }).join("");
}

export function searchQueryVariants(value: string): string[] {
  return [...new Set([
    normalized(value),
    normalized(swapKeyboardLayout(value, ENGLISH_KEYBOARD, RUSSIAN_KEYBOARD)),
    normalized(swapKeyboardLayout(value, RUSSIAN_KEYBOARD, ENGLISH_KEYBOARD)),
  ])].filter(Boolean);
}

function editDistance(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row;
  for (let column = 0; column <= b.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}

function allowedEditDistance(length: number): number {
  if (length < 4) return 0;
  if (length < 7) return 1;
  return 2;
}

function subsequencePenalty(term: string, word: string, minimumLength = 3): number | null {
  if (term.length < minimumLength || term.length >= word.length) return null;
  let termIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let wordIndex = 0; wordIndex < word.length; wordIndex += 1) {
    if (word[wordIndex] !== term[termIndex]) continue;
    if (firstMatch === -1) firstMatch = wordIndex;
    lastMatch = wordIndex;
    termIndex += 1;
    if (termIndex === term.length) break;
  }
  if (termIndex !== term.length || firstMatch === -1 || lastMatch === -1) return null;

  const omittedCharacters = word.length - term.length;
  const matchedSpan = lastMatch - firstMatch + 1;
  const spanGaps = matchedSpan - term.length;
  return (2 * omittedCharacters + spanGaps) / Math.max(1, 4 * word.length);
}

function fuzzyTermScore(searchable: string, priority: FuzzySearchField<string>["priority"], term: string, minimumSubsequenceLength = 3): number {
  const words = searchable.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (priority === "primary") {
    if (searchable === term) return EXACT_SCORE;
    if (searchable.startsWith(term)) return PREFIX_SCORE;
    const initials = words.map((word) => word[0]).join("");
    const initialismIndex = term.length >= 2 ? initials.indexOf(term) : -1;
    if (initialismIndex !== -1) return INITIALISM_SCORE + initialismIndex;
  }
  if (searchable.includes(term)) return SUBSTRING_SCORE;

  let smallestPenalty = Number.POSITIVE_INFINITY;
  for (const word of words) {
    const penalty = subsequencePenalty(term, word, minimumSubsequenceLength);
    if (penalty !== null) smallestPenalty = Math.min(smallestPenalty, penalty);
  }
  if (Number.isFinite(smallestPenalty)) return SUBSEQUENCE_SCORE + smallestPenalty;

  const maximum = allowedEditDistance(term.length);
  if (!maximum) return Number.POSITIVE_INFINITY;
  let closest = Number.POSITIVE_INFINITY;
  for (const word of words) {
    if (Math.abs(word.length - term.length) > maximum) continue;
    closest = Math.min(closest, editDistance(term, word));
  }
  return closest <= maximum ? EDIT_DISTANCE_SCORE + closest : Number.POSITIVE_INFINITY;
}

interface TermMatch<FieldId extends string> {
  fieldId: FieldId;
  score: number;
}

function bestTermMatch<FieldId extends string>(term: string, fields: readonly FuzzySearchField<FieldId>[], minimumSubsequenceLength = 3): TermMatch<FieldId> | null {
  let best: TermMatch<FieldId> | null = null;
  for (const field of fields) {
    const searchable = normalized(field.text);
    if (!searchable) continue;
    for (const [variantIndex, variant] of searchQueryVariants(term).entries()) {
      const intrinsicScore = fuzzyTermScore(searchable, field.priority, variant, minimumSubsequenceLength);
      const score = intrinsicScore + (field.priority === "secondary" ? SECONDARY_FIELD_PENALTY : 0) + variantIndex;
      if (!Number.isFinite(score)) continue;
      if (best === null || score < best.score) best = { fieldId: field.id, score };
    }
  }
  return best;
}

export function fuzzySearch<FieldId extends string>(query: string, fields: readonly FuzzySearchField<FieldId>[]): FuzzySearchMatch<FieldId> | null {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { matchedFieldIds: [], score: 0 };

  const strictMatches = terms.map((term) => bestTermMatch(term, fields));
  const hasStrictMatch = strictMatches.some((match) => match !== null);
  const matches: TermMatch<FieldId>[] = [];
  for (const [index, term] of terms.entries()) {
    const strictMatch = strictMatches[index];
    if (strictMatch !== null) {
      matches.push(strictMatch);
      continue;
    }

    // Relaxed two-character subsequences are allowed only after another term
    // has already made a strict match; unresolved short terms cannot bootstrap
    // each other into a broad result.
    const contextualMatch = hasStrictMatch ? bestTermMatch(term, fields, 2) : null;
    if (contextualMatch === null) return null;
    matches.push(contextualMatch);
  }

  matches.sort((left, right) => left.score - right.score);
  return {
    matchedFieldIds: [...new Set(matches.map((match) => match.fieldId))],
    score: matches.reduce((total, match) => total + match.score, 0),
  };
}
