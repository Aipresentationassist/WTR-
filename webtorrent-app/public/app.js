class WebTorrentApp {
    constructor() {
        this.ws = null;
        this.torrents = new Map();
        this.expandedFileLists = new Set(); // Track which file lists are expanded
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 30;
        this.reconnectDelay = 1000;
        this.pendingMessages = [];
        this.logs = [];
        this.refreshInterval = null;
        this.refreshRate = 5000; // Refresh every 5 seconds
        this.serverUrl = this.detectServerUrl(); // Auto-detect server URL
        
        // Initialize the app
        this.initializeUI();
        
        // Force immediate update of connection status
        document.getElementById('status-text').textContent = 'Checking connection...';
        document.getElementById('status-indicator').className = 'status-indicator';
        document.getElementById('connection-status').className = 'connection-status';
        
        // Add a small delay to ensure UI updates before connection check
        setTimeout(() => {
            // Force immediate connection check
            this.checkConnection();
            
            this.connectWebSocket();
            this.startAutoRefresh();
        }, 100);
        
        // Add initial log entry
        this.addLogEntry('WebTorrent Manager initialized', 'info');
        this.addLogEntry(`Server URL detected: ${this.serverUrl}`, 'info');
        
        // Check for URL changes periodically (useful for dynamic environments like Colab)
        setInterval(() => {
            this.updateServerUrl();
        }, 30000); // Check every 30 seconds
    }
    
    // Server URL detection for different environments
    detectServerUrl() {
        const currentUrl = window.location.href;
        const protocol = window.location.protocol;
        const hostname = window.location.hostname;
        const port = window.location.port;
        
        // Handle different environments
        if (hostname.includes('ngrok.io') || hostname.includes('ngrok-free.app')) {
            // ngrok tunnel
            return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        } else if (hostname.includes('trycloudflare.com') || hostname.includes('cloudflare.com')) {
            // Cloudflare tunnel
            return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        } else if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
            // Local development
            return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        } else if (hostname.includes('colab.research.google.com') || hostname.includes('colab')) {
            // Google Colab - use the current URL
            return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        } else {
            // Production or other environments
            return `${protocol}//${hostname}${port ? ':' + port : ''}`;
        }
    }
    
    // Generate proper stream URL based on detected server URL
    generateStreamUrl(torrentId, fileIndex) {
        const baseUrl = this.serverUrl;
        return `${baseUrl}/stream/${torrentId}/${fileIndex}`;
    }
    
    // Generate proper download URL based on detected server URL
    generateDownloadUrl(torrentId, fileIndex) {
        const baseUrl = this.serverUrl;
        return `${baseUrl}/api/download/${torrentId}/${fileIndex}`;
    }
    
    // Update server URL (useful for dynamic environments)
    updateServerUrl() {
        const newUrl = this.detectServerUrl();
        if (newUrl !== this.serverUrl) {
            this.serverUrl = newUrl;
            this.addLogEntry(`Server URL updated: ${this.serverUrl}`, 'info');
            // Regenerate all stream URLs if needed
            this.regenerateStreamUrls();
        }
    }
    
    // Regenerate stream URLs for all torrents
    regenerateStreamUrls() {
        this.torrents.forEach((torrent, torrentId) => {
            if (torrent.files && torrent.files.length > 0) {
                torrent.files.forEach((file, index) => {
                    if (file.isVideo || this.isVideoFile(file.name)) {
                        const streamUrl = this.generateStreamUrl(torrentId, index);
                        const downloadUrl = this.generateDownloadUrl(torrentId, index);
                        
                        // Update any existing stream links
                        const card = document.getElementById(`torrent-${torrentId}`);
                        if (card) {
                            const streamLinks = card.querySelectorAll(`a[href*="/stream/${torrentId}/${index}"]`);
                            streamLinks.forEach(link => {
                                link.href = streamUrl;
                            });
                            
                            const copyButtons = card.querySelectorAll(`button[data-url*="/stream/${torrentId}/${index}"]`);
                            copyButtons.forEach(button => {
                                button.dataset.url = streamUrl;
                            });
                            
                            const downloadLinks = card.querySelectorAll(`a[href*="/api/download/${torrentId}/${index}"]`);
                            downloadLinks.forEach(link => {
                                link.href = downloadUrl;
                            });
                        }
                    }
                });
            }
        });
    }
    
    initializeUI() {
        // Connection status elements
        this.connectionStatus = document.getElementById('connection-status');
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        
        // Input elements
        this.magnetInput = document.getElementById('magnet-input');
        this.startDownloadBtn = document.getElementById('start-download-btn');
        
        // Container elements
        this.torrentsContainer = document.getElementById('torrents-container');
        this.noTorrents = document.getElementById('no-torrents');
        
        // Logs elements
        this.formattedLogs = document.getElementById('formatted-logs');
        this.clearLogsBtn = document.getElementById('clear-logs-btn');
        this.toggleLogsBtn = document.getElementById('toggle-logs-btn');
        
        // Initialize event listeners
        this.initEventListeners();
    }
    
    initEventListeners() {
        // Button click handlers
        if (this.startDownloadBtn) {
            this.startDownloadBtn.addEventListener('click', () => this.startDownload(false));
        }
        if (this.clearLogsBtn) {
            this.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        }
        if (this.toggleLogsBtn) {
            this.toggleLogsBtn.addEventListener('click', () => this.toggleLogs());
        }
        
        // Handle Enter key in magnet input
        if (this.magnetInput) {
            this.magnetInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.startDownload(false);
                }
            });
        }
    }
    
    // WebSocket connection methods
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        const wsUrl = `${protocol}//${host}`;
        
        // Update UI to show connecting status
        if (this.statusText) {
            this.statusText.textContent = 'Connecting...';
        }
        if (this.statusIndicator) {
            this.statusIndicator.className = 'status-indicator';
        }
        
        this.addLogEntry(`Connecting to WebSocket server at ${wsUrl}...`, 'info');
        console.log(`[WS] Attempting connection to ${wsUrl}`);
        
        try {
            // Close existing connection if any
            if (this.ws) {
                try {
                    this.ws.close();
                } catch (e) {
                    // Ignore close errors
                }
            }
            
            this.ws = new WebSocket(wsUrl);
            this.setupWebSocketHandlers();
        } catch (error) {
            console.error('[ERROR] Failed to create WebSocket:', error);
            this.addLogEntry(`Failed to connect: ${error.message}`, 'error');
            this.updateConnectionStatus(false);
            this.scheduleReconnect();
        }
    }
    
    setupWebSocketHandlers() {
        if (!this.ws) return;
        
        this.ws.onopen = () => {
            console.log('[SUCCESS] WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            this.addLogEntry('Connected to WebTorrent server', 'success');
            
            // Directly update the connection status elements
            if (this.statusText) {
                this.statusText.textContent = 'Connected';
            }
            if (this.statusIndicator) {
                this.statusIndicator.className = 'status-indicator connected';
            }
            if (this.connectionStatus) {
                this.connectionStatus.className = 'connection-status connected';
            }
            
            // Send any pending messages
            this.sendPendingMessages();
            
            // Request initial torrents
            this.requestInitialTorrents();
            
            // Ensure auto-refresh is running
            this.startAutoRefresh();
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
                
                // Reset the auto-refresh timer on each message to avoid unnecessary requests
                if (this.refreshInterval) {
                    clearInterval(this.refreshInterval);
                    this.startAutoRefresh();
                }
            } catch (error) {
                console.error('[ERROR] Error parsing WebSocket message:', error);
                this.addLogEntry(`Error parsing message: ${error.message}`, 'error');
            }
        };
        
        this.ws.onclose = (event) => {
            this.isConnected = false;
            
            // Directly update the connection status elements
            if (this.statusText) {
                this.statusText.textContent = 'Disconnected';
            }
            if (this.statusIndicator) {
                this.statusIndicator.className = 'status-indicator disconnected';
            }
            if (this.connectionStatus) {
                this.connectionStatus.className = 'connection-status disconnected';
            }
            
            // Stop auto-refresh when disconnected
            this.stopAutoRefresh();
            
            if (event.code !== 1000) { // 1000 is a normal closure
                console.warn(`[WARNING] Connection closed unexpectedly: Code: ${event.code}`);
                this.addLogEntry(`Connection lost (code ${event.code}). Reconnecting...`, 'warning');
                
                // Update UI to show reconnecting status
                if (this.statusText) {
                    this.statusText.textContent = 'Reconnecting...';
                }
                
                this.scheduleReconnect();
            } else {
                this.addLogEntry('Disconnected from server', 'info');
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('[ERROR] WebSocket error occurred');
            this.addLogEntry('WebSocket connection error', 'error');
        };
    }
    
    checkConnection() {
        // Check if we can connect to the server
        const testConnection = () => {
            try {
                // Direct DOM updates for immediate feedback
                document.getElementById('status-text').textContent = 'Checking connection...';
                document.getElementById('status-indicator').className = 'status-indicator';
                document.getElementById('connection-status').className = 'connection-status';
                
                // Create a test WebSocket to check if the server is available
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const host = window.location.host || 'localhost:3000';
                const wsUrl = `${protocol}//${host}`;
                
                console.log(`[WS] Testing connection to ${wsUrl}`);
                
                const testWs = new WebSocket(wsUrl);
                
                testWs.onopen = () => {
                    console.log('[SUCCESS] Server is available');
                    // Direct DOM update for immediate feedback
                    document.getElementById('status-text').textContent = 'Connected';
                    document.getElementById('status-indicator').className = 'status-indicator connected';
                    document.getElementById('connection-status').className = 'connection-status connected';
                    
                    this.isConnected = true;
                    
                    // Close the test connection
                    testWs.close();
                };
                
                testWs.onerror = () => {
                    console.log('[ERROR] Server is not available');
                    // Direct DOM update for immediate feedback
                    document.getElementById('status-text').textContent = 'Disconnected';
                    document.getElementById('status-indicator').className = 'status-indicator disconnected';
                    document.getElementById('connection-status').className = 'connection-status disconnected';
                };
            } catch (error) {
                console.error('[ERROR] Failed to test connection:', error);
                // Direct DOM update for immediate feedback on error
                document.getElementById('status-text').textContent = 'Connection Error';
                document.getElementById('status-indicator').className = 'status-indicator disconnected';
                document.getElementById('connection-status').className = 'connection-status disconnected';
            }
        };
        
        // Run the test immediately and then every 2 seconds until connected
        testConnection();
        const checkInterval = setInterval(() => {
            if (this.isConnected) {
                clearInterval(checkInterval);
                // Final confirmation of connected status
                document.getElementById('status-text').textContent = 'Connected';
                document.getElementById('status-indicator').className = 'status-indicator connected';
                document.getElementById('connection-status').className = 'connection-status connected';
            } else {
                testConnection();
            }
        }, 2000);
    }
    
    updateConnectionStatus(connected) {
        if (!this.connectionStatus || !this.statusIndicator || !this.statusText) return;
        
        if (connected) {
            this.connectionStatus.className = 'connection-status connected';
            this.statusIndicator.className = 'status-indicator connected';
            this.statusText.textContent = 'Connected';
        } else {
            this.connectionStatus.className = 'connection-status disconnected';
            this.statusIndicator.className = 'status-indicator disconnected';
            this.statusText.textContent = 'Disconnected';
        }
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.addLogEntry('Max reconnection attempts reached', 'error');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        
        this.addLogEntry(`Reconnecting in ${delay/1000} seconds (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, 'warning');
        
        // Update UI to show reconnecting status
        if (this.statusText) {
            this.statusText.textContent = 'Reconnecting...';
        }
        
        setTimeout(() => {
            this.connectWebSocket();
        }, delay);
    }
    
    sendPendingMessages() {
        if (!this.isConnected || !this.pendingMessages.length) return;
        
        this.addLogEntry(`Sending ${this.pendingMessages.length} pending messages...`, 'info');
        
        while (this.pendingMessages.length > 0) {
            const message = this.pendingMessages.shift();
            this.sendMessage(message);
        }
    }
    
    sendMessage(data) {
        if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify(data));
                return true;
            } catch (error) {
                console.error('[ERROR] Failed to send message:', error);
                this.addLogEntry(`Failed to send message: ${error.message}`, 'error');
                this.pendingMessages.unshift(data);
                return false;
            }
        } else {
            this.pendingMessages.push(data);
            this.addLogEntry('WebSocket not connected. Message queued.', 'warning');
            if (!this.isConnected) {
                this.scheduleReconnect();
            }
            return false;
        }
    }
    
    // Torrent Management Methods
    handleTorrentStopped(data) {
        const { torrentId } = data;
        if (!torrentId) return;
        
        const torrent = this.torrents.get(torrentId);
        if (!torrent) return;
        
        // Update torrent status and stats
        torrent.status = 'stopped';
        torrent.downloadSpeed = 0;
        torrent.uploadSpeed = 0;
        torrent.peers = 0;
        
        // Update the UI
        this.updateTorrentCard(torrent);
        
        // Log the event
        const torrentName = torrent.name || torrentId;
        this.addLogEntry(`Torrent stopped: ${torrentName}`, 'info');
        
        // Re-enable action buttons if needed
        const card = document.getElementById(`torrent-${torrentId}`);
        if (card) {
            const buttons = card.querySelectorAll('button[disabled]');
            buttons.forEach(button => {
                if (button.textContent.includes('Stopping')) {
                    button.disabled = false;
                    button.innerHTML = button.innerHTML.replace('⏳ Stopping...', '▶️ Start');
                }
            });
        }
    }
    
    handleTorrentUpdate(update) {
        const { torrentId, data } = update;
        if (!torrentId || !data) return;
        
        try {
            // Get the existing torrent or create a new one
            let torrent = this.torrents.get(torrentId);
            const isNew = !torrent;
            
            if (isNew) {
                torrent = { torrentId, ...data };
                this.torrents.set(torrentId, torrent);
                this.addLogEntry(`New torrent added: ${data.name || torrentId}`, 'info');
            } else {
                // Preserve existing properties that aren't being updated
                Object.assign(torrent, data);
            }
            
            // Update the UI with the latest data
            this.updateTorrentCard(torrent);
            
            // Special handling for status changes
            if (data.status === 'stopping') {
                this.addLogEntry(`Stopping torrent: ${torrent.name || torrentId}`, 'info');
                
                // Disable the stop button if it exists
                const card = document.getElementById(`torrent-${torrentId}`);
                if (card) {
                    const stopButton = card.querySelector('button[onclick^="app.stopTorrent"]');
                    if (stopButton) {
                        stopButton.disabled = true;
                        stopButton.innerHTML = '⏳ Stopping...';
                    }
                }
            } else if (data.status === 'stopped') {
                this.addLogEntry(`Torrent stopped: ${torrent.name || torrentId}`, 'info');
                
                // Re-enable the start button if it exists
                const card = document.getElementById(`torrent-${torrentId}`);
                if (card) {
                    const startButton = card.querySelector('button[onclick^="app.startTorrent"]');
                    if (startButton) {
                        startButton.disabled = false;
                    }
                }
            } else if (data.status === 'error') {
                this.addLogEntry(`Error with torrent ${torrent.name || torrentId}: ${data.message || 'Unknown error'}`, 'error');
            }
            
            // Always update the torrent list in the UI to ensure it's current
            this.renderTorrentList();
            
            // Force a redraw of the specific torrent card to ensure it's up to date
            this.updateTorrentCard(torrent, true);
            
        } catch (error) {
            console.error('Error updating torrent:', error);
            this.addLogEntry(`Error updating torrent ${torrentId}: ${error.message}`, 'error');
        }
    }
    
    handleTorrentRemoved(torrentId) {
        if (!torrentId) return;
        
        const torrent = this.torrents.get(torrentId);
        if (torrent) {
            const torrentName = torrent.name || torrentId;
            this.addLogEntry(`Torrent removed: ${torrentName}`, 'info');
            
            // Remove from our map
            this.torrents.delete(torrentId);
            
            // Update UI
            const card = document.getElementById(`torrent-${torrentId}`);
            if (card) {
                card.classList.add('removing');
                setTimeout(() => {
                    if (card.parentNode) {
                        card.parentNode.removeChild(card);
                    }
                }, 500);
            }
            
            // Update the torrent list
            this.renderTorrentList();
        }
    }
    
    handleTorrentCompleted(data) {
        if (!data || !data.torrentId) return;
        
        const torrentId = data.torrentId;
        const torrent = this.torrents.get(torrentId);
        
        if (torrent) {
            torrent.status = 'completed';
            torrent.progress = 100;
            this.addLogEntry(`Torrent completed: ${torrent.name || torrentId}`, 'success');
            this.updateTorrentCard(torrent, true);
            this.renderTorrentList();
        }
    }
    
    handleTorrentList(torrents) {
        if (!Array.isArray(torrents)) {
            console.error('Expected torrents to be an array, got:', typeof torrents);
            return;
        }
        
        console.log(`[INFO] Received ${torrents.length} torrents in list`);
        
        // Update existing torrents and add new ones
        torrents.forEach(torrent => {
            if (torrent && torrent.torrentId) {
                const existingTorrent = this.torrents.get(torrent.torrentId);
                if (existingTorrent) {
                    // Update existing torrent
                    Object.assign(existingTorrent, torrent);
                    this.updateTorrentCard(existingTorrent);
                } else {
                    // Add new torrent
                    this.torrents.set(torrent.torrentId, torrent);
                    this.addLogEntry(`Discovered torrent: ${torrent.name || torrent.torrentId}`, 'info');
                }
            }
        });
        
        // Update the UI
        this.renderTorrentList();
    }
    
    handleTorrentAdded(data) {
        if (!data || !data.torrentId) return;
        
        const torrentId = data.torrentId;
        const existingTorrent = this.torrents.get(torrentId);
        
        if (existingTorrent) {
            // Update existing torrent
            Object.assign(existingTorrent, data);
            this.updateTorrentCard(existingTorrent);
            this.addLogEntry(`Torrent updated: ${existingTorrent.name || torrentId}`, 'info');
        } else {
            // Add new torrent
            this.torrents.set(torrentId, data);
            this.addLogEntry(`New torrent added: ${data.name || torrentId}`, 'success');
            this.updateTorrentCard(data);
        }
        
        // Update the UI
        this.renderTorrentList();
    }
    
    requestInitialTorrents() {
        this.sendMessage({ type: 'get-torrents' });
    }
    
    handleInitialTorrents(torrents) {
        if (!Array.isArray(torrents)) {
            console.error('Expected torrents to be an array, got:', typeof torrents);
            return;
        }
        
        console.log(`[INFO] Received ${torrents.length} initial torrents`);
        
        // Clear existing torrents
        this.torrents.clear();
        
        // Add each torrent to our map
        torrents.forEach(torrent => {
            if (torrent && torrent.torrentId) {
                this.torrents.set(torrent.torrentId, torrent);
                // Set the last update time
                torrent.lastUpdateTime = Date.now();
            }
        });
        
        // Update the UI
        this.renderTorrentList();
        
        // Log the event
        if (torrents.length > 0) {
            this.addLogEntry(`Loaded ${torrents.length} active torrents`, 'info');
        } else {
            this.addLogEntry('No active torrents found', 'info');
        }
    }
    
    handleWebSocketMessage(data) {
        if (!data || !data.type) return;
        
        try {
            // Log received message for debugging
            console.log(`[WebSocket] Received message type: ${data.type}`);
            
            switch (data.type) {
                case 'torrent-list':
                    this.handleTorrentList(data.data || []);
                    break;
                    
                case 'torrent-added':
                    this.handleTorrentAdded(data.data);
                    break;
                    
                case 'torrent-update':
                    this.handleTorrentUpdate(data);
                    // Mark the last update time for this torrent
                    if (data.torrentId && data.data) {
                        const torrent = this.torrents.get(data.torrentId);
                        if (torrent) {
                            torrent.lastUpdateTime = Date.now();
                        }
                    }
                    break;
                    
                case 'torrent-completed':
                    this.handleTorrentCompleted(data.data);
                    break;
                    
                case 'torrent-stopped':
                    this.handleTorrentStopped(data);
                    break;
                    
                case 'torrent-removed':
                    this.handleTorrentRemoved(data.torrentId);
                    break;
                    
                case 'initial-torrents':
                    this.handleInitialTorrents(data.data || []);
                    break;
                    
                case 'log':
                    this.addLogEntry(data.message, data.level || 'info');
                    break;
                    
                case 'error':
                    this.addLogEntry(data.message || 'An error occurred', 'error');
                    break;
                    
                default:
                    console.warn('Unknown message type:', data.type, data);
            }
            
            // After processing any message, update the UI
            this.renderTorrentList();
            
        } catch (error) {
            console.error('Error handling WebSocket message:', error, data);
            this.addLogEntry(`Error processing update: ${error.message}`, 'error');
        }
    }
    
    // Start a new download
    async startDownload(fresh = false) {
        const magnetLink = this.magnetInput ? this.magnetInput.value.trim() : '';
        
        if (!magnetLink) {
            this.addLogEntry('Please enter a magnet link', 'warning');
            if (this.magnetInput) this.magnetInput.focus();
            return;
        }
        
        // Basic magnet link validation
        if (!magnetLink.startsWith('magnet:?')) {
            this.addLogEntry('Please enter a valid magnet link', 'error');
            return;
        }
        
        try {
            this.addLogEntry(`Starting ${fresh ? 'fresh ' : ''}download...`, 'info');
            
            // Send message to start the torrent
            const message = {
                type: 'start-torrent',
                magnet: magnetLink,
                fresh: fresh,
                timestamp: Date.now()
            };
            
            this.sendMessage(message);
            if (this.magnetInput) this.magnetInput.value = ''; // Clear the input field
        } catch (error) {
            console.error('[ERROR] Error starting download:', error);
            this.addLogEntry(`Error starting download: ${error.message}`, 'error');
        }
    }
    
    startTorrent(torrentId) {
        if (!torrentId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('Cannot start torrent: WebSocket not connected');
            return false;
        }
        
        const torrent = this.torrents.get(torrentId);
        if (!torrent) {
            this.addLogEntry('Torrent not found', 'error');
            return false;
        }
        
        // Update UI immediately to show starting state
        torrent.status = 'downloading';
        this.updateTorrentCard(torrent);
        
        // Send message to server to start the torrent
        this.sendMessage({
            type: 'start-torrent',
            magnet: torrent.magnet || torrent.infoHash,
            torrentId: torrentId,
            timestamp: Date.now()
        });
        
        this.addLogEntry(`Starting torrent: ${torrent.name || torrentId}`, 'info');
        return true;
    }
    
    stopTorrent(torrentId) {
        if (!torrentId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('Cannot stop torrent: WebSocket not connected');
            return false;
        }
        
        try {
            // Update UI immediately to show stopping state
            const torrent = this.torrents.get(torrentId);
            if (torrent) {
                torrent.status = 'stopping';
                this.updateTorrentCard(torrent);
                this.renderTorrentList();
            }
            
            this.ws.send(JSON.stringify({
                type: 'stop-torrent',
                torrentId: torrentId,
                timestamp: Date.now()
            }));
            
            this.addLogEntry(`Stopping torrent: ${torrentId}`, 'info');
            return true;
            
        } catch (error) {
            console.error('Error sending stop-torrent message:', error);
            this.addLogEntry(`Failed to stop torrent: ${error.message}`, 'error');
            return false;
        }
    }
    
    removeTorrent(torrentId, deleteFiles = false) {
        if (!torrentId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('Cannot remove torrent: WebSocket not connected');
            return false;
        }
        
        const torrent = this.torrents.get(torrentId);
        if (!torrent) {
            this.addLogEntry(`Torrent not found: ${torrentId}`, 'error');
            return false;
        }
        
        // Show confirmation dialog for deleting files
        if (deleteFiles) {
            const confirmed = confirm('Are you sure you want to delete the downloaded files? This action cannot be undone.');
            if (!confirmed) return false;
        }
        
        try {
            // Update UI immediately to show removing state
            torrent.status = 'removing';
            this.updateTorrentCard(torrent);
            
            // Add visual indication that torrent is being removed
            const card = document.getElementById(`torrent-${torrentId}`);
            if (card) {
                card.classList.add('removing');
            }
            
            const action = deleteFiles ? 'delete' : 'remove';
            const actionText = deleteFiles ? 'Deleting' : 'Removing';
            
            this.addLogEntry(`${actionText} torrent: ${torrent.name || torrent.torrentId}`, 'info');
            
            this.ws.send(JSON.stringify({
                type: 'remove-torrent',
                torrentId: torrentId,
                deleteFiles: deleteFiles,
                timestamp: Date.now()
            }));
            
            return true;
            
        } catch (error) {
            console.error('Error sending remove-torrent message:', error);
            this.addLogEntry(`Failed to remove torrent: ${error.message}`, 'error');
            return false;
        }
    }
    
    renderTorrentList() {
        if (!this.torrentsContainer) return;
        
        // Show/hide the no torrents message
        if (this.noTorrents) {
            this.noTorrents.style.display = this.torrents.size === 0 ? 'flex' : 'none';
        }
        
        if (this.torrents.size === 0) return;
        
        // Define status priority for sorting
        const statusPriority = {
            'downloading': 0,
            'verifying': 1,
            'seeding': 2,
            'completed': 3,
            'stopped': 4,
            'error': 5,
            'unknown': 6
        };
        
        // Sort torrents by status and name
        const sortedTorrents = Array.from(this.torrents.values()).sort((a, b) => {
            const statusA = a.status || 'unknown';
            const statusB = b.status || 'unknown';
            
            // First sort by status
            const statusDiff = (statusPriority[statusA] || 6) - (statusPriority[statusB] || 6);
            if (statusDiff !== 0) return statusDiff;
            
            // Then sort by name
            const nameA = a.fileName || a.torrentId || '';
            const nameB = b.fileName || b.torrentId || '';
            return nameA.localeCompare(nameB);
        });
        
        // Get current torrent IDs in the container
        const currentCardIds = new Set();
        this.torrentsContainer.querySelectorAll('.torrent-card').forEach(card => {
            currentCardIds.add(card.id);
        });
        
        // Update each torrent card
        sortedTorrents.forEach(torrent => {
            const cardId = `torrent-${torrent.torrentId}`;
            currentCardIds.delete(cardId); // Remove from the set as we process it
            this.updateTorrentCard(torrent);
        });
        
        // Remove any cards that are no longer in the torrents map
        currentCardIds.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.add('removing');
                setTimeout(() => {
                    if (card.parentNode) {
                        card.parentNode.removeChild(card);
                    }
                }, 500); // Fade out animation duration
            }
        });
    }
    
        updateTorrentCard(torrent, forceRedraw = false) {
        try {
            if (!torrent || !torrent.torrentId) {
                return;
            }

            const torrentId = torrent.torrentId;
            const cardId = `torrent-${torrentId}`;
            let card = document.getElementById(cardId);
            const isNewCard = !card;
        
            // Save expanded state before any redraw
            let wasExpanded = false;
            if (card && !isNewCard) {
                const fileList = card.querySelector('.file-list');
                wasExpanded = fileList && fileList.style && fileList.style.display !== 'none';
                if (wasExpanded) {
                    this.expandedFileLists.add(torrentId);
                }
            }

            // Only create new card if it doesn't exist (not on every update)
            if (isNewCard || forceRedraw) {
            if (card && forceRedraw) {
                card.remove();
            }
            card = document.createElement('div');
            card.id = cardId;
            card.className = 'torrent-card';
            
            const fileCount = torrent.files ? torrent.files.length : 0;
            
            card.innerHTML = `
                <div class="torrent-thumbnail">
                    <i class="fas fa-download"></i>
                </div>
                <div class="torrent-content">
                    <div class="torrent-header">
                        <div class="torrent-title-section">
                            <h3 class="torrent-title" title="${this.escapeHTML(torrent.name || torrent.fileName || torrent.torrentId)}">${this.escapeHTML(torrent.name || torrent.fileName || torrent.torrentId || 'Unknown')}</h3>
                            <span class="status-badge"></span>
                        </div>
                        <div class="torrent-actions">
                            <button class="btn btn-sm btn-primary start-btn"><i class="fas fa-play"></i> Start</button>
                            <button class="btn btn-sm btn-warning stop-btn"><i class="fas fa-stop"></i> Stop</button>
                            <button class="btn btn-sm btn-danger remove-btn"><i class="fas fa-trash"></i> Remove</button>
                            <button class="btn btn-sm btn-danger delete-btn"><i class="fas fa-trash-alt"></i> Delete Files</button>
                        </div>
                    </div>
                    <div class="torrent-details">
                        <div class="progress-container">
                            <div class="progress-bar" style="width: 0%;"></div>
                        </div>
                        <div class="torrent-stats">
                            <div class="stat-item"><span class="stat-label">Downloaded:</span> <span class="stat-value">0 B</span></div>
                            <div class="stat-item"><span class="stat-label">Size:</span> <span class="stat-value">0 B</span></div>
                            <div class="stat-item"><span class="stat-label">Speed:</span> <span class="stat-value">0 B/s</span></div>
                            <div class="stat-item"><span class="stat-label">Peers:</span> <span class="stat-value">0</span></div>
                            <div class="stat-item"><span class="stat-label">ETA:</span> <span class="stat-value">--:--:--</span></div>
                        </div>
                    </div>
                    <div class="torrent-files-container">
                        <div class="torrent-files-header">
                            <span class="files-count-text">${fileCount > 0 ? fileCount : 'Loading'} File${fileCount !== 1 ? 's' : ''}</span>
                            <button class="btn btn-sm toggle-files-btn"><i class="fas fa-chevron-down"></i> ${fileCount > 0 ? 'Show Files' : 'Loading...'}</button>
                        </div>
                        <ul class="file-list" style="display: none;"></ul>
                    </div>
                </div>
            `;

            // Add event listeners for action buttons
            card.querySelector('.start-btn').addEventListener('click', () => this.startTorrent(torrentId));
            card.querySelector('.stop-btn').addEventListener('click', () => this.stopTorrent(torrentId));
            card.querySelector('.remove-btn').addEventListener('click', () => this.removeTorrent(torrentId, false));
            card.querySelector('.delete-btn').addEventListener('click', () => this.removeTorrent(torrentId, true));

            // Add event listener for file list toggle - make entire header clickable
            const toggleFilesHeader = card.querySelector('.torrent-files-header');
            const toggleHandler = (e) => {
                e.stopPropagation();
                const button = card.querySelector('.toggle-files-btn');
                const fileList = card.querySelector('.file-list');
                
                // Null checks before accessing properties
                if (!fileList || !fileList.style || !button) {
                    console.warn('Toggle elements not found');
                    return;
                }
                
                const isHidden = fileList.style.display === 'none' || fileList.style.display === '';
                
                fileList.style.display = isHidden ? 'block' : 'none';
                button.innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i> Hide Files' : '<i class="fas fa-chevron-down"></i> Show Files';
                
                // Track expanded state
                if (isHidden) {
                    this.expandedFileLists.add(torrentId);
                } else {
                    this.expandedFileLists.delete(torrentId);
                }
            };
            
            // Both header and button trigger the same action (with null checks)
            if (toggleFilesHeader) {
                toggleFilesHeader.addEventListener('click', toggleHandler);
            }
            const toggleBtn = card.querySelector('.toggle-files-btn');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', toggleHandler);
            }
            
            // Restore expanded state if it was previously expanded
            if (this.expandedFileLists.has(torrentId) || wasExpanded) {
                const fileList = card.querySelector('.file-list');
                const toggleBtn = card.querySelector('.toggle-files-btn');
                if (fileList && fileList.style && toggleBtn) {
                    fileList.style.display = 'block';
                    toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Files';
                }
            }

            this.torrentsContainer.appendChild(card);
        }

        const status = torrent.status || 'unknown';
        card.className = `torrent-card status-${status} fade-in`;

        // Update thumbnail icon based on status
        const thumbnail = card.querySelector('.torrent-thumbnail i');
        if (thumbnail) {
            const iconMap = {
                'downloading': 'fas fa-download',
                'seeding': 'fas fa-upload',
                'verifying': 'fas fa-check-circle',
                'completed': 'fas fa-check',
                'stopped': 'fas fa-stop',
                'stopping': 'fas fa-spinner fa-spin',
                'error': 'fas fa-exclamation-triangle',
                'unknown': 'fas fa-download'
            };
            thumbnail.className = iconMap[status] || iconMap.unknown;
        }

        const statusBadge = card.querySelector('.status-badge');
        if (statusBadge) {
            statusBadge.className = `status-badge status-${status}`;
            statusBadge.innerHTML = `${this.getStatusIcon(status)} ${this.capitalizeFirstLetter(status)}`;
        }

        const progressBar = card.querySelector('.progress-bar');
        if (progressBar) {
            const progress = Math.min(100, Math.max(0, torrent.progress || 0));
            progressBar.style.width = `${progress}%`;
        }

        const updateStat = (selector, value) => {
            const element = card.querySelector(selector);
            if (element) element.textContent = value;
        };

        updateStat('.stat-item:nth-child(1) .stat-value', this.formatBytes(torrent.downloaded || 0));
        updateStat('.stat-item:nth-child(2) .stat-value', this.formatBytes(torrent.length || 0));
        updateStat('.stat-item:nth-child(3) .stat-value', this.formatSpeed(torrent.downloadSpeed || 0));
        updateStat('.stat-item:nth-child(4) .stat-value', torrent.peers || 0);
        updateStat('.stat-item:nth-child(5) .stat-value', this.formatTimeRemaining(torrent.timeRemaining));

        const startBtn = card.querySelector('.start-btn');
        const stopBtn = card.querySelector('.stop-btn');
        if (startBtn) startBtn.disabled = ['downloading', 'seeding', 'verifying', 'stopping'].includes(status);
                if (stopBtn) stopBtn.disabled = ['stopped', 'stopping', 'error'].includes(status);

        // Handle Stream URL display - with null check
        const streamUrlContainer = card ? card.querySelector('.stream-url-container') : null;
        if (streamUrlContainer) {
            if (torrent.streamingUrl) {
                const streamUrlLink = streamUrlContainer.querySelector('.stream-url-link');
                const vpsUrl = torrent.streamingUrl.replace('localhost', window.location.hostname);
                if (streamUrlLink) {
                    streamUrlLink.href = vpsUrl;
                    streamUrlLink.textContent = vpsUrl;
                }
                if (streamUrlContainer.style) {
                    streamUrlContainer.style.display = 'flex';
                }

                const copyBtn = streamUrlContainer.querySelector('.btn-copy-url');
                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(vpsUrl).then(() => {
                            copyBtn.innerHTML = '<i class="fas fa-check"></i>';
                            setTimeout(() => { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 2000);
                        });
                    });
                }
            } else if (streamUrlContainer.style) {
                streamUrlContainer.style.display = 'none';
            }
        }

        if (status === 'stopping' && stopBtn) {
            stopBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Stopping...';
        } else if (stopBtn && stopBtn.innerHTML && stopBtn.innerHTML.includes('Stopping')) {
            stopBtn.innerHTML = '<i class="fas fa-stop"></i> Stop';
        }

        // Update file count in header - with comprehensive null checks
        if (!card) return; // Exit early if card doesn't exist
        
        const filesCountText = card.querySelector('.files-count-text');
        const toggleFilesBtn = card.querySelector('.toggle-files-btn');
        if (filesCountText && torrent.files && torrent.files.length > 0) {
            const fileCount = torrent.files.length;
            filesCountText.textContent = `${fileCount} File${fileCount !== 1 ? 's' : ''}`;
            if (toggleFilesBtn && toggleFilesBtn.textContent && toggleFilesBtn.textContent.includes('Loading')) {
                toggleFilesBtn.innerHTML = '<i class="fas fa-chevron-down"></i> Show Files';
            }
        }

        // Update file list - only rebuild when necessary to prevent flickering
        const fileList = card.querySelector('.file-list');
        if (!fileList) {
            return; // Exit early if file list doesn't exist
        }
        
        // Only update if we have files and the list is empty or count changed
        if (!torrent.files || torrent.files.length === 0) {
            return; // No files yet, don't update
        }
        
        const currentFileCount = fileList.children ? fileList.children.length : 0;
        const newFileCount = torrent.files.length;
        
        // ONLY rebuild if file count actually changed (prevents flickering on every update)
        if (currentFileCount !== newFileCount) {
            // Save current display state (with comprehensive null check)
            const wasExpanded = (fileList.style && fileList.style.display === 'block');
            
            // Clear and rebuild (only when count changes)
            fileList.innerHTML = '';
            
            torrent.files.forEach((file, index) => {
                const fileItem = document.createElement('li');
                fileItem.className = 'file-item';
                
                // Check if file is a video
                const isVideo = file.isVideo || this.isVideoFile(file.name);
                const streamUrl = this.generateStreamUrl(torrent.torrentId, index);
                const downloadUrl = this.generateDownloadUrl(torrent.torrentId, index);
                
                fileItem.innerHTML = `
                        <div class="file-info">
                            ${isVideo ? '<i class="fas fa-video file-icon"></i>' : '<i class="fas fa-file file-icon"></i>'}
                            <span class="file-name" title="${this.escapeHTML(file.path || file.name)}">${this.escapeHTML(file.name)}</span>
                            <span class="file-size">${this.formatBytes(file.length)}</span>
                        </div>
                        <div class="file-actions">
                            ${isVideo ? `
                                <a href="${streamUrl}" target="_blank" class="btn btn-sm btn-success btn-stream">
                                    <i class="fas fa-play"></i> Play
                                </a>
                                <button class="btn btn-sm btn-info copy-stream-btn" data-url="${streamUrl}">
                                    <i class="fas fa-link"></i> Copy URL
                                </button>
                            ` : ''}
                            <a href="${downloadUrl}" class="btn btn-sm btn-primary btn-download">
                                <i class="fas fa-download"></i> Download
                            </a>
                        </div>
                `;
                
                // Add copy link functionality for video files
                if (isVideo) {
                    const copyBtn = fileItem.querySelector('.copy-stream-btn');
                    if (copyBtn) {
                        copyBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            const url = copyBtn.dataset.url;
                            navigator.clipboard.writeText(url).then(() => {
                                const originalHTML = copyBtn.innerHTML;
                                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                                copyBtn.classList.add('btn-success');
                                copyBtn.classList.remove('btn-info');
                                
                                // Show a tooltip/notification
                                this.addLogEntry(`Stream URL copied: ${url}`, 'success');
                                
                                setTimeout(() => {
                                    copyBtn.innerHTML = originalHTML;
                                    copyBtn.classList.remove('btn-success');
                                    copyBtn.classList.add('btn-info');
                                }, 2000);
                            }).catch(err => {
                                console.error('Failed to copy:', err);
                                this.addLogEntry('Failed to copy stream URL', 'error');
                            });
                        });
                    }
                }
                
                fileList.appendChild(fileItem);
            });
            
            // Auto-expand on first load OR restore previous state
            if (fileList && fileList.style) {
                if (currentFileCount === 0) {
                    // First time loading - auto expand
                    fileList.style.display = 'block';
                    if (toggleFilesBtn) {
                        toggleFilesBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Files';
                    }
                    this.expandedFileLists.add(torrentId);
                } else if (wasExpanded) {
                    // Restore expanded state
                    fileList.style.display = 'block';
                    if (toggleFilesBtn) {
                        toggleFilesBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Files';
                    }
                }
            }
        }
        } catch (error) {
            console.error(`Error updating torrent ${torrent.torrentId}:`, error);
            this.addLogEntry(`Error updating torrent ${torrent.torrentId}: ${error.message}`, 'error');
        }
    }
    
    // Auto-refresh methods
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.requestTorrentUpdates();
            }
        }, this.refreshRate);
    }
    
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
    
    requestTorrentUpdates() {
        if (this.torrents.size > 0) {
            this.sendMessage({ type: 'get-torrents' });
        }
    }
    
    // Utility methods
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    
    formatSpeed(bytesPerSecond) {
        return this.formatBytes(bytesPerSecond) + '/s';
    }
    
    formatTimeRemaining(milliseconds) {
        if (!milliseconds || milliseconds <= 0 || !isFinite(milliseconds)) {
            return '--:--:--';
        }
        
        const seconds = Math.floor(milliseconds / 1000);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        
        return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
    }
    
    getStatusIcon(status) {
        const icons = {
            'downloading': '<i class="fas fa-arrow-down"></i>',
            'seeding': '<i class="fas fa-arrow-up"></i>',
            'verifying': '<i class="fas fa-check-circle"></i>',
            'completed': '<i class="fas fa-check"></i>',
            'stopped': '<i class="fas fa-stop"></i>',
            'stopping': '<i class="fas fa-spinner fa-spin"></i>',
            'error': '<i class="fas fa-exclamation-triangle"></i>',
            'unknown': '<i class="fas fa-question-circle"></i>'
        };
        
        return icons[status] || icons.unknown;
    }
    
    capitalizeFirstLetter(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    }
    
    escapeHTML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    // Check if a file is a video file based on extension
    isVideoFile(filename) {
        if (!filename) return false;
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        return videoExtensions.includes(ext);
    }
    
    // Log handling
    addLogEntry(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const logEntry = { timestamp, message, level };
        
        // Add to logs array (limit to 1000 entries)
        this.logs.unshift(logEntry);
        if (this.logs.length > 1000) {
            this.logs.pop();
        }
        
        // Update the UI
        this.updateLogs();
    }
    
    updateLogs() {
        if (!this.formattedLogs) return;
        
        // Update formatted logs with colored log levels
        this.formattedLogs.innerHTML = this.logs.map(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            return `
                <div class="log-entry log-${log.level}">
                    <span class="log-time">${time}</span>
                    <span class="log-level">[${log.level.toUpperCase()}]</span>
                    <span class="log-message">${this.escapeHTML(log.message)}</span>
                </div>
            `;
        }).join('');
    }
    
    clearLogs() {
        this.logs = [];
        this.updateLogs();
        this.addLogEntry('Logs cleared', 'info');
    }
    
    toggleLogs() {
        const logsSection = document.getElementById('logs-section');
        if (logsSection) {
            logsSection.classList.toggle('expanded');
            
            if (this.toggleLogsBtn) {
                const isExpanded = logsSection.classList.contains('expanded');
                this.toggleLogsBtn.innerHTML = isExpanded ? 
                    '<i class="fas fa-chevron-down"></i> Hide Logs' : 
                    '<i class="fas fa-chevron-up"></i> Show Logs';
            }
        }
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new WebTorrentApp();
});
