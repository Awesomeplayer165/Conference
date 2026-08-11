import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const certDirectory = resolve(import.meta.dirname, "../certs");
const keyPath = resolve(certDirectory, "localhost-key.pem");
const certPath = resolve(certDirectory, "localhost-cert.pem");

mkdirSync(certDirectory, { recursive: true });

const result = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "365",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout",
    keyPath,
    "-out",
    certPath,
  ],
  { stdio: "inherit" },
);

if (result.error) {
  console.error("OpenSSL is required to generate local certificates.");
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Created ${keyPath}`);
console.log(`Created ${certPath}`);
