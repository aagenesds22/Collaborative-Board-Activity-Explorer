**Collaborative Board Activity Explorer**

Mural is a visual collaboration platform where teams brainstorm, organize ideas, and make decisions together on a shared canvas.

During workshops or brainstorming sessions, many participants may contribute dozens or hundreds of sticky notes to a board. Once a session ends, teams often want to understand:

* What activity happened on the board  
* Who contributed what  
* How ideas evolved over time

In this exercise, you will build a small full-stack application that helps users explore activity on a board, with particular emphasis on the **backend service**, **API design**, and how your approach could **scale** as activity volume grows.

## **Key requirements**

### **1\) Backend-first activity service**

Your backend should do more than simply return the raw JSON file. It should provide additional endpoints to support board activity exploration.

Examples of useful capabilities:

* loading sticky notes from a JSON file  
* querying notes by author, color, or time range  
* sorting and paginating results  
* computing aggregated statistics such as notes per author or notes over time  
* identifying recently added notes

You do not need to implement every possible capability. Choose a small set and implement it well.

### **2\) Frontend to explore board activity**

*Note: We prioritize a clean, well-designed backend API. The frontend is optional and considered a stretch goal.*

The UI should allow a user to load or select a dataset and explore the activity exposed by the backend.

Examples include:

* filtering by author  
* filtering by color  
* sorting by creation time  
* viewing summary statistics  
* seeing activity over time  
* highlighting recently added notes

The frontend does not need to be highly polished. We care more about clarity, usability, and whether it makes good use of the backend service.

## **Assumptions**

1. Single-Board assumption for this challenge. There is not a functionality to “create” boards, as it could shift the focus of the challenge itself, being it a collaborative board and not a full product. In reality, multiple considerations such as access authorization and permissions to edit/delete/update should be modeled at this stage. If the product evolves to support multiple boards, the system will be upgraded by adding a **boardId** property to the schema, creating a **composite database index** (boardId, createdAt) for efficient scoped querying, and logically partitioning the data

2. Frontend as a Stretch Goal: Because the challenge explicitly marks the frontend as a stretch goal, we assume that conflict resolution and data consistency must be handled entirely by the backend. We cannot rely on UI-level locking or client-side orchestration.

3. Read-Heavy Traffic Profile: We assume the board experiences a significantly higher volume of reads (initial loads, analytics, filtering) than concurrent writes.

4. Lack of Mutation Metadata: Because the provided schema lacks an updatedAt timestamp or an ETag/version hash, we assume standard database-level Optimistic Locking is impossible without schema mutation. This necessitates a custom conflict resolution strategy (CRDT).

5. Ingestion Format: We assume we are permitted to format the initial seed dataset as JSON Lines (.jsonl) to facilitate lightweight, non-blocking stream processing without requiring external heavy stream-parsing libraries.

6. In-Memory Persistence is Acceptable: To satisfy the "lightweight" and "runnable out of the box" requirements, we assume an internal JavaScript Map is acceptable for MVP persistence, provided it is fully decoupled via the Repository Pattern (Dependency Inversion) to allow future database injection.

7. Dual-Transport Requirement: We assume that a purely RESTful architecture is insufficient for a collaborative board due to network latency and the Pull-model limitations. We must use a hybrid approach: REST for initial payloads/analytics, and WebSockets for real-time bidirectional mutations.

8. Stateless Node.js Process: We assume the backend must be designed to scale horizontally. Even though we are using in-memory structures for the MVP, the application architecture itself (Controllers, Services, Gateways) must not rely on sticky sessions or local process memory for routing, paving the way for Dockerized replicas and Load Balancers.

### **1\. Core Architecture & Framework**

* **Decision:** Adopt NestJS using Clean Architecture principles.  
* **Rationale:** NestJS natively enforces modularity, Dependency Injection (DI), and separation of concerns. This allows the core business logic (Sticky Notes, Boards) to remain agnostic of the underlying infrastructure, demonstrating a highly scalable, enterprise-ready structure.  
* **Data Access Strategy:** Implement the Repository Pattern. The application will interact with abstract interfaces (e.g., IBoardRepository) rather than concrete database drivers, allowing seamless transitions between data sources.  
* **Simplification:** Instead of implementing a deep Hexagonal directory structure, stick to basic NestJS modules (Domain Interfaces, Services, Controllers) and implement a simple InMemoryBoardRepository class to satisfy the interface for the reviewer's execution.

