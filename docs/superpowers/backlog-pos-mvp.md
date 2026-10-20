# Backlog pós-MVP (pendências menores das revisões)

Itens Minor registrados nas revisões de cada tarefa e na revisão final. Nenhum bloqueia o deploy; a revisão final classificou estes como "podem esperar".

- - Task 1: minor (deferred): parseBRLToCents uses Number(intPart)*100 (reference code, safe-integer guarded) despite "no *100" constraint.
- - Task 1: minor (deferred): money tests lack negative/NaN/string formatBRL cases.
- Task 2: minor (deferred): pricing tests lack bad-quantity on pizza branch, invalid addon/drink price, addons omitted default, empty subtotal.
- Task 4: minor (deferred): paymentText undefined for unknown method (unreachable via Zod); formatPhoneBR passthrough on odd lengths; tests lack landline-in-message / whitespace notes cases.
- Task 3: minor (deferred): describeNextOpening(null) throws (callers must guard — T9 does); Kiritimati subprocess test uses cwd-relative paths; no test for 24h shift / open override on closed day.
- Task 5: minor (deferred): freeText max() reuses min message (e.g. long street says "Informe a rua."); missing tests for update addon+borda kept / explicit null; Zod English defaults on addonIds/quantity/uuid.
- Task 15: minor (deferred): dom.js el() allows on*/style string attrs (harden: throw on non-function on*, style, srcdoc); reference header leftovers in dom.js/tokens.css; no h1 (wordmark span); toast role=alert+assertive (prefer status); load() no re-entrancy guard; store flip repaints whole menu; status interval polls when hidden; openDialog throws if already open; no smoke test for /shared alias; api.test gaps; skeleton raw 1.4s.
- Task 13: minor (deferred): duplicated revoke/grant blocks; set_updated_at/next_order_code without fixed search_path; seed products insert not idempotent (no on conflict); redundant settings insert in 0002.
- Task 6: minor (deferred): kind-mismatch tests only cover drink-as-flavor; no single-flavor description / drink snapshot / change==total boundary tests; "Bacon, Frango acabou" singular (spec §12 wording).
- Task 17: minor (deferred): failed reload leaves stale tabs; store flip resets active tab/scroll; scrollIntoView may scroll page vertically (prefer scrollLeft); aria-current="true" vs "location"; non-token literals 88px/2px/28ch; weak TZ test; no DOM tests for renderers.
- Task 7: minor (deferred): requestLogger mounted after express.json (parse failures unlogged); no direct errorHandler/validate/asyncHandler tests (unknown 500, ZodError 400, multer 413); new URL(SUPABASE_URL) raw TypeError at boot; literal NBSP in testkit normalizeSpaces; 300 sequential requests in rate-limit test.
- Task 20: minor (deferred): auth.js caches rejected supabasePromise (??=) → login dead until reload; painel.js no try/catch around requireSession (blank panel); logout vs onAuthStateChange redirect race for ?motivo; untested refreshSession throw / 5xx non-JSON; retried flag exposed as option; .btn--small/.btn--block unverified.
- Task 16: minor (deferred): priceable() doesn't check priceCents validity; notes slice may split surrogate pair (server toWellFormed); fix round 1 not test-first.
- Task 8: minor (deferred): category order relies on repo getMenu; TUESDAY_19H test checks only weekday; status route awaits sequentially.
- Task 9: minor (deferred): duplicated STORE_CLOSED test cases; ' at ' stack check heuristic.
- Task 11: minor (deferred): no tests for JPEG-declared-as-PNG / real PNG+WebP accepted; no test that PUT keeps omitted optional fields; double listCategories per POST/PUT; invalid file to missing product → 400 not 404.
- Task 12: minor (deferred): createdAt desc assertion vacuous (fixed clock); loose tie-break assertion. CROSS-CHECK for final review: real repo listOrders/getOrdersSummary must treat from/to as LOCAL days, end exclusive (to+1 00:00 local).
- Task 16: minor (deferred): normalize() turns addonIds:null into [].
- Task 21: minor (deferred): unknown category slug defaults to kind 'pizza'; rejected 2nd file leaves old preview; double "Salvo" toast on create+photo; dev-facing toast text; mount untested.
- Task 23: minor (deferred): visibilitychange listener lingers until next event; page-offset load-more may duplicate rows; TDZ-style close ref.
- Task 14: minor (deferred): embedded order_items unordered (add order by id); currentImageUrl ignores error; orphan file if upload then update fails/null; SUPABASE_ANON_KEY required at boot (beyond brief); localDayRangeToIso throws on malformed date (relies on schema); no mocked-chain repo tests.
- Task 22: minor (deferred): hidden-button hack with withSaving; dynamic import of /js/dom.js; maskPhoneBR strips leading 55 for DDD-55 numbers typed with 12+ digits; empty time inputs not handled; phone saved even if unchanged.
- Task 10: minor (deferred): no 401/403 cases in hours/settings tests (covered by T7); updatedAt only key-presence check.
- Task 18: minor (deferred): "Escolha o 2º sabor" hint not announced (role=status / aria-disabled); aria-live price inside button; available-addon filter untested; fixed ids.
- Task 23: minor (deferred): received bg overrides hover; tel: link < 48px; summary ol padding.
- Task 19: minor (deferred): onError not awaited → submitting=false during reloadMenu; formError role=alert toggled hidden; aria-invalid only on first radio; payload edge tests; closed state refreshed only on open.
- Task 24: minor (deferred): comment-skip regex lets `/* */ code` lines through; dom.js exempt by whole file (should be guard lines only); scan blind spots (document.write, DOMParser…); /img cache assertion vacuous (no img dir); 1h max-age on unversioned modules; CORS_ORIGIN wording in DEPLOY.md.
- Final fix wave re-review: all 13 addressed, no new Critical/Important. Minor: raw letter-spacing literals in hero CSS; check tilde clipping on BARÃO (line-height 1).

Também fora do MVP (revisão final): turno de 24 h no painel; mappers.js com -03:00 fixo; ordem dos itens do pedido (precisa coluna position em 0003); contraste/tilde do título BARÃO conferir no celular.
