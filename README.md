# DDL Torznab

Torznab indexer for DDL (Direct Download Links) sites, compatible with Prowlarr, Sonarr, and Radarr.

## Quick Install (Docker)

```bash
# 1. Download docker-compose and .env files
curl -O https://raw.githubusercontent.com/z-m-g/ddlarr-suite/main/docker-compose.prod.yml
curl -O https://raw.githubusercontent.com/z-m-g/ddlarr-suite/main/.env.example
mv .env.example .env

# 2. Edit .env with your settings (debrid API key, site URLs, etc.)
nano .env

# 3. Create download directories
mkdir -p downloads downloads-temp

# 4. Start services
docker compose -f docker-compose.prod.yml up -d
```

**Access:**
- Torznab Indexer: `http://localhost:9117`
- qBittorrent UI: `http://localhost:8080` (admin/adminadmin)

**Configure in Radarr/Sonarr:**
1. Add Indexer: Settings > Indexers > Torznab > URL: `http://<IP>:9117` > API Path: `/api/wawacity`
2. Add Download Client: Settings > Download Clients > qBittorrent > Host: `<IP>`, Port: `8080`

## Soutien
☕ Après minuit, je code. Je bois du café — pas d’eau (c’est dangereux pour les gremlins).  
<a href="https://www.buymeacoffee.com/z.m.g"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="40"></a>


## Architecture

The project consists of several Docker services. Two approaches are available:

### Option A: DDL-qBittorrent (Recommended)

| Service | Default Port | Description |
|---------|--------------|-------------|
| **ddl-torznab** | 9117 | Torznab indexer that scrapes DDL sites |
| **dlprotect-resolver** | 5000 | Botasaurus service to resolve dl-protect links |
| **ddl-qbittorrent** | 8080 | Simulates a qBittorrent client for Sonarr/Radarr |

This approach simulates a real qBittorrent client. Sonarr/Radarr communicate directly with ddl-qbittorrent as if it were a real torrent client.

**Supports real torrents!** In addition to fake DDL torrents, ddl-qbittorrent can receive real .torrent files and automatically send them to debrid services (AllDebrid, RealDebrid, Premiumize) for download.

### Option B: Blackhole + External Client

| Service | Default Port | Description |
|---------|--------------|-------------|
| **ddl-torznab** | 9117 | Torznab indexer that scrapes DDL sites |
| **dlprotect-resolver** | 5000 | Botasaurus service to resolve dl-protect links |
| **ddl-downloader** | 9118 | Monitors a blackhole folder and sends links to download clients |

This approach uses a blackhole folder and an external download client (JDownloader, aria2, Download Station).

> Ports are configurable via environment variables

## Supported Sites

