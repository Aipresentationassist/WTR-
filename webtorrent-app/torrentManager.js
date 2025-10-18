import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * TorrentManager - Manages WebTorrent instances using the native library
 * This is a much faster and more robust implementation compared to CLI spawning
 */
class TorrentManager {
    constructor() {
        // Initialize WebTorrent client
        this.client = new WebTorrent();
        this.activeTorrents = new Map(); // torrentId -> { torrent, status, metadata }
        this.onUpdate = null; // Callback for updates
        this.updateInterval = 1000; // Update every second
        
        console.log(`[TORRENT] WebTorrent client initialized`);
        
        // Setup client error handling
        this.client.on('error', (err) => {
            console.error(`[TORRENT] Client error: ${err.message}`);
        });
    }

    async startTorrent(magnetUri, downloadPath, fresh = false) {
        const torrentId = this.generateTorrentId();
        
        try {
            console.log(`[TORRENT] Starting: ${magnetUri.substring(0, 50)}...`);
            
            // Ensure directory exists
            if (!fs.existsSync(downloadPath)) {
                fs.mkdirSync(downloadPath, { recursive: true });
            }

            // Create initial status object
            const statusData = {
                torrentId,
                status: 'starting',
                progress: 0,
                downloadSpeed: 0,
                uploadSpeed: 0,
                peers: 0,
                downloaded: 0,
                totalSize: 0,
                timeRemaining: 'Unknown',
                fileName: 'Unknown',
                streamingUrl: null,
                canStream: false,
                downloadDir: downloadPath,
                downloadPath,
                fresh,
                startTime: Date.now(),
                error: null,
                files: [],
                infoHash: null
            };

            // Add torrent using WebTorrent library
            const torrent = this.client.add(magnetUri, {
                path: downloadPath
            });

            // Store torrent info
            const torrentInfo = {
                torrent,
                status: statusData,
                updateTimer: null,
                downloadPath
            };

            this.activeTorrents.set(torrentId, torrentInfo);

            // Setup event listeners
            this.setupTorrentListeners(torrentId, torrentInfo);

            return { torrentId, status: 'started' };

        } catch (error) {
            console.error(`[TORRENT] Error starting torrent: ${error.message}`);
            this.activeTorrents.delete(torrentId);
            throw error;
        }
    }

    setupTorrentListeners(torrentId, torrentInfo) {
        const { torrent, status } = torrentInfo;

        // Torrent metadata received
        torrent.on('metadata', () => {
            console.log(`[TORRENT ${torrentId}] Metadata received: ${torrent.name}`);
            status.status = 'downloading';
            status.fileName = torrent.name;
            status.totalSize = torrent.length;
            status.infoHash = torrent.infoHash;
            
            // Map torrent files with streaming URLs
            status.files = torrent.files.map((file, index) => {
                const isVideo = this.isVideoFile(file.name);
                return {
                    name: file.name,
                    path: file.path,
                    length: file.length,
                    index,
                    isVideo,
                    canStream: true,
                    streamUrl: `/stream/${torrentId}/${index}`,
                    downloadUrl: `/api/download/${torrentId}/${index}`
                };
            });

            this.broadcastUpdate(torrentId, status);
        });

        // Torrent ready to stream
        torrent.on('ready', () => {
            console.log(`[TORRENT ${torrentId}] Ready to stream`);
            status.canStream = true;
            this.broadcastUpdate(torrentId, status);
        });

        // Wire (peer) connected
        torrent.on('wire', (wire) => {
            console.log(`[TORRENT ${torrentId}] Connected to peer: ${wire.remoteAddress}`);
        });

        // Download progress - start periodic updates
        torrentInfo.updateTimer = setInterval(() => {
            this.updateTorrentStatus(torrentId, torrentInfo);
        }, this.updateInterval);

        // Torrent done
        torrent.on('done', () => {
            console.log(`[TORRENT ${torrentId}] Download complete!`);
            status.status = 'completed';
            status.progress = 100;
            this.broadcastUpdate(torrentId, status);
            
            // Clear update timer but keep seeding
            if (torrentInfo.updateTimer) {
                clearInterval(torrentInfo.updateTimer);
                torrentInfo.updateTimer = null;
            }
        });

        // Torrent error
        torrent.on('error', (err) => {
            console.error(`[TORRENT ${torrentId}] Error: ${err.message}`);
            status.status = 'error';
            status.error = err.message;
            this.broadcastUpdate(torrentId, status);
            
            // Clear update timer
            if (torrentInfo.updateTimer) {
                clearInterval(torrentInfo.updateTimer);
                torrentInfo.updateTimer = null;
            }
        });

        // Warning (non-fatal)
        torrent.on('warning', (err) => {
            console.warn(`[TORRENT ${torrentId}] Warning: ${err.message}`);
        });
    }

