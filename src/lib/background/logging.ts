export interface BackgroundLogging {
  originalConsole: {
    log: typeof console.log
    info: typeof console.info
    warn: typeof console.warn
    error: typeof console.error
    debug: typeof console.debug
  }
  backgroundLog: (...args: unknown[]) => void
  backgroundError: (...args: unknown[]) => void
}

export function createBackgroundLogging(): BackgroundLogging {
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  }

  return {
    originalConsole,
    backgroundLog: (...args: unknown[]) => {
      originalConsole.log(...args)
    },
    backgroundError: (...args: unknown[]) => {
      originalConsole.error(...args)
    },
  }
}
