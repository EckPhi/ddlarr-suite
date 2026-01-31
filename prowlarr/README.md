# DDL Torznab - Prowlarr Custom Indexer

This Cardigann definition allows you to add DDL Torznab as a native indexer in Prowlarr.

> **Note**: This definition has not been tested. If you encounter problems, use Option 2 (Generic Torznab) which works reliably.

## Installation

### Option 1: Custom Definition (recommended)

1. Copy the `ddl-torznab.yml` file to the Prowlarr custom definitions folder:
   - **Linux**: `~/.config/Prowlarr/Definitions/Custom/`
   - **Docker**: `/config/Definitions/Custom/`
   - **Windows**: `%AppData%\Prowlarr\Definitions\Custom\`

2. Restart Prowlarr

3. Add the indexer:
   - Go to **Settings > Indexers > Add Indexer**
   - Search for "DDL Torznab"
   - Configure the URL (default: `http://ddl-torznab:3000`)
   - Select the source site (Darkiworld, ZoneTelecharger, WawaCity)

### Option 2: Generic Torznab

If the custom definition doesn't work, use the generic Torznab indexer:

1. In Prowlarr: **Settings > Indexers > Add Indexer**
2. Select **Generic Torznab**
3. Configure:
   - **Name**: DDL Torznab - Darkiworld (or other site)
   - **URL**: `http://ddl-torznab:3000/api/darkiworld`
   - **API Key**: leave empty
   - **Categories**: Movies, TV

## Configuration

| Parameter | Description | Example |
|-----------|-------------|---------|
| DDL Torznab URL | DDL Torznab service URL | `http://ddl-torznab:3000` |
| Source Site | DDL site to use | `darkiworld` |

## Available Sites

- **Darkiworld**: French movies and TV series
- **ZoneTelecharger**: French movies and TV series
- **WawaCity**: French movies, TV series and ebooks

## Filter by Hoster

To filter by specific hoster, use the URL with path:
```
http://ddl-torznab:3000/api/darkiworld/1fichier
http://ddl-torznab:3000/api/darkiworld/uptobox,1fichier
```

## Docker Compose

If you're using Docker Compose with Prowlarr:

```yaml
services:
  prowlarr:
    image: linuxserver/prowlarr
    volumes:
      - ./prowlarr:/config
      - ./prowlarr/ddl-torznab.yml:/config/Definitions/Custom/ddl-torznab.yml:ro
```

## Troubleshooting

- **Indexer not visible**: Restart Prowlarr after copying the file
- **Connection error**: Verify that DDL Torznab is accessible from Prowlarr (same Docker network)
- **No results**: Test with the DDL Torznab web interface directly
