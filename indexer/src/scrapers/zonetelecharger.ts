import * as cheerio from 'cheerio';
import { BaseScraper, parseQuality, parseLanguage, parseSize } from './base.js';
import { ScraperResult, SearchParams, ContentType } from '../models/torznab.js';
import { fetchHtml, encodeSearchQuery } from '../utils/http.js';
import { isNameMatch, extractName } from '../utils/text.js';
import { getSearchQueriesFromImdb } from '../utils/imdb.js';
import { config } from '../config.js';

type ZTContentType = 'films' | 'series' | 'mangas' | 'ebooks';

// Mapping for search parameter
const CONTENT_TYPE_MAP: Record<string, ZTContentType> = {
  movie: 'films',
  series: 'series',
  anime: 'mangas',
  ebook: 'ebooks',
};

interface SearchResult {
  title: string;
  pageUrl: string;
  quality?: string;
  language?: string;
  season?: number;
  needsOriginalTitleCheck?: boolean; // True if French title didn't match, need to check original title
  validationQuery?: string; // The query used for Levenshtein validation (IMDB title or original query)
}

export class ZoneTelechargerScraper implements BaseScraper {
  readonly name = 'Zone-Téléchargement';

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

    const ztType = CONTENT_TYPE_MAP[contentType];

    // If an IMDB ID is provided, fetch titles from the IMDB API
    // Otherwise use the original query
    let searchQueries: string[];
    if (params.imdbid) {
      console.log(`[ZoneTelecharger] IMDB ID provided: ${params.imdbid}`);
      searchQueries = await getSearchQueriesFromImdb(params.imdbid, params.q);
    } else {
      searchQueries = params.q ? [params.q] : [];
    }

    if (searchQueries.length === 0) {
      console.log(`[ZoneTelecharger] No search queries available`);
      return [];
    }

    console.log(`[ZoneTelecharger] Search queries for "${params.q || params.imdbid}":`, searchQueries);

