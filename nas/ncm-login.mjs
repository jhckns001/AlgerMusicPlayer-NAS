import path from 'node:path';

// Keep the pinned upstream API and replace only its QR placeholder and broken
// exception branch. No upstream files or account credentials are persisted here.
export async function createNcmModules(require) {
  const apiRoot = path.dirname(require.resolve('netease-cloud-music-api-alger/package.json'));
  const ncm = require(path.join(apiRoot, 'server.js'));
  const qr = require(require.resolve('qrcode', { paths: [apiRoot] }));
  const option = require(path.join(apiRoot, 'util/option.js'));
  const modules = await ncm.getModulesDefinitions(path.join(apiRoot, 'module'), {
    'daily_signin.js': '/daily_signin',
    'fm_trash.js': '/fm_trash',
    'personal_fm.js': '/personal_fm'
  });
  for (const entry of modules) {
    if (entry.route === '/login/qr/create') {
      const upstream = entry.module;
      entry.module = async (query) => {
        const response = await upstream(query);
        if (query.qrimg) {
          const url = response.body?.data?.qrurl;
          if (!url || new URL(url).origin !== 'https://music.163.com')
            throw { status: 502, body: { code: 502, msg: '登录二维码地址无效' }, cookie: [] };
          response.body.data.qrimg = await qr.toDataURL(url, {
            errorCorrectionLevel: 'M', margin: 4, width: 300
          });
        }
        return response;
      };
    }
    if (entry.route === '/login/qr/check') {
      entry.module = async (query, request) => {
        try {
          const result = await request('/api/login/qrcode/client/login',
            { key: query.key, type: 3 }, option(query));
          return { status: 200, body: { ...result.body, cookie: (result.cookie || []).join(';') },
            cookie: result.cookie || [] };
        } catch (error) {
          // An expired QR can be returned as an API error; preserve that status
          // for the frontend. Network/server errors must not look like success.
          if ([800, 801, 802, 803].includes(error?.body?.code))
            return { status: 200, body: { ...error.body,
              cookie: (error.cookie || []).join(';') }, cookie: error.cookie || [] };
          throw { status: 502, body: { code: 502, msg: '扫码状态查询失败，请刷新二维码重试' }, cookie: [] };
        }
      };
    }
  }
  return modules;
}
