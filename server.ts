/**
 * 커스텀 서버 — Next.js와 Socket.IO를 같은 HTTP 서버로 묶는다.
 * 실행: tsx server.ts (dev / production 모두)
 */
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { setupSocketServer } from "./src/lib/socket";
import { setIo } from "./src/lib/broadcast";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const hostname = "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });
  setIo(io);
  setupSocketServer(io);

  httpServer.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  httpServer.listen(port, () => {
    console.log(`> 파티룸 ready: http://localhost:${port}`);
    console.log(`> (LAN에서 접속하려면 이 기기의 로컬 IP 사용 — 예: http://192.168.x.x:${port})`);
  });
});
