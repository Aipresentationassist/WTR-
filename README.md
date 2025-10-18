# WebTorrent Web Application

A robust WebTorrent WebApp for downloading and streaming torrents directly in your browser.

## Features

- Download torrents directly in the browser
- Stream video and audio files while downloading
- Simple and intuitive user interface
- Built with Node.js, Express, and WebTorrent

## Prerequisites

- Node.js 14.0.0 or higher
- npm (comes with Node.js)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/your-repo-name.git
   cd your-repo-name
   ```

2. Install dependencies:
   ```bash
   cd webtorrent-app
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

3. Enter a magnet link or .torrent file to start downloading/streaming

## Google Colab Setup

To run this in Google Colab:

1. Upload the project files to your Google Drive
2. Open a new Colab notebook
3. Run the following commands in a cell:
   ```python
   !git clone https://github.com/your-username/your-repo-name.git
   %cd your-repo-name/webtorrent-app
   !npm install
   !npm start
   ```
4. Use ngrok to expose the local server:
   ```python
   !wget https://bin.equinox.io/c/4VmDzA7iaHb/ngrok-stable-linux-amd64.zip
   !unzip ngrok-stable-linux-amd64.zip
   !./ngrok http 3000
   ```
5. Use the ngrok URL to access the app

## Project Structure

- `/webtorrent-app` - Main application code
  - `server.js` - Express server setup
  - `public/` - Frontend files (HTML, CSS, JS)
  - `package.json` - Project dependencies and scripts

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
