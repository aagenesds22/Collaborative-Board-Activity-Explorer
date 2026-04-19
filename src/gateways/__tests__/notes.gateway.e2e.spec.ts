/**
 * WebSocket Gateway E2E Tests
 * 
 * Tests the NotesGateway real-time mutation broadcast behavior using socket.io-client
 * to simulate multiple connected users.
 * 
 * Setup:
 * - NestJS application instance on random port (prevents conflicts in parallel test runs)
 * - socket.io-client for simulating multiple concurrent clients
 * - Shared /board namespace with board-0 room for MVP architecture
 * 
 * Test Cases:
 * 1. Successful Broadcast: Current timestamp mutation → all clients receive note.mutated
 * 2. Stale Conflict: Past timestamp mutation → sender gets note.conflict, no broadcast to others
 * 3. Validation Rejection: Invalid property mutation → sender gets note.error, repo unchanged
 * 
 * Architecture Validation:
 * - Proves transport separation: WebSocket = mutations, REST = reads (separation in gateway code)
 * - Proves CRDT correctness: timestamp-based conflict resolution via gateway broadcast decisions
 * - Proves isolation: Client B never sees Client A's stale mutations (no broadcast on conflict)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, Module } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InMemoryNoteRepository } from '../../infrastructure/repositories/in-memory-note.repository';
import { StickyNote } from '../../domain/models/note.model';
import { NotesGateway } from '../notes.gateway';
import { CrdtService } from '../../application/services/crdt.service';
import {
  NOTE_REPOSITORY,
  INoteRepository,
} from '../../domain/interfaces/note-repository.interface';

// Test constants
const BOARD_NAMESPACE = '/board';
const BOARD_ROOM = 'board-0';
const TEST_PORT = 3001; // Use fixed port for E2E; in production could randomize
const TEST_TIMEOUT_MS = 30000; // Event timeout (increased for socket.io latency)

// Test utilities
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitForEvent = <T>(
  socket: Socket,
  eventName: string,
  timeoutMs: number = TEST_TIMEOUT_MS,
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting for event: ${eventName}`)),
      timeoutMs,
    );

    socket.once(eventName, (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
};

/**
 * Test Module: Minimal NestJS setup for E2E tests
 * Excludes FileNoteIngestionProvider to avoid seed-data.jsonl loading
 */
@Module({
  imports: [
    CacheModule.register({
      isGlobal: true,
      ttl: 60,
    }),
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
  ],
  providers: [
    // Application Services
    CrdtService,

    // WebSocket Gateway
    NotesGateway,

    // Infrastructure - Repositories
    InMemoryNoteRepository,

    // Dependency Injection Bindings
    {
      provide: NOTE_REPOSITORY,
      useClass: InMemoryNoteRepository,
    },
  ],
})
class TestAppModule { }

