1. The CRDT Core (Domain Layer)
We break this into two parts: the generic LWWRegister (which holds a single property and its timestamp) and the StickyNoteCRDT (which aggregates them).

// src/domain/models/crdt.model.ts
import { RawStickyNote } from './note.model';

/**
 * A Last-Write-Wins Register.
 * Resolves conflicts deterministically by comparing timestamps.
 */
export class LWWRegister<T> {
  constructor(public value: T, public timestamp: number) {}

  /**
   * Attempts to merge an incoming operation.
   * Returns true if the state was updated, false if the incoming operation was stale.
   */
  merge(newValue: T, incomingTimestamp: number): boolean {
    if (incomingTimestamp > this.timestamp) {
      this.value = newValue;
      this.timestamp = incomingTimestamp;
      return true;
    }
    // If timestamps are identical (extremely rare tie), we resolve deterministically.
    // A simple string fallback comparison ensures both nodes end up with the same state.
    if (incomingTimestamp === this.timestamp) {
      const isGreater = JSON.stringify(newValue) > JSON.stringify(this.value);
      if (isGreater) {
        this.value = newValue;
        return true;
      }
    }
    return false; // The incoming operation was dropped safely
  }
}

/**
 * The CRDT Envelope for a Sticky Note.
 * Immutable fields (id, author) remain standard. Mutable fields become LWWRegisters.
 */
export class StickyNoteCRDT {
  public readonly id: string;
  public readonly author: string;
  public readonly createdAt: Date;

  private text: LWWRegister<string>;
  private x: LWWRegister<number>;
  private y: LWWRegister<number>;
  private color: LWWRegister<string>;

  constructor(
    id: string, author: string, createdAt: Date,
    text: string, x: number, y: number, color: string,
    initialTimestamp: number = Date.now()
  ) {
    this.id = id;
    this.author = author;
    this.createdAt = createdAt;
    
    // Initialize registers
    this.text = new LWWRegister(text, initialTimestamp);
    this.x = new LWWRegister(x, initialTimestamp);
    this.y = new LWWRegister(y, initialTimestamp);
    this.color = new LWWRegister(color, initialTimestamp);
  }

  /**
   * Updates a specific property if the incoming timestamp is newer.
   */
  updateProperty<K extends 'text' | 'x' | 'y' | 'color'>(
    property: K, 
    value: string | number, 
    timestamp: number
  ): boolean {
    // Type assertion is safe here as we restrict K
    return (this[property] as LWWRegister<any>).merge(value, timestamp);
  }

  /**
   * The "Projection" method.
   * Strips the CRDT metadata and projects the state back into the strict schema.
   */
  toRawSchema(): RawStickyNote {
    return {
      id: this.id,
      text: this.text.value,
      x: this.x.value,
      y: this.y.value,
      author: this.author,
      color: this.color.value,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

2. Updating the Repository (Infrastructure Layer)
Now, your internal memory store doesn't save raw sticky notes; it saves the StickyNoteCRDT envelopes.

// src/infrastructure/repositories/in-memory-note.repository.ts
import { Injectable } from '@nestjs/common';
import { INoteRepository } from '../../domain/interfaces/note-repository.interface';
import { StickyNoteCRDT } from '../../domain/models/crdt.model';
import { RawStickyNote } from '../../domain/models/note.model';

@Injectable()
export class InMemoryNoteRepository implements INoteRepository {
  // The store now holds our CRDT objects
  private readonly store: Map<string, StickyNoteCRDT> = new Map();

  async save(crdtNote: StickyNoteCRDT): Promise<void> {
    this.store.set(crdtNote.id, crdtNote);
  }

  async findById(id: string): Promise<StickyNoteCRDT | undefined> {
    return this.store.get(id);
  }

  // Notice how the return type is still RawStickyNote for the API layer
  async findAll(
    filters?: { author?: string; color?: string }, 
    pagination: { offset: number; limit: number } = { offset: 0, limit: 50 }
  ): Promise<RawStickyNote[]> {
    
    // Project CRDTs to Raw Schema immediately for querying
    let results = Array.from(this.store.values()).map(crdt => crdt.toRawSchema());

    if (filters?.author) results = results.filter(n => n.author === filters.author);
    if (filters?.color) results = results.filter(n => n.color === filters.color);

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results.slice(pagination.offset, pagination.offset + pagination.limit);
  }
}

3. Handling Mutations in the Service
This is the exact logic that processes the WebSocket events. Notice how clean the business logic becomes when the math is delegated to the domain.

// src/application/services/note.service.ts
import { Injectable } from '@nestjs/common';
import { InMemoryNoteRepository } from '../../infrastructure/repositories/in-memory-note.repository';
import { RawStickyNote } from '../../domain/models/note.model';

@Injectable()
export class NoteService {
  constructor(private readonly noteRepository: InMemoryNoteRepository) {}

  /**
   * Processes an incoming delta from a WebSocket client.
   */
  async handleConcurrentUpdate(
    noteId: string, 
    property: 'text' | 'x' | 'y' | 'color', 
    value: string | number, 
    clientTimestamp: number
  ): Promise<{ updated: boolean; note?: RawStickyNote }> {
    
    const crdtNote = await this.noteRepository.findById(noteId);
    if (!crdtNote) {
      throw new Error('Note not found');
    }

    // The CRDT handles the conflict resolution math
    const wasUpdated = crdtNote.updateProperty(property, value, clientTimestamp);

    if (wasUpdated) {
      await this.noteRepository.save(crdtNote);
      // Return the newly projected state to be broadcasted to all clients
      return { updated: true, note: crdtNote.toRawSchema() };
    }

    // If it returns false, the server safely drops the stale packet
    return { updated: false };
  }
}