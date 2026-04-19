/**
 * In-Memory Note Repository Implementation
 * 
 * Stores all sticky notes in memory using a Map for O(1) lookups.
 * Implements the INoteRepository interface.
 * 
 * For MVP: Sufficient for boards up to ~100k notes on a single instance.
 * For production scaling: Replace with PostgreSQL/MongoDB + indexes.
 */

import { Injectable, Logger } from '@nestjs/common';
import { StickyNote } from '../../domain/models/note.model';
import { INoteRepository } from '../../domain/interfaces/note-repository.interface';

@Injectable()
export class InMemoryNoteRepository implements INoteRepository {
  private readonly logger = new Logger(InMemoryNoteRepository.name);
  private notes = new Map<string, StickyNote>();

  async saveBulk(notes: StickyNote[]): Promise<void> {
    for (const note of notes) {
      this.notes.set(String(note.id), note);
    }
    this.logger.debug(
      `Saved ${notes.length} notes. Total in repository: ${this.notes.size}`,
    );
  }

  async getById(id: number): Promise<StickyNote | null> {
    return this.notes.get(String(id)) || null;
  }

  async getAll(offset: number, limit: number): Promise<{
    items: StickyNote[];
    total: number;
  }> {
    const allNotes = Array.from(this.notes.values());
    const total = allNotes.length;
    const items = allNotes.slice(offset, offset + limit);

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
      (note) => note.author.toLowerCase() === author.toLowerCase(),
    );
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

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
      (note) => note.color.toLowerCase() === color.toLowerCase(),
    );
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

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
    const filtered = Array.from(this.notes.values()).filter((note) => {
      return note.createdAt >= startDate && note.createdAt <= endDate;
    });
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);

    return { items, total };
  }

  async getRecent(limit: number): Promise<StickyNote[]> {
    const allNotes = Array.from(this.notes.values());
    return allNotes
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async getCount(): Promise<number> {
    return this.notes.size;
  }

  async getStatsByAuthor(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const note of this.notes.values()) {
      stats[note.author] = (stats[note.author] || 0) + 1;
    }
    return stats;
  }

  async getStatsByColor(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    for (const note of this.notes.values()) {
      stats[note.color] = (stats[note.color] || 0) + 1;
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
}
