import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const token = `relay-test-${Date.now()}`;
const port = Number(process.env.RELAY_E2E_PORT || 39190);
const baseHttpUrl = `http://127.0.0.1:${port}`;
const baseWsUrl = `ws://127.0.0.1:${port}`;
const waitTimeoutMs = 2500;

let serverProcess = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeBinaryEnvelope(header, body) {
  const headerBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const lengthBuffer = Buffer.allocUnsafe(4);
  lengthBuffer.writeUInt32BE(headerBuffer.length, 0);
  return Buffer.concat([lengthBuffer, headerBuffer, body]);
}

function decodeBinaryEnvelope(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const headerLength = data.readUInt32BE(0);
  return {
    header: JSON.parse(data.subarray(4, 4 + headerLength).toString("utf8")),
    body: data.subarray(4 + headerLength),
  };
}

function readSensitiveSample() {
  const vocabularyDir = path.join(projectRoot, "src", "vocabulary");
  const words = fs
    .readdirSync(vocabularyDir)
    .filter((fileName) => fileName.endsWith(".txt"))
    .flatMap((fileName) =>
      fs
        .readFileSync(path.join(vocabularyDir, fileName), "utf8")
        .split(/\r?\n/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 2),
    );
  assert(words.length > 0, "敏感词词库为空，无法测试过滤");
  return words.sort((a, b) => b.length - a.length)[0];
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8000) {
    try {
      const response = await fetch(`${baseHttpUrl}/health`, {
        headers: { "x-relay-token": token },
      });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("中继服务器启动超时");
}

function startServer() {
  serverProcess = spawn(process.execPath, ["src/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      RELAY_TOKEN: token,
      ROOM_TTL_MS: "60000",
      MAX_ROOMS: "10",
      MAX_CLIENTS: "30",
      MAX_CLIENTS_PER_ROOM: "10",
      MAX_EVENT_LOOP_DELAY_MS: "10000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (data) =>
    process.stdout.write(`[server] ${data}`),
  );
  serverProcess.stderr.on("data", (data) =>
    process.stderr.write(`[server] ${data}`),
  );
}

async function stopServer() {
  if (!serverProcess) return;
  const current = serverProcess;
  serverProcess = null;
  current.kill();
  await new Promise((resolve) => current.once("exit", resolve));
}

function connectClient(name, authorized = true) {
  const url = authorized
    ? `${baseWsUrl}/?relayToken=${encodeURIComponent(token)}`
    : baseWsUrl;
  const ws = new WebSocket(url);
  const messages = [];
  const binaries = [];
  let closed = false;
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      binaries.push(Buffer.from(data));
      return;
    }
    messages.push(JSON.parse(Buffer.from(data).toString("utf8")));
  });
  ws.on("close", () => {
    closed = true;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${name} 连接超时`)),
      waitTimeoutMs,
    );
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({
        name,
        ws,
        messages,
        binaries,
        get closed() {
          return closed;
        },
      });
    });
    ws.once("error", reject);
  });
}

function sendJson(client, message) {
  client.ws.send(JSON.stringify(message));
}

async function waitFor(client, predicate, label, listName = "messages") {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitTimeoutMs) {
    const found = client[listName].find(predicate);
    if (found) return found;
    await sleep(20);
  }
  throw new Error(`${client.name} 未收到预期消息：${label}`);
}

async function assertNoMessage(
  client,
  predicate,
  label,
  listName = "messages",
) {
  await sleep(350);
  const found = client[listName].find(predicate);
  assert(!found, `${client.name} 不应收到消息：${label}`);
}

async function httpJson(pathname, expectedStatus = 200) {
  const response = await fetch(`${baseHttpUrl}${pathname}`, {
    headers: { "x-relay-token": token },
  });
  assert(
    response.status === expectedStatus,
    `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`,
  );
  return await response.json();
}

async function expectUnauthorizedHttp() {
  const response = await fetch(`${baseHttpUrl}/health`);
  assert(
    response.status === 401,
    `未鉴权 HTTP 应返回 401，实际为 ${response.status}`,
  );
}

async function expectUnauthorizedWs() {
  const client = await connectClient("unauthorized", false);
  const startedAt = Date.now();
  while (!client.closed && Date.now() - startedAt < waitTimeoutMs)
    await sleep(20);
  assert(client.closed, "未鉴权 WebSocket 应被关闭");
}

async function hostRoom(client, roomId, extra = {}) {
  sendJson(client, {
    type: "relay:host",
    payload: {
      token,
      roomId,
      playerId: client.name,
      hostName: client.name,
      gameId: "relay-test-game",
      gameName: "Relay Test Game",
      gameVersion: "1.0.0",
      maxPlayers: 4,
      state: "waiting",
      ...extra,
    },
  });
  const ack = await waitFor(
    client,
    (message) => message.type === "relay:host:ack",
    "relay:host:ack",
  );
  assert(
    typeof ack.payload.roomCode === "string" && ack.payload.roomCode.length > 0,
    "房间码无效",
  );
  return ack.payload.roomCode;
}

async function joinRoom(client, roomCode, password) {
  sendJson(client, {
    type: "relay:join",
    payload: {
      token,
      roomCode,
      playerId: client.name,
      password,
    },
  });
}

async function main() {
  startServer();
  await waitForServer();

  await expectUnauthorizedHttp();
  await expectUnauthorizedWs();

  const health = await httpJson("/health");
  assert(health.ok === true, "/health ok 应为 true");
  assert(
    health.limits.maxClientsPerRoom === 10,
    "/health 应返回单房 10 人上限",
  );

  const host = await connectClient("host");
  const roomCode = await hostRoom(host, "room-main");
  const rooms = await httpJson("/rooms");
  assert(
    rooms.some(
      (room) => room.roomCode === roomCode && room.hasPassword === false,
    ),
    "/rooms 应返回当前无密码房间",
  );

  sendJson(host, {
    type: "relay:room:password:update",
    payload: { roomPassword: "secret" },
  });
  await sleep(100);
  const passwordRooms = await httpJson("/rooms");
  assert(
    passwordRooms.some(
      (room) => room.roomCode === roomCode && room.hasPassword === true,
    ),
    "设置密码后 /rooms 应显示 hasPassword",
  );

  const probe = await connectClient("probe");
  sendJson(probe, {
    type: "relay:room:password:probe",
    payload: { token, roomCode },
  });
  const probeAck = await waitFor(
    probe,
    (message) => message.type === "relay:room:password:probe:ack",
    "password probe ack",
  );
  assert(
    probeAck.payload.hasPassword === true,
    "密码探测应返回 hasPassword=true",
  );
  assert(probeAck.payload.hostId === "host", "密码探测应返回房主 ID");

  const wrongGuest = await connectClient("wrongGuest");
  await joinRoom(wrongGuest, roomCode, "wrong");
  const wrongAck = await waitFor(
    wrongGuest,
    (message) => message.type === "relay:error",
    "password incorrect",
  );
  assert(
    wrongAck.payload.code === "password_incorrect",
    "错误密码应返回 password_incorrect",
  );

  const guest = await connectClient("guest");
  await joinRoom(guest, roomCode, "secret");
  const joinAck = await waitFor(
    guest,
    (message) => message.type === "relay:join:ack",
    "relay:join:ack",
  );
  assert(joinAck.payload.hostId === "host", "join ack hostId 不正确");

  sendJson(guest, {
    type: "relay:latency:ping",
    payload: { probeId: "ping-1", sentAt: Date.now() },
  });
  await waitFor(
    guest,
    (message) =>
      message.type === "relay:latency:pong" &&
      message.payload.probeId === "ping-1",
    "latency pong",
  );

  sendJson(guest, {
    type: "relay:latency:probe",
    __relayTo: "host",
    payload: { probeId: "probe-1", sentAt: Date.now(), fromPlayerId: "guest" },
  });
  await waitFor(
    host,
    (message) =>
      message.type === "relay:latency:probe" &&
      message.payload.probeId === "probe-1",
    "forward latency probe",
  );

  const sensitiveWord = readSensitiveSample();
  const normalText = "今天天气不错，适合一起玩游戏。";
  const sensitiveText = `正常前缀${sensitiveWord}正常后缀`;

  sendJson(host, {
    type: "room:chat",
    payload: {
      id: "chat-normal",
      senderId: "host",
      content: normalText,
      contentType: "text",
      timestamp: Date.now(),
    },
  });
  const normalReceived = await waitFor(
    guest,
    (message) => message.payload?.id === "chat-normal",
    "正常文本聊天",
  );
  assert(normalReceived.payload.content === normalText, "正常文本不应被修改");

  sendJson(host, {
    type: "room:chat",
    payload: {
      id: "chat-sensitive",
      senderId: "host",
      content: sensitiveText,
      contentType: "text",
      timestamp: Date.now(),
    },
  });
  const sensitiveReceived = await waitFor(
    guest,
    (message) => message.payload?.id === "chat-sensitive",
    "敏感词文本聊天",
  );
  assert(
    !sensitiveReceived.payload.content.includes(sensitiveWord),
    "敏感词文本应被过滤",
  );
  assert(
    sensitiveReceived.payload.content.includes("*"),
    "敏感词文本应显示星号",
  );

  sendJson(host, {
    type: "room:chat",
    payload: {
      id: "chat-mixed-normal-image",
      senderId: "host",
      content: normalText,
      contentType: "mixed",
      images: ["data:image/png;base64,abc"],
      timestamp: Date.now(),
    },
  });
  await assertNoMessage(
    guest,
    (message) => message.payload?.id === "chat-mixed-normal-image",
    "正常文本+图片混合消息应被拦截",
  );

  sendJson(host, {
    type: "room:chat",
    payload: {
      id: "chat-mixed-sensitive-image",
      senderId: "host",
      content: sensitiveText,
      contentType: "mixed",
      images: ["data:image/png;base64,abc"],
      timestamp: Date.now(),
    },
  });
  await assertNoMessage(
    guest,
    (message) => message.payload?.id === "chat-mixed-sensitive-image",
    "敏感文本+图片混合消息应被拦截",
  );

  sendJson(host, {
    type: "room:chat",
    payload: {
      id: "chat-audio",
      senderId: "host",
      content: "data:audio/webm;base64,abc",
      contentType: "audio",
      timestamp: Date.now(),
    },
  });
  const audioReceived = await waitFor(
    guest,
    (message) => message.payload?.id === "chat-audio",
    "语音消息",
  );
  assert(audioReceived.payload.contentType === "audio", "语音消息应正常转发");

  sendJson(host, {
    type: "room:chat",
    payload: {
      id: "chat-image",
      senderId: "host",
      content: "data:image/png;base64,abc",
      contentType: "image",
      timestamp: Date.now(),
    },
  });
  await assertNoMessage(
    guest,
    (message) => message.payload?.id === "chat-image",
    "纯图片消息应被拦截",
  );

  sendJson(guest, {
    type: "room:chat",
    __relayTo: "host",
    payload: {
      id: "guest-chat",
      senderId: "guest",
      content: normalText,
      contentType: "text",
      timestamp: Date.now(),
      __relayTo: "host",
    },
  });
  await waitFor(
    host,
    (message) => message.payload?.id === "guest-chat",
    "客机到房主文本聊天",
  );

  sendJson(host, {
    type: "game:message:relay",
    payload: {
      messageId: "direct-1",
      senderId: "host",
      to: "guest",
      sentAt: Date.now(),
      data: { value: "direct" },
    },
  });
  await waitFor(
    guest,
    (message) =>
      message.type === "game:message:relay" &&
      message.payload.messageId === "direct-1",
    "game direct relay",
  );

  sendJson(host, {
    type: "game:broadcast:relay",
    payload: {
      messageId: "broadcast-1",
      senderId: "host",
      sentAt: Date.now(),
      data: { value: "broadcast" },
    },
  });
  await waitFor(
    guest,
    (message) =>
      message.type === "game:broadcast:relay" &&
      message.payload.messageId === "broadcast-1",
    "game broadcast relay",
  );

  const binaryBody = Buffer.from("binary-payload", "utf8");
  const binaryHeader = {
    type: "game:message:relay",
    payload: {
      messageId: "binary-1",
      senderId: "guest",
      to: "host",
      sentAt: Date.now(),
      binary: true,
    },
  };
  guest.ws.send(
    encodeBinaryEnvelope({ ...binaryHeader, __relayTo: "host" }, binaryBody),
    { binary: true },
  );
  const binaryReceived = await waitFor(
    host,
    () => true,
    "二进制转发",
    "binaries",
  );
  const decodedBinary = decodeBinaryEnvelope(binaryReceived);
  assert(
    decodedBinary.header.type === "game:message:relay",
    "二进制帧 header type 不正确",
  );
  assert(
    decodedBinary.header.payload.messageId === "binary-1",
    "二进制帧 messageId 不正确",
  );
  assert(decodedBinary.body.equals(binaryBody), "二进制帧 body 不一致");

  sendJson(guest, { type: "relay:leave", payload: {} });
  await waitFor(
    host,
    (message) =>
      message.type === "relay:peer:left" &&
      message.payload.playerId === "guest",
    "guest leave notify",
  );

  host.ws.close();
  guest.ws.close();
  probe.ws.close();
  wrongGuest.ws.close();
  console.log("所有中继服务器端到端测试通过");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
  });
