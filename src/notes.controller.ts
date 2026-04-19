/**
 * Notes Controller
 * 
 * Exposes REST API endpoints for querying sticky note activity.
 * All endpoints are read-only (GET operations) for the MVP.
 * Write operations (POST, PATCH, DELETE) are deferred to future versions.
 * 
 * API Design Principles:
 * - Pagination: offset/limit for MVP (cursor-based documented for production)
 * - Query parameters for filtering and sorting
 * - Consistent response format with metadata
 * - Input validation at controller level
 */

import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  NotFoundException,
  Logger,
  ParseIntPipe,
} from '@nestjs/common';

import { StickyNote } from './domain/models/note.model';
import { NoteService } from './application/services/note.service';
import {
  GetNotesQueryDto,
  GetNotesByAuthorQueryDto,
  GetNotesByColorQueryDto,
  GetNotesByDateRangeQueryDto,
  GetRecentNotesQueryDto,
} from './dtos/query.dtos';

@Controller('notes')
export class NotesController {
  private readonly logger = new Logger(NotesController.name);

  constructor(private readonly noteService: NoteService) {}

  /**
   * GET /notes
   * Retrieve all notes with pagination
   *
   * Query Parameters (validated via DTO):
   *   - offset: number (default: 0, min: 0) - Skip this many records
   *   - limit: number (default: 10, min: 1, max: 1000) - Return this many records
   *
   * Response: Paginated list with total count metadata
   */
  @Get()
  @HttpCode(200)
  async getNotes(@Query() query: GetNotesQueryDto): Promise<{
    items: StickyNote[];
    total: number;
    offset: number;
    limit: number;
  }> {
    this.logger.log(`GET /notes: offset=${query.offset}, limit=${query.limit}`);
    const startTime = Date.now();
    const result = await this.noteService.getNotes(query.offset, query.limit);
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes returned ${result.items.length}/${result.total} notes in ${duration}ms`,
    );
    return result;
  }

  /**
   * GET /notes/by-author/:author
   * Filter notes by author name
   *
   * Path Parameter:
   *   - author: string - Author name to filter by
   *
   * Query Parameters (validated via DTO):
   *   - offset: number (default: 0, min: 0)
   *   - limit: number (default: 10, min: 1, max: 1000)
   *
   * Response: Paginated list of notes by author
   */
  @Get('by-author/:author')
  @HttpCode(200)
  async getNotesByAuthor(
    @Param('author') author: string,
    @Query() query: GetNotesByAuthorQueryDto,
  ): Promise<{
    items: StickyNote[];
    total: number;
    author: string;
    offset: number;
    limit: number;
  }> {
    this.logger.log(`GET /notes/by-author/${author}: offset=${query.offset}, limit=${query.limit}`);
    const startTime = Date.now();
    const result = await this.noteService.getNotesByAuthor(author, query.offset, query.limit);
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes/by-author/${author} returned ${result.items.length}/${result.total} notes in ${duration}ms`,
    );
    return result;
  }

  /**
   * GET /notes/by-color/:color
   * Filter notes by color
   *
   * Path Parameter:
   *   - color: string - Color to filter by
   *
   * Query Parameters (validated via DTO):
   *   - offset: number (default: 0, min: 0)
   *   - limit: number (default: 10, min: 1, max: 1000)
   *
   * Response: Paginated list of notes by color
   */
  @Get('by-color/:color')
  @HttpCode(200)
  async getNotesByColor(
    @Param('color') color: string,
    @Query() query: GetNotesByColorQueryDto,
  ): Promise<{
    items: StickyNote[];
    total: number;
    color: string;
    offset: number;
    limit: number;
  }> {
    this.logger.log(`GET /notes/by-color/${color}: offset=${query.offset}, limit=${query.limit}`);
    const startTime = Date.now();
    const result = await this.noteService.getNotesByColor(color, query.offset, query.limit);
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes/by-color/${color} returned ${result.items.length}/${result.total} notes in ${duration}ms`,
    );
    return result;
  }

  /**
   * GET /notes/by-date-range
   * Filter notes by creation date range
   *
   * Query Parameters (validated via DTO):
   *   - start: string (required) - ISO 8601 start date (e.g., 2024-01-01T00:00:00Z)
   *   - end: string (required) - ISO 8601 end date (e.g., 2024-12-31T23:59:59Z)
   *   - offset: number (default: 0, min: 0)
   *   - limit: number (default: 10, min: 1, max: 1000)
   *
   * Response: Paginated list of notes within date range
   */
  @Get('by-date-range')
  @HttpCode(200)
  async getNotesByDateRange(
    @Query() query: GetNotesByDateRangeQueryDto,
  ): Promise<{
    items: StickyNote[];
    total: number;
    startDate: string;
    endDate: string;
    offset: number;
    limit: number;
  }> {
    this.logger.log(
      `GET /notes/by-date-range: start=${query.start}, end=${query.end}, offset=${query.offset}, limit=${query.limit}`,
    );
    const startTime = Date.now();
    const result = await this.noteService.getNotesByDateRange(
      query.start,
      query.end,
      query.offset,
      query.limit,
    );
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes/by-date-range returned ${result.items.length}/${result.total} notes in ${duration}ms`,
    );
    return result;
  }

  /**
   * GET /notes/stats
   * Get aggregated statistics across all notes
   *
   * Response:
   *   - totalNotes: Total count of all notes
   *   - uniqueAuthors: Number of unique authors
   *   - uniqueColors: Number of unique colors
   *   - notesPerAuthor: Distribution of notes by author
   *   - notesPerColor: Distribution of notes by color
   */
  @Get('stats')
  @HttpCode(200)
  async getStatistics(): Promise<{
    totalNotes: number;
    uniqueAuthors: number;
    uniqueColors: number;
    notesPerAuthor: Record<string, number>;
    notesPerColor: Record<string, number>;
  }> {
    this.logger.log('GET /notes/stats');
    const startTime = Date.now();
    const result = await this.noteService.getStatistics();
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes/stats returned ${result.totalNotes} total notes, ` +
      `${result.uniqueAuthors} authors, ${result.uniqueColors} colors in ${duration}ms`,
    );
    return result;
  }

  /**
   * GET /notes/stats/by-author
   * Get count of notes grouped by author
   *
   * Response: Object with author names as keys and note counts as values
   */
  @Get('stats/by-author')
  @HttpCode(200)
  async getStatsByAuthor(): Promise<Record<string, number>> {
    this.logger.log('GET /notes/stats/by-author');
    const startTime = Date.now();
    const stats = await this.noteService.getStatistics();
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes/stats/by-author returned ${Object.keys(stats.notesPerAuthor).length} authors in ${duration}ms`,
    );
    return stats.notesPerAuthor;
  }

  /**
   * GET /notes/recent
   * Get recently added notes (sorted by creation time, newest first)
   *
   * Query Parameters (validated via DTO):
   *   - limit: number (default: 10, min: 1, max: 1000)
   *
   * Response: Array of recent notes
   */
  @Get('recent')
  @HttpCode(200)
  async getRecentNotes(@Query() query: GetRecentNotesQueryDto): Promise<StickyNote[]> {
    this.logger.log(`GET /notes/recent: limit=${query.limit}`);
    const startTime = Date.now();
    const result = await this.noteService.getRecentNotes(query.limit);
    const duration = Date.now() - startTime;
    this.logger.debug(
      `✓ GET /notes/recent returned ${result.length} notes in ${duration}ms`,
    );
    return result;
  }

  /**
   * GET /notes/:id
   * Retrieve a single note by ID
   *
   * IMPORTANT: This route is defined LAST to avoid catching other routes like /stats, /recent, etc.
   * NestJS matches routes in definition order, so wildcard routes must come after specific ones.
   *
   * Path Parameter (validated via ParseIntPipe):
   *   - id: number (must be a valid integer)
   *
   * Response: Single note object or 404 if not found
   */
  @Get(':id')
  @HttpCode(200)
  async getNoteById(@Param('id', ParseIntPipe) id: number): Promise<StickyNote | null> {
    this.logger.log(`GET /notes/${id}`);
    const startTime = Date.now();
    const note = await this.noteService.getNoteById(id);

    if (!note) {
      this.logger.warn(`Note ${id} not found`);
      throw new NotFoundException(`Note with id '${id}' not found`);
    }

    const duration = Date.now() - startTime;
    this.logger.debug(`✓ GET /notes/${id} returned note in ${duration}ms`);
    return note;
  }
}
