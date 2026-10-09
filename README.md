# DMoney Performance Testing with k6

Two-minute k6 load test of the DMoney transaction APIs. Each of the six users logs in with their own credentials. Activities that share a time window run at the same time and stay active for that whole window.

## Transaction flow

| Window | Concurrent activities |
| --- | --- |
| 0–30s | Customer 1 sends money to Customer 2. Customer 2 pays Merchant 1. |
| 30–60s | Customer 2 sends money to Customer 1. Agent 1 deposits to Customer 2. Customer 1 pays Merchant 1. |
| 60–90s | Agent 1 deposits to Customer 1. Agent 2 deposits to Customer 2. Customer 1 sends money to Customer 2. Customer 2 pays Merchant 2. |
| 90–120s | Agent 1 pays Merchant 1. Agent 2 pays Merchant 2. Customer 1 pays Merchant 1. Customer 2 pays Merchant 2. |

APIs under test:

- `POST /transaction/deposit`
- `POST /transaction/sendmoney`
- `POST /transaction/payment`

## Checks and thresholds

Every transaction response is checked for:

- HTTP status `201`
- a successful transaction
- a returned transaction id (`trnxId`)
- the expected success message (`Deposit successful`, `Send money successful`, or `Payment successful`)

Thresholds, including separate ones for Deposit, Send Money, and Payment:

- failed request rate under 1%
- p(95) response time under 1000 ms
- transaction checks passing at least 99% of the time

## How to run

Requirements: [k6](https://k6.io/), Node.js, and the DMoney API on `http://localhost:5000`.

The API prints a one-time password to its log for Agent, Customer, and Merchant logins. Start the API with its log written to `logs/api.log`, then start the small bridge that reads those codes:

```powershell
mkdir logs -Force
# from the DMoney API project
node server.js > D:\SDET\B-19\K6\dMoney-Performance-Testing-with-K6\logs\api.log 2>&1

# from this project
$env:OTP_LOG = "D:\SDET\B-19\K6\dMoney-Performance-Testing-with-K6\logs\api.log"
node scripts/otp-bridge.js
```

In another terminal:

```powershell
k6 run tests/dmoney-transactions.js
```

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:5000` | DMoney API |
| `SECRET_KEY` | `ROADTOSDET` | `X-AUTH-SECRET-KEY` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@dmoney.com` / `1234` | Creates and activates the six users |
| `SYSTEM_EMAIL` / `SYSTEM_PASSWORD` | `system@dmoney.com` / `1234` | Funds the agents before the test |
| `EMAIL_LOCAL` | `tashfia.islam102938` | Gmail local-part used for the new users |
| `OTP_BRIDGE` | `http://127.0.0.1:5055` | Local OTP reader |
| `AMOUNT` | `10` | Amount of each measured transaction |

Setup creates Agent 1, Agent 2, Customer 1, Customer 2, Merchant 1, and Merchant 2, activates them, logs each one in, funds both agents from `SYSTEM`, and deposits to both customers. The measured two minutes start after that.

k6 writes:

- `reports/summary.html` — HTML report
- `reports/comparison.html` — API comparison

## Results

The run on 9 October 2026 passed every threshold. Failed requests: **0%**. Transaction checks: **100%**. Overall transaction p(95): **91.35 ms**.

| API | Requests | Throughput | Avg | Median | p(95) | p(99) | Failure rate | Checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Deposit | 3 | 0.05 req/s | 50.95 ms | 40.18 ms | 76.65 ms | 79.89 ms | 0.00% | 100% |
| Send Money | 3 | 0.03 req/s | 58.73 ms | 59.53 ms | 91.07 ms | 93.88 ms | 0.00% | 100% |
| Payment | 7 | 0.06 req/s | 60.68 ms | 60.62 ms | 85.63 ms | 88.49 ms | 0.00% | 100% |

Throughput is requests divided by the seconds that API was scheduled (Deposit 60s, Send Money 90s, Payment 120s).

Deposit was the fastest API by p(95). Send Money was the slowest, still well under 1000 ms.

Payment ran in every window, so it shows how latency moved as the workload grew from 2 concurrent activities to 4:

| Window | Concurrent activities | Payment p(95) |
| --- | --- | --- |
| 0–30s | 2 | 18.54 ms |
| 30–60s | 3 | 89.21 ms |
| 60–90s | 4 | 53.31 ms |
| 90–120s | 4 | 76.42 ms |

Payment p(95) rose by about 58 ms from the first window to the last. The highest payment sample was in the 30–60s window, when a deposit, a send, and a payment were in flight together. Latency moved around as the mix of APIs changed. It did not climb in a straight line, and no window came close to the 1000 ms threshold. There was no increase in failures.

## HTML report

![k6 HTML report](screenshots/k6-html-report.png)

Full report: [reports/summary.html](reports/summary.html)

## Metrics

![API comparison metrics](screenshots/api-metrics.png)

Window-by-window numbers: [reports/comparison.html](reports/comparison.html)
