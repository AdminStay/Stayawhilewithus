// Minimal typing for the `ws` package surface used by ./control.ts (the
// package ships no types and @types/ws isn't installed). Only what we call.
declare module "ws" {
  interface ClientOptions {
    headers?: Record<string, string>;
    origin?: string;
    handshakeTimeout?: number;
    perMessageDeflate?: boolean;
  }

  class WebSocket {
    constructor(address: string, options?: ClientOptions);
    static readonly OPEN: number;
    readonly readyState: number;
    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: unknown) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "close", listener: (code: number) => void): this;
    on(
      event: "unexpected-response",
      listener: (req: unknown, res: { statusCode?: number }) => void,
    ): this;
    send(data: string, cb?: (err?: Error) => void): void;
    close(): void;
    terminate(): void;
  }

  // Matches the real package: `ws` exposes the class as its default export.
  // eslint-disable-next-line import/no-default-export
  export default WebSocket;
}
