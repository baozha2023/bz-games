export interface BinaryEnvelope<T = unknown> {
  header: T;
  body: Buffer;
}

export function encodeBinaryEnvelope<T>(header: T, body: Buffer): Buffer {
  const headerBuffer = Buffer.from(JSON.stringify(header), "utf8");
  const lengthBuffer = Buffer.allocUnsafe(4);
  lengthBuffer.writeUInt32BE(headerBuffer.length, 0);
  return Buffer.concat([lengthBuffer, headerBuffer, body]);
}

export function decodeBinaryEnvelope<T>(data: Buffer): BinaryEnvelope<T> | null {
  try {
    if (data.length < 4) return null;
    const headerLength = data.readUInt32BE(0);
    const bodyOffset = 4 + headerLength;
    if (headerLength <= 0 || bodyOffset > data.length) return null;
    const header = JSON.parse(data.subarray(4, bodyOffset).toString("utf8")) as T;
    if (!header || typeof header !== "object") return null;
    return {
      header,
      body: data.subarray(bodyOffset),
    };
  } catch {
    return null;
  }
}

export function toBinaryBody(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}
