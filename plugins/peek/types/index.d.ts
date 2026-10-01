// What a row shows: Raster cells ([codePoint, foreground, background] each),
// or, on a terminal with kitty graphics, a PNG file the terminal draws itself.
export type Cells = { kind: 'cells'; columns: number; rows: number; cells: string }
export type Photo = { kind: 'photo'; columns: number; rows: number; file: string }
export type Picture = Cells | Photo

declare module 'claude-code' {
  interface PluginState {
    // Keyed by the row that shows it: `command:<args>`, or a tool_use_id.
    peek: { pictures: Record<string, Picture> }
  }
}
