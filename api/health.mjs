export default function handler(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "Napkin Audio AI Studio provider proxy" }));
}
