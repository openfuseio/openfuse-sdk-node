const PREFIX = '[openfuse]'

export const logger = {
  warn(message: string, ...args: unknown[]): void {
    console.warn(PREFIX, message, ...args)
  },

  error(message: string, ...args: unknown[]): void {
    console.error(PREFIX, message, ...args)
  },
}
