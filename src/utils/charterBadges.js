export function countPendingCharterResponses(openRequests, myResponses) {
  const respondedRequestIds = new Set(
    myResponses.filter((r) => r.status !== 'withdrawn').map((r) => r.request_id),
  );
  return openRequests.filter((r) => !respondedRequestIds.has(r.id)).length;
}
