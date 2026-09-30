export function log(level, event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }))
}
