let context = {};

export function setLogContext(values = {}) {
  context = { ...context, ...values };
}

export function log(level, message, details = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...context, ...details })}\n`);
}
