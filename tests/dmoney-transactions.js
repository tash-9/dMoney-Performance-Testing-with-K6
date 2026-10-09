import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const SECRET_KEY = __ENV.SECRET_KEY || 'ROADTOSDET';
const OTP_BRIDGE = __ENV.OTP_BRIDGE || 'http://127.0.0.1:5055';
const PASSWORD = __ENV.PASSWORD || '1234';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@dmoney.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || '1234';
const SYSTEM_EMAIL = __ENV.SYSTEM_EMAIL || 'system@dmoney.com';
const SYSTEM_PASSWORD = __ENV.SYSTEM_PASSWORD || '1234';
const EMAIL_LOCAL = __ENV.EMAIL_LOCAL || 'tashfia.islam102938';

const windowSec = Number(__ENV.WINDOW_SECONDS || 30);
const rate = Number(__ENV.RATE || 1);
const amount = Number(__ENV.AMOUNT || 10);
const agentFund = Number(__ENV.AGENT_FUND || 50000);
const customerFund = Number(__ENV.CUSTOMER_FUND || 2000);

const txnDuration = new Trend('txn_duration', true);

const runId = String(Date.now()).slice(-7);

function phaseLabel(index) {
  const start = index * windowSec;
  const end = (index + 1) * windowSec;
  return `${start}-${end}s`;
}

function phoneFor(slot) {
  return `019${runId}${slot}`;
}

function emailFor(key) {
  return `${EMAIL_LOCAL}+k6${key}${runId}@gmail.com`;
}

const USERS = [
  { key: 'agent1', name: 'Agent 1', role: 'Agent', slot: 1 },
  { key: 'agent2', name: 'Agent 2', role: 'Agent', slot: 2 },
  { key: 'customer1', name: 'Customer 1', role: 'Customer', slot: 3 },
  { key: 'customer2', name: 'Customer 2', role: 'Customer', slot: 4 },
  { key: 'merchant1', name: 'Merchant 1', role: 'Merchant', slot: 5 },
  { key: 'merchant2', name: 'Merchant 2', role: 'Merchant', slot: 6 },
];

const API_PATH = {
  deposit: '/transaction/deposit',
  sendmoney: '/transaction/sendmoney',
  payment: '/transaction/payment',
};

const API_MESSAGE = {
  deposit: 'Deposit successful',
  sendmoney: 'Send money successful',
  payment: 'Payment successful',
};

const ACTIVE_SECONDS = {
  deposit: windowSec * 2,
  sendmoney: windowSec * 3,
  payment: windowSec * 4,
};

function scenario(exec, index, startOffsetSec = 0) {
  return {
    executor: 'constant-vus',
    vus: rate,
    duration: `${windowSec - startOffsetSec}s`,
    startTime: `${index * windowSec + startOffsetSec}s`,
    gracefulStop: '5s',
    exec,
    tags: { phase: phaseLabel(index), flow: 'transaction' },
  };
}

const thresholds = {
  'http_req_failed{flow:transaction}': ['rate<0.01'],
  'http_req_duration{flow:transaction}': ['p(95)<1000'],
  'checks{flow:transaction}': ['rate>0.99'],
  txn_duration: ['p(95)<1000'],
};

const phaseApis = {
  0: ['sendmoney', 'payment'],
  1: ['sendmoney', 'deposit', 'payment'],
  2: ['deposit', 'sendmoney', 'payment'],
  3: ['payment'],
};

for (const api of ['deposit', 'sendmoney', 'payment']) {
  thresholds[`http_req_failed{api:${api}}`] = ['rate<0.01'];
  thresholds[`http_req_duration{api:${api}}`] = ['p(95)<1000'];
  thresholds[`checks{api:${api}}`] = ['rate>0.99'];
  thresholds[`txn_duration{api:${api}}`] = ['p(95)<1000'];
}

for (const [index, apis] of Object.entries(phaseApis)) {
  const phase = phaseLabel(Number(index));
  for (const api of apis) {
    thresholds[`txn_duration{api:${api},phase:${phase}}`] = ['p(95)<1000'];
    thresholds[`http_reqs{api:${api},phase:${phase}}`] = ['count>0'];
    thresholds[`http_req_failed{api:${api},phase:${phase}}`] = ['rate<0.01'];
  }
}

