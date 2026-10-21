/**
 * @name NAS 集成验证源（仅用于本机模拟测试）
 * @version 0.1.0
 * @author Local test
 */
lx.on(lx.EVENT_NAMES.request, ({ action, info }) => {
  if (action !== 'musicUrl') return Promise.reject(new Error('unsupported action'));
  return new Promise((resolve, reject) => {
    lx.request(`https://alger-fixture.invalid/resolve?quality=${info.type}`,
      { method: 'GET' }, (error, response, body) => {
        if (error || response.statusCode !== 200) return reject(new Error('requested quality unavailable'));
        resolve(body.url);
      });
  });
});
lx.send(lx.EVENT_NAMES.inited, { sources: {
  wy: { name: '网易云模拟源', type: 'music', actions: ['musicUrl'], qualitys: ['flac', '320k', '128k'] }
} });
