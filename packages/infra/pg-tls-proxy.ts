import { type Server, type Socket, connect as tcpConnect, createServer } from "node:net";
import { connect as tlsConnect } from "node:tls";

// Postgres SSLRequest: message length 8, request code 80877103.
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);
const SSL_ACCEPTED = 0x53; // "S"

export type PgTlsProxyOptions = {
  listenPort: number;
  host: string;
  port: number;
  /** PEM CA certificate the database's certificate must chain to. */
  ca: string;
};

// In `alchemy dev`, Hyperdrive hands the Worker the origin itself, and workerd only trusts public CAs,
// so it cannot open TLS to a database signed by a private CA (Aiven). The Worker talks plaintext to
// this proxy on loopback; the proxy speaks TLS to the database and verifies it against `ca`.
export function startPgTlsProxy(options: PgTlsProxyOptions): Promise<Server> {
  const server = createServer((client) => {
    client.pause();
    const upstream = tcpConnect({ host: options.host, port: options.port });
    const close = (error?: Error) => {
      if (error) console.error(`[pg-tls-proxy] ${error.message}`);
      client.destroy();
      upstream.destroy();
    };
    client.once("error", () => close());
    upstream.once("error", close);
    upstream.once("connect", () => upstream.write(SSL_REQUEST));
    upstream.once("data", (reply) => {
      if (reply[0] !== SSL_ACCEPTED) return close(new Error("The database refused TLS."));
      const secure = tlsConnect({ socket: upstream, ca: options.ca, servername: options.host });
      secure.once("error", close);
      secure.once("secureConnect", () => pipeBoth(client, secure, close));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listenPort, "127.0.0.1", () => resolve(server));
  });
}

function pipeBoth(client: Socket, secure: Socket, close: () => void) {
  client.pipe(secure).pipe(client);
  client.once("close", close);
  secure.once("close", close);
  client.resume();
}
