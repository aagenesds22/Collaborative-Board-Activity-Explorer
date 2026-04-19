/**
 * Repository Interface for Note Storage
 * 
 * Abstracts the storage layer, allowing seamless transitions between
 * in-memory, PostgreSQL, MongoDB, etc. Implements Repository Pattern
 * with Dependency Inversion Principle.
 */

import { StickyNote } from '../models/note.model';

export const NOTE_REPOSITORY = Symbol('NOTE_REPOSITORY');

export interface INoteRepository {
  /**
   * Save multiple notes in bulk (used during data ingestion)
   */
  saveBulk(notes: StickyNote[]): Promise<void>;

  /**
   * Retrieve a note by its ID
   */
  getById(id: number): Promise<StickyNote | null>;

  /**
   * Retrieve all notes with pagination
   * @param offset - Skip this many records (0-based)
   * @param limit - Return this many records
   */
  getAll(offset: number, limit: number): Promise<{
    items: StickyNote[];
    total: number;
  }>;

  /**
   * Find notes by author
   */
  findByAuthor(author: string, offset: number, limit: number): Promise<{
    items: StickyNote[];
    total: number;
  }>;

  /**
   * Find notes by color
   */
  findByColor(color: string, offset: number, limit: number): Promise<{
    items: StickyNote[];
    total: number;
  }>;

  /**
   * Find notes within a date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    offset: number,
    limit: number,
  ): Promise<{
    items: StickyNote[];
    total: number;
  }>;

  /**
   * Get recently added notes (sorted by createdAt DESC)
   */
  getRecent(limit: number): Promise<StickyNote[]>;

  /**
   * Get total count of all notes
   */
  getCount(): Promise<number>;

  /**
   * Get statistics: count of notes per author
   */
  getStatsByAuthor(): Promise<Record<string, number>>;

  /**
   * Get statistics: count of notes per color
   */
  getStatsByColor(): Promise<Record<string, number>>;

  /**
   * Get total count and basic statistics
   */
  getBasicStats(): Promise<{
    totalNotes: number;
    uniqueAuthors: number;
    uniqueColors: number;
    notesPerAuthor: Record<string, number>;
    notesPerColor: Record<string, number>;
  }>;
}
