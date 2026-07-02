# PRD: Fix Kasbon Add Button

## 1. Problem Statement
The "Add Kasbon" (Catat Kasbon) button is unresponsive. Users cannot record new debts.

## 2. Requirements
- **Functional**: Button click must open the debt recording modal.
- **Functional**: The modal must allow adding products, calculating totals, and saving the debt.
- **Technical**: Ensure `kasbon.js` is correctly compiled from `kasbon.ts` and all functions are exposed to the `window` scope for HTML event handlers.
- **Technical**: Verify that `KasirApp` and its dependencies are correctly referenced.

## 3. Technical Context
- **Stack**: Vanilla JS/TS, HTML, Tailwind CSS.
- **Files**:
    - `public/index.html` (UI)
    - `public/kasbon.ts` (Logic source)
    - `public/kasbon.js` (Runtime code)
- **Previous Issues**: `kasbon.js` was previously out of sync with `kasbon.ts`, using deprecated/missing APIs (`cachedStoreId`, `KASIR.*`).

## 4. Success Criteria
- Clicking the "Add Kasbon" button opens the modal.
- No console errors related to missing functions.
- A user can successfully add a new kasbon entry.
