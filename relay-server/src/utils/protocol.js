export function normalizePassword(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveTargetPlayerId(payload) {
  return payload?.__relayTo || payload?.relayTo || payload?.to || payload?.targetPlayerId || payload?.payload?.__relayTo;
}

export function decodeBinaryEnvelope(buffer) {
  if (buffer.length < 4) return null;
  const headerLength = buffer.readUInt32BE(0);
  if (headerLength <= 0 || headerLength > buffer.length - 4) return null;
  try {
    return {
      header: JSON.parse(buffer.subarray(4, 4 + headerLength).toString("utf8")),
      body: buffer.subarray(4 + headerLength),
    };
  } catch {
    return null;
  }
}

export function normalizeBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return null;
}

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