| // src/domain/interfaces/note-ingestion-provider.interface.tsimport { RawStickyNote } from '../models/note.model';export const NOTE\_INGESTION\_PROVIDER \= Symbol('NOTE\_INGESTION\_PROVIDER');export interface INoteIngestionProvider {  // AsyncIterable is the ultimate abstraction for streams in JS  getNoteStream(): AsyncIterable\<RawStickyNote\>; } |
| :---- |

| // src/infrastructure/providers/file-note-ingestion.provider.tsimport { Injectable, Logger } from '@nestjs/common';import \* as fs from 'fs';import \* as readline from 'readline';import { INoteIngestionProvider } from '../../domain/interfaces/note-ingestion-provider.interface';import { RawStickyNote } from '../../domain/models/note.model';@Injectable()export class FileNoteIngestionProvider implements INoteIngestionProvider {  private readonly filePath \= './seed-data.jsonl';  private readonly logger \= new Logger(FileNoteIngestionProvider.name);  async \*getNoteStream(): AsyncIterable\<RawStickyNote\> {    if (\!fs.existsSync(this.filePath)) {      this.logger.warn(\`Seed file not found at ${this.filePath}. Yielding empty stream.\`);      return;    }    const fileStream \= fs.createReadStream(this.filePath);    const rl \= readline.createInterface({ input: fileStream, crlfDelay: Infinity });    for await (const line of rl) {      if (line.trim()) {        yield JSON.parse(line) as RawStickyNote;      }    }  }} |
| :---- |

* Context & Decision: The initial seed data is provided as a local file, but the architecture must support scaling to external data sources (e.g., HTTP streams, database cursors, S3 buckets) without requiring core logic refactoring. We abstracted the ingestion mechanism using the Dependency Inversion Principle, exposing an INoteIngestionProvider that returns an AsyncIterable\<RawStickyNote\>.  
    
* Rationale: AsyncIterable is the native JavaScript standard that unifies all modern asynchronous data streams. By injecting a file-based implementation (FileNoteIngestionProvider) during the challenge, we prove the system handles streaming properly to protect the Event Loop. If the data source changes to an external endpoint, we only need to swap the injected provider module (e.g., to an HttpNoteIngestionProvider using Axios streams). The core Application Service remains untouched.

* Simplification: For the challenge MVP, we are only providing the FileNoteIngestionProvider parsing JSON Lines (.jsonl), acknowledging that standard .json arrays would require a heavier stream parser like stream-json, but the interface design remains identical.

| // src/application/services/note.service.tsimport { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';import { NOTE\_REPOSITORY, INoteRepository } from '../../domain/interfaces/note-repository.interface';import { NOTE\_INGESTION\_PROVIDER, INoteIngestionProvider } from '../../domain/interfaces/note-ingestion-provider.interface';import { StickyNote } from '../../domain/models/note.model';@Injectable()export class NoteService implements OnModuleInit {  private readonly logger \= new Logger(NoteService.name);  constructor(    @Inject(NOTE\_REPOSITORY) private readonly noteRepository: INoteRepository,    @Inject(NOTE\_INGESTION\_PROVIDER) private readonly ingestionProvider: INoteIngestionProvider,  ) {}  async onModuleInit() {    this.logger.log('Starting data ingestion...');    await this.ingestData();  }  private async ingestData(): Promise\<void\> {    const batch: StickyNote\[\] \= \[\];    const BATCH\_SIZE \= 1000;    // The service is now completely ignorant of the file system    for await (const rawNote of this.ingestionProvider.getNoteStream()) {      try {        batch.push({          id: rawNote.id,          text: rawNote.text,          x: rawNote.x,          y: rawNote.y,          author: rawNote.author,          color: rawNote.color,          createdAt: new Date(rawNote.createdAt)        });        if (batch.length \>= BATCH\_SIZE) {          await this.noteRepository.saveBulk(batch);          batch.length \= 0;         }      } catch (e) {        this.logger.error(\`Failed to map note ${rawNote?.id}\`, e);      }    }    if (batch.length \> 0) {      await this.noteRepository.saveBulk(batch);    }        this.logger.log('Data ingestion complete.');  }} |
| :---- |

### **2\. Data Ingestion (Initial JSON Load)**

