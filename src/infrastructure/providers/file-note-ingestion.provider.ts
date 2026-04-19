/**
 * File-Based Note Ingestion Provider
 * 
 * Streams sticky notes from a JSON Lines (.jsonl) seed file.
 * Uses fs.createReadStream + readline for memory-efficient streaming.
 * 
 * Implements the INoteIngestionProvider interface, allowing seamless
 * migration to other sources (HTTP, S3, databases) without changing
 * the NoteService business logic.
 * 
 * JSON Lines format (.jsonl): One JSON object per line, newline-delimited.
 * Example:
 *   {"id":"1","text":"Idea 1","author":"john","color":"yellow",...}
 *   {"id":"2","text":"Idea 2","author":"jane","color":"blue",...}
 */

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as readline from 'readline';
import { RawStickyNote } from '../../domain/models/note.model';
import { INoteIngestionProvider } from '../../domain/interfaces/note-ingestion-provider.interface';

@Injectable()
export class FileNoteIngestionProvider implements INoteIngestionProvider {
  private readonly logger = new Logger(FileNoteIngestionProvider.name);
  private readonly filePath = './seed-data.jsonl';

  /**
   * Async generator that yields raw sticky notes from the seed file.
   * Protects the Node.js event loop by streaming in manageable chunks.
   */
  async *getNoteStream(): AsyncIterable<RawStickyNote> {
    if (!fs.existsSync(this.filePath)) {
      this.logger.warn(
        `Seed file not found at ${this.filePath}. Yielding empty stream.`,
      );
      return;
    }

    const fileStream = fs.createReadStream(this.filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity, // Handle both \n and \r\n line endings
    });

    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      if (line.trim()) {
        try {
          const rawNote = JSON.parse(line) as RawStickyNote;
          yield rawNote;
        } catch (error) {
          this.logger.error(
            `Failed to parse JSON at line ${lineNumber}: ${line}`,
            error,
          );
          // Skip malformed lines, continue processing
        }
      }
    }

    this.logger.log(
      `Completed streaming ${lineNumber} lines from ${this.filePath}`,
    );
  }
}