    updateTorrentStatus(torrentId, torrentInfo) {
        const { torrent, status } = torrentInfo;

        if (!torrent) return;

        try {
            // Update status with current stats
            status.progress = torrent.progress * 100;
            status.downloadSpeed = torrent.downloadSpeed;
            status.uploadSpeed = torrent.uploadSpeed;
            status.downloaded = torrent.downloaded;
            status.totalSize = torrent.length;
            status.peers = torrent.numPeers;
            status.ratio = torrent.ratio;
            
            // Ensure files are always synced (in case metadata event was missed or files changed)
            if (torrent.files && torrent.files.length > 0) {
                // Only resync if count changed or files are missing
                if (!status.files || status.files.length !== torrent.files.length) {
                    console.log(`[TORRENT ${torrentId}] Syncing ${torrent.files.length} files`);
                    status.files = torrent.files.map((file, index) => {
                        const isVideo = this.isVideoFile(file.name);
                        return {
                            name: file.name,
                            path: file.path,
                            length: file.length,
                            index,
                            isVideo,
                            canStream: true,
                            streamUrl: `/stream/${torrentId}/${index}`,
                            downloadUrl: `/api/download/${torrentId}/${index}`
                        };
                    });
                }
            }
            
            // Calculate time remaining
            if (torrent.downloadSpeed > 0 && torrent.progress < 1) {
                const remaining = (torrent.length - torrent.downloaded) / torrent.downloadSpeed;
                status.timeRemaining = this.formatTime(remaining);
            } else if (torrent.progress >= 1) {
                status.timeRemaining = 'Complete';
                status.status = 'seeding';
            } else {
                status.timeRemaining = 'Unknown';
            }

            // Update timestamp
            status.lastUpdated = new Date().toISOString();

            // Broadcast update
            this.broadcastUpdate(torrentId, status);
        } catch (error) {
            console.error(`[TORRENT ${torrentId}] Error updating status: ${error.message}`);
        }
    }

    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return 'Unknown';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    broadcastUpdate(torrentId, statusObject) {
        if (this.onUpdate) {
            try {
                this.onUpdate(torrentId, statusObject);
            } catch (error) {
                console.error(`[ERROR] Failed to broadcast update: ${error.message}`);
            }
        }
    }

    async stopTorrent(torrentId) {
        const torrentInfo = this.activeTorrents.get(torrentId);
        
        if (!torrentInfo) {
            throw new Error(`Torrent with ID ${torrentId} not found`);
        }
        
        try {
            console.log(`[TORRENT] Stopping torrent: ${torrentId}`);
            
            // Update status to stopping
            torrentInfo.status.status = 'stopping';
            this.broadcastUpdate(torrentId, torrentInfo.status);
            
            // Clear update timer
            if (torrentInfo.updateTimer) {
                clearInterval(torrentInfo.updateTimer);
                torrentInfo.updateTimer = null;
            }
            
            // Destroy the torrent
            const { torrent } = torrentInfo;
            if (torrent) {
                await new Promise((resolve, reject) => {
                    torrent.destroy({ destroyStore: false }, (err) => {
                        if (err) {
                            console.error(`[TORRENT ${torrentId}] Error destroying torrent:`, err);
                            reject(err);
                        } else {
                            console.log(`[TORRENT ${torrentId}] Torrent destroyed successfully`);
                            resolve();
                        }
                    });
                });
            }
            
            // Update final status
            torrentInfo.status.status = 'stopped';
            torrentInfo.status.downloadSpeed = 0;
            torrentInfo.status.uploadSpeed = 0;
            torrentInfo.status.peers = 0;
            
            this.broadcastUpdate(torrentId, torrentInfo.status);
            
            // Remove from active torrents after a delay
            setTimeout(() => {
                this.activeTorrents.delete(torrentId);
                console.log(`[TORRENT] Removed ${torrentId} from tracking`);
            }, 2000);
            
            return { torrentId, status: 'stopped' };
            
        } catch (error) {
            console.error(`[ERROR] Failed to stop torrent: ${error.message}`);
            throw error;
        }
    }