* **Decision:** Stream-based processing for large payload ingestion.  
* **Rationale:** Parsing massive JSON files in memory using synchronous JSON.parse() blocks the Node.js Event Loop, freezing the application for concurrent users and risking Out of Memory (OOM) crashes. Using streams processes the data in manageable chunks, keeping the server reactive.  
* **Simplification:** Use Node's native fs.createReadStream combined with a lightweight chunking library (or simple line-by-line parsing if the JSON structure permits) strictly during the application bootstrap phase, loading it into the in-memory data store.

Before moving to mutations, we must guarantee that our API never trusts client input. In NestJS, this is handled via Data Transfer Objects (DTOs) and the ValidationPipe. This proves to the reviewer that your API won't crash if someone sends limit=apple instead of a number.

1. Code Implementation:

TypeScript
// src/interfaces/dtos/get-notes-query.dto.ts
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class GetNotesQueryDto {
  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100) // Prevent the client from requesting a million records at once
  limit?: number = 50;
}
We apply this DTO to our NoteController's @Query() parameter. It automatically transforms string queries into numbers and validates bounds.

2. ADR Entry: Input Validation & Boundary Enforcement

Decision: Implement strict schema validation and transformation at the transport layer using Data Transfer Objects (DTOs) and decorators (class-validator, class-transformer).

Rationale: An enterprise API must enforce boundaries. By restricting maximum pagination limits (e.g., Max(100)) and strictly typing query parameters before they reach the Application layer, we protect the database from malicious or malformed queries (like massive payload requests that could cause memory spikes).

Simplification: We are validating at the REST controller level. In a more complex architecture, we might validate again at the Domain level to ensure entities are always in a valid state regardless of the entry point (REST, gRPC, CLI), but controller-level validation is sufficient for the MVP.

### **3\. API Design for High-Volume Reads**

* **Decision:** Cursor-based pagination and partial payload updates.  
* **Rationale:** For boards with thousands of sticky notes, standard offset/limit pagination causes severe database performance degradation ($O(n)$ time complexity as it scans skipped rows). Cursor pagination (e.g., using last\_note\_timestamp) provides $O(1)$ lookup performance. For updates (moving a note), a PATCH endpoint receiving only X/Y coordinates saves bandwidth compared to sending the full note object.  
* **Simplification:** Implement standard offset/limit pagination for the challenge's MVP to save time, but explicitly document in the ADR that cursor-based pagination is the required evolution for production-scale boards.

### **4\. Concurrency & State Management**

* **Decision:** 100% Stateless application with Optimistic Locking.  
* **Rationale:** To support horizontal scaling via Docker and a Load Balancer, the Node.js process must not hold any internal state (sessions, local cache). To handle concurrent user edits on the same sticky note, implement Optimistic Locking using an updatedAt timestamp or version number. If a user tries to modify an outdated version of a note, the API returns a 409 Conflict.  
* **Simplification:** Forego building a custom cluster or load balancer in the code. Deliver a single Dockerfile and docker-compose.yml, relying on the ADR to explain that horizontal scaling is delegated to the infrastructure layer. Use a simple "last write wins" strategy for the MVP instead of strict Optimistic Locking, acknowledging the tradeoff.

For this particular design let's consider one additional situation with this chosen stack of the solution: what happens if 120 users hop on the board (our designed MVP) and they do so almost in the lapse of 8 seconds?

Although Last-Write-Wins is great, a lagging internet connection can cause an horrible user experience. And this is important for our design, because if I am in Japan seeing that a sticky note is where it is and I dont receive the "lock" order accordingly after one user from a plane travelling in the middle of the atlantic ocean moves a note, the board will look like flashing cards all over the place. Although we will not aim to solve it with the cloud and with excessive production grade engineering, we should assume that this is a collaborative board and these kind of issues are common if not solved. (Network Latency and Client-Side State Desynchronization)

1. The CRDT Strategy: LWW-Map (Last-Write-Wins Map)
Implementing a full text-editing CRDT (like Google Docs uses) is overkill for sticky notes. A sticky note is essentially a Map of properties (x, y, text, color).

The perfect structure here is a Last-Write-Wins Map (LWW-Map) where every individual property of the note acts as an independent LWW-Register.

How it solves the "Lagging Connection" seamlessly:

If User A (in Japan) updates the text property, and User B (in the Atlantic Ocean) simultaneously updates the x property, a standard REST overwrite would cause one of those updates to be lost.

