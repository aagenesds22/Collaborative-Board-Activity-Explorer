/**
 * Note Application Service
 * 
 * Orchestrates core business logic:
 * - Data ingestion from providers (runs on app startup)
 * - Query operations delegated to repositories
 * 
 * Completely agnostic of data sources and storage mechanisms
 * (respects Dependency Inversion Principle).
 */

import {
  Injectable,
  Inject,
  OnModuleInit,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import {
  NOTE_REPOSITORY,
  INoteRepository,
} from '../../domain/interfaces/note-repository.interface';
import {
  NOTE_INGESTION_PROVIDER,
  INoteIngestionProvider,
} from '../../domain/interfaces/note-ingestion-provider.interface';
import { StickyNote } from '../../domain/models/note.model';

@Injectable()
export class NoteService implements OnModuleInit {
  private readonly logger = new Logger(NoteService.name);
  private readonly BATCH_SIZE = 1000;

  constructor(
    @Inject(NOTE_REPOSITORY) private readonly noteRepository: INoteRepository,
    @Inject(NOTE_INGESTION_PROVIDER)
    private readonly ingestionProvider: INoteIngestionProvider,
  ) {}

  /**
   * Lifecycle hook: Runs on application startup
   * Triggers data ingestion from provider into repository
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('🚀 Starting data ingestion...');
    const startTime = Date.now();

    try {
      await this.ingestData();
      const duration = Date.now() - startTime;
      const totalNotes = await this.noteRepository.getCount();
      this.logger.log(
        `✅ Data ingestion complete. Loaded ${totalNotes} notes in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error('❌ Data ingestion failed', error);
      throw error;
    }
  }

  /**
   * Ingests data from provider in batches
   * Protects memory and event loop by processing notes in chunks
   */
  private async ingestData(): Promise<void> {
    const batch: StickyNote[] = [];
    let processedCount = 0;

    // Stream notes from provider and accumulate in batch
    for await (const rawNote of this.ingestionProvider.getNoteStream()) {
      try {
        // Transform raw note to domain model
        const domainNote: StickyNote = {
          id: rawNote.id,
          text: rawNote.text,
          x: rawNote.x,
          y: rawNote.y,
          author: rawNote.author,
          color: rawNote.color,
          createdAt: new Date(rawNote.createdAt),
        };

        batch.push(domainNote);
        processedCount++;

        // Flush batch when it reaches BATCH_SIZE
        if (batch.length >= this.BATCH_SIZE) {
          await this.noteRepository.saveBulk(batch);
          this.logger.debug(
            `Flushed batch of ${batch.length} notes (total processed: ${processedCount})`,
          );
          batch.length = 0;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to map note ${rawNote?.id}: ${errorMessage}`,
        );
        // Continue processing other notes
      }
    }

    // Flush remaining notes
    if (batch.length > 0) {
      await this.noteRepository.saveBulk(batch);
      this.logger.debug(
        `Flushed final batch of ${batch.length} notes (total processed: ${processedCount})`,
      );
    }
  }

  /**
   * Query all notes with pagination
   */
  async getNotes(offset: number = 0, limit: number = 10): Promise<{
    items: StickyNote[];
    total: number;
    offset: number;
    limit: number;
  }> {
    this.validatePagination(offset, limit);
    const result = await this.noteRepository.getAll(offset, limit);

    return {
      items: result.items,
      total: result.total,
      offset,
      limit,
    };
  }

  /**
   * Query a single note by ID
   * 
   * Note: ID validation is handled at the controller level via ParseIntPipe.
   * This method receives a guaranteed integer.
   */
  async getNoteById(id: number): Promise<StickyNote | null> {
    return this.noteRepository.getById(id);
  }

  /**
   * Query notes by author
   */
  async getNotesByAuthor(
    author: string,
    offset: number = 0,
    limit: number = 10,
  ): Promise<{
    items: StickyNote[];
    total: number;
    author: string;
    offset: number;
    limit: number;
  }> {
    if (!author || author.trim() === '') {
      throw new BadRequestException('Author name is required');
    }

    this.validatePagination(offset, limit);
    const result = await this.noteRepository.findByAuthor(author, offset, limit);

    return {
      items: result.items,
      total: result.total,
      author,
      offset,
      limit,
    };
  }

  /**
   * Query notes by color
   */
  async getNotesByColor(
    color: string,
    offset: number = 0,
    limit: number = 10,
  ): Promise<{
    items: StickyNote[];
    total: number;
    color: string;
    offset: number;
    limit: number;
  }> {
    if (!color || color.trim() === '') {
      throw new BadRequestException('Color is required');
    }

    this.validatePagination(offset, limit);
    const result = await this.noteRepository.findByColor(color, offset, limit);

    return {
      items: result.items,
      total: result.total,
      color,
      offset,
      limit,
    };
  }

  /**
   * Query notes by date range
   */
  async getNotesByDateRange(
    startDate: string,
    endDate: string,
    offset: number = 0,
    limit: number = 10,
  ): Promise<{
    items: StickyNote[];
    total: number;
    startDate: string;
    endDate: string;
    offset: number;
    limit: number;
  }> {
    let start: Date;
    let end: Date;

    try {
      start = new Date(startDate);
      end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Invalid date format');
      }

      if (start > end) {
        throw new Error('Start date must be before end date');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Invalid date range: ${errorMessage}. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)`,
      );
    }

    this.validatePagination(offset, limit);
    const result = await this.noteRepository.findByDateRange(
      start,
      end,
      offset,
      limit,
    );

    return {
      items: result.items,
      total: result.total,
      startDate,
      endDate,
      offset,
      limit,
    };
  }

  /**
   * Get recently added notes
   */
  async getRecentNotes(limit: number = 10): Promise<StickyNote[]> {
    if (limit < 1 || limit > 1000) {
      throw new BadRequestException('Limit must be between 1 and 1000');
    }

    return this.noteRepository.getRecent(limit);
  }

  /**
   * Get aggregated statistics
   */
  async getStatistics(): Promise<{
    totalNotes: number;
    uniqueAuthors: number;
    uniqueColors: number;
    notesPerAuthor: Record<string, number>;
    notesPerColor: Record<string, number>;
  }> {
    return this.noteRepository.getBasicStats();
  }

  /**
   * Validate pagination parameters
   */
  private validatePagination(offset: number, limit: number): void {
    if (offset < 0) {
      throw new BadRequestException('Offset must be non-negative');
    }
    if (limit < 1 || limit > 1000) {
      throw new BadRequestException('Limit must be between 1 and 1000');
    }
  }
}