    async stopAllTorrents() {
        console.log(`[TORRENT] Stopping all ${this.activeTorrents.size} torrents...`);
        
        const stopPromises = [];
        for (const [torrentId] of this.activeTorrents) {
            stopPromises.push(
                this.stopTorrent(torrentId).catch(err => {
                    console.error(`[TORRENT] Error stopping ${torrentId}:`, err);
                })
            );
        }
        
        await Promise.all(stopPromises);
        
        // Destroy the client
        return new Promise((resolve) => {
            this.client.destroy((err) => {
                if (err) {
                    console.error(`[TORRENT] Error destroying client:`, err);
                }
                console.log(`[TORRENT] All torrents stopped, client destroyed`);
                resolve({ status: 'all_stopped' });
            });
        });
    }

    async deleteTorrent(torrentId, deleteFiles = false) {
        const torrentInfo = this.activeTorrents.get(torrentId);
        
        if (!torrentInfo) {
            throw new Error(`Torrent with ID ${torrentId} not found`);
        }
        
        try {
            const { torrent, downloadPath } = torrentInfo;
            const torrentName = torrent ? torrent.name : 'Unknown';
            
            console.log(`[TORRENT] Deleting torrent: ${torrentId}, deleteFiles: ${deleteFiles}`);
            
            // Stop the torrent first
            await this.stopTorrent(torrentId);
            
            // Delete files if requested
            if (deleteFiles && downloadPath) {
                try {
                    const fullPath = path.join(downloadPath, torrentName);
                    if (fs.existsSync(fullPath)) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                        console.log(`[TORRENT] Deleted files at: ${fullPath}`);
                    }
                } catch (err) {
                    console.error(`[TORRENT] Error deleting files:`, err);
                }
            }
            
            return { torrentId, name: torrentName, deleted: true };
            
        } catch (error) {
            console.error(`[ERROR] Failed to delete torrent: ${error.message}`);
            throw error;
        }
    }

    getTorrent(torrentId) {
        const torrentInfo = this.activeTorrents.get(torrentId);
        if (!torrentInfo) {
            return null;
        }
        
        return torrentInfo.status;
    }

    getAllTorrents() {
        const torrents = [];
        for (const [torrentId, torrentInfo] of this.activeTorrents) {
            torrents.push(torrentInfo.status);
        }
        return torrents;
    }

    getTorrentFiles(torrentId) {
        const torrentInfo = this.activeTorrents.get(torrentId);
        if (!torrentInfo || !torrentInfo.status) {
            return [];
        }
        
        return torrentInfo.status.files || [];
    }

    generateTorrentId() {
        return crypto.randomBytes(8).toString('hex');
    }

    setUpdateCallback(callback) {
        this.onUpdate = callback;
    }

    // Check if a file is a video file based on extension
    isVideoFile(filename) {
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        return videoExtensions.includes(ext);
    }

    // Get torrent by infoHash (for external access)
    getTorrentByInfoHash(infoHash) {
        for (const [torrentId, torrentInfo] of this.activeTorrents) {
            if (torrentInfo.status.infoHash === infoHash) {
                return { torrentId, ...torrentInfo.status };
            }
        }
        return null;
    }
}

export default TorrentManager;
