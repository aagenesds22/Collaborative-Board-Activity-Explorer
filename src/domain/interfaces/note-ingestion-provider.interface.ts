/**
 * Note Ingestion Provider Interface
 * 
 * Abstracts the data source for seed notes. Supports file-based ingestion,
 * HTTP streams, S3 buckets, database cursors, or any async iterable source.
 * Implements Dependency Inversion Principle to keep core logic independent
 * of the underlying data source.
 * 
 * Uses AsyncIterable to protect the Node.js event loop by streaming data
 * in manageable chunks rather than loading everything into memory at once.
 */

import { RawStickyNote } from '../models/note.model';

export const NOTE_INGESTION_PROVIDER = Symbol('NOTE_INGESTION_PROVIDER');

export interface INoteIngestionProvider {
  /**
   * Get an async iterable stream of raw sticky notes
   * 
   * The async generator allows the NoteService to consume notes in batches
   * without blocking the event loop. This is critical for large datasets.
   * 
   * Example producers (all implement the same interface):
   * - FileNoteIngestionProvider: Streams from seed-data.jsonl using fs.createReadStream
   * - HttpNoteIngestionProvider: Streams from a remote API endpoint
   * - S3NoteIngestionProvider: Streams from AWS S3 bucket
   * - DatabaseNoteIngestionProvider: Streams from database cursor/query
   */
  getNoteStream(): AsyncIterable<RawStickyNote>;
}
