/**
 * @name 测试 A（故意失败）
 * @version 0.2.0
 */
lx.on(lx.EVENT_NAMES.request, ({ info }) => new Promise((resolve, reject) => {
  lx.request(`https://alger-fixture.invalid/resolve?source=A&quality=${info.type}`,
    { method: 'GET' }, (error, response, body) => {
      if (error || response.statusCode !== 200) return reject(new Error('本机测试：首选音源故意失败'));
      resolve(body.url);
    });
}));
lx.send(lx.EVENT_NAMES.inited, { sources: {
  wy: { name: '测试 A', type: 'music', actions: ['musicUrl'], qualitys: ['flac', '320k', '128k'] }
} });