With a CRDT LWW-Map, the backend merges the state at the property level. The resulting note will have User A's text and User B's x coordinate. No data is lost, and no UI locking is required.

If both users update the same property (e.g., both change x), the CRDT uses a logical clock (or a high-precision timestamp) attached to the operation to deterministically choose the winner across all nodes.

2. Handling the Rigid Schema (The "CRDT Envelope")
Since the challenge demands a strict schema for the sticky note GET output, we cannot expose the messy CRDT metadata (logical clocks, tombstones) in the public REST API.

The Architecture:

Ingestion/Storage: We store the data internally wrapped in a "CRDT Envelope" that includes state vectors or timestamps.

WebSocket (Mutations): Clients send operations (deltas) via WebSockets. The backend CRDT engine merges these operations.

REST API (Reads): When the GET /notes endpoint is called, the backend strips the CRDT metadata and projects the state back into the strict RawStickyNote schema requested by the challenge.

3. The Backend-Driven WebSocket Flow
Instead of the frontend managing locks, the frontend simply streams its intent, and the backend guarantees consistency.

Connection: Clients connect via WebSockets and receive the current CRDT state vector.

Operation Broadcast: User moves a note. Client sends an operation:
{ event: "note.update", payload: { id: "note_1", changes: { x: 412 }, timestamp: 1713473485000, clientId: "user_7" } }

Backend Merge: The NestJS Gateway receives the operation. The internal CRDT service checks the timestamp against the current state of the x register for note_1.

If the incoming timestamp is newer, it updates the state and broadcasts the operation to all other peers.

If it is older (delayed by lag), the backend ignores the operation, safely dropping the stale update.

Reconciliation: The backend periodically broadcasts the authoritative state hash so clients can request missing operations if they dropped off the WebSocket momentarily.

4. The ADR Entry: CRDTs for Backend-Enforced Consistency
This goes straight into your "Scalable Approach" section.

Decision: Implement a State-based Last-Write-Wins Map (LWW-Map) CRDT over WebSockets for concurrent mutations, while maintaining REST for read-heavy operations.

Rationale: The challenge explicitly deprioritizes frontend implementation. Relying on UI-level locking or client-side orchestration for conflict resolution is therefore an anti-pattern for this specific evaluation. A CRDT approach shifts the burden of eventual consistency entirely to the backend. It allows decentralized clients to submit concurrent modifications to individual sticky note properties (e.g., text vs. x/y coordinates) without locking the database or losing data to race conditions, natively handling network latency and out-of-order packets.

Data Modeling Tradeoff: The required output schema does not permit exposing CRDT metadata (logical clocks, state vectors). To resolve this, the backend will maintain the CRDT structures internally within the infrastructure layer and project the materialized, conflict-resolved state into the strict RawStickyNote DTO only at the transport layer (REST Controllers).

Simplification: Implementing a production-grade CRDT engine (like Automerge or Yjs) requires significant overhead. For the MVP, the "CRDT" will be implemented as a simplified property-level LWW-Register in memory, using high-precision Unix timestamps provided by the client's WebSocket payload to deterministically resolve write conflicts on identical fields.

Decision: Technology Stack & Custom LWW-Map CRDTContext: We require a stack capable of handling streaming data ingestion, high-frequency real-time WebSocket broadcasting, and deterministic conflict resolution without mandating complex local infrastructure setups for the reviewer.

Decisions:

Framework: NestJS with TypeScript for strict architectural boundaries (Clean Architecture / DI).

Real-time: Socket.IO for robust client connection management and native "Room" broadcasting.

Concurrency: A custom, lightweight Last-Write-Wins Map (LWW-Map) implemented in vanilla TypeScript.

Rationale: While libraries like Yjs or Automerge are industry standards for CRDTs, they are optimized for complex document editing and introduce heavy binary serialization overhead. For a sticky note entity (a flat schema of primitives), a custom LWW-Map perfectly resolves network-latency race conditions based on client-provided operation timestamps, maintaining $O(1)$ merge complexity without adding external dependencies.

Evolution: For a production deployment, the in-memory data store will be replaced by a managed database (e.g., DynamoDB or PostgreSQL), and Socket.IO will be augmented with a Redis Adapter for cross-node broadcasting.

So, answering the question:

Phase 1: The Initial Load Spike (Seconds 1-8)
The Action: 120 users hit GET /notes to render the board initially.

