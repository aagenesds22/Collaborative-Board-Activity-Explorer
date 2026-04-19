# 🎨 Mural Board Activity Explorer API

A collaborative sticky note board API with real-time mutations powered by Last-Write-Wins CRDT (Conflict-free Replicated Data Type). Supports 120+ concurrent users with property-level conflict resolution via timestamp-based merges.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [REST API Endpoints](#rest-api-endpoints)
- [WebSocket (Socket.IO) API](#websocket-api-socketio)
- [Examples](#examples)
- [Testing with Postman](#testing-with-postman)
- [Error Handling](#error-handling)

---

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 20+ (for local development)
- npm 10+ (for local development)

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start development server
npm run dev
# API available at http://localhost:3000
# WebSocket gateway at ws://localhost:3000/board
```

### Docker

```bash
# Build and run container
docker-compose up --build

# Container exposes port 3000
# API: http://localhost:3000
# WebSocket: ws://localhost:3000/board
```

---

## Architecture Overview

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Applications                      │
├──────────────────────────┬──────────────────────────────────┤
│   REST (Read-Only)       │   WebSocket (Mutations)           │
│   (/api/notes/*)         │   (/board namespace)              │
└──────────┬───────────────┴──────────┬───────────────────────┘
           │                          │
      ┌────▼──────────────────────────▼─────┐
      │     NestJS Application Layer         │
      │  ┌─────────────────────────────────┐ │
      │  │   NotesController (REST)        │ │
      │  │   NotesGateway (WebSocket)      │ │
      │  └────────────┬──────────────────┘ │
      │               │                     │
      │  ┌────────────▼──────────────────┐  │
      │  │   NoteService                 │  │
      │  │   CrdtService                 │  │
      │  │   EventEmitter2               │  │
      │  └────────────┬──────────────────┘  │
      └───────────────┼──────────────────────┘
                      │
      ┌───────────────▼──────────────────────┐
      │  Repository Layer (CRDT-Aware)       │
      │  ┌──────────────────────────────┐   │
      │  │ InMemoryNoteRepository       │   │
      │  │ Map<id, StickyNoteCRDT>      │   │
      │  │  • LWWRegister<text>         │   │
      │  │  • LWWRegister<x, y>         │   │
      │  │  • LWWRegister<color>        │   │
      │  └──────────────────────────────┘   │
      └──────────────────────────────────────┘
```
---

## REST API Endpoints

All REST endpoints are **read-only**. Mutations are exclusively via WebSocket (see [WebSocket API](#websocket-api)).

### Base URL
```
http://localhost:3000/api/notes
```

### 1. Get All Notes (Paginated)

```http
GET /api/notes?offset=0&limit=10
```

**Query Parameters:**
| Parameter | Type | Default | Range | Description |
|-----------|------|---------|-------|-------------|
| `offset` | integer | 0 | ≥ 0 | Skip N notes from start |
| `limit` | integer | 10 | 1–1000 | Max results per page |

**Response:**
```json
{
  "items": [
    {
      "id": 1,
      "text": "Build analytics dashboard",
      "x": 145,
      "y": 230,
      "author": "Eve",
      "color": "yellow",
      "createdAt": "2026-04-01T08:15:00Z"
    }
    // ... 9 more items
  ],
  "total": 750,
  "offset": 0,
  "limit": 10
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes?offset=0&limit=5"
```

---

### 2. Get Single Note by ID

```http
GET /api/notes/:id
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | Note ID (1–750) |

**Response:**
```json
{
  "id": 1,
  "text": "Build analytics dashboard",
  "x": 145,
  "y": 230,
  "author": "Eve",
  "color": "yellow",
  "createdAt": "2026-04-01T08:15:00Z"
}
```

**Error (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Note not found"
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/1"
```

---

### 3. Get Notes by Author

```http
GET /api/notes/by-author/:author?offset=0&limit=10
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `author` | string | Author name (case-insensitive) |
| `offset` | integer | Pagination offset (default: 0) |
| `limit` | integer | Results per page (default: 10, max: 1000) |

**Response:**
```json
{
  "items": [
    { "id": 2, "text": "...", "author": "Alice", ... }
    // All notes by this author
  ],
  "total": 54,
  "offset": 0,
  "limit": 10
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/by-author/Alice?limit=5"
```

---

### 4. Get Notes by Color

```http
GET /api/notes/by-color/:color?offset=0&limit=10
```

**Parameters:**
| Parameter | Type | Allowed Values | Description |
|-----------|------|---|-------------|
| `color` | string | yellow, blue, pink, green, orange, purple, white | Color filter (case-insensitive) |
| `offset` | integer | ≥ 0 | Pagination offset |
| `limit` | integer | 1–1000 | Results per page |

**Response:**
```json
{
  "items": [
    { "id": 15, "text": "...", "color": "yellow", ... }
    // All yellow notes
  ],
  "total": 107,
  "offset": 0,
  "limit": 10
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/by-color/yellow"
```

---

### 5. Get Notes by Date Range

```http
GET /api/notes/by-date-range?start=2026-04-01T00:00:00Z&end=2026-04-07T23:59:59Z&offset=0&limit=10
```

**Query Parameters:**
| Parameter | Type | Format | Description |
|-----------|------|--------|-------------|
| `start` | string | ISO 8601 | Start date (inclusive) |
| `end` | string | ISO 8601 | End date (inclusive) |
| `offset` | integer | - | Pagination offset (default: 0) |
| `limit` | integer | - | Results per page (default: 10, max: 1000) |

**Response:**
```json
{
  "items": [
    { "id": 5, "text": "...", "createdAt": "2026-04-05T10:20:00Z", ... }
    // All notes created between start and end dates
  ],
  "total": 123,
  "offset": 0,
  "limit": 10
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/by-date-range?start=2026-04-01&end=2026-04-10&limit=20"
```

---

### 6. Get Recent Notes

```http
GET /api/notes/recent?limit=20
```

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 20 | 1000 | Number of recent notes to return |

**Response:**
```json
[
  { "id": 750, "text": "...", "createdAt": "2026-04-18T14:50:00Z", ... },
  { "id": 749, "text": "...", "createdAt": "2026-04-18T14:48:00Z", ... }
  // Most recent notes first
]
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/recent?limit=5"
```

---

### 7. Get Statistics

```http
GET /api/notes/stats
```

**Response:**
```json
{
  "totalNotes": 750,
  "uniqueAuthors": 10,
  "uniqueColors": 7,
  "notesPerAuthor": {
    "Alice": 54,
    "Bob": 72,
    "Charlie": 68,
    "Diana": 80,
    "Eve": 85,
    "Frank": 91,
    "Grace": 78,
    "Henry": 69,
    "Ivy": 75,
    "Jack": 78
  },
  "notesPerColor": {
    "yellow": 107,
    "blue": 115,
    "pink": 92,
    "green": 129,
    "orange": 97,
    "purple": 105,
    "white": 94
  }
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/stats"
```

---

### 8. Get Statistics by Author

```http
GET /api/notes/stats/by-author
```

**Response:**
```json
{
  "Alice": 54,
  "Bob": 72,
  "Charlie": 68,
  "Diana": 80,
  "Eve": 85,
  "Frank": 91,
  "Grace": 78,
  "Henry": 69,
  "Ivy": 75,
  "Jack": 78
}
```

**Example:**
```bash
curl "http://localhost:3000/api/notes/stats/by-author"
```

---

## WebSocket API (Socket.IO)

WebSocket connections enable **real-time collaborative mutations** with CRDT-based conflict resolution. Use Socket.IO to connect and subscribe to events.

### Connection

**IMPORTANT: All connections must use the `/board` namespace**

The backend is configured to listen exclusively on the `/board` namespace. Connections to the root path (e.g., `localhost:3000` without `/board`) will silently fail—events will be dropped and you'll see no errors.

#### For Postman / WebSocket Clients:

**Connection URL:** `ws://localhost:3000/board` (or `http://localhost:3000/board` for polling)

The namespace `/board` is automatically included in the URL path, not added separately.

### Events Overview

| Event | Direction | Purpose | Payload |
|-------|-----------|---------|---------|
| `note.update` | → Server | Send mutation | { noteId, property, value, clientTimestamp, clientId } |
| `note.mutated` | ← Server | Mutation accepted | { noteId, property, mergedState, clientId, ... } |
| `note.conflict` | ← Server | Mutation rejected (stale) | { noteId, property, reason, currentState, ... } |
| `note.error` | ← Server | Validation error | { message, noteId, property, ... } |

---

### 1. Update a Note Property (Mutation)

**Send Event:**
```javascript
socket.emit('note.update', {
  noteId: 1,
  property: 'text',           // One of: 'text', 'x', 'y', 'color'
  value: 'Updated text here',
  clientTimestamp: Date.now(),
  clientId: 'user-123'        // Your unique client identifier
});
```

**Payload Schema:**
```typescript
{
  noteId: number;              // ID of the note to update (1–750)
  property: 'text' | 'x' | 'y' | 'color';
  value: any;                  // Type depends on property:
                               // - text: string (max 5000 chars)
                               // - x, y: number (0–10000)
                               // - color: string (yellow|blue|pink|green|orange|purple|white)
  clientTimestamp: number;     // Unix milliseconds (client-generated)
                               // Server validates: |clientTs - serverNow| ≤ 30 seconds
  clientId: string;            // Client identifier for tracing (optional, uses socket.id if omitted)
}
```

**Success Response (`note.mutated`):**
```javascript
socket.on('note.mutated', (payload) => {
  console.log('Mutation accepted:', payload);
  // Output:
  // {
  //   noteId: 1,
  //   property: 'text',
  //   mergedState: {
  //     id: 1,
  //     text: 'Updated text here',
  //     x: 145,
  //     y: 230,
  //     author: 'Eve',
  //     color: 'yellow',
  //     createdAt: '2026-04-01T08:15:00Z'
  //   },
  //   clientId: 'user-123',
  //   clientTimestamp: 1713603900100,
  //   serverTimestamp: 1713603900105
  // }
});
```

**Stale Mutation Response (`note.conflict`):**

If a more recent mutation already exists on the server, the operation is rejected:

```javascript
socket.on('note.conflict', (payload) => {
  console.log('Mutation rejected (stale):', payload);
  // Output:
  // {
  //   noteId: 1,
  //   property: 'text',
  //   reason: 'Operation older than current state',
  //   currentState: { /* authoritative note state */ },
  //   clientTimestamp: 1713603899000,  // Your old timestamp
  //   serverTimestamp: 1713603900500
  // }
  
  // Action: Client should accept currentState as authoritative
});
```

**Error Response (`note.error`):**

Validation failures trigger error events:

```javascript
socket.on('note.error', (payload) => {
  console.error('Mutation error:', payload);
  // Examples:
  // {
  //   message: 'Timestamp drift exceeds threshold (45000ms > 30000ms). Client may need NTP synchronization.',
  //   noteId: 1,
  //   property: 'text',
  //   timestamp: 1713603900105
  // }
  //
  // {
  //   message: 'Cannot mutate property "author". Mutable properties: text, x, y, color. Immutable: id, author, createdAt.',
  //   noteId: 1,
  //   property: 'author',
  //   timestamp: 1713603900105
  // }
  //
  // {
  //   message: 'color must be one of: yellow, blue, pink, green, orange, purple, white',
  //   noteId: 1,
  //   property: 'color',
  //   timestamp: 1713603900105
  // }
});
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | GET /api/notes/1 returns valid note |
| 400 | Bad Request | Query parameter invalid (limit=abc) |
| 404 | Not Found | GET /api/notes/999 (note doesn't exist) |
| 500 | Server Error | Unexpected error |

### HTTP Error Response

```json
{
  "statusCode": 400,
  "message": "Validation failed: limit must be an integer between 1 and 1000",
  "error": "Bad Request"
}
```

### WebSocket Error Codes

| Event | Scenario | Message | Action |
|-------|----------|---------|--------|
| `note.error` | Invalid property | "Cannot mutate property 'author'" | Validate property name |
| `note.error` | Invalid value type | "text must be a string" | Check value type |
| `note.error` | Value out of range | "x must be between 0 and 10000" | Validate bounds |
| `note.error` | Timestamp drift | "Timestamp drift exceeds threshold" | Sync client clock via NTP |
| `note.error` | Note not found | "Note 999 not found" | Verify noteId exists |
| `note.conflict` | Stale mutation | "Operation older than current state" | Accept currentState as authoritative |

---

## Examples

### Scenario 1: Simple Mutation (JavaScript)

```javascript
const io = require('socket.io-client');

const socket = io('http://localhost:3000', { namespace: '/board' });

socket.on('connect', () => {
  // Update note 5: change text
  socket.emit('note.update', {
    noteId: 5,
    property: 'text',
    value: 'My updated text',
    clientTimestamp: Date.now(),
    clientId: 'web-client-user-1'
  });
});

socket.on('note.mutated', (data) => {
  console.log('✓ Update accepted');
  console.log(`Note ${data.noteId}: "${data.mergedState.text}"`);
});

socket.on('note.error', (err) => {
  console.error('✗ Mutation failed:', err.message);
});
```

### Scenario 2: Concurrent Edits (No Data Loss)

```javascript
// Scenario: Two clients editing the same note at the same time

// Client A (Tokyo): Updates text
socket.emit('note.update', {
  noteId: 1,
  property: 'text',
  value: 'Client A text',
  clientTimestamp: 1713603900100,  // 10:00:00.100
  clientId: 'client-A'
});

// Client B (Reykjavik): Updates x coordinate
socket.emit('note.update', {
  noteId: 1,
  property: 'x',
  value: 500,
  clientTimestamp: 1713603899500,  // 9:59:59.500 (slightly earlier)
  clientId: 'client-B'
});

// Result: BOTH UPDATES PERSIST
// ✓ note.text = 'Client A text' (higher timestamp wins)
// ✓ note.x = 500 (Client B's update on different property)

socket.on('note.mutated', (data) => {
  // Two events fired:
  // 1. { noteId: 1, property: 'text', ... }
  // 2. { noteId: 1, property: 'x', ... }
  
  console.log('Final state:', {
    text: 'Client A text',  // From Client A's update
    x: 500,                 // From Client B's update
    y: 230                  // Unchanged
  });
});
```

### REST API for Analytics

```bash
# Get all notes (paginated)
curl "http://localhost:3000/api/notes?limit=20"

# Get statistics
curl "http://localhost:3000/api/notes/stats"

# Get notes by author
curl "http://localhost:3000/api/notes/by-author/Alice"

# Get recent notes
curl "http://localhost:3000/api/notes/recent?limit=10"

# Filter by date range
curl "http://localhost:3000/api/notes/by-date-range?start=2026-04-01&end=2026-04-10"
```
---

## Testing with Postman

Postman (v10.0+) has native WebSocket support, making it ideal for testing real-time mutation endpoints.

### Prerequisites

1. **Postman Version:** Download v10.0 or later from https://www.postman.com/downloads/
2. **Running API:** Start the API with `docker-compose up` (listening on `http://localhost:3000`)
3. **Basic Knowledge:** Familiarity with Postman's UI

### Step 1: Create a New Socket.IO Request

1. Open Postman
2. Click **New** → **Socket.IO Request**
3. Enter URL: `ws://localhost:3000/board`
4. Click **Connect**

You should see: `Connected` in green with connection info displayed.

**Alternative (Direct WebSocket):**
```
ws://localhost:3000/socket.io/?EIO=4&transport=websocket
```

---

### Step 2: Send a Mutation Event (Using Postman's Socket.IO UI)

Postman's Socket.IO option automatically handles the Engine.IO protocol layer—you do NOT need to manually add the `2[...]` wrapper. Simply provide the event name and JSON payload separately.

To update a note, send a `note.update` event with the correct timestamp.

#### Send a Mutation: Update Note Text

**Event Name:** `note.update`

**Payload (JSON):**
```json
{
  "noteId": 1,
  "property": "text",
  "value": "Updated text here",
  "clientTimestamp": <CURRENT_UNIX_TIMESTAMP_MS>,
  "clientId": "postman-test"
}
```

**⚠️ CRITICAL: Timestamp Validation**

The CRDT engine validates clock drift strictly: `|clientTimestamp - serverTime| ≤ 30 seconds`

**DO NOT copy-paste a static timestamp from this documentation.** It will be rejected as stale.

**Use a current timestamp:**
- Node.js: `Date.now()`
- Postman: Use the `{{$timestamp}}` variable or paste the current Unix milliseconds
- Browser console: `Date.now()`

**Example with current timestamp (NOW):**
```json
{
  "noteId": 1,
  "property": "text",
  "value": "Test mutation",
  "clientTimestamp": 1713603965000,
  "clientId": "postman-test"
}
```

**Expected Success Response:** You'll receive a `note.mutated` event confirming the mutation was accepted.

**If you see `note.conflict` instead:** Your timestamp was older than the current server state. This is expected if you used an outdated timestamp—accept the `currentState` from the conflict event as authoritative.

---

### Step 3: Configure Listeners (Important for Testing)

Socket.IO clients only display incoming events if you're actively listening for them. If you send a `note.update` and the server responds with `note.error`, you **won't see it** unless you have a listener configured.

#### In Postman:

Use the "Listen" tab or add event listeners:

1. **For mutation responses**, listen for:
   - `note.mutated` (mutation accepted)
   - `note.conflict` (mutation rejected as stale)
   - `note.error` (validation failed)

#### Test Checklist:

After sending any event, check the message history for:
- ✅ **Expected response event** (e.g., `note.mutated`, `board.state`)
- ❌ **Or error event** (e.g., `note.error`, `note.conflict`)

If you see neither, verify:
1. You're connected to `ws://localhost:3000/board`
2. Event name is spelled correctly
3. Payload is valid JSON
4. `clientTimestamp` is a current Unix millisecond value (not from documentation)

---

### Step 4: Testing Scenarios in Postman

#### Scenario 1: Simple Property Update

1. **Update text:**
   - **Event Name:** `note.update`
   - **Payload:**
   ```json
   {"noteId":5,"property":"text","value":"New text","clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"postman-1"}
   ```
   - Expect: `note.mutated` event

2. **Update x coordinate:**
   - **Event Name:** `note.update`
   - **Payload:**
   ```json
   {"noteId":5,"property":"x","value":500,"clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"postman-2"}
   ```
   - Expect: `note.mutated` event (both updates coexist)

---

#### Scenario 2: Concurrent Edits (No Data Loss)

**Open two WebSocket connections in separate Postman tabs.**

**Tab 1 (Client A):**
- **Event Name:** `note.update`
- **Payload:**
```json
{"noteId":10,"property":"text","value":"Client A text","clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"client-A"}
```

**Tab 2 (Client B):**
- **Event Name:** `note.update`
- **Payload:**
```json
{"noteId":10,"property":"x","value":750,"clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"client-B"}
```

**Result:**
- Both mutations appear as `note.mutated` ✓
- Final state has both: text from A, x from B
- Verify by requesting state:
  - **Event Name:** `note.getState`
  - **Payload:** `{"noteId":10}`

---

#### Scenario 3: Stale Mutation Rejection

1. **First update (accepted):**
   - **Event Name:** `note.update`
   - **Payload:**
   ```json
   {"noteId":15,"property":"text","value":"First","clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"first"}
   ```
   - Result: ✅ `note.mutated`

2. **Second update with older timestamp (rejected):**
   - **Event Name:** `note.update`
   - **Payload:**
   ```json
   {"noteId":15,"property":"text","value":"Second","clientTimestamp":1000000000000,"clientId":"second"}
   ```
   - Result: ⚠️ `note.conflict` (your timestamp is older than the first update)

---

#### Scenario 4: Validation Error - Invalid Property

- **Event Name:** `note.update`
- **Payload:**
```json
{"noteId":1,"property":"author","value":"Eve","clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"test"}
```

Expected Error Event (`note.error`):
```json
{"message":"Cannot mutate property \"author\". Mutable properties: text, x, y, color. Immutable: id, author, createdAt.","noteId":1,"property":"author","timestamp":1713603965000}
```

---

#### Scenario 5: Validation Error - Invalid Color

- **Event Name:** `note.update`
- **Payload:**
```json
{"noteId":1,"property":"color","value":"invalid_color","clientTimestamp":<CURRENT_UNIX_TIMESTAMP_MS>,"clientId":"test"}
```

Expected Error Event (`note.error`):
```json
{"message":"color must be one of: yellow, blue, pink, green, orange, purple, white","noteId":1,"property":"color","timestamp":1713603965000}
```

---

#### Scenario 6: Validation Error - Timestamp Drift

- **Event Name:** `note.update`
- **Payload (using timestamp from 50 years ago):**
```json
{"noteId":1,"property":"text","value":"Test","clientTimestamp":1234567890000,"clientId":"test"}
```

Expected Error Event (`note.error`):
```json
{"message":"Timestamp drift exceeds threshold (48967316210105ms > 30000ms). Client may need NTP synchronization.","noteId":1,"property":"text","timestamp":1713603965000}
```

---

### Postman Collection Template

Create a **Postman Collection** with pre-built requests for easy testing:

```json
{
  "info": {
    "name": "Mural Board WebSocket API",
    "description": "CRDT-based collaborative sticky notes"
  },
  "item": [
    {
      "name": "Update Note Text",
      "request": {
        "method": "GET",
        "url": "ws://localhost:3000/socket.io/?EIO=4&transport=websocket",
        "description": "Mutation payload: {\"noteId\":1,\"property\":\"text\",\"value\":\"New text\",\"clientTimestamp\":1713603900100,\"clientId\":\"postman\"}"
      }
    },
    {
      "name": "Update Note X Coordinate",
      "request": {
        "method": "GET",
        "url": "ws://localhost:3000/socket.io/?EIO=4&transport=websocket",
        "description": "Mutation payload: {\"noteId\":1,\"property\":\"x\",\"value\":500,\"clientTimestamp\":1713603900100,\"clientId\":\"postman\"}"
      }
    },
    {
      "name": "Update Note Color",
      "request": {
        "method": "GET",
        "url": "ws://localhost:3000/socket.io/?EIO=4&transport=websocket",
        "description": "Mutation payload: {\"noteId\":1,\"property\":\"color\",\"value\":\"pink\",\"clientTimestamp\":1713603900100,\"clientId\":\"postman\"}"
      }
    }
  ]
}
```

---

### Tips & Troubleshooting

#### ✅ Connection Test
If you see `Connected` in green, the WebSocket is working.

#### ❓ "Cannot connect" or "Connection failed"
- Verify API is running: `docker-compose up`
- Check port: `curl http://localhost:3000` should return 200
- Try using HTTP polling URL instead: `http://localhost:3000/socket.io/?EIO=4&transport=polling`

#### ❓ "Message not received" or "No response"
- Verify message format: Should start with `2["eventName",...`
- Check `clientTimestamp`: Use `Date.now()` (current Unix milliseconds)
- Verify `noteId` exists (1–750 for seed data)

#### ❓ Getting "Timestamp drift exceeds threshold" error
- Your system clock is out of sync
- Update your computer's time to sync with NTP
- Or use `Date.now()` to get current server time

#### ✅ Seeing Multiple Events
This is normal! When you update a note, you may see:
1. Mutation broadcast to all connected clients
2. Potentially a conflict event if operation was stale
3. Error event if validation failed

Each connection receives all events published to that room.

---

### Advanced: Testing 120+ Concurrent Users

For stress testing, use Postman's **Collection Runner** with multiple iterations:

1. **Create a Collection** with mutation requests
2. **Open Collection Runner** (top left in Postman)
3. **Select your collection** and set **Iterations: 120**
4. **Run** (sends 120 sequential requests with configurable delays)

Or use **Newman** (Postman CLI) for scripted testing:

```bash
npm install -g newman

newman run postman-collection.json \
  --iterations 120 \
  --delay-request 10
```

This simulates 120 concurrent users each sending mutations ~every 10ms.

---

## License

MIT

---