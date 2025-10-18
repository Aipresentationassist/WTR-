# WebTorrent Streaming Guide

## Real-Time Streaming Features

This WebTorrent application supports **real-time streaming while downloading**! You can start watching videos immediately, even before the download completes.

---

## 🎬 Streaming in Browser

Simply add a torrent and the UI will show available video files. Click the "Stream" button to watch directly in your browser.

---

## 🎯 External Player Support (VLC, MPV, etc.)

### Method 1: Using the API to Get Streaming URLs

#### Get all streaming URLs for a torrent:
```bash
GET http://localhost:3000/api/torrents/{torrentId}/streaming-urls
```

**Response:**
```json
{
  "torrentId": "abc123",
  "name": "My Video",
  "infoHash": "...",
  "files": [
    {
      "index": 0,
      "name": "video.mp4",
      "size": 1234567890,
      "isVideo": true,
      "streamUrl": "http://localhost:3000/stream/abc123/0",
      "downloadUrl": "http://localhost:3000/api/download/abc123/0",
      "vlcUrl": "http://localhost:3000/stream/abc123/0"
    }
  ],
  "status": { ... }
}
```

#### Get streaming URL for a specific file:
```bash
GET http://localhost:3000/api/torrents/{torrentId}/files/{fileIndex}/stream-url
```

**Response:**
```json
{
  "streamUrl": "http://localhost:3000/stream/abc123/0",
  "fileName": "video.mp4",
  "fileSize": 1234567890,
  "torrentName": "My Video",
  "instructions": {
    "vlc": "Copy the URL and open VLC -> Media -> Open Network Stream -> Paste URL",
    "mpv": "mpv \"http://localhost:3000/stream/abc123/0\"",
    "curl": "curl -o \"video.mp4\" \"http://localhost:3000/stream/abc123/0\""
  }
}
```

---

## 📺 How to Stream in Different Players

### VLC Media Player
1. Open VLC
2. Click **Media** → **Open Network Stream** (or press `Ctrl+N`)
3. Paste the streaming URL: `http://localhost:3000/stream/{torrentId}/{fileIndex}`
4. Click **Play**

**Command Line:**
```bash
vlc http://localhost:3000/stream/abc123/0
```

---

### MPV Player
```bash
mpv http://localhost:3000/stream/abc123/0
```

---

### MPC-HC / MPC-BE
1. Open MPC
2. Click **File** → **Open File** (or press `Ctrl+O`)
3. Paste the streaming URL
4. Click **OK**

---

### Browser (Chrome, Firefox, Edge)
Simply open the URL in your browser:
```
http://localhost:3000/stream/abc123/0
```

The browser's built-in video player will load automatically.

---

## 🔗 API Endpoints

### 1. **Get All Torrents**
```
GET /api/torrents
```
Returns list of all active torrents with their status.

### 2. **Get Streaming URLs for Torrent**
```
GET /api/torrents/:torrentId/streaming-urls
```
Returns all files in a torrent with their streaming URLs.

### 3. **Get Individual File Stream URL**
```
GET /api/torrents/:torrentId/files/:fileIndex/stream-url
```
Returns streaming URL and instructions for a specific file.

### 4. **Stream Video (Range Request Supported)**
```
GET /stream/:torrentId/:fileIndex
```
Direct streaming endpoint with HTTP range request support for seeking.

### 5. **Download File**
```
GET /api/download/:torrentId/:fileIndex
```
Download a specific file from the torrent.

---

## ⚡ Features

- ✅ **Real-time streaming** - Start watching while downloading
- ✅ **HTTP Range Request Support** - Seek to any position in the video
- ✅ **Multiple format support** - MP4, MKV, AVI, MOV, WebM, and more
- ✅ **CORS enabled** - Stream from any origin
- ✅ **External player compatible** - VLC, MPV, MPC, browsers
- ✅ **Proper MIME types** - Automatic content-type detection
- ✅ **WebSocket updates** - Real-time progress and file information

---

## 🚀 Quick Start Example

1. **Start the server:**
```bash
npm start
```

2. **Add a torrent via WebSocket or API**

3. **Get the torrent ID** from the response

4. **Get streaming URLs:**
```bash
curl http://localhost:3000/api/torrents/{torrentId}/streaming-urls
```

5. **Copy the `streamUrl` and paste it into VLC or your browser!**

---

## 🌐 Remote Access (VPS/Cloud)

If you're running this on a VPS or cloud server, replace `localhost` with your server's IP or domain:

```
http://your-server-ip:3000/stream/{torrentId}/{fileIndex}
```

**Example:**
```
http://192.168.1.100:3000/stream/abc123/0
```

Or with a domain:
```
http://torrents.yourdomain.com/stream/abc123/0
```

---

## 📝 Notes

- **File Index**: Files are indexed starting from 0. The first file is index 0, second is 1, etc.
- **Video Detection**: The system automatically detects video files by extension
- **Streaming Quality**: Depends on your torrent's download speed and peer availability
- **Buffer**: External players like VLC will buffer automatically for smooth playback

---

## 🛠️ Troubleshooting

### "Torrent not found" error
- Make sure the torrent is still active
- Check that you're using the correct torrent ID

### Buffering issues
- Wait for more pieces to download
- Check your internet connection and peer count

### VLC won't play
- Make sure you're using the correct URL format
- Try updating VLC to the latest version
- Check that the server is accessible from your network

---

## 🎉 Happy Streaming!

Enjoy watching your torrents in real-time with any player you prefer!