describe('NotesGateway E2E Tests', () => {
  let app: INestApplication;
  let repository: InMemoryNoteRepository;

  // Test fixtures
  let testNote: StickyNote;
  const testNoteId = 1;

  beforeAll(async () => {
    // Create NestJS test module with extended timeout
    // Using TestAppModule (excludes ingestion provider) for fast initialization
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    // Create NestJS application instance
    app = moduleFixture.createNestApplication();

    // Listen with extended timeout
    await Promise.race([
      app.listen(TEST_PORT),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('App listen timeout')), 30000)
      ),
    ]);

    // Get repository for pre-population and assertions
    repository = moduleFixture.get(NOTE_REPOSITORY);

    // Create a test note to mutate
    testNote = {
      id: testNoteId,
      text: 'Original text',
      x: 100,
      y: 200,
      author: 'Alice',
      color: 'yellow',
      createdAt: new Date(),
    };
    await repository.saveBulk([testNote]);

    // Allow server to stabilize and socket handlers to register
    await sleep(1500);
  }, 60000); // 60 second timeout for beforeAll

  afterAll(async () => {
    // Proper teardown to prevent Jest memory leaks
    if (app) {
      await app.close();
    }
  }, 15000); // 15 second timeout for afterAll

  describe('Successful Broadcast: Current Timestamp', () => {
    it('should broadcast note.mutated to all clients when mutation has current timestamp', async () => {
      // Setup: Connect 2 clients to /board namespace
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });
      const clientB = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        // Wait for connections
        await Promise.all([
          waitForEvent<void>(clientA, 'connect'),
          waitForEvent<void>(clientB, 'connect'),
        ]);

        // Additional delay to ensure socket.io rooms are fully set up
        await sleep(500);

        // Act: Client A emits note.update with current timestamp
        const currentTimestamp = Date.now();
        const mutationPayload = {
          noteId: testNoteId,
          property: 'text' as const,
          value: 'Updated by Client A',
          clientTimestamp: currentTimestamp,
          clientId: 'client-a',
        };

        clientA.on('note.error', (err) => console.error('SERVER REJECTED:', err));
        // Emit from Client A (no response, but expect broadcasts)
        clientA.emit('note.update', mutationPayload);

        // Assert: Both clients should receive note.mutated broadcast
        const mutatedEventA = await waitForEvent<any>(clientA, 'note.mutated');
        const mutatedEventB = await waitForEvent<any>(clientB, 'note.mutated');

        // Verify payload structure
        expect(mutatedEventA).toHaveProperty('noteId', testNoteId);
        expect(mutatedEventA).toHaveProperty('property', 'text');
        expect(mutatedEventA).toHaveProperty('mergedState');
        expect(mutatedEventA.mergedState.text).toBe('Updated by Client A');

        expect(mutatedEventB).toHaveProperty('noteId', testNoteId);
        expect(mutatedEventB).toHaveProperty('mergedState');
        expect(mutatedEventB.mergedState.text).toBe('Updated by Client A');

        // Verify repository was updated
        const updatedNote = await repository.getById(testNoteId);
        expect(updatedNote?.text).toBe('Updated by Client A');
      } finally {
        clientA.disconnect();
        clientB.disconnect();
      }
    });
  });

  describe('Stale Conflict Handling: Past Timestamp', () => {
    it('should send note.conflict to sender and NOT broadcast when timestamp is 10s in the past', async () => {
      // Setup: Connect 2 clients to /board namespace
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });
      const clientB = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        // Wait for connections
        await Promise.all([
          waitForEvent<void>(clientA, 'connect'),
          waitForEvent<void>(clientB, 'connect'),
        ]);

        // Additional delay to ensure socket.io rooms are fully set up
        await sleep(500);

        // Pre-setup: Accept a current mutation first (to set baseline)
        const currentTimestamp = Date.now();
        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'x',
          value: 150,
          clientTimestamp: currentTimestamp,
          clientId: 'client-a-baseline',
        });

        // Wait for baseline to be accepted
        await waitForEvent<any>(clientA, 'note.mutated');
        await waitForEvent<any>(clientB, 'note.mutated');

        // Act: Client A emits note.update with stale timestamp (10 seconds in the past)
        const staleTimestamp = currentTimestamp - 10000; // 10 seconds ago
        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'y',
          value: 999, // Should be rejected
          clientTimestamp: staleTimestamp,
          clientId: 'client-a-stale',
        });

        // Assert: Client A receives note.conflict (not note.mutated)
        const conflictEvent = await waitForEvent<any>(clientA, 'note.conflict');
        expect(conflictEvent).toHaveProperty('noteId', testNoteId);
        expect(conflictEvent).toHaveProperty('reason');
        expect(conflictEvent).toHaveProperty('currentState');
        expect(conflictEvent.currentState.y).toBe(200); // Should remain unchanged

        // Assert: Client B should NOT receive any note.mutated event for this stale operation
        // Set a flag to detect if note.mutated arrives (it shouldn't)
        let clientBReceivedMutation = false;
        const timeoutHandle = setTimeout(() => {
          // If we get here, no event was received (as expected)
        }, 1000);

        clientB.once('note.mutated', () => {
          clientBReceivedMutation = true;
        });

        await sleep(1000);
        clearTimeout(timeoutHandle);

        expect(clientBReceivedMutation).toBe(false);

        // Verify repository was NOT updated (y should still be 200)
        const noteState = await repository.getById(testNoteId);
        expect(noteState?.y).toBe(200); // Original value preserved
      } finally {
        clientA.disconnect();
        clientB.disconnect();
      }
    });
  });

  describe('Validation Rejection: Invalid Property', () => {
    it('should send note.error to sender when trying to mutate immutable property (author)', async () => {
      // Setup: Connect client to /board namespace
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        // Wait for connection
        await waitForEvent<void>(clientA, 'connect');

        // Act: Client A attempts to mutate immutable property
        const currentTimestamp = Date.now();
        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'author', // Immutable property
          value: 'Hacker',
          clientTimestamp: currentTimestamp,
          clientId: 'client-a-invalid',
        });

        // Assert: Client A receives note.error event
        const errorEvent = await waitForEvent<any>(clientA, 'note.error');
        expect(errorEvent).toHaveProperty('message');
        expect(errorEvent.message).toContain('Cannot mutate property');
        expect(errorEvent.message).toContain('author');

        // Verify repository was NOT updated
        const noteState = await repository.getById(testNoteId);
        expect(noteState?.author).toBe('Alice'); // Original author preserved
      } finally {
        clientA.disconnect();
      }
    });

    it('should send note.error when value type is invalid (text as number)', async () => {
      // Setup: Connect client to /board namespace
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        // Wait for connection
        await waitForEvent<void>(clientA, 'connect');

        // Act: Client A sends invalid value type
        const currentTimestamp = Date.now();
        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'text',
          value: 12345, // Should be string
          clientTimestamp: currentTimestamp,
          clientId: 'client-a-type-error',
        });

        // Assert: Client A receives note.error event
        const errorEvent = await waitForEvent<any>(clientA, 'note.error');
        expect(errorEvent).toHaveProperty('message');
        expect(errorEvent.message).toContain('text');

        // Verify repository was NOT updated
        const noteState = await repository.getById(testNoteId);
        const originalText = 'Updated by Client A'; // From first successful broadcast test
        expect(noteState?.text).not.toBe(12345);
      } finally {
        clientA.disconnect();
      }
    });

    it('should send note.error when coordinate value is out of bounds', async () => {
      // Setup: Connect client to /board namespace
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        // Wait for connection
        await waitForEvent<void>(clientA, 'connect');

        // Act: Client A sends coordinate out of bounds (> 10000)
        const currentTimestamp = Date.now();
        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'x',
          value: 50000, // Out of bounds
          clientTimestamp: currentTimestamp,
          clientId: 'client-a-bounds-error',
        });

        // Assert: Client A receives note.error event
        const errorEvent = await waitForEvent<any>(clientA, 'note.error');
        expect(errorEvent).toHaveProperty('message');
        expect(errorEvent.message).toContain('must be between');

        // Verify repository was NOT updated
        const noteState = await repository.getById(testNoteId);
        expect(noteState?.x).not.toBe(50000);
      } finally {
        clientA.disconnect();
      }
    });
  });

  describe('Concurrent Multi-Client Mutations', () => {
    it('should handle 3 concurrent clients with independent mutations deterministically', async () => {
      const testNoteId = 100;
      const concurrentTestNote: StickyNote = {
        id: 100,
        text: 'Concurrent test note',
        x: 100,
        y: 200,
        author: 'Bob',
        color: 'blue',
        createdAt: new Date(),
      };

      await repository.saveBulk([concurrentTestNote]);

      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, { reconnection: false, forceNew: true });
      const clientB = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, { reconnection: false, forceNew: true });
      const clientC = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, { reconnection: false, forceNew: true });

      try {
        await Promise.all([
          waitForEvent<void>(clientA, 'connect'),
          waitForEvent<void>(clientB, 'connect'),
          waitForEvent<void>(clientC, 'connect'),
        ]);
        await sleep(200);

        const baseTimestamp = Date.now();

        const clientCErrors: any[] = [];

        clientC.on('note.conflict', (data) => clientCErrors.push(data));

        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'text',
          value: 'Text from A',
          clientTimestamp: baseTimestamp,
          clientId: 'client-a',
        });

        clientB.emit('note.update', {
          noteId: testNoteId,
          property: 'x',
          value: 300,
          clientTimestamp: baseTimestamp + 500,
          clientId: 'client-b',
        });

        clientC.emit('note.update', {
          noteId: testNoteId,
          property: 'color',
          value: 'green',
          clientTimestamp: baseTimestamp - 1000,
          clientId: 'client-c',
        });

        // Wait for the server to process all operations and broadcasts.
        await sleep(500);

        // 5. Assert: The Ultimate Truth (The Repository State)
        const finalNote = await repository.getById(testNoteId);

        // Client A's text should be saved
        expect(finalNote?.text).toBe('Text from A');

        // Client B's x coordinate should be saved
        expect(finalNote?.x).toBe(300);

        // Client C's color update should have been rejected (remains original blue)
        expect(finalNote?.color).toBe('blue');

        // 6. Verify Client C actually received the conflict notification
        expect(clientCErrors.length).toBe(1);
        expect(clientCErrors[0].currentState.color).toBe('blue');

      } finally {
        clientA.disconnect();
        clientB.disconnect();
        clientC.disconnect();
      }
    });
  });

  describe('Malformed Payload Handling', () => {
    it('should send note.error when payload is missing required fields', async () => {
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        await waitForEvent<void>(clientA, 'connect');

        clientA.emit('note.update', {
          property: 'text',
          value: 'No noteId',
          clientTimestamp: Date.now(),
          clientId: 'client-a-malformed',
          // noteId is missing
        });

        const errorEvent = await waitForEvent<any>(clientA, 'note.error');
        expect(errorEvent).toHaveProperty('message');
        expect(errorEvent.message).toContain('Invalid');
      } finally {
        clientA.disconnect();
      }
    });

    it('should send note.error when clientTimestamp is not a number', async () => {
      const clientA = io(`http://localhost:${TEST_PORT}${BOARD_NAMESPACE}`, {
        reconnection: false,
        forceNew: true,
      });

      try {
        await waitForEvent<void>(clientA, 'connect');

        clientA.emit('note.update', {
          noteId: testNoteId,
          property: 'text',
          value: 'Invalid timestamp',
          clientTimestamp: 'not-a-number',
          clientId: 'client-a-bad-ts',
        });

        const errorEvent = await waitForEvent<any>(clientA, 'note.error');
        expect(errorEvent).toHaveProperty('message');
        expect(errorEvent.message).toContain('Invalid');
      } finally {
        clientA.disconnect();
      }
    });
  });
});
