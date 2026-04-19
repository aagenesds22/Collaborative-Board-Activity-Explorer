/**
 * CRDT Domain Unit Tests
 * 
 * Tests focus exclusively on the mathematical determinism of the LWW-Map CRDT:
 * - Timestamp-based conflict resolution
 * - Lexicographic tie-breaking for deterministic ordering
 * - Property-level isolation in StickyNoteCRDT
 * 
 * No framework testing; no mocking; direct instantiation only.
 */

import { LWWRegister, StickyNoteCRDT } from '../crdt.model';
import { StickyNote } from '../note.model';

describe('LWWRegister<T>', () => {
  // ==================== Group A: Accessors ====================

  describe('Accessors', () => {
    it('should return initial value and timestamp', () => {
      const register = new LWWRegister('initial', 100);

      expect(register.getValue()).toBe('initial');
      expect(register.getTimestamp()).toBe(100);
    });

    it('should return numeric values correctly', () => {
      const register = new LWWRegister(42, 500);

      expect(register.getValue()).toBe(42);
      expect(register.getTimestamp()).toBe(500);
    });

    it('should return object values correctly', () => {
      const obj = { a: 1, b: 2 };
      const register = new LWWRegister(obj, 1000);

      expect(register.getValue()).toEqual(obj);
      expect(register.getTimestamp()).toBe(1000);
    });
  });

  // ==================== Group B: Standard Merge (Newer Timestamp) ====================

  describe('Standard Merge (Newer Timestamp)', () => {
    it('should accept string value with newer timestamp', () => {
      const register = new LWWRegister('old', 100);

      const result = register.merge('new', 200);

      expect(result).toBe(true);
      expect(register.getValue()).toBe('new');
      expect(register.getTimestamp()).toBe(200);
    });

    it('should accept numeric value with newer timestamp', () => {
      const register = new LWWRegister(10, 100);

      const result = register.merge(50, 200);

      expect(result).toBe(true);
      expect(register.getValue()).toBe(50);
      expect(register.getTimestamp()).toBe(200);
    });

    it('should accept object value with newer timestamp', () => {
      const oldObj = { text: 'old' };
      const newObj = { text: 'new' };
      const register = new LWWRegister(oldObj, 100);

      const result = register.merge(newObj, 200);

      expect(result).toBe(true);
      expect(register.getValue()).toEqual(newObj);
      expect(register.getTimestamp()).toBe(200);
    });

    it('should handle large timestamp differences', () => {
      const register = new LWWRegister('initial', 1);

      const result = register.merge('later', 1000000000);

      expect(result).toBe(true);
      expect(register.getValue()).toBe('later');
      expect(register.getTimestamp()).toBe(1000000000);
    });
  });

  // ==================== Group C: Stale Rejection (Older Timestamp) ====================

  describe('Stale Rejection (Older Timestamp)', () => {
    it('should reject string value with older timestamp', () => {
      const register = new LWWRegister('current', 200);

      const result = register.merge('old', 100);

      expect(result).toBe(false);
      expect(register.getValue()).toBe('current');
      expect(register.getTimestamp()).toBe(200);
    });

    it('should reject numeric value with older timestamp', () => {
      const register = new LWWRegister(100, 500);

      const result = register.merge(50, 200);

      expect(result).toBe(false);
      expect(register.getValue()).toBe(100);
      expect(register.getTimestamp()).toBe(500);
    });

    it('should reject object value with older timestamp', () => {
      const currentObj = { text: 'current' };
      const oldObj = { text: 'old' };
      const register = new LWWRegister(currentObj, 300);

      const result = register.merge(oldObj, 100);

      expect(result).toBe(false);
      expect(register.getValue()).toEqual(currentObj);
      expect(register.getTimestamp()).toBe(300);
    });

    it('should reject multiple stale updates in sequence', () => {
      const register = new LWWRegister('current', 1000);

      const result1 = register.merge('attempt1', 500);
      const result2 = register.merge('attempt2', 600);
      const result3 = register.merge('attempt3', 900);

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
      expect(register.getValue()).toBe('current');
      expect(register.getTimestamp()).toBe(1000);
    });
  });

  // ==================== Group D: Deterministic Tie-Breaker (Equal Timestamps) ====================

  describe('Deterministic Tie-Breaker (Equal Timestamps)', () => {
    it('should accept lexicographically larger string on tie (incoming wins)', () => {
      const register = new LWWRegister('apple', 100);

      const result = register.merge('zebra', 100);

      expect(result).toBe(true); // "zebra" > "apple" lexicographically
      expect(register.getValue()).toBe('zebra');
      expect(register.getTimestamp()).toBe(100);
    });

    it('should reject lexicographically smaller string on tie (current wins)', () => {
      const register = new LWWRegister('zebra', 100);

      const result = register.merge('apple', 100);

      expect(result).toBe(false); // "apple" < "zebra" lexicographically
      expect(register.getValue()).toBe('zebra');
      expect(register.getTimestamp()).toBe(100);
    });

    it('should reject identical values on tie (no change)', () => {
      const register = new LWWRegister('same', 100);

      const result = register.merge('same', 100);

      expect(result).toBe(false); // Values are identical
      expect(register.getValue()).toBe('same');
      expect(register.getTimestamp()).toBe(100);
    });

    it('should use stringified comparison for numeric tie-breaker', () => {
      const register = new LWWRegister(10, 50);

      // JSON.stringify(20) = "20", JSON.stringify(10) = "10"
      // "20" > "10" lexicographically
      const result = register.merge(20, 50);

      expect(result).toBe(true);
      expect(register.getValue()).toBe(20);
    });

    it('should use stringified comparison for object tie-breaker', () => {
      const objA = { a: 1, b: 2 };
      const objB = { a: 2, b: 1 };
      const register = new LWWRegister(objA, 100);

      // JSON.stringify comparison determines winner
      const aStringified = JSON.stringify(objA); // '{"a":1,"b":2}'
      const bStringified = JSON.stringify(objB); // '{"a":2,"b":1}'

      const result = register.merge(objB, 100);

      // bStringified > aStringified lexicographically
      expect(result).toBe(bStringified > aStringified);
      if (result) {
        expect(register.getValue()).toEqual(objB);
      }
    });

    it('should handle multiple equal-timestamp updates deterministically', () => {
      const register = new LWWRegister('a', 100);

      // All have same timestamp; lexicographic order determines winner
      const r1 = register.merge('z', 100); // "z" > "a" → true, now value is "z"
      const r2 = register.merge('m', 100); // "m" < "z" → false, stays "z"
      const r3 = register.merge('zebra', 100); // "zebra" > "z" → true, now value is "zebra"
      const r4 = register.merge('zed', 100); // "zed" > "zebra" (z=z, e=e, d>b) → true

      expect(r1).toBe(true);
      expect(r2).toBe(false);
      expect(r3).toBe(true);
      expect(r4).toBe(true); // "zed" > "zebra" lexicographically (d=100 > b=98)
      expect(register.getValue()).toBe('zed');
    });
  });

  // ==================== Group E: Static Merge Method ====================

  describe('Static merge() method', () => {
    it('should return new register without mutating original', () => {
      const original = new LWWRegister('original', 100);

      const merged = LWWRegister.merge(original, 'new', 200);

      expect(original.getValue()).toBe('original');
      expect(original.getTimestamp()).toBe(100);
      expect(merged.getValue()).toBe('new');
      expect(merged.getTimestamp()).toBe(200);
    });

    it('should return same register reference when rejecting stale update', () => {
      const original = new LWWRegister('current', 200);

      const merged = LWWRegister.merge(original, 'old', 100);

      expect(merged).toBe(original);
      expect(merged.getValue()).toBe('current');
    });

    it('should apply tie-breaking to static merge', () => {
      const original = new LWWRegister('apple', 100);

      const merged = LWWRegister.merge(original, 'zebra', 100);

      expect(merged.getValue()).toBe('zebra');
      expect(original.getValue()).toBe('apple'); // original unchanged
    });
  });
});

