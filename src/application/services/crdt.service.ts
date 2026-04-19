/**
 * CRDT Service - Orchestrates Last-Write-Wins Map operations
 * 
 * Responsibilities:
 * - Validate incoming mutations (property name, value types, timestamp bounds)
 * - Handle property-level conflict resolution via LWWRegister merges
 * - Emit domain events on successful mutations
 * - Return merged state for WebSocket broadcasts
 * 
 * Time-Drift Security:
 * - Rejects operations with |clientTimestamp - serverTime| > 30 seconds
 * - Mitigates malicious clock attacks while tolerating typical network latency
 */

import { Injectable, BadRequestException, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
import { RawStickyNote } from '../../domain/models/note.model';
import { NOTE_REPOSITORY } from '../../domain/interfaces/note-repository.interface';
import { InMemoryNoteRepository } from '../../infrastructure/repositories/in-memory-note.repository';

const TIME_DRIFT_THRESHOLD_MS = 30000; // 30 seconds
const MUTABLE_PROPERTIES = ['text', 'x', 'y', 'color'] as const;
type MutableProperty = typeof MUTABLE_PROPERTIES[number];

@Injectable()
export class CrdtService {
  private readonly logger = new Logger(CrdtService.name);

  constructor(
    @Inject(NOTE_REPOSITORY)
    private readonly repository: InMemoryNoteRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Validate that the client-provided timestamp is within acceptable bounds
   * 
   * @param clientTimestamp Unix timestamp (milliseconds) from client
   * @throws BadRequestException if timestamp drift exceeds threshold
   */
  private validateTimestampDrift(clientTimestamp: number): void {
    const serverTime = Date.now();
    const drift = Math.abs(clientTimestamp - serverTime);

    if (drift > TIME_DRIFT_THRESHOLD_MS) {
      throw new BadRequestException(
        `Timestamp drift exceeds threshold (${drift}ms > ${TIME_DRIFT_THRESHOLD_MS}ms). ` +
        `Client may need NTP synchronization.`,
      );
    }
  }

  /**
   * Validate that the property is mutable
   * 
   * @param property Property name to validate
   * @throws BadRequestException if property is immutable
   */
  private validateProperty(property: string): asserts property is MutableProperty {
    if (!MUTABLE_PROPERTIES.includes(property as any)) {
      throw new BadRequestException(
        `Cannot mutate property "${property}". ` +
        `Mutable properties: ${MUTABLE_PROPERTIES.join(', ')}. ` +
        `Immutable: id, author, createdAt.`,
      );
    }
  }

  /**
   * Validate the value type matches expected schema
   * 
   * @param property Property to update
   * @param value Value to validate
   * @throws BadRequestException if value type is invalid
   */
  private validatePropertyValue(
    property: MutableProperty,
    value: any,
  ): void {
    switch (property) {
      case 'text':
        if (typeof value !== 'string') {
          throw new BadRequestException('text must be a string');
        }
        if (value.length > 5000) {
          throw new BadRequestException('text cannot exceed 5000 characters');
        }
        break;

      case 'x':
      case 'y':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BadRequestException(`${property} must be a finite number`);
        }
        if (value < 0 || value > 10000) {
          throw new BadRequestException(
            `${property} must be between 0 and 10000`,
          );
        }
        break;

      case 'color':
        if (typeof value !== 'string') {
          throw new BadRequestException('color must be a string');
        }
        // Validate against allowed colors
        const allowedColors = [
          'yellow',
          'blue',
          'pink',
          'green',
          'orange',
          'purple',
          'white',
        ];
        if (!allowedColors.includes(value.toLowerCase())) {
          throw new BadRequestException(
            `color must be one of: ${allowedColors.join(', ')}`,
          );
        }
        break;
    }
  }

  /**
   * Process an incoming mutation with CRDT conflict resolution
   * 
   * Flow:
   * 1. Validate timestamp (drift check)
   * 2. Validate property name (mutable only)
   * 3. Validate value type and bounds
   * 4. Perform CRDT merge (property-level LWWRegister)
   * 5. Emit event if accepted
   * 6. Return merged state for broadcast
   * 
   * @param noteId ID of the note to mutate
   * @param property Mutable property ('text', 'x', 'y', 'color')
   * @param value New value
   * @param clientTimestamp Client-provided Unix timestamp (milliseconds)
   * @param clientId Client identifier (for tracing)
   * @returns { accepted: boolean; state: RawStickyNote; wasUpdated: boolean }
   * 
   * @throws BadRequestException on validation failure
   */
  async handleMutation(
    noteId: number,
    property: string,
    value: any,
    clientTimestamp: number,
    clientId: string,
  ): Promise<{
    accepted: boolean;
    state: RawStickyNote;
    wasUpdated: boolean;
  }> {
    // Validation phase
    this.validateTimestampDrift(clientTimestamp);
    this.validateProperty(property);
    this.validatePropertyValue(property, value);

    // Repository merge phase (handles CRDT conflict resolution)
    const result = await this.repository.mergeMutation(
      noteId,
      property,
      value,
      clientTimestamp,
    );

    if (!result.note) {
      throw new BadRequestException(`Note ${noteId} not found`);
    }

    // Event emission (for downstream handlers, caching, etc.)
    if (result.updated) {
      this.eventEmitter.emit('note.mutated', {
        noteId,
        property,
        value,
        clientId,
        clientTimestamp,
        serverTimestamp: Date.now(),
        mergedState: result.note,
      });

      this.logger.log(
        `Mutation accepted: note=${noteId}, property=${property}, ` +
        `clientId=${clientId}, clientTs=${clientTimestamp}`,
      );
    } else {
      // Operation was stale; current state is more recent
      this.eventEmitter.emit('note.stale', {
        noteId,
        property,
        clientId,
        clientTimestamp,
        currentState: result.note,
      });

      this.logger.debug(
        `Mutation rejected (stale): note=${noteId}, property=${property}, ` +
        `clientId=${clientId}, clientTs=${clientTimestamp}`,
      );
    }

    return {
      accepted: true,
      state: result.note,
      wasUpdated: result.updated,
    };
  }

  /**
   * Get the current state of a note (for reconciliation or queries)
   * 
   * @param noteId ID of the note
   * @returns Current state or null if not found
   */
  async getCurrentState(noteId: number): Promise<RawStickyNote | null> {
    const note = await this.repository.getById(noteId);
    if (!note) {
      return null;
    }

    // Convert StickyNote back to RawStickyNote for external API
    return {
      id: note.id,
      text: note.text,
      x: note.x,
      y: note.y,
      author: note.author,
      color: note.color,
      createdAt: note.createdAt.toISOString(),
    };
  }
}
