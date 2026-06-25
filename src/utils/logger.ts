export const logger = {
  info(message: string) {
    console.info(message);
  },
  warn(message: string) {
    console.warn(message);
  },
  error(message: string, error?: unknown) {
    console.error(message, error);
  },
};
