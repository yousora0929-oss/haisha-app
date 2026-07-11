/**
 * 未応答バッジ件数。
 * withdrawn 以外の応答がある募集は対応済み。declined / offered / accepted / rejected はカウント対象外。
 */
export function countPendingCharterResponses(openRequests, myResponses) {
  const respondedRequestIds = new Set(
    (myResponses || [])
      .filter((r) => r && r.status !== 'withdrawn')
      .map((r) => String(r.request_id || '').trim())
      .filter(Boolean),
  );
  return (openRequests || []).filter((r) => {
    const id = String(r?.id || '').trim();
    return id && !respondedRequestIds.has(id);
  }).length;
}