    try {
      // Collect all search results for all queries
      const allSearchResults: SearchResult[] = [];
      const seenPageUrls = new Set<string>();

      // Search for each query (in parallel)
      const queryPromises = searchQueries.map(async (query) => {
        let searchTerm = query;
        if (params.season) {
          searchTerm += ` Saison ${params.season}`;
        }

        // Zone-Téléchargement limit: max 36 characters (spaces included)
        // If the limit is exceeded, the complete list of films is returned instead of search results
        if (searchTerm.length > 36) {
          searchTerm = searchTerm.substring(0, 36).trim();
          console.log(`[ZoneTelecharger] Truncated search term to 36 chars: "${searchTerm}"`);
        }


        const baseSearchUrl = `${this.baseUrl}/?search=${encodeSearchQuery(searchTerm)}&p=${ztType}`;
        console.log(`[ZoneTelecharger] Searching ${contentType} with query "${query}": ${baseSearchUrl}`);

        try {
          return await this.fetchAllPages(baseSearchUrl, contentType, params, query);
        } catch (error) {
          console.error(`[ZoneTelecharger] Error searching query "${query}":`, error);
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

      console.log(`[ZoneTelecharger] Found ${allSearchResults.length} unique search results across all queries`);

      if (allSearchResults.length === 0) {
        return [];
      }

      // For each result, visit the page and retrieve the download links
      const allResults: ScraperResult[] = [];

      // Limit to 10 results to avoid too many requests
      const pagesToVisit = allSearchResults.slice(0, 10);

      for (const result of pagesToVisit) {
        try {
          const episodes = await this.parseDetailPage(result, contentType, params, result.needsOriginalTitleCheck);
          allResults.push(...episodes);
        } catch (error) {
          console.error(`[ZoneTelecharger] Error parsing detail page ${result.pageUrl}:`, error);
        }
      }

      console.log(`[ZoneTelecharger] Total results after parsing detail pages: ${allResults.length}`);
      return allResults;
    } catch (error) {
      console.error(`[ZoneTelecharger] Search error for ${contentType}:`, error);
      return [];
    }
  }

  private async fetchAllPages(baseSearchUrl: string, contentType: ContentType, params: SearchParams, validationQuery: string): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;
    const maxPages = config.searchMaxPages;

    while (currentPage <= maxPages) {
      const pageUrl = currentPage === 1 ? baseSearchUrl : `${baseSearchUrl}&page=${currentPage}`;
      console.log(`[ZoneTelecharger] Fetching page ${currentPage}: ${pageUrl}`);

      try {
        const html = await fetchHtml(pageUrl);
        const results = this.parseSearchResults(html, contentType, params, validationQuery);
        allResults.push(...results);

        // Check if there is a next page (div.navigation a[rel="next"])
        const $ = cheerio.load(html);
        const hasNextPage = $('div.navigation a[rel="next"]').length > 0;

        if (!hasNextPage) {
          console.log(`[ZoneTelecharger] No more pages after page ${currentPage}`);
          break;
        }

        currentPage++;
      } catch (error) {
        console.error(`[ZoneTelecharger] Error fetching page ${currentPage}:`, error);
        break;
      }
    }

    return allResults;
  }

  private parseSearchResults(html: string, contentType: ContentType, params: SearchParams, validationQuery: string): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    console.log(`[ZoneTelecharger] Parsing search results for ${contentType} (validating against "${validationQuery}")`);

    // Parse the .cover_global blocks
    $('.cover_global').each((_, block) => {
      try {
        const $block = $(block);

        // Title and link in div.cover_infos_title > a
        const $titleLink = $block.find('div.cover_infos_title > a').first();

        if ($titleLink.length === 0) return;

        const titleHtml = $titleLink.html() || '';
        const title = $titleLink.text().trim();
        const href = $titleLink.attr('href') || '';

        if (!title || !href) return;

        // Language in div.cover_infos_title > .detail_release > span > b
        const langText = $block.find('div.cover_infos_title .detail_release > span > b').text().trim();
        const language = parseLanguage(langText) || parseLanguage(title);

        // Extract the name and season from the title (depending on content type)
        const { name, season: extractedSeason } = extractName(titleHtml, contentType);

        console.log(`[ZoneTelecharger] Parsed title: "${title}" -> name="${name}", season=${extractedSeason}, lang="${langText}"`);

        // Check that the name matches the search (Levenshtein, adapted to content type)
        // For movies, we're less strict because we'll check the original title on the detail page
        let needsOriginalTitleCheck = false;
        if (validationQuery && name) {
          if (!isNameMatch(validationQuery, name, contentType, '[ZoneTelecharger]')) {
            if (contentType !== 'movie') {
              console.log(`[ZoneTelecharger] Skipping "${name}" - too different from "${validationQuery}"`);
              return;
            }
            console.log(`[ZoneTelecharger] Keeping "${name}" (movie) - will check original title on detail page`);
            needsOriginalTitleCheck = true;
          }
        }

        // If searching for a specific season, check that the season matches
        if (params.season && contentType === 'series') {
          const seasonNum = parseInt(params.season, 10);
          if (extractedSeason !== undefined && extractedSeason !== seasonNum) {
            console.log(`[ZoneTelecharger] Skipping "${title}" - season ${extractedSeason} != ${seasonNum}`);
            return;
          }
        }

        const pageUrl = href.startsWith('http') ? href : `${this.baseUrl}${href}`;

        const quality = parseQuality(title);

        console.log(`[ZoneTelecharger] Found matching result: ${title}`);

        results.push({
          title,
          pageUrl,
          quality,
          language,
          season: extractedSeason,
          needsOriginalTitleCheck,
          validationQuery,
        });
      } catch {
        // Skip invalid items
      }
    });

    return results;
  }

