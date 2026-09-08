export function log(level, message, details = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...details })}\n`);
}

