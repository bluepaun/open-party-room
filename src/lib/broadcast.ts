import type { Server } from "socket.io";
import { EV, type GameDTO, type RoomDTO } from "./types";

/**
 * server.js(ts)가 생성한 Socket.IO 인스턴스를 globalThis에 둔다.
 * 커스텀 서버(server.ts)와 Next 서버 액션은 모듈 그래프가 달라
 * globalThis가 두 계층을 잇는 유일한 공유 채널.
 */
type GlobalIo = { __partyIo?: Server };

export function setIo(io: Server) {
  (globalThis as typeof globalThis & GlobalIo).__partyIo = io;
}

export function getIo(): Server | null {
  return (globalThis as typeof globalThis & GlobalIo).__partyIo ?? null;
}

export function emitRoomState(code: string, room: RoomDTO) {
  getIo()?.to(`room:${code}`).emit(EV.roomState, room);
}

export function emitGameState(code: string, game: GameDTO) {
  getIo()?.to(`room:${code}`).emit(EV.gameState, game);
}

export function emitRoomClosed(code: string) {
  getIo()?.to(`room:${code}`).emit(EV.roomClosed, { code });
}
