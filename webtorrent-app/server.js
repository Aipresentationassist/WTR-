import { WebSocket, WebSocketServer } from 'ws';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import cors from 'cors';
import TorrentManager from './torrentManager.js';

// Initialize Express and HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

// Get the current directory path in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
    DOWNLOADS_DIR: path.join(process.cwd(), 'downloads'),
    TEMP_DIR: path.join(process.cwd(), 'temp'),
    PORT: process.env.PORT || 3000
};

// Initialize torrent manager
const torrentManager = new TorrentManager();

// Ensure directories exist
[CONFIG.DOWNLOADS_DIR, CONFIG.TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/downloads', express.static(CONFIG.DOWNLOADS_DIR));

// Setup torrent manager callback
torrentManager.onUpdate = (torrentId, processInfo) => {
    broadcastToClients({
        type: 'torrent-update',
        torrentId,
        data: processInfo
    });
};

// Set up periodic updates to ensure clients stay in sync
const UPDATE_INTERVAL = 3000; // 3 seconds - prevents UI flickering
let updateIntervalId = null;

function startPeriodicUpdates() {
    if (updateIntervalId) {
        clearInterval(updateIntervalId);
    }
    
    updateIntervalId = setInterval(() => {
        try {
            // Only proceed if we have clients connected
            if (clients.size > 0) {
                const torrents = torrentManager.getAllTorrents();
                console.log(`[SERVER] Periodic update: ${torrents.length} torrents for ${clients.size} clients`);
                
                if (torrents.length > 0) {
                    // Send updates for all active torrents
                    torrents.forEach(torrent => {
                        if (torrent && torrent.torrentId) {
                            broadcastToClients({
                                type: 'torrent-update',
                                torrentId: torrent.torrentId,
                                data: torrent
                            });
                        }
                    });
                }
            }
        } catch (error) {
            console.error(`[SERVER] Error in periodic update: ${error.message}`);
        }
    }, UPDATE_INTERVAL);
    
    console.log(`[SERVER] Started periodic updates every ${UPDATE_INTERVAL/1000} seconds`);
}

// Start periodic updates
startPeriodicUpdates();

// Function to broadcast messages to all connected clients
function broadcastToClients(message) {
    const messageStr = JSON.stringify(message);
    let clientCount = 0;
    
    clients.forEach(client => {
        try {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
                clientCount++;
            }
        } catch (error) {
            console.error(`[WS] Error broadcasting to client: ${error.message}`);
        }
    });
    
    if (clientCount > 0 && message.type === 'torrent-update') {
        console.log(`[WS] Broadcast ${message.type} for ${message.torrentId} to ${clientCount} clients`);
    }
}

