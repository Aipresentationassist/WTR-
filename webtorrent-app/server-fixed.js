import express from 'express';
import WebTorrent from 'webtorrent';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Initialize WebTorrent client
const client = new WebTorrent({
    maxConns: 100,
    dht: true,
    webSeeds: true,
    utp: true,
    ipv6: true,
    debug: true
});

// Track active torrents and clients
const activeTorrents = new Map();
const clients = new Set();

// Log WebTorrent client events
client.on('error', (err) => console.error('WebTorrent error:', err));
client.on('warning', (err) => console.warn('WebTorrent warning:', err));
client.on('listening', () => console.log('WebTorrent listening on port', client.torrentPort));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    setupWebSocketServer(server);
});

// WebSocket server setup
function setupWebSocketServer(server) {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        const clientId = `client-${Date.now()}`;
        clients.add(ws);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                handleClientMessage(ws, data);
            } catch (err) {
                console.error('Error parsing message:', err);
            }
        });

        ws.on('close', () => clients.delete(ws));
    });
}

// Handle client messages
function handleClientMessage(ws, data) {
    if (!data.type) return;

    switch (data.type) {
        case 'start-torrent':
            if (data.magnet) startTorrent(data.magnet, ws);
            break;
        case 'stop-torrent':
            if (data.infoHash) stopTorrent(data.infoHash);
            break;
        case 'get-files':
            sendFileList(ws);
            break;
    }
}

// Torrent management
function startTorrent(magnet, ws) {
    const downloadPath = path.join(__dirname, 'downloads');
    if (!fsSync.existsSync(downloadPath)) {
        fsSync.mkdirSync(downloadPath, { recursive: true });
    }

    client.add(magnet, { path: downloadPath }, (torrent) => {
        const torrentData = { torrent, ws, progress: 0 };
        activeTorrents.set(torrent.infoHash, torrentData);

        torrent.on('download', () => sendTorrentUpdate(torrentData));
        torrent.on('done', () => sendTorrentUpdate(torrentData, 'completed'));
        
        // Send initial update
        sendTorrentUpdate(torrentData);
    });
}

function stopTorrent(infoHash) {
    const torrentData = activeTorrents.get(infoHash);
    if (!torrentData) return;

    torrentData.torrent.destroy(() => {
        activeTorrents.delete(infoHash);
    });
}

function sendTorrentUpdate(torrentData, status = 'downloading') {
    const { torrent, ws } = torrentData;
    
    const data = {
        type: 'torrentUpdate',
        infoHash: torrent.infoHash,
        name: torrent.name,
        progress: torrent.progress,
        downloadSpeed: torrent.downloadSpeed,
        numPeers: torrent.numPeers,
        status
    };

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function sendFileList(ws) {
    const files = [];
    const downloadPath = path.join(__dirname, 'downloads');
    
    if (fsSync.existsSync(downloadPath)) {
        const fileList = fsSync.readdirSync(downloadPath);
        
        fileList.forEach(file => {
            const filePath = path.join(downloadPath, file);
            const stats = fsSync.statSync(filePath);
            
            files.push({
                name: file,
                size: stats.size,
                path: filePath
            });
        });
    }
    
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'fileList',
            files
        }));
    }
}

// Clean up on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    client.destroy(() => process.exit());
});
