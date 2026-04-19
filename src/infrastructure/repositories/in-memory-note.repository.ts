/**
 * In-Memory Note Repository Implementation
 * 
 * Stores all sticky notes in memory using a Map for O(1) lookups.
 * Implements the INoteRepository interface.
 * 
 * CRDT Storage Model:
 * - Internal storage: Map<string, StickyNoteCRDT> (preserves timestamps for conflict resolution)
 * - External API: Returns StickyNote (domain model) by projecting CRDT state
 * - Mutation handling: New method mergeMutation() for property-level CRDT merges
 * 
 * For MVP: Sufficient for boards up to ~100k notes on a single instance.
 * For production scaling: Replace with PostgreSQL/MongoDB + indexes; repository abstraction allows seamless migration.
 */

import { Injectable, Logger } from '@nestjs/common';
import { StickyNote, RawStickyNote } from '../../domain/models/note.model';
import { StickyNoteCRDT } from '../../domain/models/crdt.model';
import { INoteRepository } from '../../domain/interfaces/note-repository.interface';

@Injectable()
export class InMemoryNoteRepository implements INoteRepository {
  private readonly logger = new Logger(InMemoryNoteRepository.name);
  private notes = new Map<string, StickyNoteCRDT>();

  /**
   * Project RawStickyNote (from CRDT) to StickyNote (domain model)
   */
  private projectToDomain(raw: RawStickyNote): StickyNote {
    return {
      ...raw,
      createdAt: new Date(raw.createdAt),
    };
  }

  /**
   * Project StickyNoteCRDT to StickyNote for external API
   */
  private crdtToStickyNote(crdt: StickyNoteCRDT): StickyNote {
    return this.projectToDomain(crdt.toRawSchema());
  }

  async saveBulk(notes: StickyNote[]): Promise<void> {
    for (const note of notes) {
      // Wrap each StickyNote in StickyNoteCRDT with current timestamp as initial version
      const crdt = new StickyNoteCRDT(note, Date.now());
      this.notes.set(String(note.id), crdt);
    }
    this.logger.debug(
      `Saved ${notes.length} notes as CRDT envelopes. Total in repository: ${this.notes.size}`,
    );
  }

  async getById(id: number): Promise<StickyNote | null> {
    const crdt = this.notes.get(String(id));
    return crdt ? this.crdtToStickyNote(crdt) : null;
  }

  /**
   * Get CRDT envelope directly (for mutations and internal operations)
   */
  async getByIdCRDT(id: number): Promise<StickyNoteCRDT | null> {
    return this.notes.get(String(id)) || null;
  }

  async getAll(offset: number, limit: number): Promise<{
    items: StickyNote[];
    total: number;
  }> {
    const allCRDTs = Array.from(this.notes.values());
    const total = allCRDTs.length;
    const items = allCRDTs
      .slice(offset, offset + limit)
      .map((crdt) => this.crdtToStickyNote(crdt));

    return { items, total };
  }

  async findByAuthor(
    author: string,
    offset: number,
    limit: number,
  ): Promise<{
    items: StickyNote[];
    total: number;
  }> {
    const filtered = Array.from(this.notes.values()).filter(
      (crdt) => crdt.getAuthor().toLowerCase() === author.toLowerCase(),
    );
    const total = filtered.length;
    const items = filtered
      .slice(offset, offset + limit)
      .map((crdt) => this.crdtToStickyNote(crdt));

    return { items, total };
  }

  async findByColor(
    color: string,
    offset: number,
    limit: number,
  ): Promise<{
    items: StickyNote[];
    total: number;
  }> {
    const filtered = Array.from(this.notes.values()).filter(
      (crdt) => crdt.getColor().toLowerCase() === color.toLowerCase(),
    );
    const total = filtered.length;
    const items = filtered
      .slice(offset, offset + limit)
      .map((crdt) => this.crdtToStickyNote(crdt));

    return { items, total };
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
    offset: number,
    limit: number,
  ): Promise<{
    items: StickyNote[];
    total: number;
  }> {
    const filtered = Array.from(this.notes.values()).filter((crdt) => {
      const noteDate = crdt.getCreatedAt();
      return noteDate >= startDate && noteDate <= endDate;
    });
    const total = filtered.length;
    const items = filtered
      .slice(offset, offset + limit)
      .map((crdt) => this.crdtToStickyNote(crdt));

    return { items, total };
  }

  async getRecent(limit: number): Promise<StickyNote[]> {
    const allCRDTs = Array.from(this.notes.values());
    return allCRDTs
      .sort(
        (a, b) =>
          b.getCreatedAt().getTime() - a.getCreatedAt().getTime(),
      )
      .slice(0, limit)
      .map((crdt) => this.crdtToStickyNote(crdt));
  }

  async getCount(): Promise<number> {
    return this.notes.size;
  }

  async getStatsByAuthor(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const crdt of this.notes.values()) {
      const author = crdt.getAuthor();
      stats[author] = (stats[author] || 0) + 1;
    }
    return stats;
  }

  async getStatsByColor(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const crdt of this.notes.values()) {
      const color = crdt.getColor();
      stats[color] = (stats[color] || 0) + 1;
    }
    return stats;
  }

  async getBasicStats(): Promise<{
    totalNotes: number;
    uniqueAuthors: number;
    uniqueColors: number;
    notesPerAuthor: Record<string, number>;
    notesPerColor: Record<string, number>;
  }> {
    const notesPerAuthor = await this.getStatsByAuthor();
    const notesPerColor = await this.getStatsByColor();

    return {
      totalNotes: this.notes.size,
      uniqueAuthors: Object.keys(notesPerAuthor).length,
      uniqueColors: Object.keys(notesPerColor).length,
      notesPerAuthor,
      notesPerColor,
    };
  }

  /**
   * Merge a CRDT mutation into an existing note.
   * Property-level conflict resolution via LWWRegister timestamps.
   * 
   * @param noteId ID of the note to update
   * @param property Mutable property ('text', 'x', 'y', 'color')
   * @param value New value for the property
   * @param clientTimestamp Client-provided Unix timestamp (milliseconds)
   * @returns { updated: boolean; note?: RawStickyNote } - Returns updated state if changed
   */
  async mergeMutation(
    noteId: number,
    property: 'text' | 'x' | 'y' | 'color',
    value: any,
    clientTimestamp: number,
  ): Promise<{ updated: boolean; note?: RawStickyNote }> {
    const crdt = await this.getByIdCRDT(noteId);
    if (!crdt) {
      return { updated: false };
    }

    try {
      // CRDT handles the merge (timestamp-based conflict resolution)
      const wasUpdated = crdt.updateProperty(property, value, clientTimestamp);
      if (wasUpdated) {
        this.logger.debug(
          `Note ${noteId}.${property} updated: value=${value}, timestamp=${clientTimestamp}`,
        );
      } else {
        this.logger.debug(
          `Note ${noteId}.${property} rejected (stale): value=${value}, timestamp=${clientTimestamp}`,
        );
      }

      return {
        updated: wasUpdated,
        note: crdt.toRawSchema(),
      };
    } catch (error) {
      this.logger.error(`Failed to merge mutation on note ${noteId}: ${error}`);
      return { updated: false };
    }
  }
}