// WebSocket handling
wss.on('connection', (ws) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    console.log(`[WS] New connection: ${clientId}`);
    
    // Add client to the set
    clients.add(ws);
    ws.clientId = clientId;
    ws.isAlive = true;

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connection',
        clientId,
        message: 'Connected to WebTorrent server',
        timestamp: new Date().toISOString()
    }));

    // Send current torrents to new client
    const torrents = torrentManager.getAllTorrents();
    console.log(`[WS] Sending ${torrents.length} active torrents to client`);
    
    // Log file counts for debugging
    torrents.forEach(torrent => {
        const fileCount = torrent.files ? torrent.files.length : 0;
        console.log(`[WS] Torrent ${torrent.torrentId}: ${torrent.fileName || 'Unknown'} with ${fileCount} files`);
    });
    
    ws.send(JSON.stringify({
        type: 'initial-torrents',
        data: torrents,
        timestamp: new Date().toISOString()
    }));

    // Handle incoming messages
    ws.on('message', async (message) => {
        try {
            const messageStr = message.toString();
            console.log(`[WS ${clientId}] Received message:`, messageStr.substring(0, 200));
            
            let data;
            try {
                data = JSON.parse(messageStr);
            } catch (parseError) {
                throw new Error(`Invalid JSON: ${parseError.message}`);
            }
            
            if (!data.type) {
                throw new Error('Message type is required');
            }
            
            await handleWebSocketMessage(ws, data, clientId);
        } catch (error) {
            console.error(`[WS ${clientId}] Error processing message:`, error);
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: error.message || 'Error processing message',
                    timestamp: new Date().toISOString()
                }));
            } catch (sendError) {
                console.error(`[WS ${clientId}] Failed to send error response:`, sendError);
            }
        }
    });

    // Handle pings
    const pingInterval = setInterval(() => {
        if (ws.isAlive === false) {
            console.log(`[WS] Terminating dead connection: ${clientId}`);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping(() => {});
    }, 30000);

    // Handle pongs
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${clientId}`);
        clearInterval(pingInterval);
        clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`[WS ${clientId}] Error:`, error);
        clearInterval(pingInterval);
        clients.delete(ws);
    });
});

// Helper to decode HTML entities in magnet links
function decodeHtmlEntities(text) {
    if (!text) return '';
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, '/');
}

async function handleWebSocketMessage(ws, data, clientId) {
    console.log(`[WS ${clientId}] Processing message type: ${data.type}`);
    
    try {
        // Handle different message types
        switch (data.type) {
            case 'get-torrents':
                await handleGetTorrents(ws, clientId);
                break;
                
            case 'start-torrent':
                await handleStartTorrent(ws, data, clientId);
                break;
                
            case 'stop-torrent':
                await handleStopTorrent(ws, data, clientId);
                break;
                
            case 'delete-torrent':
            case 'remove-torrent':
                await handleDeleteTorrent(ws, data, clientId);
                break;
                
            case 'get-files':
                await handleGetFiles(ws, data, clientId);
                break;
                
            case 'ping':
                handlePing(ws);
                break;
                
            default:
                handleUnknownMessage(ws, data, clientId);
        }
    } catch (error) {
        console.error(`[WS ${clientId}] Error handling message:`, error);
        try {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Internal server error',
                error: error.message
            }));
        } catch (sendError) {
            console.error(`[WS ${clientId}] Failed to send error response:`, sendError);
        }
    }
}

// Handle get-torrents message
async function handleGetTorrents(ws, clientId) {
    console.log(`[WS ${clientId}] Handling get-torrents request`);
    try {
        const torrents = torrentManager.getAllTorrents();
        console.log(`[WS ${clientId}] Sending ${torrents.length} torrents`);
        
        ws.send(JSON.stringify({
            type: 'initial-torrents',
            data: torrents,
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        console.error(`[WS ${clientId}] Error getting torrents:`, error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to get torrents',
            error: error.message
        }));
    }
}

// Handle start-torrent message
async function handleStartTorrent(ws, data, clientId) {
    console.log(`[WS ${clientId}] Starting torrent`);
    try {
        const { magnet, fresh = false } = data;
        
        if (!magnet) {
            throw new Error('Magnet link is required');
        }
        
        // Clean and validate magnet link
        const cleanMagnet = decodeHtmlEntities(magnet.trim());
                const magnetRegex = /^magnet:\?xt=urn:btih:[a-fA-F0-9]{40}/i;
        if (!magnetRegex.test(cleanMagnet)) {
            throw new Error('Invalid or malformed magnet link. It must be a valid info-hash magnet link.');
        }
        
        const downloadPath = fresh ? 
            path.join(CONFIG.TEMP_DIR, `session-${Date.now()}`) :
            CONFIG.DOWNLOADS_DIR;

        console.log(`[WS ${clientId}] Downloading to: ${downloadPath}`);
        
        const result = await torrentManager.startTorrent(cleanMagnet, downloadPath, fresh);
        console.log(`[WS ${clientId}] Torrent started:`, result);
        
        ws.send(JSON.stringify({
            type: 'torrent-started',
            data: result,
            timestamp: new Date().toISOString()
        }));
        
        // Broadcast to all clients
        broadcastToClients({
            type: 'torrent-update',
            torrentId: result.torrentId,
            data: torrentManager.activeTorrents.get(result.torrentId)?.status || {}
        });
        
    } catch (error) {
        console.error(`[WS ${clientId}] Error starting torrent:`, error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to start torrent',
            error: error.message,
            timestamp: new Date().toISOString()
        }));
    }
}

// Handle stop-torrent message
async function handleStopTorrent(ws, data, clientId) {
    try {
        console.log(`[WS ${clientId}] Handling stop-torrent request`);
        const { torrentId } = data;
        
        if (!torrentId) {
            throw new Error('Torrent ID is required');
        }

        // Get current torrent state before stopping
        const torrent = torrentManager.getTorrent(torrentId);
        if (!torrent) {
            throw new Error(`Torrent not found: ${torrentId}`);
        }

        // Immediately notify all clients that we're stopping
        const stoppingUpdate = {
            type: 'torrent-update',
            torrentId: torrentId,
            data: {
                ...torrent,
                status: 'stopping',
                downloadSpeed: 0,
                uploadSpeed: 0,
                peers: 0,
                message: 'Stopping torrent...',
                lastUpdated: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        };
        
        // Broadcast to all clients first
        broadcastToClients(stoppingUpdate);
        
        console.log(`[WS ${clientId}] Stopping torrent: ${torrentId}`);
        
        // Actually stop the torrent
        const result = await torrentManager.stopTorrent(torrentId);
        
        // Prepare the final stopped state
        const stoppedUpdate = {
            type: 'torrent-update',
            torrentId: torrentId,
            data: {
                ...result,
                status: 'stopped',
                downloadSpeed: 0,
                uploadSpeed: 0,
                peers: 0,
                message: 'Torrent has been stopped',
                lastUpdated: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        };
        
        // Send confirmation to the requesting client
        ws.send(JSON.stringify({
            type: 'torrent-stopped',
            data: stoppedUpdate.data,
            timestamp: stoppedUpdate.timestamp
        }));
        
        // Broadcast the final stopped state to all clients
        broadcastToClients(stoppedUpdate);
        
        console.log(`[WS ${clientId}] Torrent stopped successfully: ${torrentId}`);
        
    } catch (error) {
        console.error(`[WS ${clientId}] Error stopping torrent:`, error);
        
        // If we have a torrentId, update its status to error
        if (data.torrentId) {
            broadcastToClients({
                type: 'torrent-update',
                torrentId: data.torrentId,
                data: {
                    torrentId: data.torrentId,
                    status: 'error',
                    message: `Error: ${error.message}`,
                    lastUpdated: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            });
        }
        
        // Send error to the requesting client
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to stop torrent',
            error: error.message,
            timestamp: new Date().toISOString()
        }));
    }
}

// Handle delete-torrent message
async function handleDeleteTorrent(ws, data, clientId) {
    try {
        console.log(`[WS ${clientId}] Handling delete-torrent request`);
        const { torrentId, deleteFiles = false } = data;
        
        if (!torrentId) {
            throw new Error('Torrent ID is required');
        }

        console.log(`[WS ${clientId}] Deleting torrent: ${torrentId}, deleteFiles: ${deleteFiles}`);
        const result = await torrentManager.deleteTorrent(torrentId, deleteFiles);
        
        ws.send(JSON.stringify({
            type: 'torrent-deleted',
            data: result,
            timestamp: new Date().toISOString()
        }));
        
        // Broadcast to all clients
        broadcastToClients({
            type: 'torrent-removed',
            torrentId: torrentId,
            name: result.name || null,
            timestamp: new Date().toISOString()
        });
        
        console.log(`[WS ${clientId}] Torrent deleted successfully: ${torrentId}`);
        
    } catch (error) {
        console.error(`[WS ${clientId}] Error deleting torrent:`, error);
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to delete torrent',
            error: error.message,
            timestamp: new Date().toISOString()
        }));
    }
}

// Handle get-files message
async function handleGetFiles(ws, messageData, clientId) {
    const filesTorrentId = messageData.torrentId || 
                         (messageData.data && messageData.data.torrentId);
    
    if (!filesTorrentId) {
        return ws.send(JSON.stringify({
            type: 'error',
            message: 'No torrent ID provided for file listing',
            timestamp: new Date().toISOString()
        }));
    }
    
    try {
        const files = torrentManager.getTorrentFiles(filesTorrentId);
        ws.send(JSON.stringify({
            type: 'files',
            torrentId: filesTorrentId,
            files: files || [],
            timestamp: new Date().toISOString()
        }));
    } catch (error) {
        console.error(`[TORRENT] Error getting files for ${filesTorrentId}:`, error);
        ws.send(JSON.stringify({
            type: 'error',
            message: `Failed to get files: ${error.message}`,
            torrentId: filesTorrentId,
            timestamp: new Date().toISOString()
        }));
    }
}

// Handle ping message
function handlePing(ws) {
    ws.send(JSON.stringify({ 
        type: 'pong',
        timestamp: new Date().toISOString() 
    }));
}

// Handle unknown message types
function handleUnknownMessage(ws, messageData, clientId) {
    console.log(`[WS ${clientId}] Unknown message type: ${messageData.type}`);
    ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${messageData.type}`,
        receivedData: messageData,
        timestamp: new Date().toISOString()
    }));
}

