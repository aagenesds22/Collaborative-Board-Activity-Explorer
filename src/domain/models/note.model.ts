/**
 * Domain Models for Sticky Notes
 * 
 * RawStickyNote: Raw data structure from seed file (JSON Lines)
 * StickyNote: Domain model used throughout the application
 */

export interface RawStickyNote {
  id: number;
  text: string;
  x: number;
  y: number;
  author: string;
  color: string;
  createdAt: string; // ISO 8601 string from JSON
}

export interface StickyNote {
  id: number;
  text: string;
  x: number;
  y: number;
  author: string;
  color: string;
  createdAt: Date; // Parsed to Date object
}
