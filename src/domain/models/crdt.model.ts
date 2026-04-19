/**
 * Last-Write-Wins Map (LWW-Map) CRDT Implementation
 * 
 * Architecture:
 * - LWWRegister<T>: Individual property with timestamp-based conflict resolution
 * - StickyNoteCRDT: Wraps StickyNote with LWWRegisters for mutable properties
 * 
 * Conflict Resolution:
 * 1. Compare timestamps: Higher timestamp wins (eventual consistency)
 * 2. Tie-breaker (rare): Lexicographic comparison of JSON.stringify(value)
 *    ensures deterministic ordering across all nodes
 * 
 * Time-Drift Boundary: Server rejects operations with |clientTimestamp - serverTime| > 30s
 * 
 * Properties:
 * - Immutable (after creation): id, author, createdAt
 * - Mutable (via LWWRegister): text, x, y, color
 */

import { RawStickyNote, StickyNote } from './note.model';

/**
 * LWWRegister<T>: Last-Write-Wins Register
 * 
 * Holds a single value with an associated timestamp.
 * When merging with an incoming update, the one with the higher timestamp wins.
 * In case of a tie, lexicographic comparison of stringified values determines order.
 */
export class LWWRegister<T> {
  /**
   * @param value Current value of the register
   * @param timestamp Unix timestamp (milliseconds) when this value was set
   */
  constructor(private value: T, private timestamp: number) {}

  /**
   * Get the current value of this register
   */
  getValue(): T {
    return this.value;
  }

  /**
   * Get the timestamp of the current value
   */
  getTimestamp(): number {
    return this.timestamp;
  }

  /**
   * Merge an incoming value with its timestamp.
   * Returns true if the incoming value is accepted (newer or tie-breaker wins).
   * Returns false if the current value is kept (more recent).
   * 
   * @param incomingValue The new value attempting to update this register
   * @param incomingTimestamp The timestamp associated with the incoming value
   * @returns true if merge accepted (state changed), false otherwise
   */
  merge(incomingValue: T, incomingTimestamp: number): boolean {
    // Higher timestamp always wins (most recent operation)
    if (incomingTimestamp > this.timestamp) {
      this.value = incomingValue;
      this.timestamp = incomingTimestamp;
      return true;
    }

    // Equal timestamp: use lexicographic comparison for deterministic tie-breaking
    if (incomingTimestamp === this.timestamp) {
      const currentStringified = JSON.stringify(this.value);
      const incomingStringified = JSON.stringify(incomingValue);

      // If incoming value is lexicographically larger, accept it
      if (incomingStringified > currentStringified) {
        this.value = incomingValue;
        return true;
      }
    }

    // Incoming timestamp is older; keep current value
    return false;
  }

  /**
   * Create a new LWWRegister by merging without mutating
   */
  static merge<T>(
    current: LWWRegister<T>,
    incomingValue: T,
    incomingTimestamp: number
  ): LWWRegister<T> {
    if (incomingTimestamp > current.getTimestamp()) {
      return new LWWRegister(incomingValue, incomingTimestamp);
    }

    if (incomingTimestamp === current.getTimestamp()) {
      const currentStringified = JSON.stringify(current.getValue());
      const incomingStringified = JSON.stringify(incomingValue);

      if (incomingStringified > currentStringified) {
        return new LWWRegister(incomingValue, incomingTimestamp);
      }
    }

    return current;
  }
}

/**
 * StickyNoteCRDT: CRDT wrapper around a sticky note
 * 
 * Immutable fields (set at creation, never updated):
 * - id, author, createdAt
 * 
 * Mutable fields (wrapped in LWWRegisters for concurrent conflict resolution):
 * - text, x, y, color
 */
export class StickyNoteCRDT {
  /**
   * Immutable metadata (per-note, not per-property)
   */
  private readonly id: number;
  private readonly author: string;
  private readonly createdAt: Date;

