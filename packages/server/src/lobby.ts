import { Room } from './room';
import type { ProfileStore } from './db';
import type { WorldStore } from './world-store';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export class LobbyManager {
  private rooms = new Map<string, Room>();

  constructor(private store: ProfileStore, private worlds: WorldStore) {}

  createRoom(solo: boolean): Room {
    let code: string;
    do {
      code = Array.from({ length: 5 }, () =>
        CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    // party id == lobby code (stable per lobby) — world persistence key
    const room = new Room(code, solo, this.store, this.worlds, code, c => this.rooms.delete(c));
    this.rooms.set(code, room);
    return room;
  }

  /** Returns the room if joinable, or the player's existing room (reconnect). */
  findJoinable(code: string, deviceId: string): Room | null {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    if (room.isJoinable) return room;
    if (room.hasDevice(deviceId)) return room;
    return null;
  }

  get roomCount(): number { return this.rooms.size; }
}
