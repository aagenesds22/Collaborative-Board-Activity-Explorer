/**
 * WebSocket Gateway - Real-Time Collaborative Mutations
 * 
 * Handles WebSocket connections via Socket.IO for real-time sticky note mutations.
 * 
 * Architecture:
 * - Namespace: /board
 * - Room: board-0 (globally shared board for MVP)
 * - Transport: WebSocket (primary) + HTTP polling (fallback)
 * 
 * Event Flow:
 * 1. Client sends 'note.update' event with mutation payload
 * 2. Gateway validates and passes to CrdtService
 * 3. CrdtService performs CRDT merge (timestamp-based conflict resolution)
 * 4. Gateway broadcasts 'note.mutated' or 'note.conflict' to room
 * 5. All clients receive authoritative merged state
 * 
 * Error Handling:
 * - Validation failures: 'note.error' event with error message
 * - Stale operations: 'note.conflict' event with current state
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CrdtService } from '../application/services/crdt.service';

const BOARD_NAMESPACE = '/board';
const BOARD_ROOM = 'board-0'; // Single board for MVP

interface MutationPayload {
  noteId: number;
  property: 'text' | 'x' | 'y' | 'color';
  value: any;
  clientTimestamp: number;
  clientId: string;
}

@WebSocketGateway({
  namespace: BOARD_NAMESPACE,
  cors: {
    origin: '*', // In production: specify allowed origins
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
@Injectable()
export class NotesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotesGateway.name);

  constructor(private readonly crdtService: CrdtService) {}

  /**
   * Handle client connection
   * 
   * @param client Connected socket
   */
  handleConnection(client: Socket): void {
    const remoteAddress = client.handshake?.address || 'unknown';
    const totalConnected = this.server?.sockets?.sockets?.size || 1;
    this.logger.log(
      `[${client.id}] [CONNECT] Connected from ${remoteAddress}. Total connected: ${totalConnected}`,
    );

    // Join the globally shared board room
    client.join(BOARD_ROOM);
    const roomSize = this.server?.sockets?.adapter?.rooms?.get(BOARD_ROOM)?.size || 0;
    this.logger.debug(
      `[${client.id}] Joined room '${BOARD_ROOM}'. Room size: ${roomSize}`,
    );

    // Notify other clients that a user joined (optional)
    this.server.to(BOARD_ROOM).emit('user.joined', {
      userId: client.id,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle client disconnection
   * 
   * @param client Disconnected socket
   */
  handleDisconnect(client: Socket): void {
    const roomSize = Math.max(0, (this.server?.sockets?.adapter?.rooms?.get(BOARD_ROOM)?.size || 1) - 1);
    const totalConnected = Math.max(0, (this.server?.sockets?.sockets?.size || 1) - 1);
    this.logger.log(
      `[${client.id}] [DISCONNECT] Disconnected. Remaining in room: ${roomSize}. Total connected: ${totalConnected}`,
    );

    // Notify other clients that a user left (optional)
    this.server.to(BOARD_ROOM).emit('user.left', {
      userId: client.id,
      timestamp: Date.now(),
    });
  }

  /**
   * Subscribe to mutation events from clients
   * 
   * Event: 'note.update'
   * Payload: { noteId, property, value, clientTimestamp, clientId }
   * 
   * Returns: 'note.mutated' (success) | 'note.conflict' (stale) | 'note.error' (validation failure)
   * 
   * @param payload Mutation request from client
   * @param client Sending socket
   */
  @SubscribeMessage('note.update')
  async handleNoteUpdate(
    @MessageBody() payload: MutationPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      // Validate payload structure
      if (
        typeof payload !== 'object' ||
        !payload.noteId ||
        !payload.property ||
        payload.value === undefined ||
        typeof payload.clientTimestamp !== 'number'
      ) {
        client.emit('note.error', {
          message: 'Invalid mutation payload',
          receivedPayload: payload,
        });
        this.logger.warn(
          `[${client.id}] Invalid mutation payload: ${JSON.stringify(payload)}`,
        );
        return;
      }

      this.logger.log(
        `[${client.id}] [RX] note.update: noteId=${payload.noteId}, ` +
        `property=${payload.property}, value=${JSON.stringify(payload.value).substring(0, 50)}`,
      );

      // Process mutation via CRDT service
      const result = await this.crdtService.handleMutation(
        payload.noteId,
        payload.property,
        payload.value,
        payload.clientTimestamp,
        payload.clientId || client.id,
      );

      if (result.wasUpdated) {
        // Broadcast accepted mutation to all clients in the room (including sender for confirmation)
        this.server.to(BOARD_ROOM).emit('note.mutated', {
          noteId: payload.noteId,
          property: payload.property,
          mergedState: result.state,
          clientId: payload.clientId || client.id,
          clientTimestamp: payload.clientTimestamp,
          serverTimestamp: Date.now(),
        });

        this.logger.log(
          `[${client.id}] [OK] Mutation accepted and broadcast: note=${payload.noteId}, property=${payload.property}`,
        );
      } else {
        // Stale operation: send conflict back to client with authoritative state
        client.emit('note.conflict', {
          noteId: payload.noteId,
          property: payload.property,
          reason: 'Operation older than current state',
          currentState: result.state,
          clientTimestamp: payload.clientTimestamp,
          serverTimestamp: Date.now(),
        });

        this.logger.warn(
          `[${client.id}] [STALE] Mutation rejected: noteId=${payload.noteId}, ` +
          `clientTs=${payload.clientTimestamp}, serverTs=${Date.now()}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof BadRequestException
          ? String((error.getResponse() as any)['message'] || error.message)
          : error instanceof Error
            ? error.message
            : 'Unknown error';

      client.emit('note.error', {
        message: errorMessage,
        noteId: payload?.noteId,
        property: payload?.property,
        timestamp: Date.now(),
      });

      this.logger.error(
        `[${client.id}] [ERROR] Mutation failed: noteId=${payload?.noteId}, ` +
        `property=${payload?.property}, error="${errorMessage}"`,
      );
    }
  }
}
