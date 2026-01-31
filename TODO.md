# TODO

## Future Improvements

### Scrapers
- [ ] Finalize Darkiworld integration
  - Scraper partially implemented in `indexer/src/scrapers/darkiworld.ts`
  - Requires an API key (`DARKIWORLD_API_KEY`)
  - Uncomment in `config.ts`, `scrapers/index.ts` and `docker-compose.yml`

  
### Indicate at the beginning of logs if the container starts with up-to-date code
 - Most recent current commit.
 - Display a big warning if this is not the case.


### Use dl-link cache to resolve cached links at the indexer level
- Will allow avoiding listing 404 links that we can already test. 