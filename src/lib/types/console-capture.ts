export type ConsoleCaptureTarget = "page" | "extension"

export type ConsoleCaptureAction = "start" | "stop" | "get" | "clear"

export interface ConsoleCaptureFilter {
  levels?: Array<"log" | "info" | "warn" | "error" | "debug">
  keyword?: string
  limit?: number
}

export interface ConsoleLogEntry {
  type: "log" | "info" | "warn" | "error" | "debug" | "trace" | "table" | "dir"
  args: unknown[]
  timestamp: number
  stackTrace?: {
    callFrames: Array<{
      functionName: string
      url: string
      lineNumber: number
      columnNumber: number
    }>
  }
}