| Site | ENV Variable | Telegram | Description |
|------|--------------|----------|-------------|
| WawaCity | `WAWACITY_URL` | [@Wawacityofficiel](https://t.me/s/Wawacityofficiel) | HTML Scraping |
| Zone-Téléchargement | `ZONETELECHARGER_URL` | [@ztofficiel](https://t.me/s/ztofficiel) | HTML Scraping |

> **Auto-detection of URLs**: If `WAWACITY_URL` or `ZONETELECHARGER_URL` variables are empty, URLs are automatically fetched from official Telegram channels.

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-repo/ddl_torznab.git
cd ddl_torznab
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit the `.env` file:

```bash
# Site URLs (optional - auto-detection from Telegram if empty)
# Leave empty to use auto-detection, or force a specific URL
WAWACITY_URL=
ZONETELECHARGER_URL=

# Blackhole folder path (required for downloader)
BLACKHOLE_PATH=/path/to/blackhole

# AllDebrid API key (optional but recommended)
ALLDEBRID_API_KEY=your_api_key
```

> **Note**: Site URLs change regularly. Auto-detection from Telegram ensures you always have up-to-date URLs without modifying the configuration.

### 3. Start the services

Choose one of the two options:

**Option A - DDL-qBittorrent (Recommended):**
```bash
docker compose --profile qbittorrent up -d
```

**Option B - Blackhole + External Client:**
```bash
docker compose --profile blackhole up -d
```

> **Note**: `docker compose up -d` (without profile) only starts the base services (indexer + resolver). You must specify a profile to have a complete download system.

### 4. Stop the services

To stop all services (including all profiles):

```bash
docker compose --profile qbittorrent --profile blackhole down
```

## Configuration with DDL-qBittorrent (Option A - Recommended)

### Start the services

```bash
docker compose --profile qbittorrent up -d
```

> This command only starts: `ddl-torznab`, `dlprotect-resolver`, and `ddl-qbittorrent`

### Radarr/Sonarr Configuration

#### Step 1: Add the Torznab indexer

1. Go to **Settings > Indexers > Add**
2. Choose **Torznab**
3. Configure:
   - **Name**: DDL Wawacity (or other)
   - **URL**: `http://<IP>:9117`
   - **API Path**: `/api/wawacity` or `/api/zonetelecharger` or `/api/darkiworld_premium`
   - **API Key**: `ddl-torznab` (any value)
   - **Categories**: 2000, 2040, 2045 (Radarr) or 5000, 5040, 5045 (Sonarr)
4. Click **Test** then **Save**

> **Filter by hoster**: Add the hoster in the API Path, e.g.: `/api/wawacity/1fichier` or `/api/wawacity/1fichier,uptobox`

#### Step 2: Configure DDL-qBittorrent as Download Client

1. Go to **Settings > Download Clients > Add**
2. Choose **qBittorrent**
3. Configure:
   - **Name**: DDL-qBittorrent
   - **Host**: `<IP>` (IP of the ddl-qbittorrent server)
   - **Port**: `8080` (or your `QBITTORRENT_PORT` value)
   - **Username**: `admin` (or your `QB_USERNAME` value)
   - **Password**: `adminadmin` (or your `QB_PASSWORD` value)
   - **Category**: `radarr` or `sonarr` (optional)
   - **Minimum Seeders**: `1`
   - **Seed Ratio**: `1`
   - **Seed Time**: `1`
4. Click **Test** then **Save**

> **Note on seeding criteria**: DDL-qBittorrent returns ratio and seeding time values higher than the configured minimums, which allows Radarr/Sonarr to automatically remove completed downloads.

> **Remote Path Mappings**: If Sonarr/Radarr and ddl-qbittorrent do not share the same filesystem, configure "Remote Path Mappings" in Settings > Download Clients. For example, if ddl-qbittorrent downloads to `/downloads` but Sonarr sees this folder as `/mnt/downloads`, add a mapping: Host=`<ddl-qbittorrent IP>`, Remote Path=`/downloads`, Local Path=`/mnt/downloads`.

> **Web Interface**: Accessible at `http://<IP>:<QBITTORRENT_PORT>/` to view download status (port 8080 by default)

### DDL-qBittorrent Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QBITTORRENT_PORT` | Service port | 8080 |
| `QB_USERNAME` | Username | admin |
| `QB_PASSWORD` | Password | adminadmin |
| `DOWNLOAD_PATH` | Download destination folder | /downloads |
| `TEMP_PATH` | Temporary folder for ongoing downloads | /downloads-temp |
| `MAX_CONCURRENT_DOWNLOADS` | Number of simultaneous downloads | 3 |
| `AUTO_EXTRACT_ARCHIVE` | Automatically extract archives (zip, rar, 7z) | 1 (enabled) |
| `AUTO_REMOVE_COMPLETED_AFTER` | Remove completed downloads after X minutes (0 = disabled) | 0 |
| `ALLDEBRID_ENABLED` | Enable AllDebrid | false |
| `ALLDEBRID_API_KEY` | AllDebrid API key | - |
| `REALDEBRID_ENABLED` | Enable RealDebrid | false |
| `REALDEBRID_API_KEY` | RealDebrid API key | - |
| `PREMIUMIZE_ENABLED` | Enable Premiumize | false |
| `PREMIUMIZE_API_KEY` | Premiumize API key | - |
| `DEBRID_TORRENT_TIMEOUT` | Timeout for real torrent debrid (hours) | 24 |

### Real Torrent Support

DDL-qBittorrent automatically detects the type of torrent received:
- **Fake DDL torrent** (created by ddl-torznab): The DDL link is extracted and debridged normally
- **Real torrent**: The .torrent file is sent to the debrid service which downloads it

#### How it works

1. Sonarr/Radarr sends a .torrent file to ddl-qbittorrent
2. DDL-qBittorrent analyzes the torrent:
   - If `created by: DDL-Torznab` → classic DDL processing
   - Otherwise → send to debrid service
3. For real torrents:
   - Upload the .torrent to AllDebrid/RealDebrid/Premiumize
   - Wait for the debrid to download the torrent (may take time if not cached)
   - Download files from the debrid

#### Status messages

- `Uploading torrent to debrid...` - Sending torrent to the service
- `Queued on AllDebrid...` - Waiting in debrid queue
- `Downloading on debrid: 45%` - Debrid is downloading the torrent
- `Downloading from debrid...` - Downloading files from debrid

> **Note**: Uncached real torrents can take time (debrid must download from seeders). Default timeout is 24 hours.

### Download Flow (Option A)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Radarr/     │────>│ ddl-torznab  │────>│ DDL Site        │
│ Sonarr      │     │ (search)     │     │ (wawacity, etc) │
└─────────────┘     └──────────────┘     └─────────────────┘
       │
       │ sends .torrent via qBittorrent API
       ▼
┌─────────────────┐     ┌───────────────────┐
│ ddl-qbittorrent │────>│ dlprotect-resolver│
│ (downloads)     │     │ (if protected link)│
└─────────────────┘     └───────────────────┘
       │
       │ downloads via debrid (AllDebrid/RealDebrid)
       ▼
┌─────────────────┐
│ Downloads       │ ← Radarr/Sonarr imports automatically
│ folder          │
└─────────────────┘
```

---

## Configuration with Blackhole (Option B)

### Start the services

```bash
docker compose --profile blackhole up -d
```

> This command only starts: `ddl-torznab`, `dlprotect-resolver`, and `ddl-downloader`

### Radarr Configuration

#### Step 1: Add the Torznab indexer

1. Go to **Settings > Indexers > Add**
2. Choose **Torznab**
3. Configure:
   - **Name**: DDL Wawacity (or other)
   - **URL**: `http://<IP>:9117`
   - **API Path**: `/api/wawacity` or `/api/zonetelecharger` or `/api/darkiworld_premium`
   - **API Key**: `ddl-torznab` (any value)
   - **Categories**: 2000, 2040, 2045
4. Click **Test** then **Save**

> Replace `<IP>` with the server address (e.g.: `192.168.1.100`, `localhost`, or your domain)
> **Filter by hoster**: Add the hoster in the API Path, e.g.: `/api/wawacity/1fichier`

### Step 2: Configure the Blackhole Download Client

1. Go to **Settings > Download Clients > Add**
2. Choose **Torrent Blackhole**
3. Configure:
   - **Name**: DDL Blackhole
   - **Torrent Folder**: `/path/to/blackhole` (same as `BLACKHOLE_PATH`)
   - **Watch Folder**: `/path/to/downloads` (where your files will be downloaded by JDownloader/aria2)
   - **Save Magnet Files**: No (disabled)
4. Click **Test** then **Save**

## Sonarr Configuration

### Step 1: Add the Torznab indexer

1. Go to **Settings > Indexers > Add**
2. Choose **Torznab**
3. Configure:
   - **Name**: DDL Wawacity (or other)
   - **URL**: `http://<IP>:9117`
   - **API Path**: `/api/wawacity` or `/api/zonetelecharger` or `/api/darkiworld_premium`
   - **API Key**: `ddl-torznab` (any value)
   - **Categories**: 5000, 5040, 5045
   - **Anime Categories**: 5070 (optional)
4. Click **Test** then **Save**

> Replace `<IP>` with the server address (e.g.: `192.168.1.100`, `localhost`, or your domain)
> **Filter by hoster**: Add the hoster in the API Path, e.g.: `/api/wawacity/1fichier`

### Step 2: Configure the Blackhole Download Client

1. Go to **Settings > Download Clients > Add**
2. Choose **Torrent Blackhole**
3. Configure:
   - **Name**: DDL Blackhole
   - **Torrent Folder**: `/path/to/blackhole` (same as `BLACKHOLE_PATH`)
   - **Watch Folder**: `/path/to/downloads` (where your files will be downloaded by JDownloader/aria2)
   - **Save Magnet Files**: No (disabled)
4. Click **Test** then **Save**

## Available Torznab URLs

| Site | URL | API Path |
|------|-----|----------|
| Wawacity | `http://<IP>:9117` | `/api/wawacity` |
| ZoneTelecharger | `http://<IP>:9117` | `/api/zonetelecharger` |
| Darkiworld Premium | `http://<IP>:9117` | `/api/darkiworld_premium` |

> Replace `<IP>` with the server address (e.g.: `192.168.1.100`, `localhost`, or your domain)

### Prowlarr Integration

For simplified integration with Prowlarr, a custom Cardigann definition is available.
See [prowlarr/README.md](prowlarr/README.md) for installation instructions.

### Filtering by Hoster

You can filter results to display only links from one or more specific hosters. This allows you to keep only hosters supported by your debrid service.

**Via the URL path:**
```
http://<IP>:9117/api/wawacity/1fichier/
http://<IP>:9117/api/wawacity/1fichier,rapidgator/
http://<IP>:9117/api/zonetelecharger/turbobit/
```

**Via the query parameter:**
```
http://<IP>:9117/api/wawacity/?hoster=1fichier
http://<IP>:9117/api/wawacity/?hoster=1fichier,rapidgator
```

**Common hosters:**
- `1fichier`
- `turbobit`
- `rapidgator`
- `uptobox`
- `nitroflare`

> **Tip**: In Radarr/Sonarr, create multiple indexers with different hosters to prioritize certain services. For example, one indexer `DDL Wawacity - 1fichier` and another `DDL Wawacity - turbobit`.

### Complete Flow Operation

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Radarr/     │────>│ ddl-torznab  │────>│ DDL Site        │
│ Sonarr      │     │ (search)     │     │ (wawacity, etc) │
└─────────────┘     └──────────────┘     └─────────────────┘
       │
       │ downloads .torrent
       ▼
┌─────────────┐     ┌───────────────┐     ┌─────────────────┐
│ Blackhole   │────>│ ddl-downloader│────>│ JDownloader/    │
│ folder      │     │ (removes the  │     │ aria2/DS        │
└─────────────┘     │  .torrent)    │     └─────────────────┘
                    └───────────────┘             │
                                                  │ downloads
                                                  ▼
                                         ┌─────────────────┐
                                         │ Downloads       │
                                         │ folder          │
                                         └─────────────────┘
```

1. **Radarr/Sonarr** searches for a movie/series via the Torznab indexer
2. The indexer returns results with `.torrent` links (containing DDL links)
3. Radarr/Sonarr downloads the `.torrent` to the **blackhole folder**
4. The **ddl-downloader** service detects the new file
5. It extracts the DDL link and sends it to the configured **download client**
6. The `.torrent` file is **deleted** (or moved to `processed/` if `DEBUG=true`)
7. The client downloads the file to the **downloads folder** monitored by Radarr/Sonarr

## Download Client Configuration

### JDownloader

Access http://localhost:9118 to configure.

**Via Local API (recommended if on same network):**
- **API Mode**: Local API only
- **Host**: JDownloader machine IP (e.g.: 192.168.1.100)
- **Port**: 3128 (default)

**Via MyJDownloader (remote access):**
- **API Mode**: MyJDownloader only
- **Email**: your MyJDownloader email
- **Password**: your password
- **Device Name**: exact name of your JDownloader device

### aria2

- **Host**: localhost (or aria2 server IP)
- **Port**: 6800
- **Secret**: your RPC token (optional)
- **Download Directory**: download path

### Synology Download Station

- **Host**: NAS IP
- **Port**: 5000 (or 5001 for HTTPS)
- **Username/Password**: DSM credentials
- **Use SSL**: check if port 5001

## AllDebrid

AllDebrid allows you to debrid links from premium hosters (1fichier, Uptobox, etc.) for faster downloads.

1. Create an account on [AllDebrid](https://alldebrid.com/)
2. Generate an API key: https://alldebrid.com/apikeys/
3. Add the key in `.env`: `ALLDEBRID_API_KEY=your_key`
4. Or via the downloader web interface (http://localhost:9118)

## Environment Variables

See `.env.example` for the complete list.

| Variable | Description | Default |
|----------|-------------|---------|
| `INDEXER_PORT` | Torznab indexer port | 9117 |
| `DOWNLOADER_PORT` | Downloader port | 9118 |
| `DLPROTECT_RESOLVER_PORT` | dl-protect resolver port | 5000 |
| `WAWACITY_URL` | WawaCity URL (auto-detection if empty) | auto |
| `ZONETELECHARGER_URL` | Zone-Téléchargement URL (auto-detection if empty) | auto |
| `WAWACITY_TELEGRAM` | WawaCity Telegram channel for auto-detection | https://t.me/s/Wawacityofficiel |
| `ZONETELECHARGER_TELEGRAM` | ZT Telegram channel for auto-detection | https://t.me/s/ztofficiel |
| `BLACKHOLE_PATH` | Blackhole folder | - |
| `ALLDEBRID_API_KEY` | AllDebrid API key | - |
| `DLPROTECT_RESOLVE_AT` | Where to resolve dl-protect links (see below) | indexer |
| `SEARCH_MAX_PAGES` | Max pages to crawl per search | 5 |
| `DISABLE_REMOTE_DL_PROTECT_CACHE` | Disable remote cache for dl-protect | false |
| `DEBUG` | Debug mode (see below) | false |
| `DS_ENABLED` | Enable Download Station | false |
| `JD_ENABLED` | Enable JDownloader | false |
| `ARIA2_ENABLED` | Enable aria2 | false |

> Site URLs are auto-detected from Telegram at startup if not configured. You can force a URL by defining it explicitly.

### Resolving dl-protect Links

The `DLPROTECT_RESOLVE_AT` variable controls when dl-protect links are resolved:

| Value | Description |
|-------|-------------|
| `indexer` | Links are resolved during search. Faster navigation in Radarr/Sonarr as links are already ready. |
| `downloader` | Links are resolved only at download time. Less load on the resolution service. |

```bash
# In .env
DLPROTECT_RESOLVE_AT=downloader
```

### Debug Mode

By default (`DEBUG=false`), `.torrent` files are **deleted** after processing.

In debug mode (`DEBUG=true`), files are **moved** to the `processed/` folder for inspection.

```bash
# In .env
DEBUG=true
```

### Smart Search via IMDB

When Radarr/Sonarr provides an IMDB ID, the indexer uses the IMDB API (https://imdbapi.dev) to retrieve:
- The **original title** of the movie/series
- The **French title**

These titles are used in addition to the original query for a more complete search, especially for French movies with accents.

**Example:**
```
Radarr sends: imdbid=0082183
→ IMDB API returns: originalTitle="La chèvre", frenchTitle="La Chèvre"
→ Searches performed: ["la chèvre"]
```

### Remote dl-protect Cache

The dl-protect resolution service uses a remote cache shared between users. This avoids resolving the same link multiple times.

To disable the remote cache (for example if the server is inaccessible):

```bash
# In .env
DISABLE_REMOTE_DL_PROTECT_CACHE=true
```

> The local cache remains active even if the remote cache is disabled.

## Torznab Categories

| Category | Code | Description |
|----------|------|-------------|
| Movies | 2000 | Movies |
| Movies/HD | 2040 | HD Movies (720p, 1080p) |
| Movies/UHD | 2045 | 4K Movies |
| TV | 5000 | TV Series |
| TV/HD | 5040 | HD TV Series |
| TV/UHD | 5045 | 4K TV Series |
| Anime | 5070 | Anime |

## Project Structure

```
ddl_torznab/
├── docker-compose.yml          # Docker configuration
├── .env.example                # Environment variables template
├── .env                        # Environment variables (to create)
├── indexer/                    # Torznab Service (port 9117)
│   └── src/
│       ├── scrapers/           # Scrapers for each site
│       ├── routes/             # Torznab API
│       └── utils/              # Utilities (XML, HTTP, dl-protect)
├── downloader/                 # Blackhole Downloader Service (port 9118)
│   └── src/
│       ├── clients/            # Download clients (JD, aria2, DS)
│       ├── routes/             # Configuration API
│       └── watcher.ts          # Blackhole monitoring
└── botasaurus-service/         # dl-protect resolution service (port 5000)
    └── main.py
```

## Troubleshooting

### Searches return nothing

- Verify that site URLs are correct and accessible
- Check the logs: `docker-compose logs ddl-torznab`

### Links are not resolved

- Verify that the dlprotect-resolver service is running: `docker-compose logs dlprotect-resolver`
- First startup may take time (Chromium download)

### Downloader does not detect files

- Check blackhole folder permissions
- Verify that the path is correct in docker-compose.yml
- Check the logs: `docker-compose logs ddl-downloader`

### JDownloader does not receive links

- Verify that local API is enabled in JDownloader (Settings > Advanced > API)
- Or verify your MyJDownloader credentials
- Test the connection via the downloader web interface

## Development

```bash
# Indexer
cd indexer
npm install
npm run dev

# Downloader
cd downloader
npm install
npm run dev
```

## License

MIT
