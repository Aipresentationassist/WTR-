# WebTorrent App Changelog

## [Unreleased]

### Added
- WebSocket connection management with automatic reconnection
- Ping/pong mechanism for connection health monitoring
- Robust error handling and logging for WebSocket communication
- Support for starting downloads via magnet links
- File listing and download progress tracking
- User interface for monitoring active downloads and downloaded files
- Logging system with different log levels (info, warning, error)

### Fixed
- Fixed WebSocket message handling to prevent "Unknown Message Type" errors
- Resolved issue with download buttons not responding
- Improved error handling for invalid magnet links
- Fixed connection state management to prevent multiple concurrent reconnection attempts
- Added proper cleanup of WebSocket resources on disconnection

### Changed
- Improved WebSocket message structure for better reliability
- Enhanced logging for debugging purposes
- Optimized reconnection logic with exponential backoff
- Updated UI to provide better feedback during download operations
- Improved error messages for better user understanding

### Security
- Added input validation for magnet links
- Implemented proper error handling to prevent information leakage
- Added rate limiting for reconnection attempts

## [0.1.0] - Initial Release
- Basic WebTorrent functionality
- WebSocket server for real-time updates
- Simple web interface for managing downloads
