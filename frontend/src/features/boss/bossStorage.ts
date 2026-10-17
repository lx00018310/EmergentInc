/** Precise removal of retired product keys; language and other site storage are preserved. */
export function clearLegacyBossStorage() {
  try {
    for (const key of Object.keys(localStorage)) if (['emergentinc.ownerChat.history','emergentinc.ownerChat.pending','emergentinc.ownerChat.draft','emergentinc.runBudgetTokens'].includes(key) || key.startsWith('emergentinc.owner.action:') || key.startsWith('emergentinc.tips.read.')) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage)) if (['emergentinc.recruit-intent','emergentinc.checkout-intent'].includes(key) || key.startsWith('emergentinc:decision:') || /^reward-pending:(?:[a-zA-Z0-9_-]+:)?-?\d+_-?\d+_-?\d+$/.test(key)) sessionStorage.removeItem(key);
  } catch { /* Disabled browser storage grants no execution authority. */ }
}
