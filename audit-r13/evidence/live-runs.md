# MULTI-CHEF R13 — Live-данные прогонов

Файлы с дампом HTTP-ответов, использовавшихся в R13. Сохранены как «сырое доказательство», без обработки.

## A. Auth/Cookies

```
=== A register/login ===
HTTP/1.1 201 Created
set-cookie: mc_session=zjUwNtHo5QPIA8Ge9TuTye_bS1CXOV5RwczJ-xbLScM; Max-Age=2591999; Path=/; HttpOnly; SameSite=Lax
set-cookie: mc_csrf=MUvGNQ9NtvSecoFVTc3HcKQ7d0NYb3aGkmx1Ft4fXVA; Max-Age=2591999; Path=/; SameSite=Lax
x-ratelimit-limit: 10
x-ratelimit-remaining: 9
```

## B. X-Forwarded-For spoofing

```
attempt 1 (10.0.1.1)  : 401 | remaining=9
attempt 2 (10.0.2.1)  : 401 | remaining=9
attempt 3 (10.0.3.1)  : 401 | remaining=9
attempt 4 (10.0.4.1)  : 401 | remaining=9
attempt 5 (10.0.5.1)  : 401 | remaining=9
attempt 6 (10.0.6.1)  : 401 | remaining=9
attempt 7 (10.0.7.1)  : 401 | remaining=9
attempt 8 (10.0.8.1)  : 401 | remaining=9
attempt 9 (10.0.9.1)  : 401 | remaining=9
attempt 10 (10.0.10.1): 401 | remaining=9
attempt 11 (10.0.11.1): 401 | remaining=9
attempt 12 (10.0.12.1): 401 | remaining=9
```

Same XFF bucket:
```
attempt 1 (10.0.99.99): remaining=9
attempt 2 (10.0.99.99): remaining=8
attempt 3 (10.0.99.99): remaining=7
attempt 4 (10.0.99.99): remaining=6
attempt 5 (10.0.99.99): remaining=5
attempt 6 (10.0.99.99): remaining=4
attempt 7 (10.0.99.99): remaining=3
attempt 8 (10.0.99.99): remaining=2
attempt 9 (10.0.99.99): remaining=1
attempt 10 (10.0.99.99): remaining=0
attempt 11 (10.0.99.99): 429
attempt 12 (10.0.99.99): 429
attempt 13 (10.0.99.99): 429
```

## C. CSRF soft bypass

```
curl -X POST http://192.168.1.35:8080/api/v1/pantry/items \
  -H "Cookie: mc_session=$A_SESSION" \
  -H "Idempotency-Key: ..." \
  -d '{"ingredientId":"…","quantityG":50,"unit":"G",...}'
→ HTTP/1.1 201 Created
x-ratelimit-limit: 300
x-ratelimit-remaining: 298
x-ratelimit-reset: 45
```

## D. CORS Origin=evil.example

```
HTTP/1.1 404 Not Found
vary: Origin
(нет Access-Control-Allow-Origin, нет Access-Control-Allow-Credentials)
```

## E. Planner 5 прогонов

```
run0 target=2000 noCook=[] rep=ALLOW_REPEATS
  ppl=2 dailies=[2974]*7
  devs=[25.7%]*7 mean=25.7% max=25.7% >10%

run1 target=2000 noCook=[] rep=NO_REPEATS
  ppl=2 dailies=[1980, 2161, 2121, 2058, 2925, 1871, 2549]
  devs=[50.5, 46.0, 47.0, 48.5, 26.9, 53.2, 36.3] mean=44.1% max=53.2% >10%

run2 target=1700 noCook=[] rep=ALLOW_REPEATS
  ppl=2 dailies=[2974]*7
  devs=[12.5%]*7 mean=12.5% max=12.5% >10%

run3 target=2000 noCook=[0,3,5] rep=ALLOW_REPEATS
  ppl=2 dailies=[2087, 2876, 2087, 2087, 2087, 2087, 2163]
  devs=[47.8, 28.1, 47.8, 47.8, 47.8, 47.8, 45.9] mean=44.7% max=47.8% >10%

run4 target=2500 noCook=[] rep=ALLOW_REPEATS
  ppl=2 dailies=[2974]*7
  devs=[40.5%]*7 mean=40.5% max=40.5% >10%
```

## F. Pantry orphan id после shopping complete

```
PANTRY_ID=0622c56c-068d-4921-8ce2-79ca7b8a1dfe-list-2D43455DDAC6A1E1AB1DB60BB0-pantry

GET /api/v1/pantry/items/{id}
→ 400 VALIDATION_ERROR
  {"status":400,"error":{"code":"VALIDATION_ERROR","message":"Invalid request",
   "details":{"fields":{"id":["must be a ULID (26 chars, A-Z0-9 minus I,L,O,U)"]}}}}

DELETE /api/v1/pantry/items/{id}
→ 400 VALIDATION_ERROR (тот же)
```

## G. Cross-household живые пробы (A vs B)

| Сценарий | A→B | B→A |
|---|---|---|
| /pantry/items GET | 0 elements (свой) | 0 elements (свой) |
| /pantry/items/:id GET foreign | 404 | 404 |
| /pantry/items/:id PATCH foreign | 404 | 404 |
| /pantry/items/:id DELETE foreign | 404 | 404 |
| /jobs/:id GET foreign | 404 | 404 |
| /meal-plans/prep-tasks/:taskId PATCH foreign | — | 404 |
| /shopping-lists/:listId/fit-budget POST foreign | — | 404 |
| /shopping-lists/:listId/complete POST foreign | — | 404 |
| /shopping-lists/items/:itemId PATCH foreign | — | 404 |
