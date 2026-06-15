export function mapRelayCloseError(code: number, reason: Buffer, fallback: string) {
  const text = reason.toString("utf8").trim();
  if (code === 1008 && text === "unauthorized") return "unauthorized";
  return text || fallback;
}