// Download file using WebTorrent's direct stream access
app.get('/api/download/:torrentId/:fileIndex', async (req, res) => {
    try {
        const { torrentId, fileIndex } = req.params;
        const torrentInfo = torrentManager.activeTorrents.get(torrentId);

        if (!torrentInfo || !torrentInfo.torrent) {
            return res.status(404).send('Torrent not found');
        }

        const file = torrentInfo.torrent.files[parseInt(fileIndex)];
        if (!file) {
            return res.status(404).send('File not found');
        }

        console.log(`[DOWNLOAD] Serving file: ${file.name} (${file.length} bytes)`);

        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', file.length);

        // Use WebTorrent's createReadStream for efficient streaming
        const stream = file.createReadStream();
        stream.pipe(res);

        stream.on('error', (error) => {
            console.error(`[DOWNLOAD] Stream error: ${error.message}`);
            if (!res.headersSent) {
                res.status(500).send('Error streaming file');
            }
        });

    } catch (error) {
        console.error(`[DOWNLOAD] Error: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).send('Error downloading file');
        }
    }
});

// API Routes
app.get('/api/torrents', (req, res) => {
    res.json(torrentManager.getAllTorrents());
});

// Get streaming URLs for a specific torrent
app.get('/api/torrents/:torrentId/streaming-urls', (req, res) => {
    try {
        const { torrentId } = req.params;
        const torrentInfo = torrentManager.activeTorrents.get(torrentId);
        
        if (!torrentInfo || !torrentInfo.torrent) {
            return res.status(404).json({ error: 'Torrent not found' });
        }
        
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const files = torrentInfo.torrent.files.map((file, index) => {
            const isVideo = torrentManager.isVideoFile(file.name);
            return {
                index,
                name: file.name,
                size: file.length,
                isVideo,
                streamUrl: `${baseUrl}/stream/${torrentId}/${index}`,
                downloadUrl: `${baseUrl}/api/download/${torrentId}/${index}`,
                // VLC compatible URL
                vlcUrl: `${baseUrl}/stream/${torrentId}/${index}`
            };
        });
        
        res.json({
            torrentId,
            name: torrentInfo.torrent.name,
            infoHash: torrentInfo.torrent.infoHash,
            files,
            status: torrentInfo.status
        });
    } catch (error) {
        console.error('[API] Error getting streaming URLs:', error);
        res.status(500).json({ error: 'Failed to get streaming URLs' });
    }
});

// Get individual file streaming URL
app.get('/api/torrents/:torrentId/files/:fileIndex/stream-url', (req, res) => {
    try {
        const { torrentId, fileIndex } = req.params;
        const torrentInfo = torrentManager.activeTorrents.get(torrentId);
        
        if (!torrentInfo || !torrentInfo.torrent) {
            return res.status(404).json({ error: 'Torrent not found' });
        }
        
        const file = torrentInfo.torrent.files[parseInt(fileIndex)];
        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const streamUrl = `${baseUrl}/stream/${torrentId}/${fileIndex}`;
        
        res.json({
            streamUrl,
            fileName: file.name,
            fileSize: file.length,
            torrentName: torrentInfo.torrent.name,
            instructions: {
                vlc: `Copy the URL and open VLC -> Media -> Open Network Stream -> Paste URL`,
                mpv: `mpv "${streamUrl}"`,
                curl: `curl -o "${file.name}" "${streamUrl}"`
            }
        });
    } catch (error) {
        console.error('[API] Error getting stream URL:', error);
        res.status(500).json({ error: 'Failed to get stream URL' });
    }
});

// File serving - serves completed torrent files from disk
app.get('/downloads/:torrentId/:filename', (req, res) => {
    try {
        const { torrentId, filename } = req.params;
        console.log(`[FILE] Download request for ${filename} in torrent ${torrentId}`);
        
        const torrentInfo = torrentManager.activeTorrents.get(torrentId);
        
        if (!torrentInfo) {
            console.error(`[FILE] Torrent not found: ${torrentId}`);
            return res.status(404).send('Torrent not found');
        }
        
        const filePath = path.join(torrentInfo.downloadPath, decodeURIComponent(filename));
        console.log(`[FILE] Serving file: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            console.error(`[FILE] File not found: ${filePath}`);
            return res.status(404).send('File not found');
        }
        
        // Set appropriate headers
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        
        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        fileStream.on('error', (error) => {
            console.error(`[FILE] Error streaming file ${filePath}:`, error);
            if (!res.headersSent) {
                res.status(500).send('Error streaming file');
            }
        });
        
    } catch (error) {
        console.error('[FILE] Error handling download request:', error);
        if (!res.headersSent) {
            res.status(500).send('Internal server error');
        }
    }
});

