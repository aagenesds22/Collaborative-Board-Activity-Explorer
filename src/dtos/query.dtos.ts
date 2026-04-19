/**
 * Data Transfer Objects for Query Parameters
 * 
 * Ensures all query inputs are validated and transformed before reaching the service layer.
 * Protects against malformed input (e.g., limit=apple, offset=-5) and enforces business rules.
 */

import { IsOptional, IsInt, Min, Max, IsString, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

export class GetNotesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be non-negative' })
  offset?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(1000, { message: 'limit must not exceed 1000' })
  limit?: number = 10;
}

export class GetNotesByAuthorQueryDto {
  @IsString({ message: 'author must be a string' })
  author: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be non-negative' })
  offset?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(1000, { message: 'limit must not exceed 1000' })
  limit?: number = 10;
}

export class GetNotesByColorQueryDto {
  @IsString({ message: 'color must be a string' })
  color: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be non-negative' })
  offset?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(1000, { message: 'limit must not exceed 1000' })
  limit?: number = 10;
}

export class GetNotesByDateRangeQueryDto {
  @IsISO8601({}, { message: 'start must be a valid ISO 8601 date' })
  start: string;

  @IsISO8601({}, { message: 'end must be a valid ISO 8601 date' })
  end: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be non-negative' })
  offset?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(1000, { message: 'limit must not exceed 1000' })
  limit?: number = 10;
}

export class GetRecentNotesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(1000, { message: 'limit must not exceed 1000' })
  limit?: number = 10;
}
