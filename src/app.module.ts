/**
 * Application Module
 * 
 * Root NestJS module that configures:
 * - Dependency Injection bindings
 * - Controllers and Providers
 * - WebSocket Gateway for real-time mutations
 * - NestJS features (Caching, Event Emitters)
 * 
 * Demonstrates clean architecture by binding interfaces to implementations,
 * allowing seamless provider/repository swaps without changing business logic.
 * 
 * Phase 2: CRDT & WebSocket Integration
 * - CrdtService: Handles property-level mutation conflict resolution
 * - NotesGateway: WebSocket endpoint for real-time collaboration
 * - Socket.IO: Real-time communication with automatic reconnect
 */

import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Controllers
import { NotesController } from './notes.controller';

// Application Services
import { NoteService } from './application/services/note.service';
import { CrdtService } from './application/services/crdt.service';

// WebSocket Gateway
import { NotesGateway } from './gateways/notes.gateway';

// Infrastructure - Repositories
import { InMemoryNoteRepository } from './infrastructure/repositories/in-memory-note.repository';

// Infrastructure - Providers
import { FileNoteIngestionProvider } from './infrastructure/providers/file-note-ingestion.provider';

// Domain - Interfaces & Symbols
import {
  NOTE_REPOSITORY,
  INoteRepository,
} from './domain/interfaces/note-repository.interface';
import {
  NOTE_INGESTION_PROVIDER,
  INoteIngestionProvider,
} from './domain/interfaces/note-ingestion-provider.interface';

@Module({
  imports: [
    // In-memory caching for MVP
    // Production: Replace with CacheModule.register({ store: 'redis' })
    CacheModule.register({
      isGlobal: true,
      ttl: 60, // 60 seconds default TTL
    }),

    // Event emitter for decoupled event handling
    // Production: Replace with external message broker (Kafka, RabbitMQ)
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
  controllers: [NotesController],
  providers: [
    // Application Services
    NoteService,
    CrdtService,

    // WebSocket Gateway (Phase 2)
    NotesGateway,

    // Infrastructure - Repositories
    InMemoryNoteRepository,

    // Infrastructure - Providers
    FileNoteIngestionProvider,

    // Dependency Injection Bindings
    // Bind interface symbols to concrete implementations
    // This enables seamless swapping of implementations without changing business logic
    {
      provide: NOTE_REPOSITORY,
      useClass: InMemoryNoteRepository,
    },
    {
      provide: NOTE_INGESTION_PROVIDER,
      useClass: FileNoteIngestionProvider,
    },
  ],
})
export class AppModule {}