export const options = {
  scenarios: {
    w1SendC1C2: scenario('w1SendC1C2', 0),
    w1PayC2M1: scenario('w1PayC2M1', 0),
    w2SendC2C1: scenario('w2SendC2C1', 1),
    w2DepositA1C2: scenario('w2DepositA1C2', 1),
    w2PayC1M1: scenario('w2PayC1M1', 1),
    w3DepositA1C1: scenario('w3DepositA1C1', 2),
    w3DepositA2C2: scenario('w3DepositA2C2', 2, 2),
    w3SendC1C2: scenario('w3SendC1C2', 2),
    w3PayC2M2: scenario('w3PayC2M2', 2),
    w4PayA1M1: scenario('w4PayA1M1', 3),
    w4PayA2M2: scenario('w4PayA2M2', 3),
    w4PayC1M1: scenario('w4PayC1M1', 3),
    w4PayC2M2: scenario('w4PayC2M2', 3),
  },
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

function jsonHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    'X-AUTH-SECRET-KEY': SECRET_KEY,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function must(res, expectedStatus, label) {
  if (res.status !== expectedStatus) {
    throw new Error(`${label} failed (${res.status}): ${res.body}`);
  }
  return res.json();
}

function authenticate(email, password) {
  const markerRes = http.get(`${OTP_BRIDGE}/marker`, { tags: { flow: 'setup' } });
  const after = markerRes.status === 200 ? markerRes.json('bytes') : 0;

  const loginRes = http.post(
    `${BASE_URL}/user/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { flow: 'setup', name: 'login' } }
  );
  const loginOk = check(
    loginRes,
    {
      'login returns 200': (r) => r.status === 200,
    },
    { flow: 'setup' }
  );
  if (!loginOk) {
    throw new Error(`Login failed for ${email} (${loginRes.status}): ${loginRes.body}`);
  }

  const body = loginRes.json();
  if (body.token) return body.token;

  if (!body.otpRequired) {
    throw new Error(`Login for ${email} did not return a token: ${loginRes.body}`);
  }

  const otpRes = http.get(
    `${OTP_BRIDGE}/otp?email=${encodeURIComponent(email)}&after=${after}`,
    { tags: { flow: 'setup', name: 'otp' }, timeout: '15s' }
  );
  if (otpRes.status !== 200) {
    throw new Error(`Could not read OTP for ${email}: ${otpRes.status} ${otpRes.body}`);
  }

  const verifyRes = http.post(
    `${BASE_URL}/user/verify-otp`,
    JSON.stringify({ identifier: email, otp: otpRes.json('otp') }),
    { headers: { 'Content-Type': 'application/json' }, tags: { flow: 'setup', name: 'verify-otp' } }
  );
  const verified = must(verifyRes, 200, `OTP verify ${email}`);
  if (!verified.token) {
    throw new Error(`OTP verify for ${email} did not return a token`);
  }
  return verified.token;
}

function createAndActivate(adminToken, user) {
  const email = emailFor(user.key);
  const phone = phoneFor(user.slot);
  const createRes = http.post(
    `${BASE_URL}/user/create`,
    JSON.stringify({
      name: user.name,
      email,
      password: PASSWORD,
      phone_number: phone,
      nid: '1234567890',
      role: user.role,
    }),
    { headers: jsonHeaders(adminToken), tags: { flow: 'setup', name: 'create-user' } }
  );
  const created = must(createRes, 201, `Create ${user.name}`);
  const id = created.user && created.user.id;
  if (!id) throw new Error(`Create ${user.name} did not return an id`);

  const patchRes = http.patch(
    `${BASE_URL}/user/update/${id}`,
    JSON.stringify({ status: 'active' }),
    { headers: jsonHeaders(adminToken), tags: { flow: 'setup', name: 'activate-user' } }
  );
  must(patchRes, 200, `Activate ${user.name}`);
  return { email, phone };
}

function fund(token, path, from, to, value, label) {
  const res = http.post(
    `${BASE_URL}${path}`,
    JSON.stringify({ from_account: from, to_account: to, amount: value }),
    { headers: jsonHeaders(token), tags: { flow: 'setup', name: 'fund' } }
  );
  must(res, 201, label);
}

export function setup() {
  const adminToken = authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);
  const accounts = {};

  for (const user of USERS) {
    const created = createAndActivate(adminToken, user);
    const token = authenticate(created.email, PASSWORD);
    accounts[user.key] = {
      name: user.name,
      role: user.role,
      email: created.email,
      phone: created.phone,
      token,
    };
    sleep(0.2);
  }

  const systemToken = authenticate(SYSTEM_EMAIL, SYSTEM_PASSWORD);
  fund(systemToken, '/transaction/deposit', 'SYSTEM', accounts.agent1.phone, agentFund, 'Fund Agent 1');
  fund(systemToken, '/transaction/deposit', 'SYSTEM', accounts.agent2.phone, agentFund, 'Fund Agent 2');
  fund(
    accounts.agent1.token,
    '/transaction/deposit',
    accounts.agent1.phone,
    accounts.customer1.phone,
    customerFund,
    'Fund Customer 1'
  );
  fund(
    accounts.agent1.token,
    '/transaction/deposit',
    accounts.agent1.phone,
    accounts.customer2.phone,
    customerFund,
    'Fund Customer 2'
  );

  return { accounts };
}

function runTxn(data, api, fromKey, toKey, phase) {
  const from = data.accounts[fromKey];
  const to = data.accounts[toKey];
  const expectedMessage = API_MESSAGE[api];
  const res = http.post(
    `${BASE_URL}${API_PATH[api]}`,
    JSON.stringify({
      from_account: from.phone,
      to_account: to.phone,
      amount,
    }),
    {
      headers: jsonHeaders(from.token),
      tags: { flow: 'transaction', api, phase },
    }
  );

  txnDuration.add(res.timings.duration, { api, phase });

  check(
    res,
    {
      'expected HTTP status code': (r) => r.status === 201,
      'transaction request is successful': (r) => r.status === 201 && r.json('message') === expectedMessage,
      'transaction ID is returned': (r) => {
        const id = r.json('trnxId');
        return typeof id === 'string' && id.length > 0;
      },
      'expected success message is returned': (r) => r.json('message') === expectedMessage,
    },
    { flow: 'transaction', api, phase }
  );

  sleep(windowSec);
}

export function w1SendC1C2(data) {
  runTxn(data, 'sendmoney', 'customer1', 'customer2', phaseLabel(0));
}
export function w1PayC2M1(data) {
  runTxn(data, 'payment', 'customer2', 'merchant1', phaseLabel(0));
}
export function w2SendC2C1(data) {
  runTxn(data, 'sendmoney', 'customer2', 'customer1', phaseLabel(1));
}
export function w2DepositA1C2(data) {
  runTxn(data, 'deposit', 'agent1', 'customer2', phaseLabel(1));
}
export function w2PayC1M1(data) {
  runTxn(data, 'payment', 'customer1', 'merchant1', phaseLabel(1));
}
export function w3DepositA1C1(data) {
  runTxn(data, 'deposit', 'agent1', 'customer1', phaseLabel(2));
}
export function w3DepositA2C2(data) {
  runTxn(data, 'deposit', 'agent2', 'customer2', phaseLabel(2));
}
export function w3SendC1C2(data) {
  runTxn(data, 'sendmoney', 'customer1', 'customer2', phaseLabel(2));
}
export function w3PayC2M2(data) {
  runTxn(data, 'payment', 'customer2', 'merchant2', phaseLabel(2));
}
export function w4PayA1M1(data) {
  runTxn(data, 'payment', 'agent1', 'merchant1', phaseLabel(3));
}
export function w4PayA2M2(data) {
  runTxn(data, 'payment', 'agent2', 'merchant2', phaseLabel(3));
}
export function w4PayC1M1(data) {
  runTxn(data, 'payment', 'customer1', 'merchant1', phaseLabel(3));
}
export function w4PayC2M2(data) {
  runTxn(data, 'payment', 'customer2', 'merchant2', phaseLabel(3));
}

function metricValues(data, name) {
  const metric = data.metrics[name];
  return metric ? metric.values : null;
}

function fmt(value, digits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits);
}

function pct(rate) {
  if (rate === undefined || rate === null || Number.isNaN(rate)) return '—';
  return `${(rate * 100).toFixed(2)}%`;
}

function comparisonHtml(data) {
  const apis = [
    { key: 'deposit', label: 'Deposit', path: '/transaction/deposit' },
    { key: 'sendmoney', label: 'Send Money', path: '/transaction/sendmoney' },
    { key: 'payment', label: 'Payment', path: '/transaction/payment' },
  ];
  const phases = [0, 1, 2, 3].map(phaseLabel);

  const rows = apis.map((api) => {
    const duration = metricValues(data, `http_req_duration{api:${api.key}}`) || {};
    const failed = metricValues(data, `http_req_failed{api:${api.key}}`) || {};
    const checksMetric = metricValues(data, `checks{api:${api.key}}`) || {};
    const count = phases.reduce((sum, phase) => {
      const reqs = metricValues(data, `http_reqs{api:${api.key},phase:${phase}}`);
      return sum + (reqs && reqs.count ? reqs.count : 0);
    }, 0);
    const throughput = count / ACTIVE_SECONDS[api.key];
    return { ...api, duration, failed, checksMetric, count, throughput };
  });

  const phaseRows = [];
  for (const phase of phases) {
    for (const api of apis) {
      const duration = metricValues(data, `txn_duration{api:${api.key},phase:${phase}}`);
      const reqs = metricValues(data, `http_reqs{api:${api.key},phase:${phase}}`);
      if (!duration && !reqs) continue;
      phaseRows.push({
        phase,
        label: api.label,
        count: reqs ? reqs.count : 0,
        avg: duration ? duration.avg : null,
        p95: duration ? duration['p(95)'] : null,
        max: duration ? duration.max : null,
      });
    }
  }

  const paymentPhases = phaseRows.filter((row) => row.label === 'Payment' && row.p95 !== null);
  let degradation = 'Payment ran in every window. Not enough phase samples to compare latency.';
  if (paymentPhases.length >= 2) {
    const first = paymentPhases[0];
    const last = paymentPhases[paymentPhases.length - 1];
    const delta = last.p95 - first.p95;
    const direction = delta > 20 ? 'increased' : delta < -20 ? 'decreased' : 'stayed about the same';
    degradation =
      `Payment p(95) ${direction} from ${fmt(first.p95)} ms in ${first.phase} ` +
      `(2 concurrent activities) to ${fmt(last.p95)} ms in ${last.phase} ` +
      `(4 concurrent activities), a change of ${fmt(delta)} ms. ` +
      `Concurrent activities step from 2 → 3 → 4 → 4 across the four windows.`;
  }

  const fastest = [...rows].sort((a, b) => (a.duration['p(95)'] || Infinity) - (b.duration['p(95)'] || Infinity))[0];

  const apiTable = rows
    .map(
      (row) => `<tr>
        <td>${row.label}<div class="path">${row.path}</div></td>
        <td>${row.count}</td>
        <td>${fmt(row.throughput)} req/s</td>
        <td>${fmt(row.duration.avg)} ms</td>
        <td>${fmt(row.duration.med)} ms</td>
        <td>${fmt(row.duration['p(95)'])} ms</td>
        <td>${fmt(row.duration['p(99)'])} ms</td>
        <td>${pct(row.failed.rate)}</td>
        <td>${pct(row.checksMetric.rate)}</td>
      </tr>`
    )
    .join('');

  const maxP95 = Math.max(...rows.map((row) => row.duration['p(95)'] || 0), 1);
  const bars = rows
    .map((row) => {
      const width = Math.max(4, ((row.duration['p(95)'] || 0) / maxP95) * 100);
      return `<div class="bar-row">
        <span>${row.label}</span>
        <div class="track"><div class="fill" style="width:${width}%"></div></div>
        <strong>${fmt(row.duration['p(95)'])} ms</strong>
      </div>`;
    })
    .join('');

  const phaseTable = phaseRows
    .map(
      (row) => `<tr>
        <td>${row.phase}</td>
        <td>${row.label}</td>
        <td>${row.count}</td>
        <td>${fmt(row.avg)} ms</td>
        <td>${fmt(row.p95)} ms</td>
        <td>${fmt(row.max)} ms</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>DMoney transaction API comparison</title>
  <style>
    body { font-family: Segoe UI, sans-serif; margin: 32px; color: #0f172a; background: #f8fafc; }
    h1 { margin-bottom: 4px; }
    h2 { margin-top: 36px; }
    .muted { color: #475569; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
    th { background: #0f172a; color: #fff; }
    .path { color: #64748b; font-size: 12px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; margin: 16px 0; }
    .bar-row { display: grid; grid-template-columns: 140px 1fr 110px; gap: 12px; align-items: center; margin: 8px 0; }
    .track { background: #e2e8f0; border-radius: 999px; height: 14px; }
    .fill { background: #4f46e5; height: 14px; border-radius: 999px; }
  </style>
</head>
<body>
  <h1>DMoney transaction API comparison</h1>
  <p class="muted">Deposit, Send Money, and Payment over a ${windowSec * 4}-second test. Each activity keeps one virtual user running for its ${windowSec}-second window. Amount: ${amount} Tk.</p>
  <div class="card">
    <strong>Fastest API by p(95):</strong> ${fastest ? fastest.label : '—'}
    <p>${degradation}</p>
  </div>
  <h2>Response time, throughput, and failure rate</h2>
  <table>
    <thead>
      <tr>
        <th>API</th><th>Requests</th><th>Throughput</th><th>Avg</th><th>Median</th>
        <th>p(95)</th><th>p(99)</th><th>Failure rate</th><th>Checks passed</th>
      </tr>
    </thead>
    <tbody>${apiTable}</tbody>
  </table>
  <h2>p(95) response time</h2>
  <div class="card">${bars}</div>
  <h2>How latency moved as the workload changed</h2>
  <p class="muted">Throughput above is requests divided by the seconds that API was scheduled to run, not the full test clock.</p>
  <table>
    <thead>
      <tr><th>Window</th><th>API</th><th>Requests</th><th>Avg</th><th>p(95)</th><th>Max</th></tr>
    </thead>
    <tbody>${phaseTable}</tbody>
  </table>
</body>
</html>`;
}

export function handleSummary(data) {
  const summary = textSummary(data, { indent: ' ', enableColors: true });
  return {
    stdout: summary,
    'reports/summary.html': htmlReport(data),
    'reports/comparison.html': comparisonHtml(data),
    'reports/summary.json': JSON.stringify(data, null, 2),
  };
}
