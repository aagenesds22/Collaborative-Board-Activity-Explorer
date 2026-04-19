/**
 * Application Bootstrap
 * 
 * Entry point for the Mural Board Activity Explorer API.
 * Sets up the NestJS application, enables global error handling,
 * and starts listening on the configured port.
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

const logger = new Logger('Mural');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;

  // Global validation pipe: automatically validate and transform all inputs
  // Rejects requests with validation errors (bad query params, malformed data, etc.)
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true, // Auto-convert types (string '10' → number 10)
      whitelist: true, // Strip unknown properties from DTOs
      forbidNonWhitelisted: false, // Allow extra properties (lenient mode for MVP)
      skipMissingProperties: true, // Use default values from DTO @IsOptional()
    }),
  );

  // Enable CORS for frontend requests (if needed)
  app.enableCors({
    origin: '*',
    methods: 'GET',
    credentials: false,
  });

  // Global prefix for API versioning
  app.setGlobalPrefix('api');

  await app.listen(port, () => {
    logger.log(
      `🎨 Mural Board Activity Explorer API started on http://localhost:${port}`,
    );
    logger.log(
      `📚 API endpoints available at http://localhost:${port}/api/notes`,
    );
  });
}

bootstrap().catch((error) => {
  logger.error('Failed to start application', error);
  process.exit(1);
});