// Helper function to get MIME type from filename
function getMimeType(filename) {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.m4v': 'video/x-m4v',
        '.mpg': 'video/mpeg',
        '.mpeg': 'video/mpeg',
        '.3gp': 'video/3gpp',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// Stream endpoint with range request support for video playback
// Supports real-time streaming while downloading - works with VLC, browser, etc.
app.get('/stream/:torrentId/:fileIndex', (req, res) => {
    try {
        const { torrentId, fileIndex } = req.params;
        const torrentInfo = torrentManager.activeTorrents.get(torrentId);
        
        if (!torrentInfo || !torrentInfo.torrent) {
            return res.status(404).send('Torrent not found');
        }
        
        const file = torrentInfo.torrent.files[parseInt(fileIndex)];
        if (!file) {
            return res.status(404).send('File not found');
        }
        
        console.log(`[STREAM] Streaming ${file.name} (${file.length} bytes)`);
        
        const range = req.headers.range;
        const fileSize = file.length;
        const mimeType = getMimeType(file.name);
        
        // Set CORS headers for cross-origin streaming
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range');
        
        if (!range) {
            // No range request - stream entire file
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
                'Content-Disposition': `inline; filename="${file.name}"`
            });
            
            const stream = file.createReadStream();
            stream.pipe(res);
            
            stream.on('error', (err) => {
                console.error(`[STREAM] Error: ${err.message}`);
                if (!res.headersSent) {
                    res.status(500).send('Streaming error');
                }
            });
        } else {
            // Range request - partial content (required for video seeking)
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = (end - start) + 1;
            
            console.log(`[STREAM] Range request: ${start}-${end}/${fileSize}`);
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': mimeType,
                'Content-Disposition': `inline; filename="${file.name}"`
            });
            
            const stream = file.createReadStream({ start, end });
            stream.pipe(res);
            
            stream.on('error', (err) => {
                console.error(`[STREAM] Error: ${err.message}`);
                if (!res.headersSent) {
                    res.status(500).send('Streaming error');
                }
            });
        }
    } catch (error) {
        console.error(`[STREAM] Error: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).send('Streaming error');
        }
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[SERVER] Shutting down gracefully...');
    await torrentManager.stopAllTorrents();
    process.exit(0);
});

// Start server
server.listen(CONFIG.PORT, () => {
    console.log(`[SERVER] Running on http://localhost:${CONFIG.PORT}`);
});
