import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function notifyWhatsappMessage(conversationId) {
  bus.emit('message', { conversationId });
}

export function streamWhatsapp(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('data: {"type":"ready"}\n\n');
  const onMessage = (payload) => {
    res.write(`data: ${JSON.stringify({ type: 'message', conversationId: payload.conversationId })}\n\n`);
  };
  bus.on('message', onMessage);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('message', onMessage);
  });
}
