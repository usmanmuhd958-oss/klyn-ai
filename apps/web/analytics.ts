export function renderAnalytics(data = []) {
  let rows = '';
  (data as any).forEach(m => {
    const successRate = m.total_calls ? ((m.success_calls / m.total_calls) * 100).toFixed(1) : '0.0';
    const avgMs = Math.round(m.avg_response_ms || 0);
    const lastUsed = m.last_used || 'never';
    rows += `<tr><td>${m.model}</td><td>${m.total_calls}</td><td>${successRate}%</td><td>${avgMs}ms</td><td>${lastUsed}</td></tr>`;
  });
  return rows;
}
