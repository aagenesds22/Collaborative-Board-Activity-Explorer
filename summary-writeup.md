**Collaborative Board Activity Explorer**

## **1\. Approach and Scoping**

I approached this challenge by focusing entirely on the backend architecture and real-time concurrency. Rather than building a basic CRUD REST API and spending hours on a frontend UI, which was explicitly marked as a stretch goal, I scoped the work to solve the hardest distributed systems problem: network latency and concurrent state mutations. Through the architecting steps I invested most of the time to implement a mathematically deterministic Conflict-Free Replicated Data Type (CRDT) over WebSockets, ensuring that high-volume, concurrent edits are resolved gracefully without relying on database locks or client-side orchestration. Several simplifications were made to utilize an in-memory store for the MVP; however, the dependency inversion design allows for seamless scalability by swapping this ephemeral solution for a dedicated persistent storage layer.

## **2\. Assumptions**

To strictly define the MVP boundaries, I worked under the following assumptions:

* **Single-Board Ecosystem:** Multi-tenancy, authorization, and board creation are out of scope. In reality, multiple considerations such as access authorization and permissions to edit/delete/update should be modeled at this stage. If the product evolves to support multiple boards, the system will be upgraded by adding a **boardId** property to the schema, creating a **composite database index** (boardId, createdAt) for efficient scoped querying, and logically partitioning the data  
* **Schema Adherence:** The provided JSON schema (id as sequential integer) is an immutable contract.  
* **Lack of Mutation Metadata**: Because the provided schema lacks an updatedAt timestamp or a hash, we assume standard database-level Optimistic Locking is impossible without schema mutation. This necessitates a custom conflict resolution strategy (CRDT).  
* **Creation and deletion of notes are omitted**: The provided schema relies on sequential integer IDs. To support note.create in a distributed environment without altering the integer-based schema, we would introduce composite primary keys (e.g., board\_id \+ client\_id \+ local\_sequence) to guarantee uniqueness without relying on heavy UUIDs or centralized database locks. Supporting deletion would require implementing an OR-Set (Observed-Remove Set) with Tombstones, increasing scope drastically.  
* **Timestamp Trust with Drift Boundaries:** Because the schema lacks an updatedAt metadata field, we must trust client-provided operation timestamps to resolve conflicts, mitigated by strict server-side drift validation (rejecting operations \> 30 seconds in the future).  
* **Ephemeral In-Memory Persistence:** A JavaScript Map is acceptable for the MVP's data store to ensure the project is "runnable out of the box," provided it is decoupled via the Repository pattern to allow future database injection.  
* **Containerization through Docker / Raw npm:** I also assumed the execution and review environment would benefit from being fully containerized. The solution is delivered via Docker and Docker Compose, guaranteeing a reproducible runtime that abstracts away local dependency conflicts and aligns with stateless deployment standards. It can also run raw through npm executable scripts.

## **3\. Architectural Overview, API Design & Modeling Decisions**

The system leverages NestJS with simple clean architecture principles. NestJS natively enforces modularity, Dependency Injection (DI), and separation of concerns. This allows the core business logic (Sticky Notes, Boards) to remain agnostic of the underlying infrastructure.  The domain logic is entirely decoupled from the framework.   
Also, a purely RESTful architecture is insufficient for real-time collaboration, it will collapse. So I implemented a dual-transport layer. Heavy reads, such as initial loads and analytics, are handled via standard REST endpoints, while lightweight, bidirectional mutations are processed over WebSockets.   
To prevent the Event Loop from blocking during the initial data load, the ingestion pipeline utilizes non-blocking asynchronous iterables to stream the JSON seed data. At the domain level, standard last-write-wins REST overwrites cause data loss during concurrent edits. To solve this, I designed a **Last-Write-Wins Map**. Internally, every mutable field acts as an independent register tied to a timestamp, allowing simultaneous updates to different properties of the same note to merge seamlessly. To satisfy the rigid schema requirements, this internal metadata is stripped out via a projection method before crossing the transport layer, where strict Data Transfer Objects enforce payload boundaries.

## **5\. How the Design Could Scale**

The system is designed to scale in two distinct phases to maximize resource efficiency. Acknowledging that Node.js handles I/O exceptionally well but struggles with synchronous CPU-bound tasks, the first phase focuses on vertical scaling. We would implement a native Worker Thread pool where the main thread passes WebSocket payloads via inter-process communication to background workers. These workers handle the heavy CRDT math and JSON serialization for massive broadcasts, keeping the main Event Loop lightning-fast. As traffic scales past single-machine operating system constraints, the second phase introduces horizontal scaling. This involves deploying application replicas behind a Load Balancer and utilizing a Redis Pub/Sub adapter to synchronize WebSocket broadcasts. Data would migrate to a persistent database like PostgreSQL, spatial indexing would be introduced for coordinate-based (x, y) viewport queries, and the heavy calculations for analytical endpoints would be offloaded to background jobs and cached in Redis. Although this might cause analytics to be slightly delayed from real-time results, this is acceptable because the core functionality is guaranteed to never be affected by analytical reads.

