import { ContentType } from '../models/torznab.js';

/**
 * Remove text in brackets [VF], [1080p], etc.
 */
export function removeBrackets(str: string): string {
  return str.replace(/\[[^\]]*\]/g, '').trim();
}

/**
 * Normalize a string for comparison (lowercase, no accents, no special characters)
 */
export function normalizeForMatch(str: string): string {
  return removeBrackets(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]/g, ''); // Keep only letters and numbers
}

/**
 * Calculate the Levenshtein distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // suppression
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate the allowed distance based on search length
 */
export function getAllowedDistance(queryLength: number): number {
  if (queryLength <= 5) {
    return 1;
  } else if (queryLength <= 10) {
    return 2;
  } else {
    return Math.floor(queryLength * 0.2);
  }
}

/**
 * Check if two series names are close enough
 */
export function isSeriesNameMatch(searchQuery: string, foundName: string, logPrefix = '[Scraper]'): boolean {
  const normalizedQuery = normalizeForMatch(searchQuery);
  const normalizedFound = normalizeForMatch(foundName);

  if (normalizedQuery === normalizedFound) {
    console.log(`${logPrefix} Series exact match: "${searchQuery}" = "${foundName}"`);
    return true;
  }

  const distance = levenshteinDistance(normalizedQuery, normalizedFound);
  const allowedDistance = getAllowedDistance(normalizedQuery.length);

  console.log(`${logPrefix} Series comparing "${searchQuery}" with "${foundName}": distance=${distance}, allowed=${allowedDistance}`);

  return distance <= allowedDistance;
}

/**
 * Check if two movie names are close enough
 * For movies, we also check if the search is contained in the found title
 */
export function isMovieNameMatch(searchQuery: string, foundName: string, logPrefix = '[Scraper]'): boolean {
  const normalizedQuery = normalizeForMatch(searchQuery);
  const normalizedFound = normalizeForMatch(foundName);

  if (normalizedQuery === normalizedFound) {
    console.log(`${logPrefix} Movie exact match: "${searchQuery}" = "${foundName}"`);
    return true;
  }

  // For movies, we also check if the search is contained in the found title
  // Useful for "Heat" which can find "Heat 1995" or "Heat (1995)"
  if (normalizedFound.includes(normalizedQuery)) {
    console.log(`${logPrefix} Movie contains match: "${searchQuery}" in "${foundName}"`);
    return true;
  }

  const distance = levenshteinDistance(normalizedQuery, normalizedFound);
  const allowedDistance = getAllowedDistance(normalizedQuery.length);

  console.log(`${logPrefix} Movie comparing "${searchQuery}" with "${foundName}": distance=${distance}, allowed=${allowedDistance}`);

  return distance <= allowedDistance;
}

/**
 * Check if a name matches the search (depending on content type)
 */
export function isNameMatch(searchQuery: string, foundName: string, contentType: ContentType, logPrefix = '[Scraper]'): boolean {
  if (contentType === 'movie') {
    return isMovieNameMatch(searchQuery, foundName, logPrefix);
  }
  return isSeriesNameMatch(searchQuery, foundName, logPrefix);
}

/**
 * Extract the movie name from the title (remove technical info and brackets)
 */
export function extractMovieName(titleHtml: string): string {
  // Enlève les tags HTML
  let cleanTitle = titleHtml
    .replace(/<[^>]+>/g, '') // Supprime les tags HTML
    .replace(/\s+/g, ' ')    // Normalise les espaces
    .trim();

  // Retire les textes entre crochets [VF], [1080p], etc.
  cleanTitle = removeBrackets(cleanTitle);

  // Split on " - " to separate parts (title - quality - language)
  const parts = cleanTitle.split(' - ');

  // The first element is generally the movie title
  return parts[0].trim();
}

/**
 * Extract the series name from the title (remove "Saison X" part and language)
 */
export function extractSeriesName(titleHtml: string): { seriesName: string; season?: number } {
  // Enlève les tags HTML
  let cleanTitle = titleHtml
    .replace(/<[^>]+>/g, '') // Supprime les tags HTML
    .replace(/\s+/g, ' ')    // Normalise les espaces
    .trim();

  // Retire les textes entre crochets [VF], [1080p], etc.
  cleanTitle = removeBrackets(cleanTitle);

  // Split on " - " to separate parts
  const parts = cleanTitle.split(' - ');

  if (parts.length >= 2) {
    // The last part is often the language (VF, VOSTFR, etc.) or the season
    // We look for the "Saison X" part
    let seriesName = '';
    let season: number | undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      const seasonMatch = part.match(/^saison\s*(\d+)$/i);

      if (seasonMatch) {
        season = parseInt(seasonMatch[1], 10);
        // The series name is everything that precedes
        seriesName = parts.slice(0, i).join(' - ').trim();
        break;
      }
    }

    // If we didn't find an explicit season, take everything except the last element
    if (!seriesName) {
      seriesName = parts.slice(0, -1).join(' - ').trim();
    }

    return { seriesName, season };
  }

  return { seriesName: cleanTitle };
}

/**
 * Extract the name depending on content type
 */
export function extractName(titleHtml: string, contentType: ContentType): { name: string; season?: number } {
  if (contentType === 'movie') {
    return { name: extractMovieName(titleHtml) };
  }
  const { seriesName, season } = extractSeriesName(titleHtml);
  return { name: seriesName, season };
}
