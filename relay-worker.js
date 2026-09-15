/*
 * 记哪儿 —— 备用中转（只有网页直连 DeepSeek 被浏览器跨域拦截时才需要部署它）
 *
 * 它只做一件事：把浏览器发来的 /chat/completions 请求原样转给 api.deepseek.com，
 * 并加上允许网页访问的响应头。它不保存任何数据，你的 Key 也不经过存储。
 *
 * 部署方法见 README 的「被浏览器拦截了怎么办」一节。
 */

const ALLOWED_PATH = '/chat/completions';
const TARGET = 'https://api.deepseek.com';

export default {
  async fetch(request) {
    // 只允许 POST 这一个路径
    if (request.method !== 'POST' || new URL(request.url).pathname !== ALLOWED_PATH) {
      return new Response('Not Found', { status: 404, headers: cors() });
    }

    let body;
    try { body = await request.text(); }
    catch (e) { return new Response('Bad Request', { status: 400, headers: cors() }); }

    const upstream = await fetch(TARGET + ALLOWED_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.get('Authorization') || ''
      },
      body
    });

    const resp = new Response(upstream.body, {
      status: upstream.status,
      headers: Object.assign(cors(), { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' })
    });
    return resp;
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
