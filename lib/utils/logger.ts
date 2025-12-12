/**
 * Logger utility that only outputs in development mode
 * Use this instead of console.log/warn/error in production code
 */

const isDev = process.env.NODE_ENV === 'development'

export const logger = {
  log: (...args: unknown[]) => {
    if (isDev) console.log(...args)
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args)
  },
  error: (...args: unknown[]) => {
    // Always log errors, but could be enhanced to send to error tracking service
    console.error(...args)
  },
  debug: (...args: unknown[]) => {
    if (isDev) console.debug(...args)
  },
}

export default logger