## **6\. Client Leverage (Reconciliation Loop)**

A frontend client (if developed) would leverage this architecture via a "Push-Pull Reconciliation" pattern:

1. **Initial Load:** Client calls the REST API (GET /notes?offset=0\&limit=100) to fetch the initial, paginated state.  
2. **Real-Time Sync:** Client connects to the /board WebSocket namespace to listen for continuous note.mutated broadcast deltas.  
3. **Conflict Handling:** If a client submits a delayed/stale operation, the server rejects it and emits a note.conflict event containing the authoritative state, forcing the client to visually snap to the truth.  
4. **Reconnection:** If the WebSocket drops, the client does *not* request a massive state dump over the socket. Upon reconnecting, it simply calls the REST GET /notes endpoint again to cleanly reconcile the state.

## **7\. AI Usage**

I utilized AI (LLMs) as an architectural sounding board and pair programmer. Specifically, I used it to:

* Debate the tradeoffs between utilizing operational transformation (OT), full CRDT libraries (Yjs/Automerge), and custom LWW-Maps for this specific schema.  
* Scaffold the boilerplate for the NestJS Dependency Injection container and infrastructure interfaces.  
* Generate and troubleshoot the Jest E2E test suite to simulate concurrent WebSocket racing conditions and ensure the CRDT math remained deterministic.

## **8\. Tradeoffs & Next Steps**

The MVP explicitly restricts operations to the mutation of the existing 750 notes. Supporting **note.create** event safely in a distributed environment requires generating a composite index to avoid ID collisions, which violates the strict sequential integer id schema provided. Supporting deletion would require implementing an OR-Set (Observed-Remove Set) with Tombstones, increasing scope drastically. This is mainly why there is no create/delete functionality in this challenge.

* **Offset vs. Cursor Pagination:** The REST API currently uses offset/limit pagination for simplicity. Moving forward, it should be migrated to cursor-based pagination (keyset pagination) to prevent database degradation at scale. Furthermore, when combining this cursor pagination with spatial indexing (e.g., PostgreSQL GiST indexes), the system can efficiently stream massive datasets in manageable chunks based strictly on the user's dynamic (x, y) viewport bounding box, rather than overloading the network with notes that render off-screen.

* **WebSocket Broadcast Bleed:** Naive WebSockets scale quadratically (O(N^2)). If 1,000 users move notes simultaneously, broadcasting every frame generates millions of messages per second. The next production step is implementing **Event Batching**, where the server collects all CRDT deltas in a 50ms window and broadcasts a single compressed array per tick.


## ⚙️ Production Considerations

### Scalability Roadmap

| Component | MVP | Production |
|-----------|-----|------------|
| **Storage** | In-memory Map (single instance, ~100k notes) | PostgreSQL/DynamoDB with indexes |
| **WebSocket Broadcast** | Naive fanout (O(N)) | Event batching (50ms windows) + compression |
| **Rate Limiting** | None | 20 ops/sec per socket |
| **Clustering** | Single Node.js process | Horizontal scaling with Redis Adapter + Socket.IO namespace partitioning |
| **Event Streaming** | EventEmitter2 (local) | Kafka/RabbitMQ for cross-node communication |
| **Caching** | In-memory (@nestjs/cache-manager) | Redis with TTL-based invalidation |
| **Persistence** | Ephemeral (no writes during mutations) | Event Sourcing + CQRS pattern |

### Security Hardening

- **Authentication:** Add JWT tokens on WebSocket connection
- **Authorization:** Implement board ownership and permission checks
- **Rate Limiting:** Enforce per-socket mutation throttling (20 ops/sec)
- **Input Validation:** Already present; expand content policy enforcement
- **CORS:** Whitelist allowed origins in production
- **SSL/TLS:** Use WSS (WebSocket Secure) in production

### Monitoring

- **Latency:** Track client→server→broadcast round-trip time
- **Conflict Rate:** Monitor stale mutation frequency (high rates indicate clock sync issues)
- **Memory:** Monitor Map<id, StickyNoteCRDT> heap usage per million notes
- **Throughput:** Mutations/sec and concurrent connections

---

## 🔗 References

- **NestJS Documentation:** https://docs.nestjs.com
- **Socket.IO Documentation:** https://socket.io/docs
- **CRDT Research:** https://crdt.tech
- **Last-Write-Wins Map:** https://arxiv.org/abs/1805.06358

---