  private async parseDetailPage(
    searchResult: SearchResult,
    contentType: ContentType,
    params: SearchParams,
    needsOriginalTitleCheck: boolean = false
  ): Promise<ScraperResult[]> {
    console.log(`[ZoneTelecharger] Fetching detail page: ${searchResult.pageUrl}`);

    const html = await fetchHtml(searchResult.pageUrl);
    const $ = cheerio.load(html);
    const results: ScraperResult[] = [];

    // Extract the original title from "<strong><u>Titre original</u> :</strong> Title <br"
    let originalTitle: string | undefined;
    const bodyText = $('div.maincont, div.corps').text();
    const originalTitleMatch = html.match(/<strong><u>Titre original<\/u>\s*:<\/strong>\s*([^<]+)/i);
    if (originalTitleMatch) {
      originalTitle = originalTitleMatch[1].trim();
      console.log(`[ZoneTelecharger] Found original title: ${originalTitle}`);
    }

    // If we need to check the original title and it doesn't match, skip
    const validationQuery = searchResult.validationQuery;
    if (needsOriginalTitleCheck && validationQuery) {
      const { name } = extractName(searchResult.title, contentType);
      const frenchMatches = name ? isNameMatch(validationQuery, name, contentType, '[ZoneTelecharger]') : false;
      const originalMatches = originalTitle ? isNameMatch(validationQuery, originalTitle, contentType, '[ZoneTelecharger]') : false;

      if (!frenchMatches && !originalMatches) {
        console.log(`[ZoneTelecharger] Skipping "${searchResult.title}" - neither French title "${name}" nor original "${originalTitle}" match "${validationQuery}"`);
        return [];
      }
      if (originalMatches && !frenchMatches) {
        console.log(`[ZoneTelecharger] Matched via original title: "${originalTitle}"`);
      }
    }

    // Extract the file size from the page
    let fileSize: number | undefined;

    // Method 1: "Taille du fichier : X Go"
    const sizeMatch1 = bodyText.match(/Taille du fichier\s*:\s*([\d.,]+)\s*(Go|Mo|Ko|GB|MB|KB)/i);
    if (sizeMatch1) {
      fileSize = parseSize(`${sizeMatch1[1]} ${sizeMatch1[2]}`);
      console.log(`[ZoneTelecharger] Found file size (method 1): ${sizeMatch1[1]} ${sizeMatch1[2]}`);
    }

    // Method 2: "filename.mkv (X Go)" in the font color="red"
    if (!fileSize) {
      const redText = $('font[color="red"]').text();
      const sizeMatch2 = redText.match(/\(([\d.,]+)\s*(Go|Mo|Ko|GB|MB|KB)\)/i);
      if (sizeMatch2) {
        fileSize = parseSize(`${sizeMatch2[1]} ${sizeMatch2[2]}`);
        console.log(`[ZoneTelecharger] Found file size (method 2): ${sizeMatch2[1]} ${sizeMatch2[2]}`);
      }
    }

    // Extract quality and language from "Qualité HDLIGHT 1080p | VOSTFR"
    let pageQuality: string | undefined;
    let pageLanguage: string | undefined;

    const qualityDiv = $('div').filter((_, el) => {
      const text = $(el).text();
      return text.includes('Qualité') && text.includes('|');
    }).first();

    if (qualityDiv.length > 0) {
      const qualityText = qualityDiv.text().trim();
      const qualityMatch = qualityText.match(/Qualité\s+(.+?)\s*\|\s*(.+)/i);
      if (qualityMatch) {
        pageQuality = qualityMatch[1].trim();
        pageLanguage = qualityMatch[2].trim();
        console.log(`[ZoneTelecharger] Found quality: ${pageQuality}, language: ${pageLanguage}`);
      }
    }

    // Extract the IMDb ID from links or text (tt1234567)
    let imdbId: string | undefined;
    const imdbMatch = html.match(/imdb\.com\/title\/(tt\d{7,8})/i) || html.match(/\b(tt\d{7,8})\b/);
    if (imdbMatch) {
      imdbId = imdbMatch[1];
      console.log(`[ZoneTelecharger] Found IMDb ID: ${imdbId}`);
    }

    // Extract the production year from "<strong><u>Année de production</u> :</strong> 2006"
    let pageYear: string | undefined;
    const yearMatch = bodyText.match(/Année de production[^:]*:\s*(\d{4})/i);
    if (yearMatch) {
      pageYear = yearMatch[1];
      console.log(`[ZoneTelecharger] Found production year: ${pageYear}`);
    }

    // Filter by year if the parameter is provided and the year is found on the page
    if (params.year && pageYear) {
      if (pageYear !== params.year) {
        console.log(`[ZoneTelecharger] Skipping "${searchResult.title}" - year ${pageYear} != ${params.year}`);
        return [];
      }
      console.log(`[ZoneTelecharger] Year filter passed: ${pageYear}`);
    } else if (params.year && !pageYear) {
      console.log(`[ZoneTelecharger] Year filter requested (${params.year}) but no year found on page - not filtering`);
    }

    // Find the h2 containing "Liens De Téléchargement :" then the following div.postinfo (nested in a div)
    const $h2 = $('h2').filter((_, el) => $(el).text().includes('Liens De Téléchargement'));

    // The div.postinfo is in one of the following sibling elements of h2
    let $postinfo = $(''); // cheerio selection vide
    $h2.nextAll().each((_, el) => {
      const $el = $(el);
      // Check if it's directly a div.postinfo
      if ($el.is('div.postinfo')) {
        $postinfo = $el;
        return false; // break
      }
      // Otherwise look for a div.postinfo inside
      const $found = $el.find('div.postinfo').first();
      if ($found.length > 0) {
        $postinfo = $found;
        return false; // break
      }
    });

    if ($postinfo.length === 0) {
      console.log(`[ZoneTelecharger] No download section found on ${searchResult.pageUrl}`);
    }

    if ($postinfo.length > 0) {
      let currentHoster = '';

      // Loop through all <b> elements in the block
      $postinfo.find('> b').each((_, bElement) => {
        const $b = $(bElement);

        // If it's a <b><div>Hoster</div></b>, it's the hoster name
        const $hosterDiv = $b.find('> div');
        if ($hosterDiv.length > 0) {
          currentHoster = $hosterDiv.text().trim();
          console.log(`[ZoneTelecharger] Found hoster: ${currentHoster}`);
          return; // continue
        }

        // If it's a <b><a>Episode X</a></b>, it's a download link
        const $link = $b.find('> a[rel="external nofollow"]');
        if ($link.length > 0 && currentHoster) {
          const downloadLink = $link.attr('href');
          const linkText = $link.text().trim();

          if (!downloadLink) return;

          const hosterLower = currentHoster.toLowerCase();

          // Filter by hoster if specified in params
          if (params.hoster) {
            const allowedHosters = params.hoster.toLowerCase().split(',').map(h => h.trim());
            if (!allowedHosters.some(allowed => hosterLower.includes(allowed) || allowed.includes(hosterLower))) {
              console.log(`[ZoneTelecharger] Skipping hoster "${currentHoster}" - not in allowed list: ${params.hoster}`);
              return;
            }
          }

          // Extract the episode number from the link text (e.g., "Episode 1", "Episode 12 FiNAL")
          let episode: number | undefined;
          const episodeMatch = linkText.match(/[ÉE]pisode\s*(\d+)/i);
          if (episodeMatch) {
            episode = parseInt(episodeMatch[1], 10);
          }

          // Filter by episode if specified in params
          if (params.ep && episode !== undefined && episode !== parseInt(params.ep, 10)) {
            return;
          }

          const quality = pageQuality || searchResult.quality || parseQuality(searchResult.title);
          const language = pageLanguage || searchResult.language || parseLanguage(searchResult.title);

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
          if (currentHoster) parts.push(currentHoster.replace(/\s+/g, '.'));

          const title = parts.join('.');

          results.push({
            title,
            link: downloadLink,
            pageUrl: searchResult.pageUrl,
            size: fileSize,
            quality,
            language,
            imdbId,
            season: searchResult.season,
            episode,
            contentType,
            pubDate: new Date(),
            year: pageYear ? parseInt(pageYear, 10) : undefined,
          });
        }
      });
    }

    console.log(`[ZoneTelecharger] Found ${results.length} download links on detail page`);
    return results;
  }

  async getDownloadLinks(pageUrl: string): Promise<string[]> {
    try {
      const html = await fetchHtml(pageUrl);
      const $ = cheerio.load(html);
      const links: string[] = [];

      // Parse the div.postinfo blocks
      $('div.postinfo b > a[rel="external nofollow"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) links.push(href);
      });

      // Fallback
      if (links.length === 0) {
        $('a[href*="dl-protect"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) links.push(href);
        });
      }

      console.log(`[ZoneTelecharger] Found ${links.length} download links`);
      return links;
    } catch (error) {
      console.error('[ZoneTelecharger] Error fetching download links:', error);
      return [];
    }
  }
}