  /**
   * Mutable properties with LWW timestamps
   */
  private textRegister: LWWRegister<string>;
  private xRegister: LWWRegister<number>;
  private yRegister: LWWRegister<number>;
  private colorRegister: LWWRegister<string>;

  /**
   * Create a StickyNoteCRDT from a StickyNote (typically on ingestion)
   * 
   * @param note Domain model sticky note
   * @param initialTimestamp Timestamp to associate with initial values (e.g., Date.now())
   */
  constructor(note: StickyNote, initialTimestamp: number) {
    this.id = note.id;
    this.author = note.author;
    this.createdAt = note.createdAt;

    // Wrap mutable properties in LWWRegisters with initial timestamp
    this.textRegister = new LWWRegister(note.text, initialTimestamp);
    this.xRegister = new LWWRegister(note.x, initialTimestamp);
    this.yRegister = new LWWRegister(note.y, initialTimestamp);
    this.colorRegister = new LWWRegister(note.color, initialTimestamp);
  }

  // ==================== Accessors ====================

  getId(): number {
    return this.id;
  }

  getAuthor(): string {
    return this.author;
  }

  getCreatedAt(): Date {
    return this.createdAt;
  }

  getText(): string {
    return this.textRegister.getValue();
  }

  getX(): number {
    return this.xRegister.getValue();
  }

  getY(): number {
    return this.yRegister.getValue();
  }

  getColor(): string {
    return this.colorRegister.getValue();
  }

  // ==================== Property-Level Updates ====================

  /**
   * Update a mutable property via CRDT merge.
   * Performs timestamp-based conflict resolution at property granularity.
   * 
   * @param property One of 'text', 'x', 'y', 'color'
   * @param value New value for the property
   * @param timestamp Client-provided Unix timestamp (milliseconds)
   * @returns true if the update was accepted (state changed), false if rejected (stale)
   * @throws Error if property is immutable or invalid
   */
  updateProperty<K extends 'text' | 'x' | 'y' | 'color'>(
    property: K,
    value: any,
    timestamp: number
  ): boolean {
    switch (property) {
      case 'text':
        if (typeof value !== 'string') {
          throw new Error('text must be a string');
        }
        return this.textRegister.merge(value, timestamp);

      case 'x':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('x must be a finite number');
        }
        return this.xRegister.merge(value, timestamp);

      case 'y':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error('y must be a finite number');
        }
        return this.yRegister.merge(value, timestamp);

      case 'color':
        if (typeof value !== 'string') {
          throw new Error('color must be a string');
        }
        return this.colorRegister.merge(value, timestamp);

      default:
        throw new Error(`Cannot update immutable or invalid property: ${property}`);
    }
  }

  // ==================== Projections ====================

  /**
   * Project the CRDT state back to the domain RawStickyNote schema.
   * This is used by REST API endpoints to expose consistent, clean data.
   * 
   * @returns RawStickyNote with current CRDT values
   */
  toRawSchema(): RawStickyNote {
    return {
      id: this.id,
      text: this.getText(),
      x: this.getX(),
      y: this.getY(),
      author: this.author,
      color: this.getColor(),
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Get metadata about CRDT state (for debugging/diagnostics)
   * 
   * @returns Object with property timestamps and values
   */
  getMetadata(): {
    id: number;
    author: string;
    createdAt: Date;
    mutableProperties: {
      text: { value: string; timestamp: number };
      x: { value: number; timestamp: number };
      y: { value: number; timestamp: number };
      color: { value: string; timestamp: number };
    };
  } {
    return {
      id: this.id,
      author: this.author,
      createdAt: this.createdAt,
      mutableProperties: {
        text: {
          value: this.getText(),
          timestamp: this.textRegister.getTimestamp(),
        },
        x: {
          value: this.getX(),
          timestamp: this.xRegister.getTimestamp(),
        },
        y: {
          value: this.getY(),
          timestamp: this.yRegister.getTimestamp(),
        },
        color: {
          value: this.getColor(),
          timestamp: this.colorRegister.getTimestamp(),
        },
      },
    };
  }
}
