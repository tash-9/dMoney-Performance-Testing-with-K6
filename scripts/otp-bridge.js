/**
 * Reads OTP codes that the local DMoney API prints to its log
 * and serves the newest code for a given email.
 *
 * The API writes a line like:
 *   OTP for user@gmail.com [Customer]: 9964
 */
const fs = require('fs');
const http = require('http');

const logPath = process.env.OTP_LOG;
const port = Number(process.env.OTP_BRIDGE_PORT || 5055);

if (!logPath) {
  console.error('OTP_LOG is required');
  process.exit(1);
}

function fileSize() {
  try {
    return fs.statSync(logPath).size;
  } catch {
    return 0;
  }
}

function readFrom(offset) {
  const size = fileSize();
  const start = Math.max(0, Math.min(Number(offset) || 0, size));
  if (size <= start) return '';
  const fd = fs.openSync(logPath, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function latestOtp(email, offset) {
  const text = readFrom(offset);
  const pattern = new RegExp(
    `OTP for ${escapeRegExp(email)} \\[[^\\]]+\\]: (\\d{4})`,
    'g'
  );
  let match;
  let otp = null;
  while ((match = pattern.exec(text)) !== null) {
    otp = match[1];
  }
  return otp;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  res.setHeader('Content-Type', 'application/json');

  if (url.pathname === '/marker') {
    res.end(JSON.stringify({ bytes: fileSize() }));
    return;
  }

  if (url.pathname === '/otp') {
    const email = url.searchParams.get('email');
    const after = Number(url.searchParams.get('after') || 0);
    if (!email) {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: 'email is required' }));
      return;
    }

    const started = Date.now();
    const poll = () => {
      const otp = latestOtp(email, after);
      if (otp) {
        res.end(JSON.stringify({ otp }));
        return;
      }
      if (Date.now() - started > 10000) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: `OTP not found for ${email}` }));
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ message: 'not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`OTP bridge listening on http://127.0.0.1:${port}`);
  console.log(`Tailing ${logPath}`);
});
