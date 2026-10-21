export function changedSettings(current: Record<string, any>, previous: Record<string, any>) {
  return Object.fromEntries(Object.entries(current).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(previous[key])));
}

export function mergeSettingsDraft(remote: Record<string, any>, pending: Record<string, any>) {
  return JSON.parse(JSON.stringify({ ...remote, ...pending }));
}
