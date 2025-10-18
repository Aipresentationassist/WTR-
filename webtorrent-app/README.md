# WebTorrent WebApp

A robust web application for downloading and streaming torrents directly in your browser. This application allows you to:

- Download torrents using magnet links
- Stream video and audio files while downloading
- View download progress and statistics
- Manage downloaded files
- View detailed logs and terminal output

## Features

- **Real-time Updates**: See download progress, speeds, and peer information in real-time
- **Streaming Support**: Play media files while they're still downloading
- **Responsive Design**: Works on desktop and mobile devices
- **Persistent Downloads**: Downloads continue in the background even if you close the browser tab
- **Detailed Logging**: View both formatted logs and raw terminal output

## Prerequisites

- Node.js 14.0.0 or higher
- npm (comes with Node.js)
- A modern web browser (Chrome, Firefox, Edge, or Safari)

## Installation

1. Clone this repository or download the source code
2. Install the dependencies:

```bash
npm install
```

## Usage

1. Start the server:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

2. Open your browser and navigate to `http://localhost:3000`
3. Paste a magnet link in the input field and click "Start Download"

## Project Structure

```
webtorrent-app/
├── public/               # Frontend static files
│   ├── index.html        # Main HTML file
│   ├── styles.css        # CSS styles
│   └── app.js            # Frontend JavaScript
├── downloads/            # Directory for downloaded files
├── logs/                 # Log files (if enabled)
├── server.js             # Backend server
└── package.json          # Project configuration
```

## Configuration

You can configure the application by setting the following environment variables:

- `PORT`: The port to run the server on (default: 3000)
- `DOWNLOAD_DIR`: Directory to store downloaded files (default: ./downloads)
- `LOG_LEVEL`: Logging level (default: info)

Example:

```bash
PORT=4000 DOWNLOAD_DIR=/path/to/downloads npm start
```

## API Endpoints

- `GET /` - Serve the web interface
- `GET /api/files` - List all downloaded files
- `GET /downloads/:filename` - Download a file
- `WS /` - WebSocket connection for real-time updates

## Browser Support

This application uses modern JavaScript features and WebSockets. It works best in the latest versions of:

- Google Chrome
- Mozilla Firefox
- Microsoft Edge
- Apple Safari

## License

MIT

## Acknowledgments

- [WebTorrent](https://webtorrent.io/) - The streaming torrent client for the web
- [Express](https://expressjs.com/) - Fast, unopinionated, minimalist web framework for Node.js
- [Font Awesome](https://fontawesome.com/) - Icon library and toolkit
