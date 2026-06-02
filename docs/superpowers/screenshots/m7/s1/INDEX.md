# M7 Section 1 — Device routing fix · screenshot index

Verifies the bug where mobile users were seeing the desktop dashboard is fixed.

| # | File | What it proves |
|---|------|----------------|
| 01 | `01-signin-mobile-viewport.png` | Dev server alive; /sign-in renders at 390×844 (iPhone 14 Pro viewport). |
| 02 | `02-mobile-redirected-to-m-survey.png` | URL bar shows `/p/test123/m/survey` after visiting `/p/test123/responses` with `fs_device_pref=mobile` cookie. Middleware redirected the legacy desktop path through the surface map to the mobile equivalent. |
| 03 | `03-mobile-redirected-to-m-map.png` | URL bar shows `/p/test123/m/map` after visiting `/p/test123/map` with `fs_device_pref=mobile` cookie. Direct desktop→mobile redirect works for the canonical surface. |
| 04 | `04-desktop-redirected-back.png` | URL bar shows `/p/test123/map` after visiting `/p/test123/m/map` with `fs_device_pref=desktop` cookie. Reverse redirect (mobile→desktop) works for the canonical surface. The 404 is because `test123` is not a real project. |

## Curl-level redirect verification

```
Mobile UA + /p/test123/map         → 307 → /p/test123/m/map      ✓
Desktop UA + /p/test123/m/map      → 307 → /p/test123/map        ✓
Mobile UA + /p/test123/responses   → 307 → /p/test123/m/survey   ✓
Desktop UA + /p/test123/m/chat     → 404 (mobile-only surface, no S1 page yet)
Mobile UA + /home                  → 307 → /sign-in (auth gate)
```

S4 builds the actual `/m/map` page; S5 builds `/m/survey`; S6 builds `/m/chat`. After all
sections ship, these same redirect tests will land on real pages instead of 404s.
