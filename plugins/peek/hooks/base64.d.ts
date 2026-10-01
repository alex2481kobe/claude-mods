// The mods environment has the base64 methods its own docs use, but neither
// the engine's declarations nor TypeScript's lib declare them yet.
interface Uint8Array {
  toBase64(): string
}
interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array<ArrayBuffer>
}
