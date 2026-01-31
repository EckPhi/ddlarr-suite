import * as cheerio from 'cheerio';
import { BaseScraper, parseQuality, parseLanguage, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtml, encodeSearchQuery } from '../utils/http.js';
import { isNameMatch, extractName } from '../utils/text.js';
import { getSearchQueriesFromImdb } from '../utils/imdb.js';
import { config } from '../config.js';

type WawaContentType = 'films' | 'series' | 'mangas' | 'ebooks';

// Mapping for search parameter
const CONTENT_TYPE_MAP: Record<string, WawaContentType> = {
  movie: 'films',
  series: 'series',
  anime: 'mangas',
  ebook: 'ebooks',
};

// Selectors for search results
const RESULT_SELECTORS: Record<string, string> = {
  movie: 'a[href^="?p=film&id="]',
  series: 'a[href^="?p=serie&id="]',
  anime: 'a[href^="?p=manga&id="]',
  ebook: 'a[href^="?p=ebook&id="]',
};

interface SearchResult {
  title: string;
  pageUrl: string;
  quality?: string;
  language?: string;
  season?: number;
}

export class WawacityScraper implements BaseScraper {
  readonly name = 'WawaCity';

  constructor(public readonly baseUrl: string) {}

  async search(params: SearchParams): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    const [movies, series, anime, ebooks] = await Promise.allSettled([
      this.searchMovies(params),
      this.searchSeries(params),
      this.searchAnime(params),
      this.searchEbooks(params),
    ]);

    if (movies.status === 'fulfilled') results.push(...movies.value);
    if (series.status === 'fulfilled') results.push(...series.value);
    if (anime.status === 'fulfilled') results.push(...anime.value);
    if (ebooks.status === 'fulfilled') results.push(...ebooks.value);

