/**
 * Data Transfer Object for GET /notes query parameters
 * 
 * Ensures all query inputs are validated and transformed before reaching the service layer.
 * Protects against malformed input (e.g., limit=apple, offset=-5) and enforces business rules.
 */

import { IsOptional, IsInt, Min, Max } from 'class-validator';
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