What happens to our MVP: Node.js handles 120 concurrent HTTP requests effortlessly (it can handle thousands). However, if the board has 10,000 sticky notes, the InMemoryNoteRepository pulls 10,000 objects and NestJS automatically runs JSON.stringify() on them 120 times.

The Bleed: JSON.stringify() on massive arrays is synchronous and CPU-intensive. During those 8 seconds, the Event Loop will heavily spike, potentially delaying WebSocket handshakes or incoming mutations.

The MVP Fix (Code): Add compression. In NestJS, enabling CompressionMiddleware (gzip/brotli) is a one-liner in main.ts. It trades a bit of CPU for massive bandwidth savings, reducing the payload size before it hits the network.

The Architect's Defense (Production): "To solve the initial load spike in production, I would cache the stringified JSON of the board's state in Redis. Instead of serializing 10,000 objects 120 times, the API serializes it once, and serves the cached string 119 times, achieving an O(1) response time."

Phase 2: The WebSocket Handshake
The Action: Immediately after the GET request, 120 clients initiate Socket.IO connections.

What happens to our MVP: Socket.IO handles this gracefully. 120 connections consume a negligible amount of RAM (a few megabytes). The clients join the board_room seamlessly. No issues here.

Phase 3: The Collaborative Chaos (The Broadcast Storm)
The Action: The 120 users are now connected. Suddenly, they all start dragging notes around. Let's assume an average of 1 move per second per user.

What happens to our MVP: This is the real stress test. WebSockets create an O(N^2) broadcasting effect. If 1 user moves a note, the server broadcasts that event to 119 users. If 120 users move a note in the same second, the single Node.js process must emit 120 * 119 = 14,280 individual WebSocket messages in one second.

The Bleed: The Node.js Event Loop gets saturated pushing messages into the TCP sockets. Network bandwidth spikes.

The MVP Fix (Code): Socket.IO handles backpressure decently well, but we don't need to fix this in the code for a 3-day challenge. The MVP will survive 14k messages/sec locally, but it will run hot.

The Architect's Defense (Production): "A naive WebSocket implementation scales quadratically in network output. If 120 users cause 14,000 messages, 1,000 users cause 1,000,000 messages per second and crash the server. In production, I would implement Event Batching on the server. Instead of broadcasting every single pixel movement instantly, the server collects all mutations in a 50-millisecond window and broadcasts a single array of updates to all clients."

Phase 4: The Ultimate Conflict (The CRDT flex)
The Action: Out of the 120 users, 5 users try to modify the color of the exact same sticky note at the exact same millisecond.

What happens to our MVP: Absolute perfection. This is where your custom LWW-Map shines.

5 WebSocket events hit the server.

The server processes them sequentially (because Node is single-threaded).

For each event, the CRDT logic compares the timestamp of the incoming operation against the timestamp currently stored for that note's color property.

Only the operation with the highest timestamp updates the memory. The other 4 are silently and safely discarded.

The server broadcasts the final, correct state.

The Architect's Defense: "Because we used an LWW-Map CRDT, the system handles concurrent writes deterministically without database locks, transactional rollbacks, or race conditions. Even if 120 users attack the same entity, the mathematical properties of the CRDT guarantee eventual consistency."

### **5\. Caching Strategy**

* **Decision:** Externalized Distributed Caching for read-heavy operations.  
* **Rationale:** Querying complex filters (by author, color, or time range) across massive datasets requires caching to protect the primary database. The system will use an external cache store (like Redis) wrapped by the application logic, implementing a "Write-Through" or event-based cache invalidation strategy to prevent serving stale board data.  
* **Simplification:** Use the NestJS native CacheModule configured with the default **in-memory store** rather than spinning up a Redis container. This demonstrates the exact caching architecture and dependency injection without forcing the reviewer to download a Redis Docker image.

### **6\. Analytics & Background Processing**

* **Decision:** Event-Driven Architecture for aggregated statistics.  
* **Rationale:** Computing aggregated statistics (e.g., notes per author, notes over time) synchronously upon every write request will degrade API write performance. We will decouple these operations. Write endpoints will emit a domain event (e.g., NoteCreatedEvent), and an asynchronous listener will compute the statistics in the background.  
* **Simplification:** Use the internal NestJS EventEmitter2 to handle asynchronous event dispatching locally within the Node process. Document clearly that in a production environment, this event emitter would be replaced by a dedicated Message Broker (like Kafka or RabbitMQ) and processed by an independent microservice.