    return results;
  }

  async searchMovies(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'movie');
  }

  async searchSeries(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'series');
  }

  async searchAnime(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'anime');
  }

  async searchEbooks(params: SearchParams): Promise<ScraperResult[]> {
    return this.searchByType(params, 'ebook');
  }

  private async searchByType(params: SearchParams, contentType: ContentType): Promise<ScraperResult[]> {
    if (!params.q && !params.imdbid) return [];

    const wawaType = CONTENT_TYPE_MAP[contentType];

    // If an IMDB ID is provided, fetch titles from the IMDB API
    // Otherwise use the original query
    let searchQueries: string[];
    if (params.imdbid) {
      console.log(`[WawaCity] IMDB ID provided: ${params.imdbid}`);
      searchQueries = await getSearchQueriesFromImdb(params.imdbid, params.q);
    } else {
      searchQueries = params.q ? [params.q] : [];
    }

    if (searchQueries.length === 0) {
      console.log(`[WawaCity] No search queries available`);
      return [];
    }

    console.log(`[WawaCity] Search queries for "${params.q || params.imdbid}":`, searchQueries);

    try {
      // Collect all search results for all variants
      const allSearchResults: SearchResult[] = [];
      const seenPageUrls = new Set<string>();

      // Search for each query (in parallel)
      const queryPromises = searchQueries.map(async (query) => {
        let searchTerm = query;
        if (params.season) {
          searchTerm += ` Saison ${params.season}`;
        }


        // WawaCity limit: max 32 characters (spaces included)
        // If the limit is exceeded, the complete list of films is returned instead of search results
        if (searchTerm.length > 32) {
          searchTerm = searchTerm.substring(0, 32).trim();
          console.log(`[WawaCity] Truncated search term to 32 chars: "${searchTerm}"`);
        }

        const baseSearchUrl = `${this.baseUrl}/?p=${wawaType}&linkType=hasDownloadLink&search=${encodeSearchQuery(searchTerm)}`;
        console.log(`[WawaCity] Searching ${contentType} with query "${query}": ${baseSearchUrl}`);

        try {
          return await this.fetchAllPages(baseSearchUrl, contentType, params, query);
        } catch (error) {
          console.error(`[WawaCity] Error searching query "${query}":`, error);
          return [];
        }
      });

      const queryResults = await Promise.all(queryPromises);

      // Deduplicate by detail page URL
      for (const results of queryResults) {
        for (const result of results) {
          if (!seenPageUrls.has(result.pageUrl)) {
            seenPageUrls.add(result.pageUrl);
            allSearchResults.push(result);
          }
        }
      }

      console.log(`[WawaCity] Found ${allSearchResults.length} unique search results across all queries`);

      if (allSearchResults.length === 0) {
        return [];
      }

      // For each result, visit the page and retrieve the download links
      const allResults: ScraperResult[] = [];

      // Limit to 10 results to avoid too many requests
      const pagesToVisit = allSearchResults.slice(0, 10);

      for (const result of pagesToVisit) {
        try {
          const episodes = await this.parseDetailPage(result, contentType, params);
          allResults.push(...episodes);
        } catch (error) {
          console.error(`[WawaCity] Error parsing detail page ${result.pageUrl}:`, error);
        }
      }

      console.log(`[WawaCity] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[WawaCity] Search error for ${contentType}:`, error);
      return [];
    }
  }

  private async fetchAllPages(baseSearchUrl: string, contentType: ContentType, params: SearchParams, validationQuery: string): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;
    const maxPages = config.searchMaxPages;

    while (currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? baseSearchUrl : `${baseSearchUrl}&page=${currentPage}`;
      console.log(`[WawaCity] Fetching page ${currentPage}: ${pageUrl}`);

      try {
        const html = await fetchHtml(pageUrl);
        const results = this.parseSearchResults(html, contentType, params, validationQuery);
        allResults.push(...results);

        // Check if there is a next page
        const $ = cheerio.load(html);
        const hasNextPage = $('ul.pagination li:not(.disabled) a[rel="next"]').length > 0;

        if (!hasNextPage) {
          console.log(`[WawaCity] No more pages after page ${currentPage}`);
          break;
        }

        currentPage++;
      } catch (error) {
        console.error(`[WawaCity] Error fetching page ${currentPage}:`, error);
        break;
      }
    }

    return allResults;
  }

  private parseSearchResults(html: string, contentType: ContentType, params: SearchParams, validationQuery: string): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    console.log(`[WawaCity] Parsing search results for ${contentType} (validating against "${validationQuery}")`);

    // Parse the .wa-sub-block.wa-post-detail-item blocks
    $('.wa-sub-block.wa-post-detail-item').each((_, block) => {
      try {
        const $block = $(block);
        const $titleLink = $block.find('.wa-sub-block-title a[href^="?p="]').first();

        if ($titleLink.length === 0) return;

        // Get the HTML of the link to extract the name without <i> tags
        const titleHtml = $titleLink.html() || '';
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';

        if (!title || !href) return;

        // Extract the name and season from the title (depending on content type)
        const { name, season: extractedSeason } = extractName(titleHtml, contentType);

        console.log(`[WawaCity] Parsed title: "${title}" -> name="${name}", season=${extractedSeason}`);

        // Check that the name matches the search (Levenshtein, adapted to content type)
        if (validationQuery && name) {
          if (!isNameMatch(validationQuery, name, contentType, '[WawaCity]')) {
            console.log(`[WawaCity] Skipping "${name}" - too different from "${validationQuery}"`);
            return;
          }
        }

        // If searching for a specific season, check that the season matches
        if (params.season && contentType === 'series') {
          const seasonNum = parseInt(params.season, 10);
          if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
            console.log(`[WawaCity] Skipping "${title}" - season ${extractedSeason} != ${seasonNum}`);
            return;
          }
        }

        // Build the complete link
        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}/${href}`;

        const quality = parseQuality(title);
        const language = parseLanguage(title);

        console.log(`[WawaCity] Found matching result: ${title}`);

        results.push({
          title,
          pageUrl,
          quality,
          language,
          season: extractedSeason,
        });
      } catch {
        // Skip invalid items
      }
    });

    // Fallback: use old selectors if no results
    // @deprecated: should be removed
    if (false && results.length === 0) {
      const selector = RESULT_SELECTORS[contentType];
      $(selector).each((_, element) => {
        try {
          const $link = $(element);
          const titleHtml = $link.html() || '';
          const title = $link.text().trim();
          const href = $link.attr('href') || '';

          if (!title || !href) return;

          // Extract the name and season (depending on content type)
          const { name, season: extractedSeason } = extractName(titleHtml, contentType);

          // Check that the name matches (Levenshtein, adapted to content type)
          if (validationQuery && name) {
            if (!isNameMatch(validationQuery, name, contentType, '[WawaCity]')) {
              return;
            }
          }

          // If searching for a specific season, check
          if (params.season && contentType === 'series') {
            const seasonNum = parseInt(params.season, 10);
            if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
              return;
            }
          }

          const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}/${href}`;

          results.push({
            title,
            pageUrl,
            quality: parseQuality(title),
            language: parseLanguage(title),
            season: extractedSeason,
          });
        } catch {
          // Skip invalid items
        }
      });
    }

    return results;
  }

  private async parseDetailPage(
    searchResult: SearchResult,
    contentType: ContentType,
    params: SearchParams
  ): Promise<ScraperResult[]> {
    console.log(`[WawaCity] Fetching detail page: ${searchResult.pageUrl}`);

    const html = await fetchHtml(searchResult.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Extract the year and original title from .wa-block-body .detail-list li
    let pageYear: string | undefined;
    let originalTitle: string | undefined;

    $('.wa-block-body .detail-list li').each((_, li) => {
      const $li = $(li);
      const spanText = $li.find('span').first().text().trim();

      if (spanText.includes('Année')) {
        const yearText = $li.find('b').text().trim() || $li.find('a').text().trim();
        const yearMatch = yearText.match(/(\d{4})/);
        if (yearMatch) {
          pageYear = yearMatch[1];
          console.log(`[WawaCity] Found production year: ${pageYear}`);
        }
      }

      if (spanText.includes('Titre original')) {
        originalTitle = $li.find('b').text().trim();
        if (originalTitle) {
          console.log(`[WawaCity] Found original title: ${originalTitle}`);
        }
      }
    });

    // Check if the original title matches the search better
    if (params.q && originalTitle) {
      if (isNameMatch(params.q, originalTitle, contentType, '[WawaCity]')) {
        console.log(`[WawaCity] Original title "${originalTitle}" matches search query "${params.q}"`);
      }
    }

    // Extract the IMDb ID from links or text (tt1234567)
    let imdbId: string | undefined;
    const imdbMatch = html.match(/imdb\.com\/title\/(tt\d{7,8})/i) || html.match(/\b(tt\d{7,8})\b/);
    if (imdbMatch) {
      imdbId = imdbMatch[1];
      console.log(`[WawaCity] Found IMDb ID: ${imdbId}`);
    }

    // Filter by year if the parameter is provided and the year is found on the page
    if (params.year && pageYear) {
      if (pageYear !== params.year) {
        console.log(`[WawaCity] Skipping "${searchResult.title}" - year ${pageYear} != ${params.year}`);
        return [];
      }
      console.log(`[WawaCity] Year filter passed: ${pageYear}`);
    } else if (params.year && !pageYear) {
      console.log(`[WawaCity] Year filter requested (${params.year}) but no year found on page - not filtering`);
    }

    // Parse the #DDLLinkѕ table (with Cyrillic ѕ)
    const $table = $('#DDLLinkѕ, #DDLLinks');

    if ($table.length === 0) {
      console.log(`[WawaCity] No download table found on ${searchResult.pageUrl}`);
      return results;
    }

    // Variable to track the current episode (for series)
    let currentEpisode: number | undefined;

    $table.find('tr').each((_, row) => {
      const $row = $(row);

      // Check if it's an episode title (tr.title.episode-title)
      if ($row.hasClass('title') && $row.hasClass('episode-title')) {
        const episodeText = $row.text();
        // Extract the episode number from "Épisode X" or "Episode X"
        const episodeMatch = episodeText.match(/[ÉE]pisode\s*(\d+)/i);
        if (episodeMatch) {
          currentEpisode = parseInt(episodeMatch[1], 10);
          console.log(`[WawaCity] Found episode header: Episode ${currentEpisode}`);
        }
        return; // Move to the next line
      }

      // Check if it's a link row (tr.link-row)
      if (!$row.hasClass('link-row')) {
        return;
      }

      const cells = $row.find('td');
      if (cells.length < 3) return;

      // Column 1: link
      const $linkCell = $(cells[0]);
      const $link = $linkCell.find('a').first();
      const downloadLink = $link.attr('href');

      if (!downloadLink) {
        console.error(`[WawaCity] No download link found`);
        return;
      }

      // Column 2: hoster
      const hoster = $(cells[1]).text().trim();
      const hosterLower = hoster.toLowerCase();

      // Skip "Anonyme" links (ads)
      if (hosterLower === 'anonyme') {
        console.error(`[WawaCity] "Anonyme" hoster skipped`);
        return;
      }

      // Filter by hoster if specified in params
      if (params.hoster) {
        const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
        if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
          console.log(`[WawaCity] Skipping hoster "${hoster}" - not in allowed list: ${params.hoster}`);
          return;
        }
        console.log(`[WawaCity] Accepted hoster "${hoster}" - in allowed list: ${params.hoster}`);
      }

      // Column 3: size
      const sizeText = $(cells[2]).text().trim();
      const size = parseSize(sizeText);

      // For series, use the current episode
      // For movies, currentEpisode will be undefined
      const episode = currentEpisode;

      // Filter by episode if specified in params
      if (params.ep && episode !== undefined && episode !== parseInt(params.ep, 10)) {
        return;
      }

      // Extract quality and language from search result title
      const quality = searchResult.quality || parseQuality(searchResult.title);
      const language = searchResult.language || parseLanguage(searchResult.title);

      // Build the title in a format parsable by Radarr/Sonarr
      // Movies: Title.Year.Quality.Language.Hoster
      // Series: Title.S01E05.Quality.Language.Hoster
      // Clean the name: remove brackets [xxx], dashes and their content, and multiple spaces
      const baseName = searchResult.title
        .split(' - ')[0]
        .replace(/\[.*?\]/g, '')  // Remove [HDLIGHT 1080p] etc.
        .replace(/\s+/g, ' ')     // Normalize spaces
        .trim()
        .replace(/\s+/g, '.');    // Replace spaces with dots
      const parts: string[] = [baseName];

      if (contentType === 'movie' && pageYear) {
        parts.push(pageYear);
      }
      if (searchResult.season) {
        parts.push(`S${String(searchResult.season).padStart(2, '0')}${episode !== undefined ? `E${String(episode).padStart(2, '0')}` : ''}`);
      }
      if (quality) parts.push(quality.replace(/\s+/g, '.'));
      if (language) parts.push(language.replace(/\s+/g, '.'));
      if (hoster) parts.push(hoster.replace(/\s+/g, '.'));

      const title = parts.join('.');

      results.push({
        title,
        link: downloadLink,
        pageUrl: searchResult.pageUrl,
        size,
        quality,
        language,
        imdbId,
        season: searchResult.season,
        episode,
        contentType,
        pubDate: new Date(),
        year: pageYear ? parseInt(pageYear, 10) : undefined,
      });
    });

    console.log(`[WawaCity] Found ${results.length} download links on detail page`);
    return results;
  }

  async getDownloadLinks(pageUrl: string): Promise<string[]> {
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      const links: string[] = [];

      $('#DDLLinks tr, #DDLLinkѕ tr').each((index, row) => {
        if (index === 0) return; // Skip header
        const linkEl = $(row).find('a[href*="dl-protect"], a.link').first();
        const href = linkEl.attr('href');
        if (href) links.push(href);
      });

      // Fallback
      if (links.length === 0) {
        $('a[href*="dl-protect"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) links.push(href);
        });
      }

      console.log(`[WawaCity] Found ${links.length} download links`);
      return links;
    } catch (error) {
      console.error('[WawaCity] Error fetching download links:', error);
      return [];
    }
  }
}