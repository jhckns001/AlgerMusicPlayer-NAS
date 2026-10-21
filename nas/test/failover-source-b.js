/**
 * @name 测试 B（备用接管）
 * @version 0.2.0
 */
lx.on(lx.EVENT_NAMES.request, ({ info }) => new Promise((resolve, reject) => {
  lx.request(`https://alger-fixture.invalid/resolve?source=B&quality=${info.type}`,
    { method: 'GET' }, (error, response, body) => {
      if (error || response.statusCode !== 200) return reject(new Error('本机测试：音质不可用'));
      resolve(body.url);
    });
}));
lx.send(lx.EVENT_NAMES.inited, { sources: {
  wy: { name: '测试 B', type: 'music', actions: ['musicUrl'], qualitys: ['flac', '320k', '128k'] }
} });