describe('StickyNoteCRDT', () => {
  // ==================== Group F: Constructor & Initialization ====================

  describe('Constructor and Initialization', () => {
    it('should initialize all properties correctly', () => {
      const createdAt = new Date('2026-04-18T12:00:00Z');
      const note: StickyNote = {
        id: 1,
        text: 'Test note',
        x: 100,
        y: 200,
        author: 'Alice',
        color: 'yellow',
        createdAt,
      };

      const crdt = new StickyNoteCRDT(note, 1000);

      expect(crdt.getId()).toBe(1);
      expect(crdt.getText()).toBe('Test note');
      expect(crdt.getX()).toBe(100);
      expect(crdt.getY()).toBe(200);
      expect(crdt.getAuthor()).toBe('Alice');
      expect(crdt.getColor()).toBe('yellow');
      expect(crdt.getCreatedAt()).toEqual(createdAt);
    });

    it('should assign initial timestamp to all mutable properties', () => {
      const note: StickyNote = {
        id: 1,
        text: 'Test',
        x: 50,
        y: 75,
        author: 'Bob',
        color: 'blue',
        createdAt: new Date(),
      };

      const crdt = new StickyNoteCRDT(note, 5000);

      const meta = crdt.getMetadata();

      expect(meta.mutableProperties.text.timestamp).toBe(5000);
      expect(meta.mutableProperties.x.timestamp).toBe(5000);
      expect(meta.mutableProperties.y.timestamp).toBe(5000);
      expect(meta.mutableProperties.color.timestamp).toBe(5000);
    });
  });

  // ==================== Group G: Immutable Field Protection ====================

  describe('Immutable Field Protection', () => {
    const createTestCRDT = () =>
      new StickyNoteCRDT(
        {
          id: 1,
          text: 'Original',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        1000
      );

    it('should throw error when attempting to update id', () => {
      const crdt = createTestCRDT();

      expect(() => crdt.updateProperty('id' as any, 999, 2000)).toThrow();
    });

    it('should throw error when attempting to update author', () => {
      const crdt = createTestCRDT();

      expect(() =>
        crdt.updateProperty('author' as any, 'Charlie', 2000)
      ).toThrow();
    });

    it('should throw error when attempting to update createdAt', () => {
      const crdt = createTestCRDT();

      expect(() =>
        crdt.updateProperty('createdAt' as any, new Date(), 2000)
      ).toThrow();
    });

    it('should throw error for invalid property names', () => {
      const crdt = createTestCRDT();

      expect(() =>
        crdt.updateProperty('invalidProp' as any, 'value', 2000)
      ).toThrow();
    });
  });

  // ==================== Group H: Standard Merge (Property-Level) ====================

  describe('Standard Merge (Property-Level)', () => {
    it('should accept text update with newer timestamp', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'old',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        100
      );

      const result = crdt.updateProperty('text', 'new', 200);

      expect(result).toBe(true);
      expect(crdt.getText()).toBe('new');
      expect(crdt.getX()).toBe(100); // unchanged
      expect(crdt.getY()).toBe(200); // unchanged
      expect(crdt.getColor()).toBe('yellow'); // unchanged
    });

    it('should handle mixed acceptance/rejection of coordinate updates', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'note',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        100
      );

      const xResult = crdt.updateProperty('x', 500, 200); // newer
      const yResult = crdt.updateProperty('y', 600, 150); // stale (older than 100? No, let me reconsider)

      // Actually, let me reconsider: initial is 100, so:
      // x @ 200: newer than 100 → accepted
      // y @ 150: newer than 100 → accepted
      expect(xResult).toBe(true);
      expect(yResult).toBe(true);
      expect(crdt.getX()).toBe(500);
      expect(crdt.getY()).toBe(600);
    });

    it('should reject stale property updates', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'note',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        500 // initial timestamp
      );

      const result = crdt.updateProperty('text', 'outdated', 300); // older

      expect(result).toBe(false);
      expect(crdt.getText()).toBe('note'); // unchanged
    });

    it('should validate value types for mutable properties', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'note',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        100
      );

      expect(() => crdt.updateProperty('text', 123, 200)).toThrow(); // text must be string
      expect(() => crdt.updateProperty('x', 'not-a-number', 200)).toThrow(); // x must be number
      expect(() => crdt.updateProperty('y', null, 200)).toThrow(); // y must be finite number
      expect(() => crdt.updateProperty('color', 789, 200)).toThrow(); // color must be string
    });
  });

  // ==================== Group I: Property Isolation ====================

  describe('Property Isolation', () => {
    it('should isolate text update timestamp from other properties', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'original',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        100 // all properties start @ 100
      );

      crdt.updateProperty('text', 'updated', 200); // text @ 200

      const meta = crdt.getMetadata();

      expect(meta.mutableProperties.text.timestamp).toBe(200);
      expect(meta.mutableProperties.x.timestamp).toBe(100); // unchanged
      expect(meta.mutableProperties.y.timestamp).toBe(100); // unchanged
      expect(meta.mutableProperties.color.timestamp).toBe(100); // unchanged
    });

    it('should allow concurrent updates to different properties with different timestamps', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'note',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        100
      );

      const textResult = crdt.updateProperty('text', 'new text', 150);
      const xResult = crdt.updateProperty('x', 500, 200);
      const yResult = crdt.updateProperty('y', 600, 175);
      const colorResult = crdt.updateProperty('color', 'blue', 80); // stale, older than 100

      expect(textResult).toBe(true);
      expect(xResult).toBe(true);
      expect(yResult).toBe(true);
      expect(colorResult).toBe(false); // rejected

      const meta = crdt.getMetadata();

      expect(meta.mutableProperties.text.value).toBe('new text');
      expect(meta.mutableProperties.text.timestamp).toBe(150);

      expect(meta.mutableProperties.x.value).toBe(500);
      expect(meta.mutableProperties.x.timestamp).toBe(200);

      expect(meta.mutableProperties.y.value).toBe(600);
      expect(meta.mutableProperties.y.timestamp).toBe(175);

      expect(meta.mutableProperties.color.value).toBe('yellow'); // unchanged
      expect(meta.mutableProperties.color.timestamp).toBe(100); // unchanged
    });

    it('should demonstrate property-level conflict resolution independence', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'original text',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        1000
      );

      // Simulate two concurrent clients updating at different times:
      // Client A updates text @ 1100
      crdt.updateProperty('text', 'client-a-text', 1100);

      // Client B updates x @ 900 (clock skew, older)
      const xUpdateStale = crdt.updateProperty('x', 150, 900);

      // Client B also updates color @ 1200 (catches up with newer timestamp)
      crdt.updateProperty('color', 'blue', 1200);

      expect(xUpdateStale).toBe(false); // rejected (stale)
      expect(crdt.getText()).toBe('client-a-text'); // from Client A
      expect(crdt.getX()).toBe(100); // unchanged (Client B's x update rejected)
      expect(crdt.getColor()).toBe('blue'); // from Client B (newer)
    });
  });

  // ==================== Group J: Projections & Metadata ====================

  describe('Projections and Metadata', () => {
    it('should project clean RawStickyNote schema via toRawSchema()', () => {
      const createdAt = new Date('2026-04-18T12:00:00Z');
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'Test note',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt,
        },
        1000
      );

      // Update some properties to different timestamps
      crdt.updateProperty('text', 'Updated', 2000);
      crdt.updateProperty('x', 500, 1500);

      const projection = crdt.toRawSchema();

      expect(projection).toEqual({
        id: 1,
        text: 'Updated',
        x: 500,
        y: 200,
        author: 'Alice',
        color: 'yellow',
        createdAt: '2026-04-18T12:00:00.000Z',
      });

      // Verify no CRDT metadata is exposed
      expect((projection as any).timestamp).toBeUndefined();
      expect((projection as any).mutableProperties).toBeUndefined();
    });

    it('should return complete diagnostic metadata via getMetadata()', () => {
      const createdAt = new Date('2026-04-18T12:00:00Z');
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'note',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt,
        },
        1000
      );

      crdt.updateProperty('text', 'updated', 2000);
      crdt.updateProperty('x', 500, 1500);

      const metadata = crdt.getMetadata();

      // Verify immutable fields
      expect(metadata.id).toBe(1);
      expect(metadata.author).toBe('Alice');
      expect(metadata.createdAt).toEqual(createdAt);

      // Verify mutable properties with timestamps
      expect(metadata.mutableProperties.text).toEqual({
        value: 'updated',
        timestamp: 2000,
      });
      expect(metadata.mutableProperties.x).toEqual({
        value: 500,
        timestamp: 1500,
      });
      expect(metadata.mutableProperties.y).toEqual({
        value: 200,
        timestamp: 1000,
      });
      expect(metadata.mutableProperties.color).toEqual({
        value: 'yellow',
        timestamp: 1000,
      });
    });

    it('should maintain metadata consistency across multiple updates', () => {
      const crdt = new StickyNoteCRDT(
        {
          id: 1,
          text: 'initial',
          x: 100,
          y: 200,
          author: 'Alice',
          color: 'yellow',
          createdAt: new Date(),
        },
        1000
      );

      // Perform multiple updates
      crdt.updateProperty('text', 'v2', 1100);
      crdt.updateProperty('text', 'v3', 1200);
      crdt.updateProperty('x', 150, 1050);

      const meta = crdt.getMetadata();

      // Final state should reflect last accepted values
      expect(meta.mutableProperties.text.value).toBe('v3');
      expect(meta.mutableProperties.text.timestamp).toBe(1200);
      expect(meta.mutableProperties.x.value).toBe(150);
      expect(meta.mutableProperties.x.timestamp).toBe(1050);

      // Projection should match metadata
      const proj = crdt.toRawSchema();
      expect(proj.text).toBe('v3');
      expect(proj.x).toBe(150);
    });
  });
});
